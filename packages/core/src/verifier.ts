import { createHash } from "node:crypto";
import { decodeTransaction, traceInstructions } from "./introspect";
import { extractEffects, readMint } from "./effects";
import { matchApprove, matchPay, matchSwap, type MatchContext } from "./matcher";
import { applyPolicy } from "./policyEngine";
import { buildEffectDiff, type DiffLine } from "./diff";
import { canonicalJson, type Policy, PolicySchema, policyVersion, toBaseUnits, TOKEN_2022_PROGRAM } from "./policy";
import { getTransactionDecoder } from "@solana/kit";
import { FINDING_CATEGORY } from "./codes";
import type { Simulator } from "./simulator";
import {
  DECISION_RANK,
  type Decision,
  type EconomicEffect,
  type EvaluationResult,
  type Finding,
  type FinancialIntent,
  FinancialIntentSchema,
  type PipelineStage,
} from "./types";

export interface EvaluateRequest {
  agentId: string;
  intent: unknown;
  /** Unsigned (or partially signed) transaction, base64 wire format. */
  transaction: { serialized: string };
  /** The wallet whose funds the intent concerns. Defaults to the fee payer. */
  agentWallet?: string;
}

/** Default validity window of a verdict. State moves; a stale verdict must be re-evaluated. */
export const DEFAULT_TTL_MS = 30_000;

/**
 * sha256 (hex) of the transaction's message bytes: exactly what the signer signs.
 * Signatures are excluded, so the fingerprint is the same before and after signing.
 * Returns null when the bytes are not a transaction.
 */
export function messageFingerprint(serialized: string | Uint8Array): string | null {
  try {
    const bytes = typeof serialized === "string" ? Buffer.from(serialized, "base64") : serialized;
    const tx = getTransactionDecoder().decode(bytes);
    return createHash("sha256").update(tx.messageBytes as unknown as Uint8Array).digest("hex");
  } catch {
    return null;
  }
}

export type SigningCheck =
  | { ok: true }
  | { ok: false; reason: "NOT_ALLOWED" | "EXPIRED" | "TRANSACTION_CHANGED" | "UNDECODABLE"; message: string };

/**
 * The last gate before a wallet signs. Call it with the evaluation and the transaction about to be
 * signed. It passes only if the verdict allows signing, has not expired, and the transaction's
 * message is byte-for-byte the one that was evaluated. A REVIEW verdict passes only once a human
 * approved it (pass humanApproved), and still only for the same message within the window.
 */
export function verifyBeforeSigning(
  result: Pick<EvaluationResult, "decision" | "expiresAt" | "txFingerprint">,
  serializedTx: string | Uint8Array,
  opts: { now?: Date; humanApproved?: boolean } = {},
): SigningCheck {
  const now = opts.now ?? new Date();
  const allowed = result.decision === "ALLOW" || (result.decision === "REVIEW" && opts.humanApproved === true);
  if (!allowed) {
    return { ok: false, reason: "NOT_ALLOWED", message: result.decision === "REVIEW" ? "This evaluation needs a human approval before signing." : "This evaluation blocked the transaction." };
  }
  if (now.getTime() >= Date.parse(result.expiresAt)) {
    return { ok: false, reason: "EXPIRED", message: "The evaluation has expired. Re-evaluate the transaction before signing." };
  }
  const fp = messageFingerprint(serializedTx);
  if (fp === null) return { ok: false, reason: "UNDECODABLE", message: "The transaction to sign could not be decoded." };
  if (fp !== result.txFingerprint) {
    return { ok: false, reason: "TRANSACTION_CHANGED", message: "This is not the transaction that was evaluated. Re-evaluate before signing." };
  }
  return { ok: true };
}

/**
 * Verifier: verify what a transaction will actually do before money moves.
 *
 * Invariants (enforced by construction):
 *  - never receives keys, never signs, never broadcasts;
 *  - every decision is deterministic over (intent, simulated state, policy version);
 *  - fails closed: anything it cannot decode or simulate is BLOCK.
 */
