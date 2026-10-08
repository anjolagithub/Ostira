import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isWritableRole,
  isSignerRole,
  type AccountMeta,
} from "@solana/kit";
import {
  getAccountMetasFromCompiledTransactionMessage,
  walkInstructions,
  type TracedInstruction,
} from "@solana/transaction-introspection";
import { TOKEN_PROGRAM_ADDRESS, TokenInstruction, identifyTokenInstruction } from "@solana-program/token";
import type { RpcInnerInstructions } from "./simulator";
import type { ProgramInteraction } from "./types";

export interface DecodedTransaction {
  compiledMessage: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
  accountMetas: AccountMeta[];
  feePayer: string;
  signers: string[];
  writable: string[];
  usesLookupTables: boolean;
}

export function decodeTransaction(txBytes: Uint8Array): DecodedTransaction {
  const tx = getTransactionDecoder().decode(txBytes);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const lookups = "addressTableLookups" in compiledMessage ? compiledMessage.addressTableLookups ?? [] : [];
  const accountMetas = getAccountMetasFromCompiledTransactionMessage(compiledMessage);
  return {
    compiledMessage,
    accountMetas,
    feePayer: accountMetas[0].address,
    signers: accountMetas.filter((m) => isSignerRole(m.role)).map((m) => m.address),
    writable: accountMetas.filter((m) => isWritableRole(m.role)).map((m) => m.address),
    usesLookupTables: lookups.length > 0,
  };
}

/** Full instruction tree (outer + CPI) after simulation, labelled where we can identify the instruction. */
export function traceInstructions(decoded: DecodedTransaction, inner: RpcInnerInstructions): { traced: TracedInstruction[]; interactions: ProgramInteraction[] } {
  const traced = walkInstructions({
    compiledMessage: decoded.compiledMessage as never,
    meta: { innerInstructions: inner as never },
  });
  const interactions = traced.map((ix) => ({
    programId: ix.programAddress,
    depth: ix.trace.kind,
    instructionType: ix.trace.kind === "inner" ? parsedLabel(inner, ix.trace.outerIndex, ix.trace.innerIndex) ?? labelInstruction(ix) : labelInstruction(ix),
  }));
  return { traced, interactions };
}

/** RPC-parsed inner instructions carry their type ("transferChecked"); use it, capitalised like the decoder's names. */
function parsedLabel(inner: RpcInnerInstructions, outer: number, idx: number): string | undefined {
  const t = inner.find((g) => g.index === outer)?.instructions[idx]?.parsedType;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : undefined;
}

function labelInstruction(ix: TracedInstruction): string | undefined {
  if (ix.programAddress !== TOKEN_PROGRAM_ADDRESS || !ix.data || ix.data.length === 0) return undefined;
  try {
    return TokenInstruction[identifyTokenInstruction(ix as never)];
  } catch {
    return "Unknown";
  }
}
