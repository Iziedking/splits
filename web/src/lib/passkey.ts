import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/lib/api";

/** Adds Face ID, fingerprint or a device passkey for confirming payments. Throws if cancelled. */
export async function registerPasskey(): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/security/passkey/options", {
    method: "POST",
  });
  const response = await startRegistration({ optionsJSON });
  await api("/api/security/passkey/verify", { body: { response } });
}
