/**
 * Live-cluster smoke test: the same engine, evaluating real transactions against real chain state
 * through Solana RPC (simulateTransaction), then signing and sending the one transaction it allowed.
 *
 *   npm run smoke --workspace @ostira/core                      # Devnet (airdrops a fresh wallet)
 *   KEYPAIR=~/.config/solana/id.json npm run smoke ...          # use a funded wallet instead
 *   RPC_URL=http://127.0.0.1:8899 npm run smoke ...             # local solana-test-validator
 *   DRY=1 ...                                                   # evaluate only, send nothing
 *
 * Writes devnet-report.json next to this script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  type Address,
  type Instruction,
  type KeyPairSigner,
  AccountRole,
  airdropFactory,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  AuthorityType,
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
  getApproveInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToCheckedInstruction,
  getSetAuthorityInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { RpcSimulator } from "../src/simulator";
import { Verifier, verifyBeforeSigning } from "../src/verifier";
import { TOKEN_2022_PROGRAM, toBaseUnits, toUi } from "../src/policy";
import type { EvaluationResult, FinancialIntent } from "../src/types";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.WS_URL ?? RPC_URL.replace(/^http/, "ws").replace(":8899", ":8900");
const DRY = process.env.DRY === "1";
const DECIMALS = 6;
const U64_MAX = 2n ** 64n - 1n;

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const log = (...a: unknown[]) => console.log(...a);

async function loadPayer(): Promise<KeyPairSigner | null> {
  if (process.env.FORCE_OBSERVE === "1") return null;
  if (process.env.KEYPAIR) {
    const path = process.env.KEYPAIR.replace(/^~/, homedir());
    return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
  }
  const kp = await generateKeyPairSigner();
  log(`No KEYPAIR given: requesting a Devnet airdrop for a fresh wallet ${kp.address}`);
  // Devnet rate-limits faucets; the whole run costs under 0.05 SOL, so ask for less on each retry.
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  let last = "";
  for (const sol of [1_000_000_000n, 500_000_000n, 300_000_000n]) {
    try {
      await airdrop({ recipientAddress: kp.address, lamports: lamports(sol), commitment: "confirmed" });
      return kp;
    } catch (e) {
      last = (e as Error).message;
      log(`Airdrop of ${Number(sol) / 1e9} SOL failed (${last}); retrying smaller in 5 s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (process.env.REQUIRE_FULL === "1") throw new Error(`Airdrop failed (${last}). Fund a wallet at https://faucet.solana.com and rerun with KEYPAIR=path/to/id.json.`);
  log(`The faucet refused (${last}). Switching to read-only mode: evaluating against existing Devnet USDC holders, nothing is signed.`);
  return null;
}

async function send(payer: KeyPairSigner, ixs: Instruction[]) {
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  await sendAndConfirm(tx as never, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

/** The agent's unsigned transaction: what an agent hands to Ostira before anyone signs. */
async function unsigned(feePayer: Address, ixs: Instruction[]) {
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const tx = compileTransaction(pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  ));
  return { tx, serialized: getBase64EncodedWireTransaction(tx) as string };
}

