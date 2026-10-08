import { BASELINE_PROGRAMS, toBaseUnits, toUi } from "./policy";
import type { EconomicEffect, FinancialIntent } from "./types";
import { counterparties } from "./matcher";

/**
 * The Effect Diff: declared intent vs observed effect, line by line.
 *   "="  declared and observed
 *   "+"  observed but NOT declared
 *   "-"  declared but NOT observed
 *   "~"  context the intent doesn't restrict (network fees, rent, the other side of a trade)
 */
export type DiffOp = "=" | "+" | "-" | "~";

export type DiffLine =
  | {
      op: DiffOp; kind: "asset"; owner: string; mint: string; symbol: string; amount: string; direction: "in" | "out";
      /** SWAP: the declared bound this line was checked against ("at most" for what is given, "at least" for what is received). */
      bound?: { kind: "max" | "min"; amount: string };
      /** "~" lines on the other side of a trade. */
      reason?: "counterparty";
    }
  | { op: DiffOp; kind: "allowance"; owner: string; spender: string; mint: string; symbol: string; amount: string; unlimited: boolean }
  | { op: DiffOp; kind: "sol"; account: string; amount: string; direction: "in" | "out"; reason?: "fees" }
  | { op: DiffOp; kind: "authority"; tokenAccount: string; field: string; to: string | null }
  | { op: DiffOp; kind: "closed"; tokenAccount: string }
  | { op: DiffOp; kind: "supply"; mint: string; symbol: string; amount: string; direction: "mint" | "burn" }
  | { op: DiffOp; kind: "frozen"; tokenAccount: string }
  | { op: DiffOp; kind: "program"; programId: string; depth: "outer" | "inner" };

