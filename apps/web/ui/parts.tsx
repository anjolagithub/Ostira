"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowClockwise, ArrowRight, Check, Copy, HandPalm, X } from "@phosphor-icons/react";
import type { ScenarioEntry } from "@ostira/core/dataset";
import type { Decision, DiffLine, EvaluationResult, Finding, PipelineStage } from "@ostira/core";
import { BASELINE } from "./programs";
import { CATEGORY_LABEL, amount, dateTimeUtc, humanize, intentSentence, isKnown, ms, nameOf, programName, shortAddr, shortHash, timeUtc, type Actors } from "./format";
import { BRAND } from "./brand";
import { useRuntime } from "./runtime";

// ---------------------------------------------------------------- verdict glyphs

const GLYPH: Record<Decision, ReactNode> = {
  ALLOW: <Check weight="bold" />,
  REVIEW: <HandPalm weight="bold" />,
  BLOCK: <X weight="bold" />,
};

export function Glyph({ d }: { d: Decision }) {
  return (
    <span className="glyph" data-decision={d} aria-hidden="true">
      {GLYPH[d]}
    </span>
  );
}

export function Chip({ d }: { d: Decision }) {
  return (
    <span className="chip" data-decision={d}>
      <Glyph d={d} />
      {d}
    </span>
  );
}

// ---------------------------------------------------------------- small utilities

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={label}
      title={done ? "Copied" : label}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => { setDone(true); window.setTimeout(() => setDone(false), 1200); },
          () => {},
        );
      }}
    >
      {done ? <Check weight="bold" /> : <Copy />}
    </button>
  );
}

/** A machine-readable code, always copyable. */
export function Code({ code }: { code: string }) {
  return (
    <span className="code-tag">
      <code>{code}</code>
      <CopyButton value={code} label={`Copy code ${code}`} />
    </span>
  );
}

function Who({ address, actors }: { address: string; actors: Actors }) {
  const known = isKnown(address, actors);
  const name = nameOf(address, actors);
  return (
    <span className="addr">
      <b>{name}</b>
      {known && <span className="mono">{shortAddr(address)}</span>}
    </span>
  );
}

/** Ticks once a second. Only used where something depends on the clock (expiry). */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

// ---------------------------------------------------------------- verdict language

/** The findings that decided the verdict, strictest first. */
export function deciding(r: EvaluationResult): Finding[] {
  return r.reasons.filter((f) => f.decision === r.decision);
}

/** One plain line under the verdict word. Exact about which kind of failure it was. */
export function headline(r: EvaluationResult): { title: string; detail?: string } {
  const top = r.reasons[0];
  if (top?.category === "UNSUPPORTED") return { title: "Verification unavailable", detail: "This transaction uses an unsupported program or token extension, so it is blocked." };
  if (top?.category === "SIMULATION_FAILED") return { title: "Unable to verify", detail: `The transaction could not be simulated. ${BRAND.name} will not authorize an unverified transaction.` };
  if (top?.category === "INVALID_REQUEST") return { title: "Request rejected", detail: "The intent is invalid or names an unknown asset, so nothing was simulated." };
  if (r.decision === "BLOCK" && !r.intentMatch) return { title: "Transaction does not match the declared intent." };
  if (r.decision === "BLOCK") return { title: "The effect matches the intent, but policy forbids it." };
  if (r.decision === "REVIEW") return { title: "The effect matches the intent. Policy needs a human to approve it." };
  return { title: "Every effect was declared and policy passed." };
}

// ---------------------------------------------------------------- verdict band

