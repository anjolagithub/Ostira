import { engine, fail, json, requireAdmin } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const rec = (await engine()).store.resolve(id, "REJECT", String(body.by ?? "operator"), body.note);
    return json(rec);
  } catch (e) {
    return fail(e);
  }
}
