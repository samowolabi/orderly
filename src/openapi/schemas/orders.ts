import { z } from "../registry";
import { Money } from "./money";

// ISO 8601 timestamps, so agents can compare and convert them reliably.
const Timestamp = z.string().openapi({ format: "date-time" });

export const OrderStatus = z.enum(["pending_payment", "paid", "failed", "expired", "paid_no_stock", "handed_over"]);

export const Order = z
  .object({
    order_id: z.string().openapi({ example: "ORD-1001" }),
    status: OrderStatus,
    product: z.object({ id: z.string(), name: z.string(), variant: z.string().nullable() }),
    store: z.object({ id: z.string(), name: z.string() }),
    quantity: z.number().int(),
    unit_price: Money,
    amount: Money,
    buyer_name: z.string(),
    payment_url: z.string().nullable().openapi({ description: "Paystack page to pay on. Only set while waiting for payment." }),
    expires_at: Timestamp.openapi({ description: "When the hold ends" }),
    payment_checks: z
      .array(
        z.object({
          at: Timestamp,
          nudge: z.boolean().openapi({ description: "True for the one check that reminds the customer if they still haven't paid" }),
        }),
      )
      .openapi({
        description:
          "When to check for payment while it waits. Schedule one reminder at each time with scheduled_at. Empty unless waiting for payment.",
      }),
    minutes_left: z.number().int().openapi({ description: "Minutes left to pay. 0 unless waiting for payment." }),
    declined_attempts: z.number().int(),
    paid_at: Timestamp.nullable(),
    created_at: Timestamp,
  })
  .openapi("Order");

// Unnamed so it can be marked nullable: the generator drops `nullable` from named references.
export const ReceiptFields = z.object({
  receipt_number: z.string(),
  business: z.string(),
  store: z.object({ name: z.string(), address: z.string() }),
  item: z.string().openapi({ example: "iPhone 13 (128GB)" }),
  quantity: z.number().int(),
  unit_price: Money,
  total: Money,
  buyer_name: z.string(),
  paid_at: Timestamp,
  paid_at_display: z.string().openapi({ description: "In the business's local time" }),
  payment_reference: z.string(),
  payment_channel: z.string().nullable(),
  text: z.string().openapi({ description: "Ready-to-send receipt. Send it as is." }),
});

export const Receipt = ReceiptFields.openapi("Receipt");

export const CreateOrderBody = z.object({
  product_id: z.string().trim().toUpperCase().min(1).openapi({ description: "From list_products", example: "IP13-128" }),
  store_id: z.string().trim().toLowerCase().min(1).openapi({ description: "Store the customer will collect from", example: "ikeja" }),
  quantity: z.number().int().min(1).max(10).default(1),
  buyer_name: z.string().trim().min(1).max(100).openapi({ example: "Tunde Bakare" }),
  buyer_email: z.email().optional().openapi({ description: "For the Paystack receipt. Leave out if the customer didn't give one." }),
});

export const OrderParams = z.object({
  // Customers type order numbers loosely in chat ("#ord 1008", "Ord_1008-2678D7"), so this
  // drops a leading "#", turns spaces and underscores into dashes and uppercases the rest.
  id: z
    .string()
    .trim()
    .transform((id) => id.replace(/^#+/, "").trim().replace(/[\s_]+/g, "-").toUpperCase())
    .openapi({
      description:
        "The order number (ORD-1001) or any payment reference for it (ORD-1001-3f9a2c), exactly as the customer or an earlier reply gave it. Never guess one.",
      example: "ORD-1001",
    }),
});

export const ListOrdersQuery = z.object({
  status: OrderStatus.optional(),
  store_id: z.string().optional(),
  period: z.enum(["today", "7d", "30d", "all"]).default("today").openapi({ description: "today starts at midnight in the business's local time" }),
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
