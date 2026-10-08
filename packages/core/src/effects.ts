import { isSome, type Option } from "@solana/kit";
import { AccountState as TokenState, TOKEN_PROGRAM_ADDRESS, getMintDecoder, getTokenDecoder } from "@solana-program/token";
import { TOKEN_2022_PROGRAM } from "./policy";
import type { AccountState, SimulationOutcome, Simulator } from "./simulator";
import type { ApprovalChange, AssetChange, AuthorityChange, EconomicEffect, ProgramInteraction, SolChange } from "./types";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_ACCOUNT_LEN = 165;
const MINT_LEN = 82;
export const U64_MAX = 2n ** 64n - 1n;

interface TokenView {
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  closeAuthority: string | null;
  frozen: boolean;
}

interface MintView { supply: bigint; decimals: number; mintAuthority: string | null; freezeAuthority: string | null }

const opt = (o: Option<string>) => (isSome(o) ? o.value : null);

function asToken(s: AccountState | null): TokenView | null {
  if (!s || s.programOwner !== TOKEN_PROGRAM_ADDRESS || s.data.length !== TOKEN_ACCOUNT_LEN) return null;
  const t = getTokenDecoder().decode(s.data);
  return {
    mint: t.mint,
    owner: t.owner,
    amount: t.amount,
    delegate: opt(t.delegate),
    delegatedAmount: t.delegatedAmount,
    closeAuthority: opt(t.closeAuthority),
    frozen: t.state === TokenState.Frozen,
  };
}

function asMint(s: AccountState | null): MintView | null {
  if (!s || s.programOwner !== TOKEN_PROGRAM_ADDRESS || s.data.length !== MINT_LEN) return null;
  const m = getMintDecoder().decode(s.data);
  return { supply: m.supply, decimals: m.decimals, mintAuthority: opt(m.mintAuthority), freezeAuthority: opt(m.freezeAuthority) };
}

export interface MintInfo { decimals: number; supply: bigint }

export async function readMint(sim: Simulator, mint: string): Promise<MintInfo | null> {
  const acc = await sim.getAccount(mint);
  if (!acc || acc.programOwner !== TOKEN_PROGRAM_ADDRESS || acc.data.length !== MINT_LEN) return null;
  const m = getMintDecoder().decode(acc.data);
  return { decimals: m.decimals, supply: m.supply };
}

/**
 * Turn raw pre/post account state into a normalized economic effect.
 *
 * This is state-based, not instruction-based: an approval or transfer hidden inside a
 * CPI shows up here exactly like a top-level one, because we diff what actually changed.
 */
export async function extractEffects(
  sim: Simulator,
  outcome: SimulationOutcome,
  interactions: ProgramInteraction[],
): Promise<EconomicEffect> {
  const mintCache = new Map<string, MintInfo | null>();
  const mintInfo = async (mint: string) => {
    if (!mintCache.has(mint)) mintCache.set(mint, await readMint(sim, mint));
    return mintCache.get(mint)!;
  };

  const byOwnerMint = new Map<string, AssetChange>();
  const approvals: ApprovalChange[] = [];
  const authorityChanges: AuthorityChange[] = [];
  const closedAccounts: string[] = [];
  const solChanges: SolChange[] = [];
  const supplyChanges: EconomicEffect["supplyChanges"] = [];
  const frozenAccounts: string[] = [];
  const unsupportedAccounts: string[] = [];

  for (const [address, { pre, post }] of outcome.accounts) {
    // Out-of-scope token program: record it and let the verifier fail closed.
    if (pre?.programOwner === TOKEN_2022_PROGRAM || post?.programOwner === TOKEN_2022_PROGRAM) {
      unsupportedAccounts.push(address);
      continue;
    }

    const mPre = asMint(pre);
    const mPost = asMint(post);
    if (mPre || mPost) {
      if (mPre && mPost) {
        if (mPost.supply !== mPre.supply) supplyChanges.push({ mint: address, delta: mPost.supply - mPre.supply, decimals: mPost.decimals });
        if (mPost.mintAuthority !== mPre.mintAuthority) authorityChanges.push({ tokenAccount: address, field: "mintAuthority", from: mPre.mintAuthority, to: mPost.mintAuthority });
        if (mPost.freezeAuthority !== mPre.freezeAuthority) authorityChanges.push({ tokenAccount: address, field: "freezeAuthority", from: mPre.freezeAuthority, to: mPost.freezeAuthority });
      }
      continue;
    }

    const tPre = asToken(pre);
    const tPost = asToken(post);

    if (tPre || tPost) {
      const mint = (tPost ?? tPre)!.mint;
      const info = await mintInfo(mint);
      const decimals = info?.decimals ?? 0;
      const owner = (tPre ?? tPost)!.owner;
      const delta = (tPost?.amount ?? 0n) - (tPre?.amount ?? 0n);
      if (delta !== 0n) {
        const key = `${owner}:${mint}`;
        const cur = byOwnerMint.get(key) ?? { mint, owner, delta: 0n, decimals };
        cur.delta += delta;
        byOwnerMint.set(key, cur);
      }
      if (tPre && !tPost) closedAccounts.push(address);
      if (tPost?.frozen && !tPre?.frozen) frozenAccounts.push(address);
      if (tPre && tPost && tPre.owner !== tPost.owner) {
        authorityChanges.push({ tokenAccount: address, field: "owner", from: tPre.owner, to: tPost.owner });
      }
      if (tPost && (tPre?.closeAuthority ?? null) !== tPost.closeAuthority) {
        authorityChanges.push({ tokenAccount: address, field: "closeAuthority", from: tPre?.closeAuthority ?? null, to: tPost.closeAuthority });
      }
      const prevDelegate = tPre?.delegate ?? null;
      const prevAmount = tPre?.delegatedAmount ?? 0n;
      const newDelegate = tPost?.delegate ?? null;
      const newAmount = tPost?.delegatedAmount ?? 0n;
      // A delegate whose allowance only went *down* because it was spent is not a new grant.
      const isNewGrant = newDelegate !== null && (newDelegate !== prevDelegate || newAmount > prevAmount);
      if (isNewGrant || (prevDelegate !== null && newDelegate === null)) {
        approvals.push({
          tokenAccount: address,
          mint,
          owner,
          previousDelegate: prevDelegate,
          newDelegate,
          previousAmount: prevAmount,
          newAmount,
          unlimited: newDelegate !== null && (newAmount === U64_MAX || (info !== null && newAmount >= info.supply)),
        });
      }
      continue;
    }

    // Native SOL movement on system-owned (wallet) accounts and newly created accounts.
    const preLamports = pre?.lamports ?? 0n;
    const postLamports = post?.lamports ?? 0n;
    const isWallet = (pre ?? post)?.programOwner === SYSTEM_PROGRAM || pre === null;
    if (isWallet && postLamports !== preLamports) {
      solChanges.push({ account: address, delta: postLamports - preLamports, existedBefore: pre !== null });
    }
  }

  return {
    assetChanges: [...byOwnerMint.values()],
    approvals,
    authorityChanges,
    closedAccounts,
    supplyChanges,
    frozenAccounts,
    unsupportedAccounts,
    solChanges,
    programInteractions: interactions,
    computeUnits: outcome.computeUnits,
  };
}
