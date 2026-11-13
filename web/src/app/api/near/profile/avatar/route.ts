import { z } from "zod";
import { json, readJson } from "@/server/http";
import { emailAccountApi, requireSessionUser } from "@/server/near/http";
import { MAX_AVATAR_CHARS, setAvatar } from "@/server/near/profile";

/** Sets the signed-in person's profile picture: a small square image the browser already shrank. */
export const PUT = emailAccountApi(async ({ req, ctx }) => {
  const user = await requireSessionUser(ctx);
  const { image } = await readJson(req, z.object({ image: z.string().max(MAX_AVATAR_CHARS) }));
  await setAvatar(ctx, user.id, image);
  return json({ avatar: image });
});

/** Removes the picture; the round initials show again. */
export const DELETE = emailAccountApi(async ({ ctx }) => {
  const user = await requireSessionUser(ctx);
  await setAvatar(ctx, user.id, null);
  return json({ avatar: null });
});
