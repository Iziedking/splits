import { z } from "zod";
import { nearEnabled } from "@/lib/near/config";
import { isAccountId } from "@/lib/near/payment";
import { allowRead, readList } from "@/server/near/ai";

const body = z.object({ text: z.string().min(1).max(2000), me: z.string().refine(isAccountId).nullable().optional() });

/** "Describe it, I split it" for NEAR: plain words -> a list to check. Nothing is paid here. */
export async function POST(req: Request) {
  if (!nearEnabled()) return new Response("Not found", { status: 404 });
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRead(visitor)) return Response.json({ error: "Too many requests. Try again in a while." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write who gets what, one person per line" }, { status: 400 });
  return Response.json(await readList(parsed.data.text, parsed.data.me ?? null));
}
