import { Money } from "../schemas/money";
import * as schema from "../schemas/orders";
import { body, errorResponses, json, paymentErrorResponses, registry, security, z } from "../registry";

registry.registerPath({
  method: "post",
  path: "/orders",
  operationId: "create_order",
  summary: "Hold one or more items and get one Paystack payment link",
  description:
    "Holds the units at the chosen store so nobody else can buy them, and returns one Paystack payment_url for the whole order. Put everything the customer wants from one store in items (one entry for a single product), so they pay once and get one receipt; if any item can't be held, nothing is held. Tell the customer how long they have from minutes_left; the hold ends at expires_at. Then schedule a reminder at each time in payment_checks, so the customer gets their receipt without having to say they've paid. The price always comes from the store's records. Confirm item, store and the customer's name before calling. If it says out_of_stock, offer the other stores it names. If it says reserved, the item is held for someone who hasn't paid yet: tell the customer when it may come back, as the message says.",
  security: security.buyer,
  request: { body: body(schema.CreateOrderBody) },
  responses: {
    201: json(schema.Order, "The held order with its payment link"),
    ...errorResponses,
    ...paymentErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/orders/{id}/verify",
  operationId: "verify_payment",
  summary: "Check with Paystack whether an order is paid",
  description:
    "The only way to know if a customer has paid. Call it whenever they say they've paid; never trust a screenshot or their word. Returns an outcome and next_step: follow next_step. receipt is set when the payment is confirmed and null otherwise.",
  security: security.buyer,
  request: { params: schema.OrderParams },
  responses: {
    200: json(
      z.object({
        outcome: schema.Outcome,
        next_step: z.string(),
        order: schema.Order,
        receipt: schema.ReceiptFields.nullable().openapi({ description: "The receipt when the payment is confirmed, otherwise null" }),
      }),
      "What Paystack says, and what to do next",
    ),
    ...errorResponses,
    ...paymentErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/orders/{id}/receipt",
  operationId: "get_receipt",
  summary: "Get the receipt for a paid order",
  description: "Only works once verify_payment has confirmed the order. Send the text field as is.",
  security: security.buyerOrSeller,
  request: { params: schema.OrderParams },
  responses: { 200: json(schema.Receipt, "The receipt"), ...errorResponses },
});

registry.registerPath({
  method: "get",
  path: "/orders",
  operationId: "list_orders",
  summary: "List orders (owner only)",
  description:
    "Orders with a summary by status, for questions like 'what sold today?'. needs_attention lists orders the owner must act on, such as refunds for paid_no_stock.",
  security: security.seller,
  request: { query: schema.ListOrdersQuery },
  responses: {
    200: json(
      z.object({
        period: z.string(),
        summary: z.object({
          counts: z.record(z.string(), z.number().int()),
          paid_totals: z.array(Money).openapi({ description: "Paid sales, one entry per currency" }),
        }),
        needs_attention: z.array(
          z.object({ order_id: z.string(), status: schema.OrderStatus, reason: z.string() }),
        ),
        orders: z.array(schema.Order),
      }),
      "Orders, newest first",
    ),
    ...errorResponses,
  },
});
