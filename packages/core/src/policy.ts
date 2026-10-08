import { z } from "zod";
import { createHash } from "node:crypto";

const Action = z.enum(["ALLOW", "REVIEW", "BLOCK"]);

export const PolicySchema = z.object({
  agentId: z.string(),
  /** Symbol -> mint address. Intents may use a symbol or a raw mint. */
  assets: z.record(z.string(), z.string()),
  /** Above this (UI units) a payment needs a human. */
  reviewAbove: z.string().default("1000"),
  /** Autonomous ceiling (UI units). Above it a payment always needs a human (REVIEW, with the ceiling as advisory). */
  maxPayAmount: z.string().default("5000"),
  /** Largest allowance an agent may grant (UI units). */
  maxApprovalAmount: z.string().default("1000"),
  allowUnlimitedApprovals: z.boolean().default(false),
  approvedRecipients: z.array(z.string()).default([]),
  approvedSpenders: z.array(z.string()).default([]),
  /** Programs a transaction may touch (outer or via CPI). System, Token, ATA and Compute Budget are added automatically. */
  approvedPrograms: z.array(z.string()).default([]),
  newRecipientAction: Action.default("REVIEW"),
  unknownSpenderAction: Action.default("BLOCK"),
  unknownProgramAction: Action.default("BLOCK"),
  /** Cap on the agent's SOL spend per tx (fees + rent for accounts it creates), in lamports. */
  maxSolSpendLamports: z.string().default("10000000"),
});
export type Policy = z.infer<typeof PolicySchema>;

export const BASELINE_PROGRAMS = [
  "11111111111111111111111111111111", // System
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
  "ComputeBudget111111111111111111111111111111", // Compute Budget
];

/** Token-2022 is out of scope for v1: its extensions (transfer hooks, fees, confidential transfers) change semantics. Fail closed. */
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Content hash of the policy. Recorded with every decision so the decision is reproducible. */
export function policyVersion(policy: Policy): string {
  const canonical = canonicalJson(policy);
  return "pol_" + createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/** Stable JSON: object keys sorted at every level, bigints as strings. */
export function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** "12.5" with 6 decimals -> 12500000n. Exact; rejects excess precision. */
export function toBaseUnits(ui: string, decimals: number): bigint {
  const [whole, frac = ""] = ui.split(".");
  if (frac.length > decimals) throw new Error(`amount ${ui} has more than ${decimals} decimals`);
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function toUi(base: bigint, decimals: number): string {
  const neg = base < 0n;
  const s = (neg ? -base : base).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}
