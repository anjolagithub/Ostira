import { AsyncLocalStorage } from "node:async_hooks";
import { verifyBeforeSigning, type EvaluationResult, type EvaluateRequest, type SigningCheck } from "@ostira/core";

/**
 * guardWallet: put Ostira at the one place every Solana agent action ends, the wallet's sign call.
 *
 * Solana Agent Kit (and most agent stacks) build a transaction inside a tool and then hand it to a wallet
 * object to sign. Wrapping that wallet means no tool, plugin or prompt can get a signature without passing
 * through here, whoever built the transaction. The wrapper:
 *
 *   1. needs a declared intent (what the agent says it is doing). No intent means no signature (fail closed);
 *   2. asks Ostira to simulate the exact transaction and compare its effects with that intent;
 *   3. checks the verdict allows signing, has not expired, and is for these exact message bytes;
 *   4. only then calls the real wallet.
 *
 * It never sees or holds a key: it only forwards to the wallet you already have.
 */

/** Anything with a Solana transaction's serialize(): web3.js `Transaction` and `VersionedTransaction` both fit. */
export interface SerializableTx {
  serialize(config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array;
}

/**
 * The part of Solana Agent Kit's `BaseWallet` this wrapper intercepts. The transaction type is left open
 * (`any`) on purpose so any wallet whose transactions have serialize(), including web3.js `Transaction` and
 * `VersionedTransaction`, satisfies it as-is; `guardWallet` returns the same type it was given.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WalletLike {
  readonly publicKey: { toBase58(): string };
  signTransaction(tx: any): Promise<any>;
  signAllTransactions(txs: any[]): Promise<any[]>;
  signAndSendTransaction(tx: any, options?: any): Promise<{ signature: string }>;
  sendTransaction?: (tx: any) => Promise<string>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type EvaluateFn = (req: EvaluateRequest) => Promise<EvaluationResult>;

export class OstiraBlockedError extends Error {
  constructor(
    message: string,
    readonly reason: "NO_INTENT" | "BLOCKED" | "NEEDS_REVIEW" | Extract<SigningCheck, { ok: false }>["reason"] | "EVALUATION_FAILED",
    readonly evaluation?: EvaluationResult,
  ) {
    super(message);
    this.name = "OstiraBlockedError";
  }
}

export interface GuardOptions {
  /** Ostira policy id for this agent. */
  agentId: string;
  /** Runs the evaluation: `(req) => verifier.evaluate(req)` in process, or your own HTTP call to a verifier you host. */
  evaluate: EvaluateFn;
  /**
   * Called when the verdict is REVIEW. Return true only if a human approved this exact evaluation.
   * Omitted means REVIEW is treated as a refusal.
   */
  onReview?: (evaluation: EvaluationResult) => boolean | Promise<boolean>;
  /** Called for every verdict, signed or refused. Useful for logging and audit. */
  onVerdict?: (evaluation: EvaluationResult, outcome: "signed" | "refused") => void;
}

const intentStore = new AsyncLocalStorage<unknown>();

export interface GuardedWallet<W extends WalletLike> {
  /** The wrapped wallet. Hand this to the agent in place of the original. */
  wallet: W;
  /**
   * Declare what the agent is about to do and run `fn` under it. Every signature inside `fn` is checked
   * against this intent. Scoped per async call chain, so concurrent agent tasks cannot borrow each other's intent.
   */
  withIntent<R>(intent: unknown, fn: () => Promise<R>): Promise<R>;
}

function toBase64(tx: SerializableTx): string {
  // Unsigned and partially signed transactions must serialize; web3.js's legacy Transaction needs these flags.
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(bytes).toString("base64");
}

export function guardWallet<W extends WalletLike>(inner: W, opts: GuardOptions): GuardedWallet<W> {
  async function check(tx: SerializableTx): Promise<void> {
    const intent = intentStore.getStore();
    if (intent === undefined) {
      throw new OstiraBlockedError(
        "No declared intent for this signature. Wrap the agent's action in withIntent(intent, ...) so Ostira can compare it with what the transaction does.",
        "NO_INTENT",
      );
    }
    const serialized = toBase64(tx);
    let evaluation: EvaluationResult;
    try {
      evaluation = await opts.evaluate({
        agentId: opts.agentId,
        intent,
        transaction: { serialized },
        agentWallet: inner.publicKey.toBase58(),
      });
    } catch (e) {
      throw new OstiraBlockedError(`Ostira could not evaluate this transaction: ${(e as Error).message}`, "EVALUATION_FAILED");
    }

    let humanApproved = false;
    if (evaluation.decision === "REVIEW" && opts.onReview) humanApproved = await opts.onReview(evaluation);

    const verdict = verifyBeforeSigning(evaluation, serialized, { humanApproved });
    if (!verdict.ok) {
      opts.onVerdict?.(evaluation, "refused");
      const reason: OstiraBlockedError["reason"] =
        verdict.reason === "NOT_ALLOWED" ? (evaluation.decision === "REVIEW" ? "NEEDS_REVIEW" : "BLOCKED") : verdict.reason;
      const why = evaluation.reasons.map((r) => `${r.code}: ${r.message}`).join(" | ");
      throw new OstiraBlockedError(`${verdict.message}${why ? " " + why : ""}`, reason, evaluation);
    }
    opts.onVerdict?.(evaluation, "signed");
  }

  // Wrap by delegation, not by copying: methods we don't intercept (and any wallet-specific extras) keep working.
  const wallet = new Proxy(inner, {
    get(target, prop, receiver) {
      switch (prop) {
        case "signTransaction":
          return async (tx: SerializableTx) => {
            await check(tx);
            return target.signTransaction(tx);
          };
        case "signAllTransactions":
          return async (txs: SerializableTx[]) => {
            for (const tx of txs) await check(tx); // all or nothing: no partial signing
            return target.signAllTransactions(txs);
          };
        case "signAndSendTransaction":
          return async (tx: SerializableTx, options?: unknown) => {
            await check(tx);
            return target.signAndSendTransaction(tx, options);
          };
        case "sendTransaction":
          return target.sendTransaction
            ? async (tx: SerializableTx) => {
                await check(tx);
                return target.sendTransaction!(tx);
              }
            : undefined;
        default: {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" ? v.bind(target) : v;
        }
      }
    },
  });

  return { wallet: wallet as W, withIntent: (intent, fn) => intentStore.run(intent, fn) };
}
