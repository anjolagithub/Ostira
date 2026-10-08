import { beforeAll, describe, expect, it } from "vitest";
import { getTransactionDecoder, type Address } from "@solana/kit";
import { ATTACKS, BASES, EXTENDED_ATTACKS, buildScenario, createWorld, type AnyAttackId, type AttackId, type BaseId, type ExtendedAttackId, type World } from "../src/fixtures";
import { messageFingerprint, verifyBeforeSigning, DEFAULT_TTL_MS } from "../src/verifier";
import { getTransactionEncoder, type Transaction } from "@solana/kit";
import type { EvaluationResult } from "../src/types";

let world: World;
beforeAll(async () => {
  world = await createWorld();
});

const run = async (base: BaseId, attacks: AnyAttackId[] = []) => world.verifier.evaluate((await buildScenario(world, base, attacks)).request);
const codes = (r: EvaluationResult) => r.reasons.map((f) => f.code);

describe("clean intents", () => {
  it("pays an approved recipient the exact amount → ALLOW", async () => {
    const r = await run("pay-alice");
    expect(r.decision).toBe("ALLOW");
    expect(r.intentMatch).toBe(true);
    expect(r.reasons).toEqual([]);
    const fx = r.economicEffect!;
    expect(fx.assetChanges.find((c) => c.owner === world.alice)!.delta).toBe(500_000_000n);
    expect(fx.assetChanges.find((c) => c.owner === world.agent)!.delta).toBe(-500_000_000n);
    expect(fx.approvals).toEqual([]);
  });

  it("pays a new recipient above the review threshold → REVIEW, with both reasons", async () => {
    const r = await run("pay-supplier");
    expect(r.decision).toBe("REVIEW");
    expect(codes(r)).toEqual(expect.arrayContaining(["NEW_RECIPIENT", "AMOUNT_ABOVE_REVIEW_THRESHOLD"]));
    expect(r.intentMatch).toBe(true);
  });

  it("observes CPIs: creating the supplier's token account runs System and Token via the ATA program", async () => {
    const r = await run("pay-supplier");
    const inner = r.economicEffect!.programInteractions.filter((p) => p.depth === "inner").map((p) => p.programId);
    expect(inner).toContain("11111111111111111111111111111111");
    expect(inner).toContain("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  });

  it("pays above the autonomous limit → REVIEW; the ceiling is advisory and the transaction is never rewritten", async () => {
    const r = await run("pay-alice-large");
    expect(r.decision).toBe("REVIEW");
    expect(codes(r)).toContain("AMOUNT_ABOVE_LIMIT");
    expect(r.suggestedMaxAmount).toBe("5000");
    // The verdict concerns the evaluated 8,000 USDC transaction, nothing else.
    expect(r.diff.find((l) => l.kind === "asset" && l.owner === world.alice)).toMatchObject({ op: "=", amount: "8000" });
  });

  it("grants a limited allowance to an approved spender → ALLOW", async () => {
    const r = await run("approve-router");
    expect(r.decision).toBe("ALLOW");
    expect(r.economicEffect!.approvals[0]).toMatchObject({ newDelegate: world.router, newAmount: 1_000_000_000n, unlimited: false });
  });

  it("declares an unlimited allowance → BLOCK by policy", async () => {
    const r = await run("approve-unlimited");
    expect(r.decision).toBe("BLOCK");
    expect(codes(r)).toContain("UNLIMITED_APPROVAL");
    expect(r.intentMatch).toBe(true); // honest, but not permitted
    expect(r.policyPassed).toBe(false);
  });

  it("approves an unknown spender → BLOCK", async () => {
    const r = await run("approve-unknown");
    expect(r.decision).toBe("BLOCK");
    expect(codes(r)).toContain("UNKNOWN_SPENDER");
  });
});

describe("the hero case", () => {
  it("Pay Alice 500 USDC + hidden unlimited approval → BLOCK, intent mismatch", async () => {
    const r = await run("pay-alice", ["hiddenApproval"]);
    expect(r.decision).toBe("BLOCK");
    expect(r.intentMatch).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(["UNDECLARED_APPROVAL", "UNLIMITED_APPROVAL"]));
    // The payment itself is exactly right: the attack is only visible in the state diff.
    expect(r.economicEffect!.assetChanges.find((c) => c.owner === world.alice)!.delta).toBe(500_000_000n);
    expect(r.economicEffect!.approvals[0]).toMatchObject({ newDelegate: world.drainer, unlimited: true });
  });
});

describe("each attack is caught on its own", () => {
  const expected: Record<AttackId, string> = {
    hiddenApproval: "UNDECLARED_APPROVAL",
    siphon: "UNEXPECTED_RECIPIENT",
    skim: "AMOUNT_MISMATCH",
    redirect: "RECIPIENT_NOT_PAID",
    ownerTakeover: "AUTHORITY_CHANGE",
    solDrain: "UNEXPECTED_SOL_TRANSFER",
    rogueProgram: "UNKNOWN_PROGRAM",
  };
  for (const [attack, code] of Object.entries(expected) as [AttackId, string][]) {
    it(`${attack} → BLOCK (${code})`, async () => {
      const r = await run("pay-alice", [attack]);
      expect(r.decision).toBe("BLOCK");
      expect(codes(r)).toContain(code);
    });
  }
});

describe("soundness sweep", () => {
  it("no combination of attacks on any intent is ever ALLOWed", async () => {
    const attackIds = Object.keys(ATTACKS) as AttackId[];
    let checked = 0;
    for (const base of Object.keys(BASES) as BaseId[]) {
      for (let mask = 1; mask < 1 << attackIds.length; mask++) {
        const attacks = attackIds.filter((_, i) => mask & (1 << i));
        // skim/redirect only apply to payments
        if (BASES[base].kind === "APPROVE" && (attacks.includes("skim") || attacks.includes("redirect"))) continue;
        const r = await run(base, attacks);
        expect(r.decision, `${base} + ${attacks.join(",")}`).toBe("BLOCK");
        checked++;
      }
    }
    expect(checked).toBe(4 * 127 + 3 * 31); // 601 attacked transactions: 3 payments + 1 swap, 3 approvals
  }, 120_000);
});

describe("safety invariants", () => {
  it("evaluation is side-effect free: balances are unchanged after any number of evaluations", async () => {
    const before = world.svm.getBalance(world.agent as Address);
    const ataBefore = (world.svm.getAccount(await world.ata(world.agent)) as { data: Uint8Array }).data;
    for (let i = 0; i < 5; i++) await run("pay-alice", ["siphon", "solDrain"]);
    expect(world.svm.getBalance(world.agent as Address)).toBe(before);
    expect((world.svm.getAccount(await world.ata(world.agent)) as { data: Uint8Array }).data).toEqual(ataBefore);
  });

  it("evaluates unsigned transactions: Verifier never needs a signature", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const tx = getTransactionDecoder().decode(Buffer.from(sc.request.transaction.serialized, "base64"));
    expect(Object.values(tx.signatures).every((s) => s === null)).toBe(true);
    expect((await world.verifier.evaluate(sc.request)).decision).toBe("ALLOW");
  });

  it("fails closed on bytes it cannot decode", async () => {
    const r = await world.verifier.evaluate({ agentId: "treasury-agent", intent: { action: "PAY", asset: "USDC", amount: "1", recipient: world.alice }, transaction: { serialized: Buffer.from("not a transaction").toString("base64") } });
    expect(r.decision).toBe("BLOCK");
    expect(codes(r)).toContain("UNDECODABLE_TRANSACTION");
  });

  it("rejects malformed intents before touching the chain", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const r = await world.verifier.evaluate({ ...sc.request, intent: { action: "PAY", asset: "USDC", amount: "five hundred", recipient: world.alice } });
    expect(r.decision).toBe("BLOCK");
    expect(codes(r)).toEqual(["INVALID_INTENT"]);
    expect(r.pipeline.map((p) => p.stage)).toEqual(["validate", "decide"]);
  });

  it("an intent that mismatches the transaction is caught even when both are 'valid'", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const r = await world.verifier.evaluate({ ...sc.request, intent: { ...sc.request.intent, amount: "50" } as never });
    expect(r.decision).toBe("BLOCK");
    expect(codes(r)).toContain("AMOUNT_MISMATCH");
  });

  it("records the policy version and a stable transaction fingerprint", async () => {
    const a = await run("pay-alice");
    const b = await run("pay-alice");
    expect(a.policyVersion).toMatch(/^pol_[0-9a-f]{12}$/);
    expect(a.policyVersion).toBe(b.policyVersion);
    expect(a.txFingerprint).toBe(b.txFingerprint);
  });
});

