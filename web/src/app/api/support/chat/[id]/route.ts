import { api, json, requireUser } from "@/server/http";
import { notFound } from "@/server/errors";
import { getChat } from "@/server/support/chat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A chat as it stands, so a reload picks up where the person left off. */
export const GET = api(async ({ ctx, params }) => {
  const user = await requireUser(ctx);
  if (!UUID.test(params.id ?? "")) throw notFound("Chat not found");
  return json(await getChat(ctx, user, params.id!));
});
