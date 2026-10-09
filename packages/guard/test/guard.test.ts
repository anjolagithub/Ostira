import { describe, it, expect, beforeAll } from "vitest";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import { createWorld, buildScenario, type World } from "@ostira/core/fixtures";
import type { EvaluationResult } from "@ostira/core";
import { guardWallet, OstiraBlockedError, type WalletLike, type SerializableTx } from "../src";

let world: World;
beforeAll(async () => {
  world = await createWorld();
});

/** A transaction object whose serialize() yields the scenario's real wire bytes. */
function txFrom(serialized: string): SerializableTx {
  const bytes = Uint8Array.from(Buffer.from(serialized, "base64"));
  return { serialize: () => bytes };
}

/** A wallet that records every signature it is asked for. It stands in for a real key-holding wallet. */
function fakeWallet() {
  const signed: SerializableTx[] = [];
  const wallet: WalletLike & { extra: () => string } = {
    publicKey: { toBase58: () => world.agent },
    async signTransaction(tx) { signed.push(tx); return tx; },
    async signAllTransactions(txs) { signed.push(...txs); return txs; },
    async signAndSendTransaction(tx) { signed.push(tx); return { signature: "sig" }; },
    async signMessage(m) { return m; },
    extra: () => "kept",
  };
  return { wallet, signed };
}

const guardFor = <W extends WalletLike>(wallet: W, extra: Partial<Parameters<typeof guardWallet>[1]> = {}) =>
  guardWallet(wallet, { agentId: "treasury-agent", evaluate: (r) => world.verifier.evaluate(r), ...extra });

