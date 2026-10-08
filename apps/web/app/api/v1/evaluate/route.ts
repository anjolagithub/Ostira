import { engine, fail, json } from "@/lib/server";

export const runtime = "nodejs";

/** POST /v1/evaluate { agentId, intent, transaction: { serialized } } — dry-run only, never signs or broadcasts. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { world, store } = await engine();
    const result = await world.verifier.evaluate(body);
    store.put(result);
    return json(result);
  } catch (e) {
    return fail(e);
  }
}
