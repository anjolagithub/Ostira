import { z } from "zod";
import type { DiffLine } from "./diff";
import type { FindingCategory, FindingCode } from "./codes";
export { FINDING_CATEGORY, type FindingCategory, type FindingCode } from "./codes";

/** Base58 Solana address (32–44 chars). Validated structurally; resolved by the engine. */
const AddressString = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "invalid base58 address");

/** Decimal amount in UI units, e.g. "500" or "12.5". Never a float. */
const UiAmount = z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string");

/** Asset reference: a symbol from the policy's asset registry, or a raw mint address. */
const AssetRef = z.union([z.string().regex(/^[A-Za-z0-9]{2,10}$/), AddressString]);

export const PayIntentSchema = z.object({
  action: z.literal("PAY"),
  asset: AssetRef,
  amount: UiAmount,
  recipient: AddressString,
  purpose: z.string().max(280).optional(),
});

export const ApproveIntentSchema = z.object({
  action: z.literal("APPROVE"),
  asset: AssetRef,
  spender: AddressString,
  /** Maximum allowance in UI units. "unlimited" is accepted so it can be explicitly judged. */
  amount: z.union([UiAmount, z.literal("unlimited")]),
});

/**
 * Exchange one asset for another, typically through a transaction a third party built (an aggregator
 * route, a market maker's quote). The guarantee is economic: the agent gives at most `amount` of `asset`,
 * receives at least `minAmountOut` of `assetOut`, and nothing else of the agent's moves.
 */
export const SwapIntentSchema = z.object({
  action: z.literal("SWAP"),
  asset: AssetRef,
  amount: UiAmount,
  assetOut: AssetRef,
  minAmountOut: UiAmount,
});

export const FinancialIntentSchema = z.discriminatedUnion("action", [PayIntentSchema, ApproveIntentSchema, SwapIntentSchema]);
export type SwapIntent = z.infer<typeof SwapIntentSchema>;
export type PayIntent = z.infer<typeof PayIntentSchema>;
export type ApproveIntent = z.infer<typeof ApproveIntentSchema>;
export type FinancialIntent = z.infer<typeof FinancialIntentSchema>;

/**
 * Only three verdicts. A verdict authorizes (or refuses) the exact transaction that was evaluated;
 * Ostira never rewrites a transaction, so there is no "execute a smaller amount" verdict.
 */
export type Decision = "ALLOW" | "REVIEW" | "BLOCK";
export const DECISION_RANK: Record<Decision, number> = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };

/** One machine-readable reason. Every BLOCK or REVIEW carries at least one. */
export interface Finding {
  code: FindingCode;
  decision: Decision;
  /** Filled in by the verifier from the code. */
  category?: FindingCategory;
  message: string;
  detail?: Record<string, unknown>;
}

// ---- Economic effect model (normalized, chain-observed) ----

export interface AssetChange {
  mint: string;
  owner: string;
  /** Raw base units, signed. */
  delta: bigint;
  decimals: number;
}

export interface ApprovalChange {
  tokenAccount: string;
  mint: string;
  owner: string;
  previousDelegate: string | null;
  newDelegate: string | null;
  previousAmount: bigint;
  newAmount: bigint;
  unlimited: boolean;
}

export interface AuthorityChange {
  /** Token account or mint whose authority changed. */
  tokenAccount: string;
  field: "owner" | "closeAuthority" | "mintAuthority" | "freezeAuthority";
  from: string | null;
  to: string | null;
}

export interface SolChange {
  account: string;
  delta: bigint;
  existedBefore: boolean;
}

export interface ProgramInteraction {
  programId: string;
  depth: "outer" | "inner";
  instructionType?: string;
}

export interface EconomicEffect {
  assetChanges: AssetChange[];
  approvals: ApprovalChange[];
  authorityChanges: AuthorityChange[];
  closedAccounts: string[];
  /** Mints whose total supply changed (minting or burning). Raw base units, signed. */
  supplyChanges: { mint: string; delta: bigint; decimals: number }[];
  /** Token accounts that became frozen. */
  frozenAccounts: string[];
  /** Writable accounts owned by a token program v1 does not support (Token-2022). */
  unsupportedAccounts: string[];
  solChanges: SolChange[];
  programInteractions: ProgramInteraction[];
  computeUnits: bigint;
}

export interface PipelineStage {
  stage: "validate" | "decode" | "simulate" | "extract" | "match" | "policy" | "decide";
  ok: boolean;
  ms: number;
  note?: string;
}

export interface EvaluationResult {
  evaluationId: string;
  agentId: string;
  agentWallet: string;
  intent: FinancialIntent | null;
  /** Resolved asset info for the intent, for display. */
  asset?: { symbol?: string; mint: string; decimals: number };
  simulator: string;
  pipeline: PipelineStage[];
  logs: string[];
  decision: Decision;
  intentMatch: boolean;
  policyPassed: boolean;
  /**
   * Advisory only, for an amount over the autonomous limit: the largest amount (UI units) that
   * would have been allowed without a human. It never authorizes the evaluated transaction.
   */
  suggestedMaxAmount?: string;
  /** Simulation context. The verdict holds for this state; it expires so stale state is never trusted. */
  simulation: { slot: string | null; simulator: string };
  /** After this time the evaluation must be re-run before signing. */
  expiresAt: string;
  reasons: Finding[];
  economicEffect: EconomicEffect | null;
  /** Declared intent vs observed effect. Empty when there is no observed effect. */
  diff: DiffLine[];
  /**
   * sha256 of the exact transaction message bytes (what the signer signs). The wallet must sign a
   * transaction whose message hashes to this value; see verifyBeforeSigning().
   */
  txFingerprint: string;
  policyVersion: string;
  evaluatedAt: string;
}
