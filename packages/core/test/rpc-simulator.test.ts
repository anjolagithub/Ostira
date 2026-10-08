import { describe, expect, it } from "vitest";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { RpcSimulator } from "../src/simulator";
import { buildScenario, createWorld } from "../src/fixtures";

/** A stand-in RPC that answers the way Agave does: inner instructions in JSON (parsed) form. */
function fakeRpc(inner: unknown[]) {
  const ok = <T>(v: T) => ({ send: async () => v });
  return {
    getMultipleAccounts: (a: string[]) => ok({ value: a.map(() => null) }),
    simulateTransaction: () => ok({ context: { slot: 4242n }, value: { err: null, logs: [], unitsConsumed: 100n, accounts: [], innerInstructions: inner } }),
  } as never;
}

describe("RpcSimulator against the RPC's JSON inner-instruction shape", async () => {
  const world = await createWorld();
  const sc = await buildScenario(world, "pay-supplier");
  const bytes = Buffer.from(sc.request.transaction.serialized, "base64");
  const keys = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes).staticAccounts as string[];
  const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  it("normalises parsed and partially decoded inner instructions to indexes", async () => {
    const out = await new RpcSimulator(fakeRpc([{ index: 0, instructions: [
      { program: "spl-token", programId: token, parsed: { type: "getAccountDataSize", info: {} }, stackHeight: 2 },
      { programId: "11111111111111111111111111111111", accounts: [keys[0]], data: "3Bxs4h24hBtQy9rw", stackHeight: 2 },
    ] }]), ).simulate(bytes, []);
    expect(out.ok).toBe(true);
    expect(out.slot).toBe(4242n);
    const [a, b] = out.innerInstructions[0].instructions;
    expect(keys[a.programIdIndex]).toBe(token);
    expect(a.parsedType).toBe("getAccountDataSize");
    expect(b.accounts).toEqual([0]);
  });

  it("fails closed when an inner instruction names an account outside the transaction", async () => {
    const out = await new RpcSimulator(fakeRpc([{ index: 0, instructions: [{ programId: "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", accounts: [], data: "", stackHeight: 2 }] }])).simulate(bytes, []);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Unresolvable execution trace/);
  });
});
