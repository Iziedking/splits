import { z } from "zod";
import { nearEnabled } from "@/lib/near/config";
import { expandPockets } from "@/lib/near/instruction";
import { isAccountId } from "@/lib/near/payment";
import { allowRead, readInstruction } from "@/server/near/ai";

const body = z.object({ text: z.string().min(1).max(2000), me: z.string().refine(isAccountId) });

/** A standing instruction in plain words -> a split to review. Nothing is signed here. */
export async function POST(req: Request) {
  if (!nearEnabled()) return new Response("Not found", { status: 404 });
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRead(visitor)) return Response.json({ error: "Too many requests. Try again in a while." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the instruction and your NEAR account" }, { status: 400 });
  return Response.json(await readInstruction(expandPockets(parsed.data.text, parsed.data.me), parsed.data.me));
}
