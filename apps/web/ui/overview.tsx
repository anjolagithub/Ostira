"use client";
import { ArrowRight } from "@phosphor-icons/react";
import type { LiveRun, ScenarioEntry } from "@ostira/core/dataset";
import type { Decision } from "@ostira/core";
import { HeroReplay } from "./replay";
import { GateIllustration, Logo } from "./brand-art";
import { Chip, Code, DiffRows, Glyph, deciding } from "./parts";
import { amount, dateTimeUtc, humanize, nameOf, shortAddr } from "./format";
import { story } from "./story";
import { BRAND } from "./brand";
import { NavLink, useRuntime, type AttackId, type CoreAttackId, type ExtendedAttackId } from "./runtime";

export const HERO_ID = "pay-alice+hiddenApproval";

/** The signature visual: declared intent, what simulation observed, the verdict. Real engine output. */
function HeroDiff({ entry }: { entry: ScenarioEntry }) {
  const { dataset } = useRuntime();
  const actors = dataset!.actors;
  const r = entry.result;
  const i = r.intent as { action: string; amount: string; asset: string; recipient?: string } | null;
  const lines = r.diff.filter((l) => l.op !== "~");
  const codes = [...new Set(deciding(r).map((f) => f.code))];
  return (
    <figure className="hero-diff" data-decision={r.decision} aria-label="The killer case, evaluated by the engine">
      <div className="hd-row">
        <span className="hd-k">Agent declares</span>
        <div className="hd-intent">
          <span className="hd-action">{i?.action}</span>
          <span className="hd-amt">{i ? `${amount(i.amount)} ${i.asset}` : ""}</span>
          {i?.recipient && <span className="hd-to">to {nameOf(i.recipient, actors)}</span>}
        </div>
      </div>
      <div className="hd-row">
        <span className="hd-k">Simulation observes</span>
        <div className="diff hd-diff" role="table" aria-label="Observed effects">
          <DiffRows lines={lines} actors={actors} />
        </div>
      </div>
      <div className="hd-verdict">
        <div className="hd-word"><Glyph d={r.decision} />{r.decision}</div>
        <div className="hd-codes">{codes.map((c) => <Code key={c} code={c} />)}</div>
        <p className="hd-story">{story(entry, actors)}</p>
      </div>
      <figcaption className="hd-foot">
        <span>Engine output for this exact transaction, simulated against the SPL Token program</span>
        <NavLink to={{ page: "console", id: HERO_ID }}>Open in console<ArrowRight size={12} aria-hidden="true" /></NavLink>
      </figcaption>
    </figure>
  );
}

/** Base units (6 decimals) to a UI amount, exactly. */
function usdc(base?: string) {
  if (!base) return "";
  const s = base.padStart(7, "0");
  const w = s.slice(0, -6), f = s.slice(-6).replace(/0+$/, "");
  return amount(w + (f ? "." + f : ""));
}

function clusterName(url: string) {
  if (/devnet/.test(url)) return "Solana Devnet";
  if (/mainnet/.test(url)) return "Solana mainnet";
  if (/127\.0\.0\.1|localhost/.test(url)) return "a local Solana validator";
  return "a Solana RPC node";
}