async function main() {
  const version = await rpc.getVersion().send();
  log(`Cluster ${RPC_URL}, solana-core ${version["solana-core"]}`);
  const payer = await loadPayer();
  const mode: "full" | "observe" = payer ? "full" : "observe";
  const [mintKp, alice, supplier, router, drainerKp] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
  let mint: Address, agentAddr: Address, agentAta: Address, drainer: Address;

  if (payer) {
    // ---- full mode: real transactions that build the world (mint, accounts, balances)
    log("Setting up a test mint and accounts on the cluster...");
    mint = mintKp.address;
    agentAddr = payer.address;
    drainer = drainerKp.address;
    const space = BigInt(getMintSize());
    const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
    await send(payer, [
      getCreateAccountInstruction({ payer, newAccount: mintKp, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeMintInstruction({ mint, decimals: DECIMALS, mintAuthority: payer.address, freezeAuthority: payer.address }),
    ]);
    agentAta = (await findAssociatedTokenPda({ mint, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
    await send(payer, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: payer.address, mint }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: alice.address, mint }),
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: drainer, mint }),
      getMintToCheckedInstruction({ mint, token: agentAta, mintAuthority: payer, amount: toBaseUnits("250000", DECIMALS), decimals: DECIMALS }),
      // The drainer must exist as a wallet so that a SOL transfer to it is a transfer, not account rent.
      getTransferSolInstruction({ source: payer, destination: drainer, amount: lamports(1_000_000n) }),
    ]);
  } else {
    // ---- read-only mode: real Devnet USDC, real wallets that already hold it. Simulation only.
    mint = (process.env.DEVNET_USDC ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU") as Address;
    log(`Looking for existing holders of Devnet USDC ${mint} in its recent transfers...`);
    // Public RPC disables getTokenLargestAccounts / getProgramAccounts, so read recent transfers instead.
    const sigs = (await rpc.getSignaturesForAddress(mint, { limit: 60, commitment: "confirmed" }).send()).filter((x) => x.err === null);
    const seen = new Set<string>();
    const wallets: { owner: Address; tokenAccount: Address; lamports: bigint; amount: bigint }[] = [];
    for (const sg of sigs.slice(0, 40)) {
      if (wallets.length >= 6) break;
      try {
        const tx: any = await rpc.getTransaction(sg.signature, { maxSupportedTransactionVersion: 0, encoding: "json", commitment: "confirmed" }).send();
        if (!tx?.meta) continue;
        const keys: string[] = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
        for (const b of tx.meta.postTokenBalances ?? []) {
          if (b.mint !== mint || !b.owner || seen.has(b.owner)) continue;
          seen.add(b.owner);
          const tokenAccount = keys[b.accountIndex] as Address;
          const t = await fetchToken(rpc, tokenAccount, { commitment: "confirmed" }).catch(() => null);
          if (!t || t.data.state !== 1 || t.data.owner !== b.owner || t.data.mint !== mint) continue;
          const { value: w } = await rpc.getAccountInfo(b.owner as Address, { encoding: "base64", commitment: "confirmed" }).send();
          if (!w || w.owner !== "11111111111111111111111111111111") continue; // a plain wallet, not a program
          wallets.push({ owner: b.owner as Address, tokenAccount, lamports: BigInt(w.lamports), amount: t.data.amount });
        }
      } catch {}
    }
    // Read-only mode scales every amount by 1/1000, so a holder of a few faucet USDC is enough.
    const agentW = wallets.find((w) => w.lamports >= 50_000_000n && w.amount >= toBaseUnits("5", DECIMALS));
    const drainerW = wallets.find((w) => w !== agentW);
    if (!agentW || !drainerW) throw new Error("No suitable Devnet USDC holders found for read-only mode.");
    agentAddr = agentW.owner;
    agentAta = agentW.tokenAccount;
    drainer = drainerW.owner;
    log(`Acting, read-only, as ${agentAddr} (holds ${Number(agentW.amount) / 1e6} USDC). Nothing will be signed.`);
  }
  const ata = async (owner: Address) => (await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

  // Read-only mode works with whatever real holders have: amounts and limits are scaled together by 1/1000.
  const K = mode === "observe" ? 1000n : 1n;
  const ui = (n: string) => toUi(toBaseUnits(n, DECIMALS) / K, DECIMALS);
  const fmt = (n: string) => Number(ui(n)).toLocaleString("en-US");
  const verifier = new Verifier(new RpcSimulator(rpc));
  verifier.setPolicy({
    agentId: "treasury-agent",
    assets: { USDC: mint },
    reviewAbove: ui("1000"), maxPayAmount: ui("5000"), maxApprovalAmount: ui("2500"), allowUnlimitedApprovals: false,
    approvedRecipients: [alice.address], approvedSpenders: [router.address], approvedPrograms: [],
    newRecipientAction: "REVIEW", unknownSpenderAction: "BLOCK", unknownProgramAction: "BLOCK",
    maxSolSpendLamports: "10000000",
  });

  // ---- the cases: each is the agent's unsigned transaction plus its declared intent
  const noop = createNoopSigner(agentAddr); // instruction builders want a signer; nothing is signed here
  const usdc = (n: string) => toBaseUnits(n, DECIMALS) / K;
  // In read-only mode recipients have no token account yet, so the payment creates it (rent is within the SOL cap).
  const pay = async (owner: Address, n: string): Promise<Instruction[]> => [
    ...(mode === "observe" ? [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: noop, owner, mint })] : []),
    getTransferCheckedInstruction({ source: agentAta, mint, destination: await ata(owner), authority: noop, amount: usdc(n), decimals: DECIMALS }),
  ];
  const payAlice: FinancialIntent = { action: "PAY", asset: "USDC", amount: ui("500"), recipient: alice.address };
  const aliceAta = await ata(alice.address);
  const drainerAta = await ata(drainer);
  const p500 = await pay(alice.address, "500");

  const cases: { name: string; intent: FinancialIntent; ixs: Instruction[]; expect: string; code?: string }[] = [
    { name: `Pay Alice ${fmt("500")} USDC (honest)`, intent: payAlice, ixs: p500, expect: "ALLOW" },
    { name: "+ hidden unlimited approval", intent: payAlice, ixs: [...p500, getApproveInstruction({ source: agentAta, delegate: drainer, owner: noop, amount: U64_MAX })], expect: "BLOCK", code: "UNDECLARED_APPROVAL" },
    { name: `+ siphon ${fmt("50")} USDC`, intent: payAlice, ixs: [...p500, ...(await pay(drainer, "50"))], expect: "BLOCK", code: "UNEXPECTED_RECIPIENT" },
    { name: `skimmed: sends ${fmt("450")}`, intent: payAlice, ixs: await pay(alice.address, "450"), expect: "BLOCK", code: "AMOUNT_MISMATCH" },
    { name: "+ account owner takeover", intent: payAlice, ixs: [...p500, getSetAuthorityInstruction({ owned: agentAta, owner: noop, authorityType: AuthorityType.AccountOwner, newAuthority: drainer })], expect: "BLOCK", code: "AUTHORITY_CHANGE" },
    { name: "+ 0.02 SOL drain", intent: payAlice, ixs: [...p500, getTransferSolInstruction({ source: noop, destination: drainer, amount: lamports(20_000_000n) })], expect: "BLOCK", code: "UNEXPECTED_SOL_TRANSFER" },
    // Minting needs the mint authority, which only exists when this run created the mint.
    ...(mode === "full" ? [{ name: "+ unauthorized mint", intent: payAlice, ixs: [...p500, getMintToCheckedInstruction({ mint, token: drainerAta, mintAuthority: noop, amount: usdc("1000000"), decimals: DECIMALS })], expect: "BLOCK", code: "SUPPLY_CHANGE" }] : []),
    { name: "+ Token-2022 reference", intent: payAlice, ixs: [...p500, { programAddress: TOKEN_2022_PROGRAM as Address, accounts: [{ address: agentAddr, role: AccountRole.READONLY_SIGNER }], data: new Uint8Array([0]) }], expect: "BLOCK", code: "UNSUPPORTED_PROGRAM" },
    {
      name: `Pay new supplier ${fmt("4000")} (creates ATA via CPI)`,
      intent: { action: "PAY", asset: "USDC", amount: ui("4000"), recipient: supplier.address },
      ixs: [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: noop, owner: supplier.address, mint }), getTransferCheckedInstruction({ source: agentAta, mint, destination: await ata(supplier.address), authority: noop, amount: usdc("4000"), decimals: DECIMALS })],
      expect: "REVIEW", code: "NEW_RECIPIENT",
    },
    { name: `Approve Router ${fmt("1000")} USDC`, intent: { action: "APPROVE", asset: "USDC", spender: router.address, amount: ui("1000") }, ixs: [getApproveInstruction({ source: agentAta, delegate: router.address, owner: noop, amount: usdc("1000") })], expect: "ALLOW" },
  ];

  const results: { name: string; expected: string; decision: string; codes: string[]; slot: string | null; ms: number; pass: boolean; cpi?: number }[] = [];
  let honest: { serialized: string; tx: Awaited<ReturnType<typeof unsigned>>["tx"]; result: EvaluationResult } | null = null;
  for (const c of cases) {
    const u = await unsigned(agentAddr, c.ixs);
    const t0 = performance.now();
    const r = await verifier.evaluate({ agentId: "treasury-agent", intent: c.intent, transaction: { serialized: u.serialized } });
    const ms = Math.round(performance.now() - t0);
    const codes = r.reasons.map((f) => f.code);
    const pass = r.decision === c.expect && (!c.code || (codes as string[]).includes(c.code));
    const cpi = r.economicEffect?.programInteractions.filter((p) => p.depth === "inner").length;
    results.push({ name: c.name, expected: c.expect + (c.code ? ` ${c.code}` : ""), decision: r.decision, codes, slot: r.simulation.slot, ms, pass, cpi });
    log(`${pass ? "PASS" : "FAIL"}  ${r.decision.padEnd(6)} ${c.name}  [${codes.join(", ") || "no findings"}]  slot ${r.simulation.slot}  ${ms} ms${cpi ? `  ${cpi} CPI` : ""}`);
    if (c.name.includes("honest")) honest = { serialized: u.serialized, tx: u.tx, result: r };
  }

  // ---- the gate: sign exactly what was allowed, prove signing kept the fingerprint, send it, compare
  let sent: Record<string, unknown> = { skipped: true };
  if (honest && honest.result.decision === "ALLOW" && payer) {
    const signed = await signTransaction([payer.keyPair], honest.tx as never);
    const signedB64 = getBase64EncodedWireTransaction(signed as never) as string;
    const gate = verifyBeforeSigning(honest.result, signedB64);
    const tampered = verifyBeforeSigning(honest.result, (await unsigned(agentAddr, await pay(alice.address, "501"))).serialized);
    log(`verifyBeforeSigning(signed tx) -> ${JSON.stringify(gate)}; on a different tx -> ${JSON.stringify(tampered)}`);
    if (!DRY && gate.ok) {
      const before = (await fetchToken(rpc, aliceAta, { commitment: "confirmed" })).data.amount;
      await sendAndConfirm(signed as never, { commitment: "confirmed" });
      const after = (await fetchToken(rpc, aliceAta, { commitment: "confirmed" })).data.amount;
      const simulated = honest.result.economicEffect!.assetChanges.find((c) => c.owner === alice.address)!.delta;
      sent = { signature: getSignatureFromTransaction(signed as never), aliceDelta: (after - before).toString(), simulatedDelta: simulated.toString(), simulationMatchedExecution: after - before === simulated };
      log(`Sent ${sent.signature}. Alice received ${after - before} base units; simulation said ${simulated}. Match: ${sent.simulationMatchedExecution}`);
    } else sent = { skipped: true, gate, tampered };
  }

  const report = {
    cluster: RPC_URL, solanaCore: version["solana-core"], ranAt: new Date().toISOString(),
    mode, agent: agentAddr, mint, passed: results.filter((r) => r.pass).length, total: results.length, results, sent,
  };
  writeFileSync(new URL("./devnet-report.json", import.meta.url), JSON.stringify(report, null, 2));
  log(`\n${report.passed}/${report.total} cases behaved as expected. Report: packages/core/scripts/devnet-report.json`);
  process.exit(report.passed === report.total ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
