import { engine, json } from "@/lib/server";

export const runtime = "nodejs";

export async function GET() {
  return json((await engine()).dataset);
}
