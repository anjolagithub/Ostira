import "server-only";
import { EvaluationStore, toJson, type EvaluationResult } from "@ostira/core";
import { createWorld, type AnyAttackId, type BaseId, type World } from "@ostira/core/fixtures";
import { buildDataset, evaluateScenario, labApplicable, type Dataset } from "@ostira/core/dataset";

/**
 * One engine per server process. The demo world runs on LiteSVM with the real SPL Token program;
 * swap the simulator for RpcSimulator(createSolanaRpc(process.env.RPC_URL)) to evaluate against Devnet.
 */
interface Engine { world: World; store: EvaluationStore; dataset: Dataset }
const g = globalThis as unknown as { __engine?: Promise<Engine> };

export function engine(): Promise<Engine> {
  g.__engine ??= (async () => {
    const world = await createWorld();
    const store = new EvaluationStore();
    const dataset = await buildDataset({ world, allCombinations: false });
    for (const id of dataset.showcase) store.put(dataset.scenarios[id].result);
    return { world, store, dataset };
  })();
  return g.__engine;
}

export async function runLab(base: BaseId, attacks: AnyAttackId[]) {
  const { world, store, dataset } = await engine();
  if (!(base in dataset.bases)) throw new HttpError(400, `Unknown intent ${base}`);
  const valid = attacks.filter((a) => a in dataset.attacks || a in dataset.extendedAttacks);
  if (!labApplicable(base, valid)) throw new HttpError(400, "Skimmed amount and redirected recipient apply to payments only");
  const entry = await evaluateScenario(world, base, valid, true);
  store.put(entry.result);
  return toJson(entry);
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200) {
  return Response.json(toJson(data), { status, headers: { "cache-control": "no-store" } });
}

export function fail(e: unknown) {
  const status = (e as { status?: number }).status ?? 500;
  return Response.json({ error: (e as Error).message ?? String(e) }, { status });
}

export type { EvaluationResult };
