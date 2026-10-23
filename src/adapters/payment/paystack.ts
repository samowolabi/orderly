import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config";
import {
  InvalidPaymentPayload,
  PaymentProcessorUnavailable,
  type CreateCheckoutInput,
  type PaymentProcessor,
  type PaymentTransaction,
  type PaymentWebhookEvent,
} from "./payment-processor";
import { retry } from "../../utils/retry";

// Short enough that a retry still fits inside a Chord tool call.
const TIMEOUT_MS = 5_000;

export class PaystackAdapter implements PaymentProcessor {
  readonly name = "Paystack";
  readonly webhookSignatureHeader = "x-paystack-signature";

  // Verifies a Paystack HMAC signature against the exact raw request body.
  isWebhookAuthentic(body: Buffer, signature: string | undefined) {
    if (!signature) return false;

    const expected = createHmac("sha512", config().PAYSTACK_SECRET_KEY).update(body).digest();
    let received: Buffer;

    try {
      received = Buffer.from(signature, "hex");
    } catch {
      return false;
    }

    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  // Converts a raw Paystack webhook into a provider-independent payment event.
  parseWebhook(body: Buffer): PaymentWebhookEvent {
    let value: unknown;

    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      throw new InvalidPaymentPayload("bad_json", "The Paystack webhook body was not valid JSON.");
    }

    if (!value || typeof value !== "object") {
      throw new InvalidPaymentPayload("invalid_webhook", "The Paystack webhook body was invalid.");
    }

    const event = (value as Record<string, unknown>).event;
    const data = (value as Record<string, unknown>).data;
    if (typeof event !== "string" || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new InvalidPaymentPayload("invalid_webhook", "The Paystack webhook event or data was missing.");
    }

    const transaction = data as Record<string, unknown>;
    if (event !== "charge.success" || transaction.status !== "success") {
      return { type: "ignored", sourceEvent: event };
    }

    return { type: "payment.succeeded", transaction: this.transactionFromData(transaction) };
  }

  // Creates a Paystack checkout URL for one order payment attempt.
  async createCheckout(input: CreateCheckoutInput): Promise<{ checkoutUrl: string }> {
    let result;

    try {
      result = await this.request("POST", "/transaction/initialize", {
        reference: input.reference,
        amount: input.amountSubunits,
        currency: input.currency,
        email: input.email,
        metadata: input.metadata,
      });
    } catch (error) {
      throw new PaymentProcessorUnavailable(`initialize: ${(error as Error).message}`);
    }

    const url = result.body?.data?.authorization_url;
    if (result.httpStatus !== 200 || !result.body?.status || typeof url !== "string") {
      // Paystack's 5xx may clear on a retry; a 4xx means it refused this request.
      throw new PaymentProcessorUnavailable(
        `initialize: HTTP ${result.httpStatus} ${result.body?.message ?? ""}`.trim(),
        result.httpStatus >= 500,
      );
    }

    return { checkoutUrl: url };
  }

  // Verifies a Paystack reference, retrying timeouts and 5xx replies. It's a read, so safe to repeat.
  async verifyTransaction(reference: string): Promise<PaymentTransaction | null> {
    return retry(
      async () => {
        let result;
        try {
          result = await this.request("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
        } catch (error) {
          throw new PaymentProcessorUnavailable(`verify: ${(error as Error).message}`);
        }
        const { httpStatus, body } = result;
        if (httpStatus >= 500) throw new PaymentProcessorUnavailable(`verify: HTTP ${httpStatus}`);
        if (httpStatus === 401) throw new PaymentProcessorUnavailable("verify: Paystack rejected the secret key", false);
        if (httpStatus === 400 || httpStatus === 404) return null;

        const transaction = body?.data;
        if (!body?.status || !transaction) {
          throw new PaymentProcessorUnavailable(`verify: unexpected response ${httpStatus}`, false);
        }
        return this.transactionFromData(transaction);
      },
      { retryOn: (error) => error instanceof PaymentProcessorUnavailable && error.retryable },
    );
  }

  // Validates and normalizes transaction data returned by Paystack.
  private transactionFromData(data: Record<string, unknown>): PaymentTransaction {
    if (
      typeof data.reference !== "string" ||
      typeof data.status !== "string" ||
      typeof data.amount !== "number" ||
      typeof data.currency !== "string"
    ) {
      throw new InvalidPaymentPayload("invalid_webhook", "The Paystack transaction data was incomplete.");
    }

    return {
      status: data.status,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      channel: typeof data.channel === "string" ? data.channel : null,
      paid_at:
        typeof data.paid_at === "string"
          ? data.paid_at
          : typeof data.paidAt === "string"
            ? data.paidAt
            : null,
      gateway_response: typeof data.gateway_response === "string" ? data.gateway_response : null,
    };
  }

  // Sends an authenticated request to Paystack with a fixed timeout.
  private async request(method: "GET" | "POST", path: string, requestBody?: unknown) {
    const { PAYSTACK_BASE_URL, PAYSTACK_SECRET_KEY } = config();
    const response = await fetch(new URL(path, PAYSTACK_BASE_URL), {
      method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Treats a non-JSON Paystack response as an absent response body.
    const responseBody = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: any;
    } | null;
    return { httpStatus: response.status, body: responseBody };
  }
}
