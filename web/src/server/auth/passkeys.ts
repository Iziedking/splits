import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { passkeyChallenges, passkeys } from "../db/schema";
import { badRequest, forbidden } from "../errors";
import { verifyPin } from "./pin";

export type RelyingParty = { rpId: string; rpName: string; origin: string };

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Face ID, Touch ID, fingerprint or a security key, always with user verification. A passkey
 * approves payments, so adding one is approved with the PIN first (same lockout as a payment):
 * without it no registration challenge exists, and a stolen session can't add its own passkey.
 */
export async function startPasskeyRegistration(
  db: Db,
  rp: RelyingParty,
  user: { id: string; email: string },
  pin: string,
  now: Date,
) {
  await verifyPin(db, user.id, pin, now);
  const existing = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await db.insert(passkeyChallenges).values({
    userId: user.id,
    challenge: options.challenge,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  });
  return options;
}

export async function finishPasskeyRegistration(
  db: Db,
  rp: RelyingParty,
  userId: string,
  response: RegistrationResponseJSON,
  now: Date,
) {
  const [pending] = await db
    .update(passkeyChallenges)
    .set({ usedAt: now })
    .where(
      and(
        eq(passkeyChallenges.userId, userId),
        isNull(passkeyChallenges.usedAt),
        gt(passkeyChallenges.expiresAt, now),
        eq(passkeyChallenges.challenge, challengeFromClientData(response.response.clientDataJSON)),
      ),
    )
    .returning();
  if (!pending) throw badRequest("PASSKEY_CHALLENGE", "That passkey request expired. Try again.");

  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) throw badRequest("PASSKEY_INVALID", "Passkey could not be verified");

  const { credential } = result.registrationInfo;
  await db.insert(passkeys).values({
    credentialId: credential.id,
    userId,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports ?? [],
  });
}

/** Options for confirming one action. The action's own random challenge is what gets signed. */
export async function passkeyAssertionOptions(db: Db, rp: RelyingParty, userId: string, challenge: string) {
  const creds = await db.select().from(passkeys).where(eq(passkeys.userId, userId));
  if (creds.length === 0) throw forbidden("NO_PASSKEY", "Add Face ID or fingerprint first, or use your PIN");
  return generateAuthenticationOptions({
    rpID: rp.rpId,
    // Raw bytes, so options.challenge comes back as the same base64url string stored on the action.
    challenge: new Uint8Array(Buffer.from(challenge, "base64url")),
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
  });
}

export async function verifyPasskeyAssertion(
  db: Db,
  rp: RelyingParty,
  userId: string,
  expectedChallenge: string,
  response: AuthenticationResponseJSON,
): Promise<void> {
  const [cred] = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.credentialId, response.id), eq(passkeys.userId, userId)))
    .limit(1);
  if (!cred) throw forbidden("PASSKEY_UNKNOWN", "This passkey isn't linked to your account");

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    requireUserVerification: true,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64")),
      counter: cred.counter,
      transports: cred.transports as AuthenticatorTransport[],
    },
  });
  if (!result.verified) throw forbidden("PASSKEY_REJECTED", "Face ID or fingerprint check failed");
  await db
    .update(passkeys)
    .set({ counter: result.authenticationInfo.newCounter })
    .where(eq(passkeys.credentialId, cred.credentialId));
}

function challengeFromClientData(clientDataJSON: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof parsed.challenge === "string" ? parsed.challenge : "";
  } catch {
    return "";
  }
}
