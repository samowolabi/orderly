import express, { type RequestHandler } from "express";
import { paymentProcessor } from "../adapters";
import { ApiError } from "../utils/http";

// Keeps the exact request bytes, since providers sign the raw body, not parsed JSON.
export const rawWebhookBody = express.raw({ type: "application/json", limit: "100kb" });

// Rejects webhook requests whose raw body does not match the payment provider's signature.
export const requireWebhookSignature: RequestHandler = (request, _response, next) => {
  const body = request.body;
  const signature = request.get(paymentProcessor.webhookSignatureHeader);

  if (!Buffer.isBuffer(body) || !paymentProcessor.isWebhookAuthentic(body, signature)) {
    return next(new ApiError(401, "invalid_webhook_signature", `The ${paymentProcessor.name} webhook signature was invalid.`));
  }

  next();
};
