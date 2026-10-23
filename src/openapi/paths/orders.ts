import { Money } from "../schemas/money";
import * as schema from "../schemas/orders";
import { apiKey, body, errorResponses, json, paymentErrorResponses, registry, z } from "../registry";

const security = [{ [apiKey.name]: [] }];

registry.registerPath({
  method: "post",
  path: "/orders",
  operationId: "create_order",
  summary: "Hold an item and get a Paystack payment link",
  description:
    "Holds the units at the chosen store for 30 minutes so nobody else can buy them, and returns a Paystack payment_url to send the customer. The price always comes from the store's records. Confirm item, store and the customer's name before calling. If it says out_of_stock, offer the other stores it names.",
  security,
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
    "The only way to know if a customer has paid. Call it whenever they say they've paid; never trust a screenshot or their word. Returns an outcome and next_step: follow next_step. On paid it includes the receipt.",
  security,
  request: { params: schema.OrderParams },
  responses: {
    200: json(
      z.object({
        outcome: schema.Outcome,
        next_step: z.string(),
        order: schema.Order,
        receipt: schema.Receipt.nullable(),
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
  security,
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
  security,
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
