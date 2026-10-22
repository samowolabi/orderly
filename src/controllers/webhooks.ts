import type { Request, Response } from "express";
import { processPaystackWebhook } from "../services/orders";
import { parsePaystackWebhook } from "../services/paystack";
import { ok } from "../utils/http";

// Parses and processes an authenticated Paystack webhook.
export async function paystackWebhook(request: Request, response: Response) {
  const webhook = parsePaystackWebhook(request.body as Buffer);
  ok(response, await processPaystackWebhook(webhook));
}
