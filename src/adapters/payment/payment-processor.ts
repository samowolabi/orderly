export class PaymentProcessorUnavailable extends Error {}

export class InvalidPaymentPayload extends Error {
  // Creates a provider-independent validation error for malformed payment data.
  constructor(
    readonly code: "bad_json" | "invalid_webhook",
    message: string,
  ) {
    super(message);
  }
}

export type PaymentTransaction = {
  reference: string;

  amount: number;
  currency: string;

  status: string;
  channel: string | null;
  gateway_response: string | null;

  paid_at: string | null;
};

export type PaymentWebhookEvent =
  | { type: "payment.succeeded"; transaction: PaymentTransaction }
  | { type: "ignored"; sourceEvent: string };

export type CreateCheckoutInput = {
  reference: string;
  amountSubunits: number;
  currency: string;
  email: string;
  metadata: Record<string, unknown>;
};

export interface PaymentProcessor {
  readonly name: string;

  // Creates a hosted checkout URL for one payment attempt.
  createCheckout(input: CreateCheckoutInput): Promise<{ checkoutUrl: string }>;

  // Returns the provider's current transaction state for a reference.
  verifyTransaction(reference: string): Promise<PaymentTransaction | null>;

  // Verifies that a webhook signature belongs to the payment provider.
  isWebhookAuthentic(body: Buffer, signature: string | undefined): boolean;

  // Converts a provider webhook body into a normalized payment event.
  parseWebhook(body: Buffer): PaymentWebhookEvent;
}
