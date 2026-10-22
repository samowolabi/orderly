import { config } from "../config";

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

const TIMEOUT_MS = 10_000;

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
  const responseBody = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: any;
  } | null;
  return { httpStatus: response.status, body: responseBody };
}

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
