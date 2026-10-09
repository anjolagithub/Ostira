# @ostira/guard

Make an agent's wallet refuse to sign anything Ostira has not verified.

Agent frameworks such as [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) build a transaction inside a
tool and then hand it to a wallet object to sign. `guardWallet` wraps that wallet, so no tool, plugin or prompt gets a
signature without passing Ostira first, whoever built the transaction.

```ts
import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import { Verifier, RpcSimulator } from "@ostira/core";
import { guardWallet } from "@ostira/guard";
import { createSolanaRpc } from "@solana/kit";

// Your verifier, with your policy, against your RPC. Ostira never holds a key and never broadcasts.
const verifier = new Verifier(new RpcSimulator(createSolanaRpc(process.env.RPC_URL!)));
verifier.setPolicy({ agentId: "treasury-agent", assets: { USDC: "<mint>" }, approvedRecipients: ["<alice>"] });

const guard = guardWallet(new KeypairWallet(keypair, rpcUrl), {
  agentId: "treasury-agent",
  evaluate: (req) => verifier.evaluate(req),
  onReview: (evaluation) => askAHuman(evaluation), // optional; REVIEW is refused without it
});

const agent = new SolanaAgentKit(guard.wallet, rpcUrl, {}); // use the guarded wallet everywhere

// Declare what the agent says it is doing. Every signature inside is checked against it.
await guard.withIntent({ action: "PAY", asset: "USDC", amount: "500", recipient: "<alice>" }, () => runAgentTask(agent));
```

If a transaction does more or less than the declared intent (a hidden unlimited approval, a siphon, a short amount,
a changed recipient), `signTransaction` / `signAndSendTransaction` throws `OstiraBlockedError` and the real wallet is
never called.

## What it guarantees

- **No intent, no signature.** A signature outside `withIntent` is refused.
- **Exact transaction.** The verdict is bound to the transaction's message bytes and expires (30 s by default). A
  replayed or stale ALLOW for a different transaction is refused (`TRANSACTION_CHANGED`, `EXPIRED`).
- **Fails closed.** If evaluation throws or the RPC is down, nothing is signed (`EVALUATION_FAILED`).
- **REVIEW needs a human.** Without `onReview` returning `true`, REVIEW is a refusal.
- **All or nothing.** `signAllTransactions` checks every transaction first and signs none if any is refused. (One
  declared intent rarely fits several different transactions, so call it per transaction.)
- **No cross-talk.** The declared intent is scoped to its async call chain; concurrent tasks cannot borrow each other's.

## What is verified, and what is not

- 18 tests cover the cases above, including the seven core attacks, intent mismatch, REVIEW, expiry, replay,
  evaluator failure and concurrency. They run against the same engine and fixtures as `@ostira/core`.
- A guarded `KeypairWallet` type-checks against, and constructs inside, `solana-agent-kit@2.0.10`.
- **Not yet verified:** an end-to-end run with a live agent and LLM choosing tools on a live cluster. The Agent Kit
  version above is the only one checked.
- **The hosted demo API is not a verifier for your agent.** `/api/v1/evaluate` on the demo site runs a fixed demo
  world. For a real agent, run a `Verifier` yourself (as above) with your own policy and RPC.
- The engine's current limits apply: SPL Token only (Token-2022 and address lookup tables fail closed), and the
  PAY, SWAP and APPROVE intents.