export class Verifier {
  private readonly policies = new Map<string, Policy>();
  private readonly ttlMs: number;
  constructor(private readonly simulator: Simulator, opts: { ttlMs?: number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  setPolicy(input: unknown): Policy {
    const p = PolicySchema.parse(input);
    this.policies.set(p.agentId, p);
    return p;
  }

  getPolicy(agentId: string): Policy | undefined {
    return this.policies.get(agentId);
  }

  async evaluate(req: EvaluateRequest): Promise<EvaluationResult> {
    const pipeline: PipelineStage[] = [];
    const findings: Finding[] = [];
    const started = new Date();
    const evaluatedAt = started.toISOString();
    const expiresAt = new Date(started.getTime() + this.ttlMs).toISOString();
    let slot: string | null = null;
    let t = performance.now();
    const step = (stage: PipelineStage["stage"], ok: boolean, note?: string) => {
      const now = performance.now();
      pipeline.push({ stage, ok, ms: Math.round((now - t) * 100) / 100, note });
      t = now;
    };

    const policy = this.policies.get(req.agentId);
    const pv = policy ? policyVersion(policy) : "pol_none";
    const txBytes = Buffer.from(req.transaction?.serialized ?? "", "base64");
    // Bound to the message bytes (what gets signed). Undecodable input falls back to the raw bytes; it is BLOCKed anyway.
    const txFingerprint = messageFingerprint(txBytes) ?? createHash("sha256").update(txBytes).digest("hex");

    const base = {
      agentId: req.agentId,
      simulator: this.simulator.name,
      txFingerprint,
      policyVersion: pv,
      evaluatedAt,
      expiresAt,
    };
    const finish = (r: {
      intent: FinancialIntent | null;
      agentWallet: string;
      effect: EconomicEffect | null;
      asset?: EvaluationResult["asset"];
      matchFindings?: Finding[];
      suggestedMaxAmount?: string;
      logs?: string[];
      diff?: DiffLine[];
    }): EvaluationResult => {
      const decision = decide(findings);
      step("decide", true, decision);
      const evaluationId =
        "eval_" + createHash("sha256").update(canonicalJson({ txFingerprint, intent: r.intent, pv, evaluatedAt, agent: req.agentId })).digest("hex").slice(0, 16);
      return {
        evaluationId,
        ...base,
        agentWallet: r.agentWallet,
        intent: r.intent,
        asset: r.asset,
        decision,
        intentMatch: (r.matchFindings ?? findings).every((f) => f.decision !== "BLOCK") && r.effect !== null,
        policyPassed: findings.filter((f) => !(r.matchFindings ?? []).includes(f)).length === 0,
        suggestedMaxAmount: decision === "REVIEW" ? r.suggestedMaxAmount : undefined,
        simulation: { slot, simulator: this.simulator.name },
        reasons: sortFindings(findings.map((f) => ({ ...f, category: FINDING_CATEGORY[f.code] }))),
        economicEffect: r.effect,
        diff: r.diff ?? [],
        pipeline,
        logs: r.logs ?? [],
      };
    };

    // 1. Validate the structured intent. Natural language never reaches this point.
    const parsed = FinancialIntentSchema.safeParse(req.intent);
    if (!parsed.success || !policy) {
      findings.push({
        code: "INVALID_INTENT",
        decision: "BLOCK",
        message: !policy ? `No policy registered for agent ${req.agentId}.` : `Intent failed validation: ${parsed.error!.issues.map((i) => i.message).join("; ")}`,
      });
      step("validate", false);
      return finish({ intent: null, agentWallet: req.agentWallet ?? "", effect: null });
    }
    const intent = parsed.data;
    const mint = policy.assets[intent.asset] ?? (intent.asset.length >= 32 ? intent.asset : undefined);
    const mintInfo = mint ? await readMint(this.simulator, mint) : null;
    if (!mint || !mintInfo) {
      findings.push({ code: "UNKNOWN_ASSET", decision: "BLOCK", message: `Asset ${intent.asset} is not a known SPL token mint.` });
      step("validate", false);
      return finish({ intent, agentWallet: req.agentWallet ?? "", effect: null });
    }
    const symbol = policy.assets[intent.asset] ? intent.asset : undefined;
    const asset = { symbol, mint, decimals: mintInfo.decimals };
    let declared: bigint | null;
    try {
      declared = intent.action === "APPROVE" && intent.amount === "unlimited" ? null : toBaseUnits(intent.amount as string, mintInfo.decimals);
    } catch (e) {
      findings.push({ code: "INVALID_INTENT", decision: "BLOCK", message: (e as Error).message });
      step("validate", false);
      return finish({ intent, agentWallet: req.agentWallet ?? "", effect: null, asset });
    }
    // SWAP: the output asset must be known too, and the minimum must be exact in its decimals.
    let out: MatchContext["out"];
    if (intent.action === "SWAP") {
      const outMint = policy.assets[intent.assetOut] ?? (intent.assetOut.length >= 32 ? intent.assetOut : undefined);
      const outInfo = outMint ? await readMint(this.simulator, outMint) : null;
      if (!outMint || !outInfo) {
        findings.push({ code: "UNKNOWN_ASSET", decision: "BLOCK", message: `Asset ${intent.assetOut} is not a known SPL token mint.` });
        step("validate", false);
        return finish({ intent, agentWallet: req.agentWallet ?? "", effect: null, asset });
      }
      try {
        out = { mint: outMint, decimals: outInfo.decimals, min: toBaseUnits(intent.minAmountOut, outInfo.decimals) };
      } catch (e) {
        findings.push({ code: "INVALID_INTENT", decision: "BLOCK", message: (e as Error).message });
        step("validate", false);
        return finish({ intent, agentWallet: req.agentWallet ?? "", effect: null, asset });
      }
    }
    step("validate", true);

    // 2. Decode. Fail closed on anything we can't fully resolve.
    let decoded;
    try {
      decoded = decodeTransaction(txBytes);
    } catch (e) {
      findings.push({ code: "UNDECODABLE_TRANSACTION", decision: "BLOCK", message: `Transaction could not be decoded: ${(e as Error).message}` });
      step("decode", false);
      return finish({ intent, agentWallet: req.agentWallet ?? "", effect: null, asset });
    }
    const agentWallet = req.agentWallet ?? decoded.feePayer;
    if (decoded.usesLookupTables) {
      findings.push({ code: "UNDECODABLE_TRANSACTION", decision: "BLOCK", message: "Address lookup tables are not supported in this version. Verifier fails closed." });
      step("decode", false);
      return finish({ intent, agentWallet, effect: null, asset });
    }
    if (decoded.accountMetas.some((m) => m.address === TOKEN_2022_PROGRAM)) {
      findings.push({ code: "UNSUPPORTED_PROGRAM", decision: "BLOCK", message: "The transaction references Token-2022, which this version does not verify. Verification fails closed.", detail: { programId: TOKEN_2022_PROGRAM } });
      step("decode", false, "Token-2022");
      return finish({ intent, agentWallet, effect: null, asset });
    }
    step("decode", true, `${decoded.writable.length} writable accounts`);

    // 3. Simulate. Side-effect free: nothing is signed or broadcast.
    const outcome = await this.simulator.simulate(txBytes, decoded.writable);
    slot = outcome.slot.toString();
    if (!outcome.ok) {
      findings.push({ code: "SIMULATION_FAILED", decision: "BLOCK", message: `Simulation failed: ${outcome.error}`, detail: { logs: outcome.logs.slice(-6) } });
      step("simulate", false, outcome.error);
      return finish({ intent, agentWallet, effect: null, asset, logs: outcome.logs });
    }
    step("simulate", true, `${outcome.computeUnits} CU`);

    // 4. Extract the economic effect from observed state, and trace outer + CPI instructions.
    const { interactions } = traceInstructions(decoded, outcome.innerInstructions);
    const effect = await extractEffects(this.simulator, outcome, interactions);
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    step("extract", true, `${plural(effect.assetChanges.length, "asset change")}, ${plural(effect.approvals.length, "approval")}`);

    // Defense in depth: anything that reached Token-2022 during execution is out of scope.
    if (effect.unsupportedAccounts.length > 0 || effect.programInteractions.some((p) => p.programId === TOKEN_2022_PROGRAM)) {
      findings.push({ code: "UNSUPPORTED_PROGRAM", decision: "BLOCK", message: "Execution touches Token-2022 accounts or programs, which this version does not verify. Verification fails closed.", detail: { accounts: effect.unsupportedAccounts } });
      return finish({ intent, agentWallet, effect, asset, logs: outcome.logs });
    }

    // 5. Does the effect equal the intent, and nothing more?
    const ctx: MatchContext = { agentWallet, mint, decimals: mintInfo.decimals, amount: declared, maxSolSpendLamports: BigInt(policy.maxSolSpendLamports), symbol: (m) => Object.entries(policy.assets).find(([, a]) => a === m)?.[0] ?? `${m.slice(0, 4)}…${m.slice(-4)}`, out };
    const matchFindings = intent.action === "PAY" ? matchPay(intent, effect, ctx) : intent.action === "SWAP" ? matchSwap(intent, effect, ctx) : matchApprove(intent, effect, ctx);
    findings.push(...matchFindings);
    step("match", matchFindings.length === 0, matchFindings.length ? `${matchFindings.length} mismatch${matchFindings.length === 1 ? "" : "es"}` : "effect equals intent");

    // 6. Is the agent authorized to do it?
    const pol = applyPolicy(intent, effect, policy, mintInfo.decimals);
    // Don't double-report: unlimited approvals already flagged by the matcher.
    for (const f of pol.findings) {
      if (!findings.some((m) => m.code === f.code && m.decision === f.decision)) findings.push(f);
    }
    step("policy", pol.findings.length === 0, pv);

    const diff = buildEffectDiff({
      intent, effect, agentWallet, mint, decimals: mintInfo.decimals, symbol: ctx.symbol, out,
      approvedPrograms: policy.approvedPrograms, maxSolSpendLamports: ctx.maxSolSpendLamports,
    });
    return finish({ intent, agentWallet, effect, asset, matchFindings, suggestedMaxAmount: pol.suggestedMaxAmount, logs: outcome.logs, diff });
  }
}

/** BLOCK > REVIEW > ALLOW. No findings means ALLOW. */
export function decide(findings: Finding[]): Decision {
  return findings.reduce<Decision>((d, f) => (DECISION_RANK[f.decision] > DECISION_RANK[d] ? f.decision : d), "ALLOW");
}

function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort((a, b) => DECISION_RANK[b.decision] - DECISION_RANK[a.decision]);
}
