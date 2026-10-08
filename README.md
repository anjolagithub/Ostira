# Ostira

**Financial intent verification for autonomous agents.**

An agent says *"Pay Alice 500 USDC."* Ostira takes the unsigned Solana transaction the agent built, simulates it, turns the before/after account state into an economic effect, and checks that effect against the declared intent and the agent's policy. It returns `ALLOW`, `REVIEW` or `BLOCK` with machine-readable reasons, bound to the exact transaction message and valid for 30 seconds. It never holds keys, never signs, never broadcasts, and fails closed.

```
intent + unsigned tx → validate → decode → simulate → extract effect → match intent → policy → decide
```

## What's proven

- **Real execution.** Scenarios run on [LiteSVM](https://github.com/LiteSVM/litesvm) with the real SPL Token, Associated Token and System programs. Effects come from simulated account state, so a transfer or approval hidden inside a CPI is caught exactly like a top-level one.
- **The hero case.** "Pay Alice 500 USDC" plus a hidden `approve(u64::MAX)` to an unknown wallet → `BLOCK`: the payment is exactly right, the undeclared unlimited allowance is not.
- **Soundness sweep.** Every combination of 7 attacks across 6 intents, 474 real transactions, is blocked. Clean payments and limited approvals are allowed. Six token-level attacks (mint, burn, freeze, mint authority, close for rent, Token-2022) are blocked on every intent, 36 more. Verdicts are bound to the message hash and expire; see `verifyBeforeSigning`. `packages/core/test/verifier.test.ts` has 41 tests.

| Attack slipped into "Pay Alice 500 USDC" | Caught as |
|---|---|
| Hidden unlimited approval | `UNDECLARED_APPROVAL`, `UNLIMITED_APPROVAL` |
| Siphon transfer | `UNEXPECTED_RECIPIENT`, `UNEXPECTED_ASSET_OUTFLOW` |
| Skimmed amount | `AMOUNT_MISMATCH` |
| Redirected recipient | `RECIPIENT_NOT_PAID` |
| Account takeover (SetAuthority) | `AUTHORITY_CHANGE` |
| SOL drain | `UNEXPECTED_SOL_TRANSFER`, `SOL_SPEND_EXCEEDS_CAP` |
| Unapproved program | `UNKNOWN_PROGRAM` |

**Bounded claim.** Ostira verifies the effects it can deterministically observe: SPL token balances, allowances (delegates), account authorities and closures, SOL movements and every program invoked, outer or CPI. Supported intents today are `PAY` and `APPROVE`. Transactions using address lookup tables are blocked rather than guessed at.

## Repo

```
packages/core   the engine: intent schema, simulator adapters, effect extraction, matcher, policy, Effect Diff, tests
apps/web        Next.js 16 console: overview, console, Attack Lab, policy, and the /api/v1 routes
scripts         rename-brand.mjs: rename the product everywhere in one command
```

## Run it

```bash
npm install
npm test            # engine tests, including the 474-transaction sweep
npm run demo        # prints every showcase verdict with reasons and stage timings
npm run dev         # console at http://localhost:3000 (live engine behind /api/v1)
```

`npm -w @ostira/web run preview:build` produces a single self-contained HTML file with a snapshot of real engine output for every Attack Lab combination (used for the shareable preview).

## API

| Method | Path | |
|---|---|---|
| POST | `/api/v1/evaluate` | `{ agentId, intent, transaction: { serialized } }` → evaluation. Dry run only. |
| GET | `/api/v1/evaluations/:id` | Evaluation record, plus any human resolution |
| POST | `/api/v1/evaluations/:id/approve` | Resolve a `REVIEW` (recorded, original result never mutated) |
| POST | `/api/v1/evaluations/:id/reject` | |
| GET / PUT | `/api/v1/policies/:agentId` | Read or replace an agent's policy; every decision records its version hash |
| POST | `/api/v1/lab` | `{ base, attacks[] }` → build and evaluate a demo transaction |

```ts
import { Verifier, RpcSimulator } from "@ostira/core";
import { createSolanaRpc } from "@solana/kit";

const verifier = new Verifier(new RpcSimulator(createSolanaRpc(process.env.RPC_URL!)));
verifier.setPolicy({ agentId: "treasury-agent", assets: { USDC: "<mint>" }, approvedRecipients: ["<alice>"] });

const result = await verifier.evaluate({ agentId: "treasury-agent", intent, transaction: { serialized } });
if (result.decision === "ALLOW") await wallet.signAndSend(tx);
```

## Moving to Devnet

`RpcSimulator` implements the same interface as `LiteSvmSimulator` using `simulateTransaction` (`sigVerify: false`, `replaceRecentBlockhash: true`, `innerInstructions: true`, post-state for writable accounts) and `getMultipleAccounts` for pre-state. Point it at Devnet or Helius with `RPC_URL`. It hasn't been exercised against a live cluster from this build environment, which had no outbound RPC access, so run `npm test` first and then a Devnet smoke test.

## Rename

The product name is a working name pending trademark clearance. To change it everywhere:

```bash
node scripts/rename-brand.mjs NewName && npm install
```

## Live cluster smoke test

The same engine, over real Solana RPC (`simulateTransaction`) instead of LiteSVM. It creates a test mint and accounts, evaluates ten transactions (honest, attacked, CPI, Token-2022), then signs and sends the one it allowed and checks that the executed effect equals the simulated one.

```bash
cd packages/core
npm run smoke                                              # Devnet, airdrops a fresh wallet
KEYPAIR=~/.config/solana/id.json npm run smoke             # Devnet with a funded wallet (if the airdrop is rate-limited)
RPC_URL=http://127.0.0.1:8899 npm run smoke                # a local solana-test-validator
```

It writes `scripts/devnet-report.json`; the site shows the latest report in its proof section. The committed report is from a local Agave 2.2.20 validator: 10/10 verdicts as expected, and the executed transfer matched the simulation exactly. Run it on Devnet to replace it.
