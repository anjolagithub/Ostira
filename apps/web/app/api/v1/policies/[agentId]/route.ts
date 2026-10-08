import { policyVersion } from "@ostira/core";
import { engine, fail, json } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await ctx.params;
  const p = (await engine()).world.verifier.getPolicy(agentId);
  return p ? json({ policy: p, version: policyVersion(p) }) : Response.json({ error: `No policy for ${agentId}` }, { status: 404 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await ctx.params;
    const body = await req.json();
    const p = (await engine()).world.verifier.setPolicy({ ...body, agentId });
    return json({ policy: p, version: policyVersion(p) });
  } catch (e) {
    return fail(Object.assign(e as Error, { status: 400 }));
  }
}
