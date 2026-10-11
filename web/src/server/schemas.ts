import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import type { Confirmation } from "./services/actions";

export const confirmBody = z.object({
  actionId: z.uuid(),
  pin: z.string().optional(),
  passkey: z.looseObject({ id: z.string() }).optional(),
});

/** Exactly one of PIN or passkey. */
export function proofFrom(body: z.infer<typeof confirmBody>): Confirmation {
  if (body.pin !== undefined && body.passkey === undefined) return { pin: body.pin };
  if (body.passkey !== undefined && body.pin === undefined) {
    return { passkey: body.passkey as unknown as AuthenticationResponseJSON };
  }
  throw new z.ZodError([{ code: "custom", path: ["pin"], message: "Send either a PIN or a passkey response", input: body }]);
}
