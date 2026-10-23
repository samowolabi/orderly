import type { Request, Response } from "express";
import { paymentProcessor } from "../adapters";
import { InvalidPaymentPayload } from "../adapters/payment/payment-processor";
import { processPaymentWebhook } from "../services/orders";
import { ApiError, ok } from "../utils/http";

// Parses and processes an authenticated payment-provider webhook.
export async function receivePaymentWebhook(request: Request, response: Response) {
  let webhook;
  try {
    webhook = paymentProcessor.parseWebhook(request.body as Buffer);
  } catch (error) {
    if (error instanceof InvalidPaymentPayload) throw new ApiError(400, error.code, error.message);
    throw error;
  }
  ok(response, await processPaymentWebhook(webhook));
}
