import { NextResponse } from "next/server";
import { nearEnabled } from "@/lib/near/config";
import { recentPayments } from "@/server/near/recent";

/** "Divided just now": the latest payments the router divided, without names. Cached 90 s. */
export async function GET() {
  if (!nearEnabled()) return new Response("Not found", { status: 404 });
  return NextResponse.json({ payments: await recentPayments() }, { headers: { "Cache-Control": "public, max-age=60" } });
}
