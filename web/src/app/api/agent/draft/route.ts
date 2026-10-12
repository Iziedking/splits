import { assertUploadSize } from "@/server/agent/images";
import { badRequest } from "@/server/errors";
import { api, json, requireUser } from "@/server/http";
import { draftPayout } from "@/server/services/agentDrafts";

/** Agentic mode: multipart `text` and up to 3 `images` in, the payout composer's fields out. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  assertUploadSize(req.headers.get("content-length"));
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("INVALID_FORM", "Send the description and screenshots as a form");
  }
  const text = form.get("text");
  const files = await Promise.all(
    form
      .getAll("images")
      .filter((f): f is File => f instanceof File)
      .map(async (f) => ({ name: f.name || "screenshot", bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  return json(await draftPayout(ctx, user, { text: typeof text === "string" ? text : "", files }));
});
