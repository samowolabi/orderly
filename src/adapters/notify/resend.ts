import { config } from "../../config";
import { NotifierUnavailable, type Notifier, type OwnerMessage } from "./notifier";

const TIMEOUT_MS = 5_000;

// Emails the owner through Resend. Without a verified domain, Resend's test sender
// (onboarding@resend.dev) can only send to the Resend account's own address.
export class ResendNotifier implements Notifier {
  readonly name = "Resend";

  // Sends one email to OWNER_EMAIL, as HTML with a plain-text fallback.
  async notifyOwner(message: OwnerMessage) {
    const { RESEND_API_KEY, RESEND_URL, EMAIL_FROM, OWNER_EMAIL } = config();
    let response: Response;
    try {
      response = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to: [OWNER_EMAIL], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new NotifierUnavailable(`Resend could not be reached: ${(error as Error).message}`);
    }
    if (!response.ok) throw new NotifierUnavailable(`Resend returned HTTP ${response.status}`);
  }
}

// Used when no email is set up, so alerts are skipped without errors.
export class NoNotifier implements Notifier {
  readonly name = "none";

  // Does nothing.
  async notifyOwner() {}
}
