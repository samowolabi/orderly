import { Router } from "express";
import * as controller from "../controllers/orders";
import { requireRole } from "../middleware/auth";

export const orders = Router();

orders.post("/delivery/quote", requireRole("buyer"), controller.quoteDelivery);
orders.post("/orders", requireRole("buyer"), controller.createOrder);
orders.post("/orders/:id/verify", requireRole("buyer"), controller.verifyPayment);
orders.get("/orders/:id/receipt", requireRole("buyer", "seller"), controller.getReceipt);
orders.get("/orders", requireRole("seller"), controller.listOrders);
