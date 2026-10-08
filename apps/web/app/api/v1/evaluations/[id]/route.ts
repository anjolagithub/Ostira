import { engine, fail, json } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const rec = (await engine()).store.get(id);
    return rec ? json(rec) : Response.json({ error: `No evaluation ${id}` }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}
