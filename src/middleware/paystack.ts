import express, { type RequestHandler } from "express";
import { paymentProcessor } from "../adapters";
import { ApiError } from "../utils/http";

export const paystackBody = express.raw({ type: "application/json", limit: "100kb" });

// Rejects webhook requests whose raw body does not match Paystack's signature.
export const requirePaystackSignature: RequestHandler = (request, _response, next) => {
  const body = request.body;
  const signature = request.get("x-paystack-signature");

  if (!Buffer.isBuffer(body) || !paymentProcessor.isWebhookAuthentic(body, signature)) {
    return next(new ApiError(401, "invalid_webhook_signature", "The Paystack signature was invalid."));
  }

  next();
};
