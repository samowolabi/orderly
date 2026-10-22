import { z } from "../registry";

export const OrderStatus = z.enum(["pending_payment", "paid", "failed", "expired", "paid_no_stock", "handed_over"]);

export const Order = z
  .object({
    order_id: z.string().openapi({ example: "ORD-1001" }),
    status: OrderStatus,
    product: z.object({ id: z.string(), name: z.string(), variant: z.string().nullable() }),
    store: z.object({ id: z.string(), name: z.string() }),
    quantity: z.number().int(),
    unit_price_naira: z.number(),
    amount_naira: z.number(),
    amount_display: z.string().openapi({ example: "₦650,000" }),
    buyer_name: z.string(),
    payment_url: z.string().nullable().openapi({ description: "Paystack page to pay on. Only set while waiting for payment." }),
    expires_at: z.string().openapi({ description: "When the hold ends (ISO time)" }),
    minutes_left: z.number().int().openapi({ description: "Minutes left to pay. 0 unless waiting for payment." }),
    declined_attempts: z.number().int(),
    paid_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("Order");

export const Receipt = z
  .object({
    receipt_number: z.string(),
    business: z.string(),
    store: z.object({ name: z.string(), address: z.string() }),
    item: z.string().openapi({ example: "iPhone 13 (128GB)" }),
    quantity: z.number().int(),
    unit_price_naira: z.number(),
    total_naira: z.number(),
    total_display: z.string(),
    buyer_name: z.string(),
    paid_at: z.string(),
    paid_at_display: z.string().openapi({ description: "Lagos time" }),
    payment_reference: z.string(),
    payment_channel: z.string().nullable(),
    text: z.string().openapi({ description: "Ready-to-send receipt. Send it as is." }),
  })
  .openapi("Receipt");

export const CreateOrderBody = z.object({
  product_id: z.string().trim().toUpperCase().min(1).openapi({ description: "From list_products", example: "IP13-128" }),
  store_id: z.string().trim().toLowerCase().min(1).openapi({ description: "Store the customer will collect from", example: "ikeja" }),
  quantity: z.number().int().min(1).max(10).default(1),
  buyer_name: z.string().trim().min(1).max(100).openapi({ example: "Tunde Bakare" }),
  buyer_email: z.email().optional().openapi({ description: "For the Paystack receipt. Leave out if the customer didn't give one." }),
});

export const OrderParams = z.object({ id: z.string().trim().toUpperCase().openapi({ example: "ORD-1001" }) });

export const ListOrdersQuery = z.object({
  status: OrderStatus.optional(),
  store_id: z.string().optional(),
  period: z.enum(["today", "7d", "30d", "all"]).default("today").openapi({ description: "today is Lagos time" }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const Outcome = z.enum([
  "paid",
  "already_paid",
  "paid_late_reheld",
  "paid_no_stock",
  "not_paid_yet",
  "payment_processing",
  "declined",
  "declined_final",
  "expired",
  "failed",
  "handed_over",
]);