describe("effect diff", () => {
  it("hero: two confirmed lines and one undeclared unlimited allowance", async () => {
    const r = await run("pay-alice", ["hiddenApproval"]);
    const ops = r.diff.filter((l) => l.op !== "~").map((l) => `${l.op}${l.kind}`);
    expect(ops).toEqual(["=asset", "=asset", "+allowance"]);
    expect(r.diff.find((l) => l.op === "+")).toMatchObject({ kind: "allowance", spender: world.drainer, unlimited: true, symbol: "USDC" });
  });
  it("clean payment: only confirmed lines plus fees", async () => {
    const r = await run("pay-alice");
    expect(r.diff.map((l) => l.op)).toEqual(["=", "=", "~"]);
  });
  it("skim: declared amount struck out, observed amount added", async () => {
    const r = await run("pay-alice", ["skim"]);
    expect(r.diff.filter((l) => l.kind === "asset").map((l) => `${l.op}${(l as { amount: string }).amount}`)).toEqual(["-500", "+450", "-500", "+450"]);
  });
});

describe("extended token attacks", () => {
  const expected: Record<ExtendedAttackId, string[]> = {
    mintSupply: ["SUPPLY_CHANGE", "UNEXPECTED_RECIPIENT"],
    burn: ["SUPPLY_CHANGE", "UNEXPECTED_ASSET_OUTFLOW"],
    freeze: ["ACCOUNT_FROZEN"],
    mintAuthority: ["AUTHORITY_CHANGE"],
    closeRent: ["ACCOUNT_CLOSED", "UNEXPECTED_SOL_TRANSFER"],
    token2022: ["UNSUPPORTED_PROGRAM"],
  };
  for (const [attack, want] of Object.entries(expected) as [ExtendedAttackId, string[]][]) {
    it(`${attack} → BLOCK (${want.join(", ")})`, async () => {
      const r = await run("pay-alice", [attack]);
      expect(r.decision).toBe("BLOCK");
      expect(codes(r)).toEqual(expect.arrayContaining(want));
    });
  }

  it("every extended attack on every intent is BLOCKed", async () => {
    let n = 0;
    for (const base of Object.keys(BASES) as BaseId[]) {
      for (const a of Object.keys(EXTENDED_ATTACKS) as ExtendedAttackId[]) {
        const r = await run(base, [a]);
        expect(r.decision, `${base} + ${a}`).toBe("BLOCK");
        n++;
      }
    }
    expect(n).toBe(42);
  });

  it("the mint authority change names the field", async () => {
    const r = await run("pay-alice", ["mintAuthority"]);
    expect(r.economicEffect!.authorityChanges[0]).toMatchObject({ field: "mintAuthority", to: world.drainer });
    expect(r.diff.some((l) => l.op === "+" && l.kind === "authority")).toBe(true);
  });

  it("Token-2022 fails closed before simulation", async () => {
    const r = await run("pay-alice", ["token2022"]);
    expect(r.reasons[0]).toMatchObject({ code: "UNSUPPORTED_PROGRAM", category: "UNSUPPORTED" });
    expect(r.pipeline.map((p) => p.stage)).toEqual(["validate", "decode", "decide"]);
    expect(r.simulation.slot).toBeNull();
  });
});

