import { config } from "./config";

// Thin client for the two Paystack calls Orderly needs. The secret key never
// leaves this process; agents only ever see the authorization_url.

export class PaystackUnavailable extends Error {}

export type PaystackTransaction = {
  status: string; // success, failed, abandoned, ongoing, pending, reversed, ...
  reference: string;
  amount: number; // kobo
  currency: string;
  channel: string | null;
  paid_at: string | null;
  gateway_response: string | null;
};

const TIMEOUT_MS = 10_000;

async function request(method: "GET" | "POST", path: string, body?: unknown) {
  const { PAYSTACK_BASE_URL, PAYSTACK_SECRET_KEY } = config();
  const res = await fetch(new URL(path, PAYSTACK_BASE_URL), {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: any } | null;
  return { httpStatus: res.status, json };
}

export async function initializeTransaction(input: {
  reference: string;
  amountKobo: number;
  email: string;
  metadata: Record<string, unknown>;
}): Promise<{ authorization_url: string }> {
  // No retry: if the first call timed out after Paystack created the
  // transaction, a retry with the same reference would be rejected anyway.
  let result;
  try {
    result = await request("POST", "/transaction/initialize", {
      reference: input.reference,
      amount: input.amountKobo,
      currency: "NGN",
      email: input.email,
      metadata: input.metadata,
    });
  } catch (err) {
    throw new PaystackUnavailable(`initialize: ${(err as Error).message}`);
  }
  const url = result.json?.data?.authorization_url;
  if (result.httpStatus !== 200 || !result.json?.status || typeof url !== "string") {
    throw new PaystackUnavailable(`initialize: HTTP ${result.httpStatus} ${result.json?.message ?? ""}`.trim());
  }
  return { authorization_url: url };
}

// Returns null when Paystack has no transaction with this reference.
export async function verifyTransaction(reference: string): Promise<PaystackTransaction | null> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { httpStatus, json } = await request("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      if (httpStatus >= 500) {
        lastError = `HTTP ${httpStatus}`;
        continue;
      }
      if (httpStatus === 401) throw new PaystackUnavailable("verify: Paystack rejected the secret key");
      if (httpStatus === 400 || httpStatus === 404) return null;
      const d = json?.data;
      if (!json?.status || !d) throw new PaystackUnavailable(`verify: unexpected response ${httpStatus}`);
      return {
        status: String(d.status),
        reference: String(d.reference),
        amount: Number(d.amount),
        currency: String(d.currency),
        channel: d.channel ?? null,
        paid_at: d.paid_at ?? d.paidAt ?? null,
        gateway_response: d.gateway_response ?? null,
      };
    } catch (err) {
      if (err instanceof PaystackUnavailable) throw err;
      lastError = (err as Error).message;
    }
  }
  throw new PaystackUnavailable(`verify: ${lastError}`);
}
