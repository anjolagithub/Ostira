import type { Dataset, ScenarioEntry } from "@ostira/core/dataset";
import type { DiffLine } from "@ostira/core";
import { amount, inlineName, intentSentence, type Actors } from "./format";

/** Title of any attack id, core or extended. */
export function attackTitle(d: Dataset, a: string): string {
  return (d.attacks as Record<string, { title: string }>)[a]?.title ?? (d.extendedAttacks as Record<string, { title: string }>)[a]?.title ?? a;
}

export function labelFor(d: Dataset, e: ScenarioEntry) {
  return e.attacks.length ? `${e.title}, with ${e.attacks.map((a) => attackTitle(d, a).toLowerCase()).join(" and ")}` : e.title;
}

function undeclared(l: DiffLine, actors: Actors): string | null {
  switch (l.kind) {
    case "allowance":
      return l.unlimited ? `grants unlimited ${l.symbol} spending authority to an undeclared spender` : `grants an undeclared ${amount(l.amount)} ${l.symbol} allowance`;
    case "asset":
      return l.direction === "in" ? `sends ${amount(l.amount)} ${l.symbol} to ${inlineName(l.owner, actors)}, which was not declared` : `takes an undeclared ${amount(l.amount)} ${l.symbol} from ${inlineName(l.owner, actors)}`;
    case "sol":
      return l.direction === "in" ? `moves ${l.amount} SOL to ${inlineName(l.account, actors)}` : null;
    case "authority":
      return `hands control of a token ${l.field === "mintAuthority" || l.field === "freezeAuthority" ? "mint" : "account"} to another wallet`;
    case "closed":
      return "closes a token account and sends its rent elsewhere";
    case "supply":
      return l.direction === "mint" ? `mints ${amount(l.amount)} new ${l.symbol}` : `burns ${amount(l.amount)} ${l.symbol}`;
    case "frozen":
      return "freezes a token account";
    case "program":
      return "calls a program outside the allowlist";
  }
}

/** One sentence in plain words: what was declared, and what else the transaction would do. */
export function story(e: ScenarioEntry, actors: Actors): string {
  const r = e.result;
  const declared = intentSentence(r.intent as never, actors).replace(/^Pay /, "pays ").replace(/^Approve /, "approves ").replace(/^Swap /, "swaps ");
  const confirmed = r.diff.some((l) => l.op === "=");
  const extra = r.diff.filter((l) => l.op === "+").map((l) => undeclared(l, actors)).filter(Boolean) as string[];
  const missing = r.diff.some((l) => l.op === "-");
  const short = r.diff.find((l) => l.op === "+" && l.kind === "asset" && l.bound?.kind === "min");
  if (short && short.kind === "asset") return `The transaction would deliver only ${amount(short.amount)} ${short.symbol}, below the declared minimum of ${amount(short.bound!.amount)} ${short.symbol}.`;
  const over = r.diff.find((l) => l.op === "+" && l.kind === "asset" && l.bound?.kind === "max");
  if (over && over.kind === "asset") return `The transaction would take ${amount(over.amount)} ${over.symbol} from the agent, more than the declared ${amount(over.bound!.amount)} ${over.symbol}.`;
  if (confirmed && extra.length) return `The transaction ${declared}, but also ${extra[0]}.`;
  if (missing && extra.length) return `The transaction does not do what was declared: it ${extra[0]}.`;
  if (missing) return "The transaction does not deliver what was declared.";
  if (r.decision === "ALLOW") return `The transaction ${declared}, and nothing else.`;
  return "";
}