export function buildEffectDiff(args: {
  intent: FinancialIntent;
  effect: EconomicEffect;
  agentWallet: string;
  mint: string;
  decimals: number;
  symbol: (mint: string) => string;
  approvedPrograms: string[];
  maxSolSpendLamports: bigint;
  out?: { mint: string; decimals: number; min: bigint };
}): DiffLine[] {
  const { intent, effect, agentWallet, mint, decimals, symbol } = args;
  const lines: DiffLine[] = [];
  const sym = symbol(mint);
  const consumed = new Set<object>();

  if (intent.action === "SWAP" && args.out) {
    const o = args.out;
    const maxIn = toBaseUnits(intent.amount, decimals);
    const give = effect.assetChanges.find((c) => c.owner === agentWallet && c.mint === mint && c.delta < 0n);
    const get = effect.assetChanges.find((c) => c.owner === agentWallet && c.mint === o.mint && c.delta > 0n);
    const maxUi = normalize(intent.amount);
    const minUi = toUi(o.min, o.decimals);
    if (give) {
      consumed.add(give);
      lines.push({ op: -give.delta <= maxIn ? "=" : "+", kind: "asset", owner: agentWallet, mint, symbol: sym, amount: toUi(-give.delta, give.decimals), direction: "out", bound: { kind: "max", amount: maxUi } });
    } else {
      lines.push({ op: "-", kind: "asset", owner: agentWallet, mint, symbol: sym, amount: maxUi, direction: "out", bound: { kind: "max", amount: maxUi } });
    }
    if (get && get.delta >= o.min) {
      consumed.add(get);
      lines.push({ op: "=", kind: "asset", owner: agentWallet, mint: o.mint, symbol: symbol(o.mint), amount: toUi(get.delta, o.decimals), direction: "in", bound: { kind: "min", amount: minUi } });
    } else {
      lines.push({ op: "-", kind: "asset", owner: agentWallet, mint: o.mint, symbol: symbol(o.mint), amount: minUi, direction: "in", bound: { kind: "min", amount: minUi } });
      if (get) {
        consumed.add(get);
        lines.push({ op: "+", kind: "asset", owner: agentWallet, mint: o.mint, symbol: symbol(o.mint), amount: toUi(get.delta, o.decimals), direction: "in", bound: { kind: "min", amount: minUi } });
      }
    }
    // The other side of the trade: context, not an undeclared effect.
    const cps = counterparties(effect, agentWallet);
    for (const c of effect.assetChanges) {
      if (consumed.has(c) || c.owner === agentWallet || !cps.has(c.owner)) continue;
      consumed.add(c);
      lines.push({ op: "~", kind: "asset", owner: c.owner, mint: c.mint, symbol: symbol(c.mint), amount: toUi(c.delta < 0n ? -c.delta : c.delta, c.decimals), direction: c.delta < 0n ? "out" : "in", reason: "counterparty" });
    }
  } else if (intent.action === "PAY") {
    const declared = [
      { owner: agentWallet, amount: intent.amount, direction: "out" as const },
      { owner: intent.recipient, amount: intent.amount, direction: "in" as const },
    ];
    for (const d of declared) {
      const obs = effect.assetChanges.find((c) => !consumed.has(c) && c.owner === d.owner && c.mint === mint && (d.direction === "in" ? c.delta > 0n : c.delta < 0n));
      if (obs) {
        consumed.add(obs);
        const observed = toUi(obs.delta < 0n ? -obs.delta : obs.delta, obs.decimals);
        if (observed === normalize(d.amount)) {
          lines.push({ op: "=", kind: "asset", owner: d.owner, mint, symbol: sym, amount: observed, direction: d.direction });
        } else {
          lines.push({ op: "-", kind: "asset", owner: d.owner, mint, symbol: sym, amount: normalize(d.amount), direction: d.direction });
          lines.push({ op: "+", kind: "asset", owner: d.owner, mint, symbol: sym, amount: observed, direction: d.direction });
        }
      } else {
        lines.push({ op: "-", kind: "asset", owner: d.owner, mint, symbol: sym, amount: normalize(d.amount), direction: d.direction });
      }
    }
  } else if (intent.action === "APPROVE") {
    const grant = effect.approvals.find((a) => a.newDelegate !== null && a.owner === agentWallet && a.mint === mint && a.newDelegate === intent.spender);
    const declaredUnlimited = intent.amount === "unlimited";
    const declaredAmount = declaredUnlimited ? "unlimited" : normalize(intent.amount as string);
    if (grant) {
      consumed.add(grant);
      const observedAmount = grant.unlimited ? "unlimited" : toUi(grant.newAmount, decimals);
      if (observedAmount === declaredAmount) {
        lines.push({ op: "=", kind: "allowance", owner: agentWallet, spender: intent.spender, mint, symbol: sym, amount: observedAmount, unlimited: grant.unlimited });
      } else {
        lines.push({ op: "-", kind: "allowance", owner: agentWallet, spender: intent.spender, mint, symbol: sym, amount: declaredAmount, unlimited: declaredUnlimited });
        lines.push({ op: "+", kind: "allowance", owner: agentWallet, spender: intent.spender, mint, symbol: sym, amount: observedAmount, unlimited: grant.unlimited });
      }
    } else {
      lines.push({ op: "-", kind: "allowance", owner: agentWallet, spender: intent.spender, mint, symbol: sym, amount: declaredAmount, unlimited: declaredUnlimited });
    }
  }

  // Everything observed that the intent did not account for.
  for (const c of effect.assetChanges) {
    if (consumed.has(c)) continue;
    lines.push({ op: "+", kind: "asset", owner: c.owner, mint: c.mint, symbol: symbol(c.mint), amount: toUi(c.delta < 0n ? -c.delta : c.delta, c.decimals), direction: c.delta < 0n ? "out" : "in" });
  }
  for (const a of effect.approvals) {
    if (consumed.has(a) || a.newDelegate === null) continue;
    lines.push({ op: "+", kind: "allowance", owner: a.owner, spender: a.newDelegate, mint: a.mint, symbol: symbol(a.mint), amount: a.unlimited ? "unlimited" : toUi(a.newAmount, a.mint === mint ? decimals : 0), unlimited: a.unlimited });
  }
  for (const a of effect.authorityChanges) lines.push({ op: "+", kind: "authority", tokenAccount: a.tokenAccount, field: a.field, to: a.to });
  for (const c of effect.closedAccounts) lines.push({ op: "+", kind: "closed", tokenAccount: c });
  for (const m of effect.supplyChanges) lines.push({ op: "+", kind: "supply", mint: m.mint, symbol: symbol(m.mint), amount: toUi(m.delta < 0n ? -m.delta : m.delta, m.decimals), direction: m.delta > 0n ? "mint" : "burn" });
  for (const f of effect.frozenAccounts) lines.push({ op: "+", kind: "frozen", tokenAccount: f });
  for (const s of effect.solChanges) {
    if (s.account === agentWallet && s.delta < 0n && -s.delta <= args.maxSolSpendLamports) {
      lines.push({ op: "~", kind: "sol", account: s.account, amount: toUi(-s.delta, 9), direction: "out", reason: "fees" });
    } else if (s.account === agentWallet || s.existedBefore) {
      lines.push({ op: "+", kind: "sol", account: s.account, amount: toUi(s.delta < 0n ? -s.delta : s.delta, 9), direction: s.delta < 0n ? "out" : "in" });
    }
  }
  const allowed = new Set([...BASELINE_PROGRAMS, ...args.approvedPrograms]);
  const seen = new Set<string>();
  for (const p of effect.programInteractions) {
    if (allowed.has(p.programId) || seen.has(p.programId)) continue;
    seen.add(p.programId);
    lines.push({ op: "+", kind: "program", programId: p.programId, depth: p.depth });
  }
  return lines;
}

function normalize(ui: string) {
  if (!ui.includes(".")) return ui.replace(/^0+(?=\d)/, "");
  const [w, f] = ui.split(".");
  const frac = f.replace(/0+$/, "");
  return w.replace(/^0+(?=\d)/, "") + (frac ? "." + frac : "");
}
