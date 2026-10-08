import type { ApproveIntent, EconomicEffect, Finding, PayIntent } from "./types";
import { toUi } from "./policy";
import { U64_MAX } from "./effects";

export interface MatchContext {
  agentWallet: string;
  mint: string;
  decimals: number;
  /** Declared amount in base units (null = "unlimited", APPROVE only). */
  amount: bigint | null;
  maxSolSpendLamports: bigint;
  /** Display name for a mint (symbol if known). */
  symbol: (mint: string) => string;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const AUTHORITY_LABEL = { owner: "owner", closeAuthority: "close authority", mintAuthority: "mint authority", freezeAuthority: "freeze authority" } as const;

/**
 * Does the observed effect equal the declared intent — and nothing more?
 * Every check is deterministic over chain-observed state. No AI, no heuristics, no score.
 */
export function matchPay(intent: PayIntent, fx: EconomicEffect, ctx: MatchContext): Finding[] {
  const out: Finding[] = [];
  const amt = ctx.amount!;
  const sym = ctx.symbol(ctx.mint);
  const fmt = (v: bigint) => `${toUi(v, ctx.decimals)} ${sym}`;

  const recv = fx.assetChanges.find((c) => c.owner === intent.recipient && c.mint === ctx.mint);
  if (!recv || recv.delta <= 0n) {
    out.push({ code: "RECIPIENT_NOT_PAID", decision: "BLOCK", message: `Recipient ${short(intent.recipient)} receives nothing in the simulated result.` });
  } else if (recv.delta !== amt) {
    out.push({ code: "AMOUNT_MISMATCH", decision: "BLOCK", message: `Recipient receives ${fmt(recv.delta)}, but the intent declared ${fmt(amt)}.`, detail: { declared: fmt(amt), observed: fmt(recv.delta) } });
  }

  const sent = fx.assetChanges.find((c) => c.owner === ctx.agentWallet && c.mint === ctx.mint);
  if (sent && -sent.delta > amt) {
    out.push({ code: "UNEXPECTED_ASSET_OUTFLOW", decision: "BLOCK", message: `Agent loses ${fmt(-sent.delta)}, more than the declared ${fmt(amt)}.`, detail: { declared: fmt(amt), observed: fmt(-sent.delta) } });
  }

  for (const c of fx.assetChanges) {
    if (c.owner === intent.recipient && c.mint === ctx.mint) continue;
    if (c.owner === ctx.agentWallet && c.mint === ctx.mint) continue;
    if (c.delta > 0n) {
      out.push({ code: "UNEXPECTED_RECIPIENT", decision: "BLOCK", message: `${short(c.owner)} receives ${toUi(c.delta, c.decimals)} ${ctx.symbol(c.mint)}, which was not declared.`, detail: { owner: c.owner, mint: c.mint, amount: toUi(c.delta, c.decimals) } });
    } else if (c.owner === ctx.agentWallet) {
      out.push({ code: "UNEXPECTED_ASSET_OUTFLOW", decision: "BLOCK", message: `Agent loses ${toUi(-c.delta, c.decimals)} ${ctx.symbol(c.mint)}, an asset that was not declared.`, detail: { mint: c.mint, amount: toUi(-c.delta, c.decimals) } });
    }
  }

  for (const a of fx.approvals) {
    if (a.newDelegate === null) continue; // revocations reduce risk
    out.push(...approvalAsUndeclared(a.newDelegate, a.newAmount, a.unlimited, a.mint === ctx.mint ? ctx.decimals : 0, a.tokenAccount, ctx.symbol(a.mint)));
  }

  out.push(...sideEffects(fx, ctx));
  return out;
}

export function matchApprove(intent: ApproveIntent, fx: EconomicEffect, ctx: MatchContext): Finding[] {
  const out: Finding[] = [];
  const fmt = (v: bigint) => (v === U64_MAX ? "unlimited" : `${toUi(v, ctx.decimals)} ${ctx.symbol(ctx.mint)}`);
  const grants = fx.approvals.filter((a) => a.newDelegate !== null && a.owner === ctx.agentWallet && a.mint === ctx.mint);

  if (grants.length === 0) {
    out.push({ code: "APPROVAL_NOT_GRANTED", decision: "BLOCK", message: `The transaction grants no ${ctx.symbol(ctx.mint)} allowance, although one was declared.` });
  }
  for (const g of grants) {
    if (g.newDelegate !== intent.spender) {
      out.push({ code: "APPROVAL_SPENDER_MISMATCH", decision: "BLOCK", message: `Allowance goes to ${short(g.newDelegate!)}, not the declared spender ${short(intent.spender)}.`, detail: { declared: intent.spender, observed: g.newDelegate } });
    }
    if (ctx.amount !== null && g.newAmount > ctx.amount) {
      out.push({ code: "APPROVAL_EXCEEDS_INTENT", decision: "BLOCK", message: `Allowance is ${fmt(g.newAmount)}, above the declared ${fmt(ctx.amount)}.`, detail: { declared: fmt(ctx.amount), observed: fmt(g.newAmount) } });
    }
  }
  for (const a of fx.approvals) {
    if (a.newDelegate === null || grants.includes(a)) continue;
    out.push(...approvalAsUndeclared(a.newDelegate, a.newAmount, a.unlimited, a.mint === ctx.mint ? ctx.decimals : 0, a.tokenAccount, ctx.symbol(a.mint)));
  }

  for (const c of fx.assetChanges) {
    if (c.delta > 0n && c.owner !== ctx.agentWallet) {
      out.push({ code: "UNEXPECTED_RECIPIENT", decision: "BLOCK", message: `${short(c.owner)} receives ${toUi(c.delta, c.decimals)} ${ctx.symbol(c.mint)}. An approval should move no funds.`, detail: { owner: c.owner, mint: c.mint, amount: toUi(c.delta, c.decimals) } });
    } else if (c.delta < 0n && c.owner === ctx.agentWallet) {
      out.push({ code: "UNEXPECTED_ASSET_OUTFLOW", decision: "BLOCK", message: `Agent loses ${toUi(-c.delta, c.decimals)} ${ctx.symbol(c.mint)}. An approval should move no funds.`, detail: { mint: c.mint, amount: toUi(-c.delta, c.decimals) } });
    }
  }

  out.push(...sideEffects(fx, ctx));
  return out;
}

function approvalAsUndeclared(delegate: string, amount: bigint, unlimited: boolean, decimals: number, tokenAccount: string, symbol: string): Finding[] {
  const f: Finding[] = [{
    code: "UNDECLARED_APPROVAL",
    decision: "BLOCK",
    message: unlimited
      ? `${short(delegate)} is granted authority to spend all of the agent's ${symbol}, which was not declared.`
      : `${short(delegate)} is granted an allowance of ${toUi(amount, decimals)} ${symbol}, which was not declared.`,
    detail: { delegate, tokenAccount, amount: unlimited ? "unlimited" : amount.toString() },
  }];
  if (unlimited) f.push({ code: "UNLIMITED_APPROVAL", decision: "BLOCK", message: "The allowance is unlimited (at or above total token supply).", detail: { delegate } });
  return f;
}

/** Effects that are never part of a PAY or APPROVE intent. */
function sideEffects(fx: EconomicEffect, ctx: MatchContext): Finding[] {
  const out: Finding[] = [];
  for (const a of fx.authorityChanges) {
    out.push({ code: "AUTHORITY_CHANGE", decision: "BLOCK", message: `The ${AUTHORITY_LABEL[a.field]} of ${short(a.tokenAccount)} changes to ${a.to ? short(a.to) : "none"}.`, detail: { ...a } });
  }
  for (const c of fx.closedAccounts) {
    out.push({ code: "ACCOUNT_CLOSED", decision: "BLOCK", message: `Token account ${short(c)} is closed and its rent leaves the account.`, detail: { tokenAccount: c } });
  }
  for (const m of fx.supplyChanges) {
    const n = toUi(m.delta < 0n ? -m.delta : m.delta, m.decimals);
    out.push({ code: "SUPPLY_CHANGE", decision: "BLOCK", message: `${n} ${ctx.symbol(m.mint)} ${m.delta > 0n ? "is minted" : "is burned"}, which was not declared.`, detail: { mint: m.mint, delta: (m.delta > 0n ? "+" : "-") + n } });
  }
  for (const f of fx.frozenAccounts) {
    out.push({ code: "ACCOUNT_FROZEN", decision: "BLOCK", message: `Token account ${short(f)} is frozen, which was not declared.`, detail: { tokenAccount: f } });
  }
  for (const s of fx.solChanges) {
    if (s.account === ctx.agentWallet && -s.delta > ctx.maxSolSpendLamports) {
      out.push({ code: "SOL_SPEND_EXCEEDS_CAP", decision: "BLOCK", message: `Agent spends ${toUi(-s.delta, 9)} SOL, above the ${toUi(ctx.maxSolSpendLamports, 9)} SOL cap for fees and rent.` });
    }
    // New accounts receive rent; an existing wallet receiving SOL is a transfer.
    if (s.account !== ctx.agentWallet && s.existedBefore && s.delta > 0n) {
      out.push({ code: "UNEXPECTED_SOL_TRANSFER", decision: "BLOCK", message: `${short(s.account)} receives ${toUi(s.delta, 9)} SOL, which was not declared.`, detail: { account: s.account, sol: toUi(s.delta, 9) } });
    }
  }
  return out;
}