describe("guardWallet", () => {
  it("signs an honest payment that matches its declared intent", async () => {
    const sc = await buildScenario(world, "pay-alice", []);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet);
    const out = await g.withIntent(sc.request.intent, () => g.wallet.signAndSendTransaction(txFrom(sc.request.transaction.serialized)));
    expect(out.signature).toBe("sig");
    expect(signed).toHaveLength(1);
  });

  it("refuses a payment with a hidden unlimited approval and never reaches the wallet", async () => {
    const sc = await buildScenario(world, "pay-alice", ["hiddenApproval"]);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet);
    const err = await g
      .withIntent(sc.request.intent, () => g.wallet.signTransaction(txFrom(sc.request.transaction.serialized)))
      .catch((e) => e);
    expect(err).toBeInstanceOf(OstiraBlockedError);
    expect(err.reason).toBe("BLOCKED");
    expect(err.message).toContain("UNDECLARED_APPROVAL");
    expect(err.evaluation.decision).toBe("BLOCK");
    expect(signed).toHaveLength(0);
  });

  it.each(["siphon", "redirect", "skim", "ownerTakeover", "solDrain", "rogueProgram"] as const)(
    "refuses an honest-looking payment carrying the %s attack",
    async (attack) => {
      const sc = await buildScenario(world, "pay-alice", [attack]);
      const { wallet, signed } = fakeWallet();
      const g = guardFor(wallet);
      await expect(
        g.withIntent(sc.request.intent, () => g.wallet.signAndSendTransaction(txFrom(sc.request.transaction.serialized))),
      ).rejects.toBeInstanceOf(OstiraBlockedError);
      expect(signed).toHaveLength(0);
    },
  );

  it("fails closed when no intent was declared", async () => {
    const sc = await buildScenario(world, "pay-alice", []);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet);
    const err = await g.wallet.signTransaction(txFrom(sc.request.transaction.serialized)).catch((e) => e);
    expect(err).toBeInstanceOf(OstiraBlockedError);
    expect(err.reason).toBe("NO_INTENT");
    expect(signed).toHaveLength(0);
  });

  it("refuses when the declared intent does not match the transaction", async () => {
    const honest = await buildScenario(world, "pay-alice", []);
    const approve = await buildScenario(world, "approve-router", []);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet);
    // The agent says "approve the router" but hands over a payment.
    await expect(
      g.withIntent(approve.request.intent, () => g.wallet.signTransaction(txFrom(honest.request.transaction.serialized))),
    ).rejects.toBeInstanceOf(OstiraBlockedError);
    expect(signed).toHaveLength(0);
  });

  it("treats REVIEW as a refusal unless a human approves it", async () => {
    const sc = await buildScenario(world, "pay-supplier", []); // new recipient above threshold: REVIEW
    const tx = txFrom(sc.request.transaction.serialized);

    const a = fakeWallet();
    const ga = guardFor(a.wallet);
    const err = await ga.withIntent(sc.request.intent, () => ga.wallet.signTransaction(tx)).catch((e) => e);
    expect(err.reason).toBe("NEEDS_REVIEW");
    expect(a.signed).toHaveLength(0);

    const b = fakeWallet();
    const gb = guardFor(b.wallet, { onReview: () => false });
    await expect(gb.withIntent(sc.request.intent, () => gb.wallet.signTransaction(tx))).rejects.toMatchObject({ reason: "NEEDS_REVIEW" });
    expect(b.signed).toHaveLength(0);

    const c = fakeWallet();
    const gc = guardFor(c.wallet, { onReview: () => true });
    await gc.withIntent(sc.request.intent, () => gc.wallet.signTransaction(tx));
    expect(c.signed).toHaveLength(1);
  });

  it("refuses an expired verdict", async () => {
    const sc = await buildScenario(world, "pay-alice", []);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet, {
      evaluate: async (r) => ({ ...(await world.verifier.evaluate(r)), expiresAt: new Date(Date.now() - 1000).toISOString() }),
    });
    await expect(
      g.withIntent(sc.request.intent, () => g.wallet.signTransaction(txFrom(sc.request.transaction.serialized))),
    ).rejects.toMatchObject({ reason: "EXPIRED" });
    expect(signed).toHaveLength(0);
  });

  it("refuses a verdict that was issued for a different transaction", async () => {
    const honest = await buildScenario(world, "pay-alice", []);
    const attacked = await buildScenario(world, "pay-alice", ["siphon"]);
    const staleAllow: EvaluationResult = await world.verifier.evaluate(honest.request);
    expect(staleAllow.decision).toBe("ALLOW");
    const { wallet, signed } = fakeWallet();
    // A verifier (or middleman) replays the honest ALLOW for the attacked transaction.
    const g = guardFor(wallet, { evaluate: async () => staleAllow });
    await expect(
      g.withIntent(honest.request.intent, () => g.wallet.signTransaction(txFrom(attacked.request.transaction.serialized))),
    ).rejects.toMatchObject({ reason: "TRANSACTION_CHANGED" });
    expect(signed).toHaveLength(0);
  });

  it("fails closed if evaluation itself throws", async () => {
    const sc = await buildScenario(world, "pay-alice", []);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet, { evaluate: async () => { throw new Error("rpc down"); } });
    await expect(
      g.withIntent(sc.request.intent, () => g.wallet.signTransaction(txFrom(sc.request.transaction.serialized))),
    ).rejects.toMatchObject({ reason: "EVALUATION_FAILED" });
    expect(signed).toHaveLength(0);
  });

  it("signAllTransactions is all or nothing", async () => {
    const ok = await buildScenario(world, "pay-alice", []);
    const bad = await buildScenario(world, "pay-alice", ["siphon"]);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet);
    await expect(
      g.withIntent(ok.request.intent, () =>
        g.wallet.signAllTransactions([txFrom(ok.request.transaction.serialized), txFrom(bad.request.transaction.serialized)]),
      ),
    ).rejects.toBeInstanceOf(OstiraBlockedError);
    expect(signed).toHaveLength(0);
  });

  it("does not leak one task's intent into a concurrent task", async () => {
    const pay = await buildScenario(world, "pay-alice", []);
    const approve = await buildScenario(world, "approve-router", []);
    const { wallet, signed } = fakeWallet();
    const g = guardFor(wallet);
    const results = await Promise.allSettled([
      g.withIntent(pay.request.intent, () => g.wallet.signTransaction(txFrom(pay.request.transaction.serialized))),
      g.withIntent(approve.request.intent, () => g.wallet.signTransaction(txFrom(pay.request.transaction.serialized))),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(signed).toHaveLength(1);
  });

  it("passes through untouched members and reports every verdict", async () => {
    const sc = await buildScenario(world, "pay-alice", []);
    const { wallet } = fakeWallet();
    const seen: string[] = [];
    const g = guardFor(wallet, { onVerdict: (e, o) => seen.push(`${e.decision}:${o}`) });
    expect(g.wallet.extra()).toBe("kept");
    expect(g.wallet.publicKey.toBase58()).toBe(world.agent);
    await g.withIntent(sc.request.intent, () => g.wallet.signTransaction(txFrom(sc.request.transaction.serialized)));
    expect(seen).toEqual(["ALLOW:signed"]);
  });

  it("works with real @solana/web3.js transactions", async () => {
    const sc = await buildScenario(world, "pay-alice", ["hiddenApproval"]);
    const real = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(sc.request.transaction.serialized, "base64")));
    const signed: unknown[] = [];
    const wallet = {
      publicKey: new PublicKey(world.agent),
      async signTransaction<T>(tx: T) { signed.push(tx); return tx; },
      async signAllTransactions<T>(txs: T[]) { signed.push(...txs); return txs; },
      async signAndSendTransaction() { return { signature: "s" }; },
      async signMessage(m: Uint8Array) { return m; },
    } as unknown as WalletLike;
    const g = guardFor(wallet);
    await expect(g.withIntent(sc.request.intent, () => g.wallet.signTransaction(real))).rejects.toMatchObject({ reason: "BLOCKED" });
    expect(signed).toHaveLength(0);
  });
});