/** The same engine over real RPC: a smoke run against a live cluster, recorded by scripts/devnet-smoke.ts. */
function LiveRunCard({ run }: { run: LiveRun }) {
  const cpi = run.results.find((r) => r.cpi);
  return (
    <div className="live-run">
      <div className="live-head">
        <span className="live-dot" aria-hidden="true" />
        <strong>Live cluster run: {run.passed}/{run.total} verdicts as expected</strong>
        <span className="faint">{clusterName(run.cluster)}, solana-core {run.solanaCore}, {dateTimeUtc(run.ranAt)}</span>
      </div>
      <p>The same engine, evaluating real transactions through Solana RPC <code>simulateTransaction</code> against real chain state{cpi ? `, including a payment that creates a token account through ${cpi.cpi} CPI calls` : ""}.{run.sent.signature ? " Then the one transaction it allowed was signed and sent." : ""}</p>
      {run.sent.signature && (
        <dl className="live-facts">
          <div><dt>Simulated effect</dt><dd>+{usdc(run.sent.simulatedDelta)} USDC to Alice</dd></div>
          <div><dt>Executed effect</dt><dd>+{usdc(run.sent.aliceDelta)} USDC to Alice</dd></div>
          <div><dt>Match</dt><dd>{run.sent.simulationMatchedExecution ? "Exact" : "No"}</dd></div>
          <div><dt>Signature</dt><dd className="mono">{shortAddr(run.sent.signature, 8)}</dd></div>
        </dl>
      )}
      <ul className="live-results">
        {run.results.map((r) => (
          <li key={r.name} data-pass={r.pass}>
            <Chip d={r.decision as Decision} />
            <span>{r.name}</span>
            <span className="mono faint">{r.codes[0] ?? "no findings"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Overview() {
  const { dataset } = useRuntime();
  const d = dataset!;
  const hero = d.scenarios[HERO_ID];
  const core = Object.keys(d.attacks) as CoreAttackId[];
  const ext = Object.keys(d.extendedAttacks) as ExtendedAttackId[];
  const row = (a: string, title: string) => {
    const e = d.scenarios[`pay-alice+${a}`];
    if (!e) return null;
    const top = deciding(e.result)[0] ?? e.result.reasons[0];
    return (
      <tr key={a}>
        <td>{title}</td>
        <td className="reason-cell">{top ? humanize(top.message, d.actors) : null}{top && <code className="code-inline">{top.code}</code>}</td>
        <td><NavLink to={{ page: "lab", base: "pay-alice", attacks: [a as AttackId] }} aria-label={`${e.result.decision}: open ${title} in the Attack Lab`}><Chip d={e.result.decision} /></NavLink></td>
      </tr>
    );
  };

  return (
    <div className="page">
      {/* 1 + 2: hero, with the Effect Diff in the first viewport */}
      <section className="hero">
        <div className="hero-copy">
          <h1>See what an agent&rsquo;s transaction would actually do before it&nbsp;signs.</h1>
          <p className="hero-sub">{BRAND.name} simulates the transaction, compares its observable economic effects with the agent&rsquo;s declared intent, and blocks anything that doesn&rsquo;t match.</p>
          <div className="hero-cta">
            <NavLink to={{ page: "lab" }} className="btn btn-primary">Try to get an attack past it<ArrowRight size={14} aria-hidden="true" /></NavLink>
            <NavLink to={{ page: "console", id: HERO_ID }} className="btn">Open the console</NavLink>
          </div>
          <ul className="hero-facts">
            <li>Never holds private keys</li>
            <li>Never broadcasts transactions</li>
            <li>Deterministic rules, not a risk score</li>
          </ul>
        </div>
        <HeroDiff entry={hero} />
      </section>

      {/* 3: how it works */}
      <section className="block-sect">
        <header>
          <h2>How it works</h2>
          <p>Below, the evaluation above replayed step by step. Every value is the engine&rsquo;s own output, timings included; only the pacing is slowed down so you can follow it.</p>
        </header>
        <div className="how">
          <ol className="how-steps">
            <li><b>Declare</b><span>The agent states a structured intent: pay, or approve, an exact amount to an exact address.</span></li>
            <li><b>Simulate</b><span>The unsigned transaction is dry-run. Nothing is signed or broadcast.</span></li>
            <li><b>Compare</b><span>Before and after state becomes effects, including CPI. Each must match the intent.</span></li>
            <li><b>Decide</b><span>ALLOW, REVIEW or BLOCK, with machine-readable reasons. The strictest finding wins.</span></li>
          </ol>
          <HeroReplay attacked={hero} honest={d.scenarios["pay-alice"]} />
        </div>
      </section>

      {/* 4: attack lab CTA */}
      <section className="cta-band">
        <div>
          <h2>Try to get an attack past it</h2>
          <p>Pick an intent, slip attacks into the transaction, and watch the engine judge every combination.</p>
        </div>
        <NavLink to={{ page: "lab", base: "pay-alice", attacks: ["hiddenApproval"] }} className="btn btn-primary">Open the Attack Lab<ArrowRight size={14} aria-hidden="true" /></NavLink>
      </section>

      {/* 5: attack classes */}
      <section className="block-sect">
        <header>
          <h2>Seven attack classes, and six more at the token level</h2>
          <p>Each row is the same honest payment, &ldquo;Pay Alice 500 USDC&rdquo;, with one behaviour slipped into the transaction. Verdicts and reasons are the engine&rsquo;s output.</p>
        </header>
        <div className="table-wrap">
          <table className="attack-table">
            <thead><tr><th>Slipped in</th><th>What simulation showed</th><th>Verdict</th></tr></thead>
            <tbody>
              {core.map((a) => row(a, d.attacks[a].title))}
              <tr className="group-row"><td colSpan={3}>Token-level attacks, tested one at a time</td></tr>
              {ext.map((a) => row(a, d.extendedAttacks[a].title))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 6: proof */}
      <section className="block-sect">
        <div className="proof">
          <div className="proof-num">{d.sweep.blocked}/{d.sweep.total}<small>adversarial cases rejected</small></div>
          <div className="proof-copy">
            <p><strong>{d.sweep.allowed} of {d.sweep.total} adversarial test transactions were incorrectly allowed.</strong> The suite builds every combination of the seven attack classes on six intents, {d.sweep.total} real transactions, and simulates each against the SPL Token program.</p>
            <p>The six token-level attacks are tested one at a time on every intent: {d.extendedSweep.blocked}/{d.extendedSweep.total} rejected. The clean payment and the limited approval are still allowed. These are generated test cases on a local runtime, not production traffic.</p>
          </div>
        </div>
        {d.liveRun && <LiveRunCard run={d.liveRun} />}
      </section>

      {/* 7: developer integration */}
      <section className="block-sect">
        <div className="split">
          <div className="split-col">
            <h2>One call before the wallet signs</h2>
            <p className="muted">Evaluate, check the verdict, then confirm you are signing the exact transaction that was evaluated.</p>
            <pre className="code">
<span className="k">const</span> result = <span className="k">await</span> ostira.evaluate({"{"}{"\n"}
{"  "}intent: {"{ "}action: <span className="s">"PAY"</span>, asset: <span className="s">"USDC"</span>,{"\n"}
{"            "}amount: <span className="s">"500"</span>, recipient: alice {"}"},{"\n"}
{"  "}transaction,{"\n"}
{"}"});{"\n\n"}
<span className="k">if</span> (result.decision !== <span className="s">"ALLOW"</span>) <span className="k">throw</span> result.reasons;{"\n"}
<span className="k">if</span> (!verifyBeforeSigning(result, transaction).ok) <span className="k">throw</span> <span className="s">"re-evaluate"</span>;{"\n\n"}
<span className="k">await</span> wallet.sign(transaction);
            </pre>
            <NavLink to={{ page: "docs" }} className="text-link">Read the docs<ArrowRight size={12} aria-hidden="true" /></NavLink>
          </div>
          {/* 8: security guarantees */}
          <div className="split-col">
            <h2>Security guarantees</h2>
            <ul className="guarantees">
              <li><strong>Never holds or asks for a private key</strong><span>It evaluates unsigned transactions. {BRAND.name}-integrated wallets sign only after ALLOW.</span></li>
              <li><strong>Binds the verdict to the exact transaction</strong><span>A verdict covers one message fingerprint for 30 seconds. Any change needs a new evaluation.</span></li>
              <li><strong>Never broadcasts</strong><span>Evaluation is a dry run and leaves chain state untouched.</span></li>
              <li><strong>Never lets a model overrule a rule</strong><span>Amounts, recipients and allowances are compared exactly, from simulated state.</span></li>
              <li><strong>Fails closed</strong><span>Anything it cannot decode, simulate or support is blocked. V1 covers the original SPL Token program only; Token-2022 is refused.</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* 9: architecture */}
      <section className="block-sect">
        <header>
          <h2>Agent, {BRAND.name}, wallet, chain</h2>
          <p>{BRAND.name} sits between the agent and the wallet. The agent proposes, {BRAND.name} checks what the transaction would do, and only an ALLOW lets an integrated wallet sign and send it.</p>
        </header>
        <GateIllustration />
      </section>

      <footer className="footer">
        <span className="footer-brand"><Logo height={16} /><span>{BRAND.tagline}.</span></span>
        <span>Simulated on {d.simulator === "litesvm" ? "LiteSVM with the real SPL Token program" : "Solana RPC"}, policy {d.policyVersion}.</span>
      </footer>
    </div>
  );
}