describe("binding a verdict to the exact transaction", () => {
  const encode = (tx: Transaction) => Buffer.from(getTransactionEncoder().encode(tx)).toString("base64");

  it("fingerprint is sha256 of the message bytes, unchanged by signing", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const r = await world.verifier.evaluate(sc.request);
    expect(r.txFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(r.txFingerprint).toBe(messageFingerprint(sc.request.transaction.serialized));
    const tx = getTransactionDecoder().decode(Buffer.from(sc.request.transaction.serialized, "base64"));
    const signed = { ...tx, signatures: Object.fromEntries(Object.keys(tx.signatures).map((k) => [k, new Uint8Array(64).fill(7)])) } as unknown as Transaction;
    expect(messageFingerprint(encode(signed))).toBe(r.txFingerprint);
  });

  it("verifyBeforeSigning passes the evaluated ALLOW transaction", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const r = await world.verifier.evaluate(sc.request);
    expect(verifyBeforeSigning(r, sc.request.transaction.serialized)).toEqual({ ok: true });
  });

  it("rejects a different transaction under an ALLOW verdict", async () => {
    const honest = await buildScenario(world, "pay-alice");
    const swapped = await buildScenario(world, "pay-alice", ["hiddenApproval"]);
    const r = await world.verifier.evaluate(honest.request);
    expect(verifyBeforeSigning(r, swapped.request.transaction.serialized)).toMatchObject({ ok: false, reason: "TRANSACTION_CHANGED" });
  });

  it("rejects a single flipped byte in the message", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const r = await world.verifier.evaluate(sc.request);
    const bytes = Buffer.from(sc.request.transaction.serialized, "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(verifyBeforeSigning(r, bytes.toString("base64"))).toMatchObject({ ok: false, reason: "TRANSACTION_CHANGED" });
  });

  it("expires: a verdict is not usable after its window", async () => {
    const sc = await buildScenario(world, "pay-alice");
    const r = await world.verifier.evaluate(sc.request);
    expect(Date.parse(r.expiresAt) - Date.parse(r.evaluatedAt)).toBe(DEFAULT_TTL_MS);
    const later = new Date(Date.parse(r.expiresAt) + 1);
    expect(verifyBeforeSigning(r, sc.request.transaction.serialized, { now: later })).toMatchObject({ ok: false, reason: "EXPIRED" });
  });

  it("BLOCK never passes; REVIEW passes only with a human approval", async () => {
    const blocked = await buildScenario(world, "pay-alice", ["hiddenApproval"]);
    const rb = await world.verifier.evaluate(blocked.request);
    expect(verifyBeforeSigning(rb, blocked.request.transaction.serialized, { humanApproved: true })).toMatchObject({ ok: false, reason: "NOT_ALLOWED" });
    const review = await buildScenario(world, "pay-supplier");
    const rr = await world.verifier.evaluate(review.request);
    expect(verifyBeforeSigning(rr, review.request.transaction.serialized)).toMatchObject({ ok: false, reason: "NOT_ALLOWED" });
    expect(verifyBeforeSigning(rr, review.request.transaction.serialized, { humanApproved: true })).toEqual({ ok: true });
  });

  it("records the simulation slot and categorises every finding", async () => {
    const r = await run("pay-alice", ["hiddenApproval", "rogueProgram"]);
    expect(r.simulation.slot).toMatch(/^\d+$/);
    expect(r.reasons.every((f) => f.category)).toBe(true);
    expect(r.reasons.find((f) => f.code === "UNDECLARED_APPROVAL")!.category).toBe("INTENT_MISMATCH");
    expect(r.reasons.find((f) => f.code === "UNKNOWN_PROGRAM")!.category).toBe("POLICY_VIOLATION");
  });
});

