import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/lib/api";

/** Adds Face ID, fingerprint or a device passkey for confirming payments, approved with the PIN. Throws if cancelled. */
export async function registerPasskey(pin: string): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/security/passkey/options", {
    body: { pin },
  });
  const response = await startRegistration({ optionsJSON });
  await api("/api/security/passkey/verify", { body: { response } });
}
