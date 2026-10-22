import { Router } from "express";
import * as controller from "../controllers/webhooks";
import { paystackBody, requirePaystackSignature } from "../middleware/paystack";

export const webhooks = Router();

webhooks.post("/webhooks/paystack", paystackBody, requirePaystackSignature, controller.paystackWebhook);
