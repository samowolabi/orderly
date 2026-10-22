import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { ApiError } from "../utils/http";

export class PaystackUnavailable extends Error {}

export type PaystackTransaction = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel: string | null;
  paid_at: string | null;
  gateway_response: string | null;
};

export type PaystackWebhook = {
  event: string;
  data: Record<string, unknown>;
};

const TIMEOUT_MS = 10_000;

// Verifies a Paystack HMAC signature against the exact raw request body.
export function hasValidPaystackSignature(body: Buffer, signature: string | undefined) {
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

// Parses a raw Paystack webhook into its minimal event shape.
export function parsePaystackWebhook(body: Buffer): PaystackWebhook {
  let value: unknown;

  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ApiError(400, "bad_json", "The Paystack webhook body was not valid JSON.");
  }

  if (!value || typeof value !== "object") {
    throw new ApiError(400, "invalid_webhook", "The Paystack webhook body was invalid.");
  }

  const event = (value as Record<string, unknown>).event;
  const data = (value as Record<string, unknown>).data;
  if (typeof event !== "string" || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(400, "invalid_webhook", "The Paystack webhook event or data was missing.");
  }

  return { event, data: data as Record<string, unknown> };
}

// Validates and normalizes transaction data from a Paystack webhook.
export function transactionFromWebhook(webhook: PaystackWebhook): PaystackTransaction {
  const { data } = webhook;
  if (
    typeof data.reference !== "string" ||
    typeof data.status !== "string" ||
    typeof data.amount !== "number" ||
    typeof data.currency !== "string"
  ) {
    throw new ApiError(400, "invalid_webhook", "The Paystack transaction data was incomplete.");
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
async function request(method: "GET" | "POST", path: string, requestBody?: unknown) {
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

// Creates a Paystack checkout URL for an order payment attempt.
export async function initializeTransaction(input: {
  reference: string;
  amountKobo: number;
  email: string;
  metadata: Record<string, unknown>;
}): Promise<{ authorization_url: string }> {
  let result;

  try {
    result = await request("POST", "/transaction/initialize", {
      reference: input.reference,
      amount: input.amountKobo,
      currency: "NGN",
      email: input.email,
      metadata: input.metadata,
    });
  } catch (error) {
    throw new PaystackUnavailable(`initialize: ${(error as Error).message}`);
  }

  const url = result.body?.data?.authorization_url;
  if (result.httpStatus !== 200 || !result.body?.status || typeof url !== "string") {
    throw new PaystackUnavailable(`initialize: HTTP ${result.httpStatus} ${result.body?.message ?? ""}`.trim());
  }

  return { authorization_url: url };
}

// Verifies a Paystack reference with one retry for transient failures.
export async function verifyTransaction(reference: string): Promise<PaystackTransaction | null> {
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { httpStatus, body } = await request("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      if (httpStatus >= 500) {
        lastError = `HTTP ${httpStatus}`;
        continue;
      }
      if (httpStatus === 401) throw new PaystackUnavailable("verify: Paystack rejected the secret key");
      if (httpStatus === 400 || httpStatus === 404) return null;

      const transaction = body?.data;
      if (!body?.status || !transaction) throw new PaystackUnavailable(`verify: unexpected response ${httpStatus}`);

      return {
        status: String(transaction.status),
        reference: String(transaction.reference),
        amount: Number(transaction.amount),
        currency: String(transaction.currency),
        channel: transaction.channel ?? null,
        paid_at: transaction.paid_at ?? transaction.paidAt ?? null,
        gateway_response: transaction.gateway_response ?? null,
      };
    } catch (error) {
      if (error instanceof PaystackUnavailable) throw error;
      lastError = (error as Error).message;
    }
  }

  throw new PaystackUnavailable(`verify: ${lastError}`);
}