describe("swaps: a transaction the agent did not build", () => {
  it("an honest market-maker fill within the declared bounds → ALLOW", async () => {
    const r = await run("swap-wbtc");
    expect(r.decision).toBe("ALLOW");
    expect(r.reasons).toEqual([]);
    const ops = r.diff.map((l) => `${l.op}${l.kind}${(l as { reason?: string }).reason === "counterparty" ? ":cp" : ""}`);
    expect(ops).toEqual(["=asset", "=asset", "~asset:cp", "~asset:cp", "~sol"]);
    expect(r.diff[1]).toMatchObject({ amount: "0.01", symbol: "wBTC", bound: { kind: "min", amount: "0.0099" } });
  });

  const expected: Record<string, string[]> = {
    skim: ["SWAP_OUTPUT_BELOW_MINIMUM"],
    redirect: ["SWAP_OUTPUT_BELOW_MINIMUM", "UNEXPECTED_RECIPIENT"],
    siphon: ["SWAP_INPUT_EXCEEDS_INTENT", "UNEXPECTED_RECIPIENT"],
    hiddenApproval: ["UNDECLARED_APPROVAL", "UNLIMITED_APPROVAL"],
    ownerTakeover: ["AUTHORITY_CHANGE"],
    solDrain: ["UNEXPECTED_SOL_TRANSFER"],
    rogueProgram: ["UNKNOWN_PROGRAM"],
    burn: ["SWAP_INPUT_EXCEEDS_INTENT", "SUPPLY_CHANGE"],
    mintSupply: ["UNEXPECTED_RECIPIENT", "SUPPLY_CHANGE"],
  };
  for (const [attack, codesWanted] of Object.entries(expected)) {
    it(`swap + ${attack} → BLOCK (${codesWanted.join(", ")})`, async () => {
      const r = await run("swap-wbtc", [attack as AnyAttackId]);
      expect(r.decision).toBe("BLOCK");
      expect(codes(r)).toEqual(expect.arrayContaining(codesWanted));
    });
  }

  it("a short fill shows the declared minimum struck out and the observed fill added", async () => {
    const r = await run("swap-wbtc", ["skim"]);
    const out = r.diff.filter((l) => l.kind === "asset" && (l as { symbol: string }).symbol === "wBTC" && (l as { owner: string }).owner === world.agent);
    expect(out.map((l) => `${l.op}${(l as { amount: string }).amount}`)).toEqual(["-0.0099", "+0.009"]);
  });

  it("an output asset outside the registry is refused before simulation", async () => {
    const sc = await buildScenario(world, "swap-wbtc");
    const r = await world.verifier.evaluate({ ...sc.request, intent: { ...sc.request.intent, assetOut: "DOGE" } as never });
    expect(r.decision).toBe("BLOCK");
    expect(codes(r)).toEqual(["UNKNOWN_ASSET"]);
  });
});