export function VerdictBand({ entry, animate = false }: { entry: ScenarioEntry; animate?: boolean }) {
  const { dataset, resolutions } = useRuntime();
  const r = entry.result;
  const actors = dataset!.actors;
  const resolved = resolutions[r.evaluationId];
  const h = headline(r);
  const codes = [...new Set(deciding(r).map((f) => f.code))];
  return (
    <section className={`band ${animate ? "band-enter" : ""}`} data-decision={r.decision} aria-label={`Verdict ${r.decision}`}>
      <div className="band-main">
        <div className="band-word" key={r.evaluationId}>
          <Glyph d={r.decision} />
          {r.decision}
        </div>
        <div className="band-intent">{intentSentence(r.intent as never, actors)}</div>
      </div>
      <div className="band-side">
        <strong>{h.title}</strong>
        {h.detail && <span className="band-detail">{h.detail}</span>}
        {resolved && (
          <span className="band-detail">{resolved.action === "APPROVE" ? "Approved by a human. Recorded beside the evaluation." : "Rejected by a human. The agent may not sign."}</span>
        )}
        {codes.length > 0 && <span className="band-codes">{codes.map((c) => <Code key={c} code={c} />)}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- effect diff

export const OP_LABEL: Record<DiffLine["op"], string> = {
  "=": "Declared and confirmed by simulation",
  "+": "Happens, but was not declared",
  "-": "Declared, but does not happen",
  "~": "Network fees and rent",
};
export const OP_STATUS: Record<DiffLine["op"], string> = { "=": "confirmed", "+": "undeclared", "-": "missing", "~": "network/rent" };

const AUTH: Record<string, string> = { owner: "owner", closeAuthority: "close authority", mintAuthority: "mint authority", freezeAuthority: "freeze authority" };

export function describe(line: DiffLine, actors: Actors): { text: ReactNode; sub?: ReactNode; amt: string } {
  switch (line.kind) {
    case "asset":
      return line.direction === "out"
        ? { text: <><Who address={line.owner} actors={actors} /> sends</>, amt: `−${amount(line.amount)} ${line.symbol}` }
        : { text: <><Who address={line.owner} actors={actors} /> receives</>, amt: `+${amount(line.amount)} ${line.symbol}` };
    case "allowance":
      return {
        text: line.unlimited
          ? <><Who address={line.spender} actors={actors} /> can spend all of the agent&rsquo;s {line.symbol}</>
          : <><Who address={line.spender} actors={actors} /> can spend the agent&rsquo;s {line.symbol}</>,
        sub: "Token delegate set on the agent's token account",
        amt: line.unlimited ? "Unlimited" : `up to ${amount(line.amount)} ${line.symbol}`,
      };
    case "sol":
      if (line.reason === "fees") return { text: "Network fees and rent", amt: `${line.amount} SOL` };
      return line.direction === "out"
        ? { text: <><Who address={line.account} actors={actors} /> sends SOL</>, amt: `−${line.amount} SOL` }
        : { text: <><Who address={line.account} actors={actors} /> receives SOL</>, amt: `+${line.amount} SOL` };
    case "authority":
      return {
        text: <>{line.field === "mintAuthority" || line.field === "freezeAuthority" ? "Token mint" : "Token account"} {AUTH[line.field] ?? line.field} changes to {line.to ? <Who address={line.to} actors={actors} /> : "nobody"}</>,
        sub: <span className="mono">{shortAddr(line.tokenAccount)}</span>,
        amt: "Control lost",
      };
    case "closed":
      return { text: <>Token account is closed, its rent leaves</>, sub: <span className="mono">{shortAddr(line.tokenAccount)}</span>, amt: "Closed" };
    case "supply":
      return {
        text: <>{line.direction === "mint" ? "New" : "Burned"} {line.symbol} {line.direction === "mint" ? "is minted" : "from the treasury"}</>,
        sub: "Total token supply changes",
        amt: `${line.direction === "mint" ? "+" : "−"}${amount(line.amount)} ${line.symbol}`,
      };
    case "frozen":
      return { text: <>Token account is frozen</>, sub: <span className="mono">{shortAddr(line.tokenAccount)}</span>, amt: "Frozen" };
    case "program":
      return {
        text: <>Calls <b>{programName(line.programId)}</b>, which is not on the allowlist</>,
        sub: <span className="mono">{line.programId}{line.depth === "inner" ? " via CPI" : ""}</span>,
        amt: "Unapproved",
      };
  }
}

export function DiffRows({ lines, actors, shown, flash }: { lines: DiffLine[]; actors: Actors; shown?: (i: number) => boolean; flash?: boolean }) {
  return (
    <>
      {lines.map((l, i) => {
        const d = describe(l, actors);
        return (
          <div className="diff-row" data-op={l.op} data-shown={shown ? shown(i) : undefined} data-flash={flash || undefined} role="row" key={i}>
            <span className="diff-op" role="cell" title={OP_LABEL[l.op]}>
              <span aria-hidden="true">{l.op === "-" ? "−" : l.op}</span>
              <span className="sr-only">{OP_LABEL[l.op]}</span>
            </span>
            <span className="diff-text" role="cell">
              {d.text}
              {d.sub && <span className="diff-sub">{d.sub}</span>}
            </span>
            <span className="diff-amt" role="cell">{d.amt}</span>
            <span className="diff-status" role="cell">{OP_STATUS[l.op]}</span>
          </div>
        );
      })}
    </>
  );
}

export function EffectDiff({ entry, reveal = false }: { entry: ScenarioEntry; reveal?: boolean }) {
  const { dataset } = useRuntime();
  const actors = dataset!.actors;
  const r = entry.result;
  if (!r.economicEffect) {
    const h = headline(r);
    return (
      <div className="empty-state" data-decision={r.decision}>
        <strong>{h.title}</strong>
        <p>{h.detail ?? `No effect was observed. ${BRAND.name} stopped before simulation finished, so nothing could be confirmed.`}</p>
      </div>
    );
  }
  const ops = new Set(r.diff.map((l) => l.op));
  return (
    <div className="sect" data-decision={r.decision}>
      <div className={`diff ${reveal ? "diff-reveal" : ""}`} role="table" aria-label="Declared intent compared with simulated effect">
        <div className="diff-head" role="row">
          <span role="columnheader"><span className="sr-only">Status symbol</span></span>
          <span role="columnheader">Effect</span>
          <span role="columnheader" className="r">Amount</span>
          <span role="columnheader" className="r">Status</span>
        </div>
        <DiffRows lines={r.diff} actors={actors} />
      </div>
      <div className="diff-legend">
        {(["=", "+", "-", "~"] as const).filter((o) => ops.has(o)).map((o) => (
          <span key={o}><code>{o === "-" ? "−" : o}</code>{OP_LABEL[o]}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reasons

export function Reasons({ result }: { result: EvaluationResult }) {
  const { dataset } = useRuntime();
  if (result.reasons.length === 0) {
    return <p className="empty-note">Every observed effect was declared, and every policy rule passed.</p>;
  }
  return (
    <div className="reasons">
      {result.reasons.map((f, i) => (
        <div className="reason" key={i}>
          <Glyph d={f.decision} />
          <p>{humanize(f.message, dataset!.actors)}</p>
          <div className="reason-meta">
            <Code code={f.code} />
            {f.category && <span className="cat">{CATEGORY_LABEL[f.category] ?? f.category}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pipeline

const STAGES: PipelineStage["stage"][] = ["validate", "decode", "simulate", "extract", "match", "policy", "decide"];
export const STAGE_LABEL: Record<PipelineStage["stage"], string> = {
  validate: "Intent validated",
  decode: "Transaction inspected",
  simulate: "Simulation",
  extract: "Effects extracted",
  match: "Intent compared",
  policy: "Policy evaluated",
  decide: "Decision",
};
const STAGE_HELP: Record<PipelineStage["stage"], string> = {
  validate: "Strict schema; free text never reaches the engine",
  decode: "Accounts, instructions, unsupported programs",
  simulate: "Dry run, nothing signed or broadcast",
  extract: "Before and after state becomes effects",
  match: "Every effect declared, every declared effect present",
  policy: "Limits and allowlists for this agent",
  decide: "Strictest finding wins",
};

export function Pipeline({ result }: { result: EvaluationResult }) {
  const byStage = new Map(result.pipeline.map((p) => [p.stage, p]));
  const total = result.pipeline.reduce((s, p) => s + p.ms, 0);
  return (
    <div className="sect">
      <div className="sect-head">
        <h3>Pipeline</h3>
        <p>{ms(total)} end to end, measured by the engine on {result.simulator === "litesvm" ? "LiteSVM" : "RPC"}</p>
      </div>
      <ol className="pipeline">
        {STAGES.map((s, i) => {
          const p = byStage.get(s);
          const state = !p ? "skipped" : String(p.ok);
          return (
            <li className="stage" key={s} data-ok={state} data-decision={p && !p.ok ? result.decision : undefined}>
              <span className="stage-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="stage-mark" aria-hidden="true">{state === "true" ? <Check weight="bold" /> : state === "false" ? <X weight="bold" /> : null}</span>
              <span className="stage-name">{STAGE_LABEL[s]}</span>
              <span className="stage-note">{p?.note ?? (p ? STAGE_HELP[s] : "Not reached")}</span>
              <span className="stage-ms">{p ? ms(p.ms) : "skipped"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- transaction + CPI tree

export function Built({ entry }: { entry: ScenarioEntry }) {
  const injected = new Set(entry.injected ?? []);
  const any = injected.size > 0 && entry.result.decision !== "ALLOW";
  return (
    <div className="sect">
      <div className="sect-head">
        <h3>Transaction</h3>
        <p>{entry.instructions.length} instructions as the agent built them, unsigned</p>
      </div>
      <ol className="built">
        {entry.instructions.map((ix, i) => {
          const flag = any && injected.has(i);
          return (
            <li className="built-row" key={i} data-injected={flag}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              <code className="mono">{ix}</code>
              {flag && <span className="tag-undeclared">Undeclared effect</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface TreeNode { programId: string; type?: string; children: { programId: string; type?: string }[] }

export function Trace({ result }: { result: EvaluationResult }) {
  const fx = result.economicEffect;
  if (!fx) return null;
  const nodes: TreeNode[] = [];
  for (const p of fx.programInteractions) {
    if (p.depth === "outer" || nodes.length === 0) nodes.push({ programId: p.programId, type: p.instructionType, children: [] });
    else nodes[nodes.length - 1].children.push({ programId: p.programId, type: p.instructionType });
  }
  const allowed = new Set(BASELINE);
  const inner = fx.programInteractions.filter((p) => p.depth === "inner").length;
  const label = (id: string, type?: string) => (
    <>
      <span className="tree-prog">{programName(id)}</span>
      {type && <span className="tree-type">{type}</span>}
      {!allowed.has(id) && <span className="tag-undeclared">Not on allowlist</span>}
    </>
  );
  return (
    <div className="sect">
      <div className="sect-head">
        <h3>CPI trace</h3>
        <p>{nodes.length} outer, {inner} via CPI, {String(fx.computeUnits)} compute units</p>
      </div>
      <div className="tree" role="tree" aria-label="Instruction tree, outer instructions and cross-program invocations">
        <div className="tree-root">Transaction</div>
        {nodes.map((n, i) => (
          <div className="tree-node" role="treeitem" aria-expanded={n.children.length ? true : undefined} key={i} data-flag={!allowed.has(n.programId)}>
            <div className="tree-row">{label(n.programId, n.type)}</div>
            {n.children.length > 0 && (
              <div className="tree-children" role="group">
                {n.children.map((c, j) => (
                  <div className="tree-row tree-child" role="treeitem" key={j} data-flag={!allowed.has(c.programId)}>{label(c.programId, c.type)}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {result.logs.length > 0 && (
        <details className="logs">
          <summary>View raw program logs ({result.logs.length} lines)</summary>
          <pre>{result.logs.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- signing gate (binding + expiry)

export function SigningGate({ entry, onReevaluated }: { entry: ScenarioEntry; onReevaluated?: (e: ScenarioEntry) => void }) {
  const { mode, reevaluate, resolutions, notify } = useRuntime();
  const r = entry.result;
  const live = mode === "live";
  const now = useNow(live);
  const [busy, setBusy] = useState(false);
  const left = Math.ceil((Date.parse(r.expiresAt) - now) / 1000);
  const expired = live && left <= 0;
  const approved = resolutions[r.evaluationId]?.action === "APPROVE";
  const mayAuthorize = r.decision === "ALLOW" || (r.decision === "REVIEW" && approved);
  const ttl = Math.round((Date.parse(r.expiresAt) - Date.parse(r.evaluatedAt)) / 1000);

  const again = async () => {
    setBusy(true);
    try {
      const e = await reevaluate(entry);
      onReevaluated?.(e);
      notify(`Re-evaluated: ${e.result.decision}`);
    } catch (err) {
      notify(`Re-evaluation failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  let state: "expired" | "ok" | "wait" | "no";
  if (!mayAuthorize) state = r.decision === "REVIEW" ? "wait" : "no";
  else state = expired ? "expired" : "ok";

  return (
    <div className="sect">
      <div className="sect-head">
        <h3>Before signing</h3>
        <p>The verdict covers this exact message, for {ttl} seconds</p>
      </div>
      <div className="gate" data-state={state}>
        <div className="gate-status">
          {state === "expired" ? (
            <>
              <strong>Evaluation expired</strong>
              <span>The transaction must be simulated again before signing.</span>
            </>
          ) : state === "ok" ? (
            <>
              <strong>An {BRAND.name}-integrated wallet may sign this exact transaction{live ? `, for ${left} more seconds` : ""}.</strong>
              <span>Any change to the message, even a new blockhash, needs a new evaluation.</span>
            </>
          ) : state === "wait" ? (
            <>
              <strong>Not signable until a human approves it.</strong>
              <span>After approval, the same fingerprint and expiry checks still apply.</span>
            </>
          ) : (
            <>
              <strong>Signing is refused for this transaction.</strong>
              <span>A wallet that checks with {BRAND.name} will not sign it.</span>
            </>
          )}
          {expired && (
            <button className="btn btn-sm" onClick={again} disabled={busy}>
              <ArrowClockwise size={14} aria-hidden="true" />{busy ? "Re-evaluating" : "Re-evaluate"}
            </button>
          )}
        </div>
        <dl className="gate-facts">
          <div><dt>Message fingerprint</dt><dd><span className="mono">sha256:{shortHash(r.txFingerprint, 10)}</span><CopyButton value={r.txFingerprint} label="Copy transaction fingerprint" /></dd></div>
          <div><dt>Simulated at slot</dt><dd className="mono">{r.simulation.slot ?? "not simulated"}</dd></div>
          <div><dt>Expires</dt><dd className="mono">{timeUtc(r.expiresAt)}{!live && <span className="faint"> (recorded)</span>}</dd></div>
        </dl>
        <code className="gate-call">verifyBeforeSigning(result, tx) <ArrowRight size={11} aria-hidden="true" /> {state === "ok" ? "{ ok: true }" : state === "expired" ? "EXPIRED" : "NOT_ALLOWED"}</code>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- audit

export function Audit({ result }: { result: EvaluationResult }) {
  const rows: [string, string, string?][] = [
    ["Evaluation ID", result.evaluationId],
    ["Transaction fingerprint", `sha256:${result.txFingerprint}`],
    ["Policy version", result.policyVersion],
    ["Simulation slot", result.simulation.slot ?? "not simulated"],
    ["Agent", result.agentWallet],
    ["Created", dateTimeUtc(result.evaluatedAt), result.evaluatedAt],
    ["Expires", dateTimeUtc(result.expiresAt), result.expiresAt],
    ["Simulator", result.simulator === "litesvm" ? "LiteSVM, SPL Token program" : "Solana RPC simulateTransaction"],
  ];
  return (
    <div className="sect">
      <div className="sect-head">
        <h3>Audit record</h3>
        <p>Immutable once written; a human review is recorded beside it</p>
      </div>
      <dl className="audit">
        {rows.map(([k, v, raw]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd><span className="mono">{v}</span><CopyButton value={raw ?? v} label={`Copy ${k.toLowerCase()}`} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- human review

export function ReviewBar({ entry }: { entry: ScenarioEntry }) {
  const { resolutions, resolve, notify, mode, dataset } = useRuntime();
  const result = entry.result;
  const [busy, setBusy] = useState(false);
  if (result.decision !== "REVIEW") return null;
  const res = resolutions[result.evaluationId];
  if (res) {
    return (
      <div className="resolved" data-decision={res.action === "APPROVE" ? "ALLOW" : "BLOCK"}>
        <Glyph d={res.action === "APPROVE" ? "ALLOW" : "BLOCK"} />
        <span><strong>{res.action === "APPROVE" ? "Approved" : "Rejected"}</strong> by {res.by} at {timeUtc(res.at)}. Recorded beside {result.evaluationId}; the evaluation itself is unchanged.</span>
      </div>
    );
  }
  const act = async (a: "APPROVE" | "REJECT") => {
    setBusy(true);
    try {
      await resolve(result.evaluationId, a);
      notify(a === "APPROVE" ? "Approved. Recorded beside the evaluation." : "Rejected. The agent may not sign.");
    } catch (e) {
      notify(`Couldn't record the decision: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const i = result.intent as { action: string; amount: string; asset: string; recipient?: string; spender?: string } | null;
  const who = i?.recipient ?? i?.spender;
  return (
    <div className="review" data-decision="REVIEW">
      <div className="review-head">
        <strong>This {i?.action === "APPROVE" ? "allowance" : "payment"} is waiting for approval.</strong>
        <span className="muted">The effect matches the intent; policy asks for a human.{mode === "snapshot" ? " In this preview your decision is kept only in this tab." : ""}</span>
      </div>
      {i && (
        <dl className="review-facts">
          <div><dt>{i.action === "APPROVE" ? "Allowance" : "Pay"}</dt><dd>{amount(i.amount)} {i.asset}</dd></div>
          {who && <div><dt>{i.action === "APPROVE" ? "Spender" : "Recipient"}</dt><dd>{nameOf(who, dataset!.actors)}</dd></div>}
          <div><dt>Reason</dt><dd className="review-codes">{deciding(result).map((f) => <Code key={f.code} code={f.code} />)}</dd></div>
        </dl>
      )}
      <div className="review-actions">
        <button className="btn" disabled={busy} onClick={() => act("REJECT")}>Reject</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => act("APPROVE")}>{i?.action === "APPROVE" ? "Approve allowance" : "Approve payment"}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- loading: name the step

const VERIFY_STEPS = ["Inspecting transaction", "Simulating", "Extracting effects", "Comparing intent", "Evaluating policy"];

/** Shown while the engine works. It names the process; it does not claim timings. */
export function Verifying() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => Math.min(n + 1, VERIFY_STEPS.length - 1)), 260);
    return () => window.clearInterval(t);
  }, []);
  return (
    <ol className="verifying" aria-live="polite" aria-label="Verifying">
      {VERIFY_STEPS.map((s, n) => (
        <li key={s} data-state={n < i ? "done" : n === i ? "active" : "pending"}>{s}</li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- composed detail

export function EvaluationDetail({ entry, reveal = false, onReevaluated }: { entry: ScenarioEntry; reveal?: boolean; onReevaluated?: (e: ScenarioEntry) => void }) {
  const r = entry.result;
  return (
    <div className="detail">
      <VerdictBand entry={entry} animate={reveal} />
      <ReviewBar entry={entry} />
      <div className="sect">
        <div className="sect-head">
          <h3>Effect Diff</h3>
          <p>Declared intent against what simulation observed</p>
        </div>
        <EffectDiff entry={entry} reveal={reveal} />
      </div>
      <div className="sect" id="why">
        <div className="sect-head">
          <h3>Why {BRAND.name} {r.decision === "ALLOW" ? "allowed" : r.decision === "REVIEW" ? "asked for review" : "blocked"} this</h3>
          <p>{r.economicEffect ? `${r.intentMatch ? "Intent matches the effect" : "Intent does not match the effect"}, policy ${r.policyPassed ? "passed" : "raised findings"}` : "Stopped before an effect could be observed"}</p>
        </div>
        <Reasons result={r} />
      </div>
      <SigningGate entry={entry} onReevaluated={onReevaluated} />
      <Pipeline result={r} />
      <div className="detail-grid">
        <Built entry={entry} />
        <Trace result={r} />
      </div>
      <Audit result={r} />
    </div>
  );
}

