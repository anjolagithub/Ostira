"use client";
import { FINDING_CATEGORY } from "@ostira/core/codes";
import { Chip, CopyButton } from "./parts";
import { CATEGORY_LABEL } from "./format";
import { BRAND } from "./brand";
import { useRuntime } from "./runtime";
import { HERO_ID } from "./overview";

const VERDICT_OF: Record<string, "BLOCK" | "REVIEW" | "configurable"> = {
  NEW_RECIPIENT: "configurable", UNKNOWN_SPENDER: "configurable", UNKNOWN_PROGRAM: "configurable",
  AMOUNT_ABOVE_REVIEW_THRESHOLD: "REVIEW", AMOUNT_ABOVE_LIMIT: "REVIEW",
};

const QUICK = `const result = await ostira.evaluate({
  intent: { action: "PAY", asset: "USDC", amount: "500", recipient: alice },
  transaction,
});

if (result.decision !== "ALLOW") {
  throw new Error(result.reasons[0].code);
}
if (!verifyBeforeSigning(result, transaction).ok) {
  throw new Error("Transaction changed or verdict expired: re-evaluate");
}

await wallet.sign(transaction);`;

export function DocsView() {
  const { dataset } = useRuntime();
  const d = dataset!;
  const hero = d.scenarios[HERO_ID].result;
  const contract = {
    decision: hero.decision,
    evaluationId: hero.evaluationId,
    txFingerprint: hero.txFingerprint,
    policyVersion: hero.policyVersion,
    simulation: hero.simulation,
    evaluatedAt: hero.evaluatedAt,
    expiresAt: hero.expiresAt,
    intentMatch: hero.intentMatch,
    reasons: hero.reasons.map((f) => ({ code: f.code, category: f.category, decision: f.decision, message: f.message })),
  };
  const json = JSON.stringify(contract, null, 2);
  const codes = Object.keys(FINDING_CATEGORY) as (keyof typeof FINDING_CATEGORY)[];

  return (
    <div className="page">
      <article className="docs">
        <header className="docs-head">
          <h1>Docs</h1>
          <p className="muted">{BRAND.name} answers one question before a wallet signs: does this transaction do exactly what the agent declared, and is the agent allowed to do it?</p>
        </header>

        <section>
          <h2>Quick start</h2>
          <p>Send the structured intent and the unsigned transaction. Sign only on ALLOW, and only the transaction that was evaluated.</p>
          <div className="code-wrap"><pre className="code">{QUICK}</pre><CopyButton value={QUICK} label="Copy example" /></div>
        </section>

        <section>
          <h2>Verdicts</h2>
          <div className="rules">
            <div className="rule"><p>Every observed effect was declared and policy passed. An integrated wallet may sign this exact transaction until it expires.</p><Chip d="ALLOW" /></div>
            <div className="rule"><p>The effect matches the intent, but policy needs a human. The approval is recorded beside the evaluation; the evaluation itself never changes.</p><Chip d="REVIEW" /></div>
            <div className="rule"><p>The transaction does something undeclared, breaks policy, or could not be verified. Do not sign.</p><Chip d="BLOCK" /></div>
          </div>
          <p className="muted">There is no partial verdict. {BRAND.name} never rewrites a transaction, so a payment above the autonomous limit is REVIEW, with the limit returned as <code>suggestedMaxAmount</code> for information only.</p>
        </section>

        <section>
          <h2>Before signing</h2>
          <p><code>verifyBeforeSigning(result, transaction)</code> passes only when all of these hold:</p>
          <ul className="docs-list">
            <li>The decision is ALLOW, or REVIEW that a human approved.</li>
            <li>The evaluation has not expired. A verdict is valid for 30 seconds after simulation, because chain state moves.</li>
            <li>The sha256 of the transaction&rsquo;s message bytes equals <code>txFingerprint</code>. Signatures are excluded, so signing does not change it; any other change, including a new blockhash, does.</li>
          </ul>
          <p className="muted">Over HTTP: <code>POST /api/v1/evaluations/:id/verify-signing</code> with <code>{"{ serialized }"}</code>.</p>
        </section>

        <section>
          <h2>Response</h2>
          <p>The API response is authoritative; never infer a decision from the UI. This is the real response for &ldquo;Pay Alice 500 USDC&rdquo; with a hidden approval, trimmed to the contract fields.</p>
          <div className="code-wrap"><pre className="code code-json">{json}</pre><CopyButton value={json} label="Copy response" /></div>
        </section>

        <section>
          <h2>Endpoints</h2>
          <dl className="endpoints">
            <div><dt><code>POST /api/v1/evaluate</code></dt><dd>Evaluate <code>{"{ agentId, intent, transaction: { serialized } }"}</code>. Dry run only.</dd></div>
            <div><dt><code>GET /api/v1/evaluations/:id</code></dt><dd>The stored evaluation and any human resolution.</dd></div>
            <div><dt><code>POST /api/v1/evaluations/:id/approve</code></dt><dd>Resolve a REVIEW. <code>/reject</code> for the opposite.</dd></div>
            <div><dt><code>POST /api/v1/evaluations/:id/verify-signing</code></dt><dd>The last check before signing.</dd></div>
            <div><dt><code>GET /api/v1/policies/:agentId</code></dt><dd>The policy and its content hash. <code>PUT</code> replaces it.</dd></div>
          </dl>
        </section>

        <section>
          <h2>Finding codes</h2>
          <p>Every BLOCK or REVIEW carries at least one finding with a code and a category, so an integration can branch on the kind of failure.</p>
          <div className="table-wrap">
            <table className="attack-table codes-table">
              <thead><tr><th>Code</th><th>Category</th><th>Verdict</th></tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c}>
                    <td><code className="code-inline">{c}</code></td>
                    <td>{CATEGORY_LABEL[FINDING_CATEGORY[c]]}</td>
                    <td>{VERDICT_OF[c] === "configurable" ? <span className="faint">Set by policy</span> : <Chip d={VERDICT_OF[c] ?? "BLOCK"} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Scope of v1</h2>
          <ul className="docs-list">
            <li>Intents: PAY and APPROVE. SWAP comes next.</li>
            <li>Tokens: the original SPL Token program only. Token-2022 and its extensions (transfer hooks, permanent delegates, transfer fees, confidential balances) are unsupported and fail closed with <code>UNSUPPORTED_PROGRAM</code>.</li>
            <li>Transactions that use address lookup tables are blocked with <code>UNDECODABLE_TRANSACTION</code>.</li>
            <li>Effects are what simulation observes: token balances, allowances, token account and mint authorities, closures, freezes, supply changes, SOL movement, and every program reached, including through CPI. No undeclared token recipient may receive value, and SOL may move only within the fee and rent cap.</li>
            <li>Simulation reflects state at one slot. That is why a verdict expires and is bound to one message.</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
