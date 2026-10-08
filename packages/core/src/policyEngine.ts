import type { Decision, EconomicEffect, Finding, FinancialIntent } from "./types";
import { BASELINE_PROGRAMS, type Policy, toBaseUnits, toUi } from "./policy";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export interface PolicyOutcome {
  findings: Finding[];
  /** Advisory: the autonomous ceiling, when the requested amount exceeds it. Never authorizes anything. */
  suggestedMaxAmount?: string;
}

/** Deterministic authorization rules. Runs on the validated intent and the observed effect. */
export function applyPolicy(intent: FinancialIntent, fx: EconomicEffect, policy: Policy, decimals: number): PolicyOutcome {
  const findings: Finding[] = [];
  let suggestedMaxAmount: string | undefined;

  const allowedPrograms = new Set([...BASELINE_PROGRAMS, ...policy.approvedPrograms]);
  const seen = new Set<string>();
  for (const p of fx.programInteractions) {
    if (allowedPrograms.has(p.programId) || seen.has(p.programId)) continue;
    seen.add(p.programId);
    findings.push({
      code: "UNKNOWN_PROGRAM",
      decision: policy.unknownProgramAction as Decision,
      message: `Transaction ${p.depth === "inner" ? "reaches" : "calls"} program ${short(p.programId)}, which is not on the allowlist${p.depth === "inner" ? " (via CPI)" : ""}.`,
      detail: { programId: p.programId, depth: p.depth },
    });
  }

  if (intent.action === "PAY" || intent.action === "SWAP") {
    const amount = toBaseUnits(intent.amount, decimals);
    if (intent.action === "PAY" && !policy.approvedRecipients.includes(intent.recipient)) {
      findings.push({ code: "NEW_RECIPIENT", decision: policy.newRecipientAction as Decision, message: `${short(intent.recipient)} has never been approved as a recipient for this agent.`, detail: { recipient: intent.recipient } });
    }
    const max = toBaseUnits(policy.maxPayAmount, decimals);
    const review = toBaseUnits(policy.reviewAbove, decimals);
    if (amount > max) {
      suggestedMaxAmount = toUi(max, decimals);
      findings.push({ code: "AMOUNT_ABOVE_LIMIT", decision: "REVIEW", message: `${intent.amount} ${intent.asset} is above the autonomous limit of ${policy.maxPayAmount} ${intent.asset}. A human must approve this exact transaction.`, detail: { requested: intent.amount, limit: policy.maxPayAmount } });
    } else if (amount > review) {
      findings.push({ code: "AMOUNT_ABOVE_REVIEW_THRESHOLD", decision: "REVIEW", message: `${intent.amount} ${intent.asset} is above the ${policy.reviewAbove} ${intent.asset} review threshold.`, detail: { requested: intent.amount, threshold: policy.reviewAbove } });
    }
  }

  if (intent.action === "APPROVE") {
    if (!policy.approvedSpenders.includes(intent.spender)) {
      findings.push({ code: "UNKNOWN_SPENDER", decision: policy.unknownSpenderAction as Decision, message: `${short(intent.spender)} is not an approved spender.`, detail: { spender: intent.spender } });
    }
    const observedUnlimited = fx.approvals.some((a) => a.unlimited && a.newDelegate !== null);
    if ((intent.amount === "unlimited" || observedUnlimited) && !policy.allowUnlimitedApprovals) {
      findings.push({ code: "UNLIMITED_APPROVAL", decision: "BLOCK", message: "Policy forbids unlimited allowances.", detail: {} });
    } else if (intent.amount !== "unlimited" && toBaseUnits(intent.amount, decimals) > toBaseUnits(policy.maxApprovalAmount, decimals)) {
      suggestedMaxAmount = policy.maxApprovalAmount;
      findings.push({ code: "AMOUNT_ABOVE_LIMIT", decision: "REVIEW", message: `An allowance of ${intent.amount} ${intent.asset} is above the ${policy.maxApprovalAmount} ${intent.asset} autonomous limit. A human must approve this exact transaction.`, detail: { requested: intent.amount, limit: policy.maxApprovalAmount } });
    }
  }

  return { findings, suggestedMaxAmount };
}
