import type { LiteSVM } from "litesvm";
import {
  type Address,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

/** Raw account state as seen by the simulator. */
export interface AccountState {
  address: string;
  programOwner: string;
  lamports: bigint;
  data: Uint8Array;
}

/** Inner instructions in the RPC wire shape (data is base58), which @solana/transaction-introspection consumes. */
export type RpcInnerInstructions = {
  index: number;
  instructions: { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number; /** Set when the RPC returned the instruction already parsed. */ parsedType?: string }[];
}[];

export interface SimulationOutcome {
  ok: boolean;
  error?: string;
  logs: string[];
  computeUnits: bigint;
  /** Slot of the state the simulation ran against. */
  slot: bigint;
  innerInstructions: RpcInnerInstructions;
  /** Pre and post state for every writable account in the transaction. null = account did not exist. */
  accounts: Map<string, { pre: AccountState | null; post: AccountState | null }>;
}

/**
 * The only thing Verifier needs from a chain: read an account, and dry-run a transaction.
 * Implementations MUST NOT sign or broadcast.
 */
export interface Simulator {
  readonly name: string;
  getAccount(address: string): Promise<AccountState | null>;
  simulate(txBytes: Uint8Array, writable: string[]): Promise<SimulationOutcome>;
}

const b58 = getBase58Decoder();

// ---------------------------------------------------------------------------
// LiteSVM: in-process Solana runtime. Real SPL Token program, real execution.
// ---------------------------------------------------------------------------

export class LiteSvmSimulator implements Simulator {
  readonly name = "litesvm";
  /** The svm must be created with `.withSigverify(false)` so unsigned transactions can be dry-run. */
  constructor(private readonly svm: LiteSVM) {}

  async getAccount(address: string): Promise<AccountState | null> {
    const acc = this.svm.getAccount(address as Address);
    if (!acc.exists) return null;
    return { address, programOwner: acc.programAddress, lamports: BigInt(acc.lamports), data: new Uint8Array(acc.data) };
  }

  async simulate(txBytes: Uint8Array, writable: string[]): Promise<SimulationOutcome> {
    const pre = new Map<string, AccountState | null>();
    for (const a of writable) pre.set(a, await this.getAccount(a));

    const tx = getTransactionDecoder().decode(txBytes);
    const res = this.svm.simulateTransaction(tx);
    const failed = "err" in res;
    const meta = res.meta();
    const inner: RpcInnerInstructions = meta.innerInstructions().map((group, index) => ({
      index,
      instructions: group.map((ii) => ({
        programIdIndex: ii.instruction().programIdIndex(),
        accounts: Array.from(ii.instruction().accounts()),
        data: b58.decode(ii.instruction().data()),
        stackHeight: ii.stackHeight(),
      })),
    })).filter((g) => g.instructions.length > 0);

    const accounts = new Map<string, { pre: AccountState | null; post: AccountState | null }>();
    if (!failed) {
      const post = new Map<string, AccountState>();
      for (const a of res.postAccounts()) {
        post.set(a.address, { address: a.address, programOwner: a.programAddress, lamports: BigInt(a.lamports), data: new Uint8Array(a.data) });
      }
      for (const a of writable) {
        const p = post.get(a) ?? null;
        // A post account with 0 lamports no longer exists on chain.
        accounts.set(a, { pre: pre.get(a) ?? null, post: p && p.lamports > 0n ? p : null });
      }
    }
    return {
      ok: !failed,
      error: failed ? String((res as { err(): unknown }).err()) : undefined,
      logs: meta.logs(),
      computeUnits: meta.computeUnitsConsumed(),
      slot: this.svm.getClock().slot,
      innerInstructions: inner,
      accounts,
    };
  }
}

// ---------------------------------------------------------------------------
// RPC (Devnet / Helius / any Solana RPC). Same contract, live cluster state.
// ---------------------------------------------------------------------------

export class RpcSimulator implements Simulator {
  readonly name = "rpc";
  constructor(private readonly rpc: Rpc<SolanaRpcApi>) {}

  async getAccount(address: string): Promise<AccountState | null> {
    const { value } = await this.rpc.getAccountInfo(address as Address, { encoding: "base64", commitment: "confirmed" }).send();
    if (!value) return null;
    return { address, programOwner: value.owner, lamports: BigInt(value.lamports), data: Buffer.from(value.data[0], "base64") };
  }

  async simulate(txBytes: Uint8Array, writable: string[]): Promise<SimulationOutcome> {
    const tx = getTransactionDecoder().decode(txBytes);
    const wire = getBase64EncodedWireTransaction(tx);
    const { value: preInfos } = await this.rpc
      .getMultipleAccounts(writable as Address[], { encoding: "base64", commitment: "confirmed" })
      .send();
    const { context, value: sim } = await this.rpc
      .simulateTransaction(wire, {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        innerInstructions: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: writable as Address[] },
      })
      .send();

    const toState = (address: string, v: { owner: string; lamports: bigint | number; data: readonly [string, string] } | null) =>
      v && BigInt(v.lamports) > 0n
        ? { address, programOwner: v.owner, lamports: BigInt(v.lamports), data: Buffer.from(v.data[0], "base64") }
        : null;

    const accounts = new Map<string, { pre: AccountState | null; post: AccountState | null }>();
    writable.forEach((a, i) => {
      accounts.set(a, {
        pre: toState(a, preInfos[i] as never),
        post: toState(a, (sim.accounts?.[i] ?? null) as never),
      });
    });
    // RPC nodes return inner instructions in JSON form: parsed ({ program, parsed, programId }) for known
    // programs, or { programId, accounts: [base58], data: base58 } otherwise, even for a base64 transaction.
    // Normalise both to the compiled shape. Anything that can't be resolved fails closed.
    const keys = getCompiledTransactionMessageDecoder().decode(tx.messageBytes).staticAccounts as string[];
    const indexOf = (a: string) => {
      const i = keys.indexOf(a);
      if (i < 0) throw new Error(`inner instruction references ${a}, which is not in the transaction`);
      return i;
    };
    let innerInstructions: RpcInnerInstructions;
    try {
      innerInstructions = (sim.innerInstructions ?? []).map((g) => ({
        index: g.index,
        instructions: (g.instructions as any[]).map((ix) => ({
          programIdIndex: typeof ix.programIdIndex === "number" ? ix.programIdIndex : indexOf(ix.programId),
          accounts: Array.isArray(ix.accounts) ? ix.accounts.map((a: number | string) => (typeof a === "number" ? a : indexOf(a))) : [],
          data: typeof ix.data === "string" ? ix.data : "",
          stackHeight: ix.stackHeight ?? undefined,
          parsedType: ix.parsed?.type,
        })),
      }));
    } catch (e) {
      return { ok: false, error: `Unresolvable execution trace: ${(e as Error).message}`, logs: [...(sim.logs ?? [])], computeUnits: 0n, slot: BigInt(context.slot), innerInstructions: [], accounts };
    }
    return {
      ok: sim.err === null,
      error: sim.err === null ? undefined : JSON.stringify(sim.err, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
      logs: [...(sim.logs ?? [])],
      computeUnits: BigInt(sim.unitsConsumed ?? 0),
      slot: BigInt(context.slot),
      innerInstructions,
      accounts,
    };
  }
}
