import { fail, json, runLab } from "@/lib/server";

export const runtime = "nodejs";

/** POST /v1/lab { base, attacks[] } — builds the demo transaction with the chosen attacks and evaluates it. */
export async function POST(req: Request) {
  try {
    const { base, attacks } = await req.json();
    return json(await runLab(base, Array.isArray(attacks) ? attacks : []));
  } catch (e) {
    return fail(e);
  }
}
