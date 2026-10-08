import { verifyBeforeSigning } from "@ostira/core";
import { engine, fail, json } from "@/lib/server";

export const runtime = "nodejs";

/**
 * POST /v1/evaluations/:id/verify-signing { serialized }
 * The last check before a wallet signs: the verdict permits signing, has not expired,
 * and the transaction is byte-for-byte the one that was evaluated. REVIEW passes only after a human approved it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { serialized } = await req.json();
    const rec = (await engine()).store.get(id);
    if (!rec) return Response.json({ error: `No evaluation ${id}` }, { status: 404 });
    return json(verifyBeforeSigning(rec.result, String(serialized ?? ""), { humanApproved: rec.resolution?.action === "APPROVE" }));
  } catch (e) {
    return fail(e);
  }
}
