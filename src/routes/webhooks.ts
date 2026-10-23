import { Router } from "express";
import * as controller from "../controllers/webhooks";
import { rawWebhookBody, requireWebhookSignature } from "../middleware/webhooks";

export const webhooks = Router();

webhooks.post("/webhooks/paystack", rawWebhookBody, requireWebhookSignature, controller.receivePaymentWebhook);
