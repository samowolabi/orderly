import { Money } from "../schemas/money";
import * as schema from "../schemas/orders";
import { body, errorResponses, json, paymentErrorResponses, registry, security, z } from "../registry";

registry.registerPath({
  method: "post",
  path: "/delivery/quote",
  operationId: "quote_delivery",
  summary: "Price delivery to the customer's address",
  description:
    "Call when the customer wants delivery rather than pickup, once you have their address and phone number. Delivers from one store: the nearest with everything in stock, or, when no store has it all, the nearest with some of it, with the rest brought over from other stores first. Returns the driving distance, how long it takes with current traffic, the fee and the new total. Tell the customer and ask them to confirm before calling create_order with delivery_quote_id. If it says address_not_found, ask for a fuller address. If they'd rather not pay for delivery, offer pickup.",
  security: security.buyer,
  request: { body: body(schema.QuoteDeliveryBody) },
  responses: {
    201: json(schema.DeliveryQuote, "The delivery quote"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/delivery/settings",
  operationId: "delivery_settings",
  summary: "Read or change delivery pricing (owner only)",
  description:
    "Send no fields to read the current delivery pricing. Send any of base_fee, fee_per_km, round_to, max_km or prep_minutes to change them, in the main unit of the business currency. The fee for a trip is base_fee plus fee_per_km for each km, rounded up to round_to. Until the owner sets anything, the shop uses default pricing (set_by_owner is false). Read the change back to the owner, with the examples, before saving it. New quotes use the new pricing straight away; quotes already given keep theirs.",
  security: security.seller,
  request: { body: body(schema.DeliverySettingsBody) },
  responses: {
    200: json(schema.DeliverySettings, "The delivery pricing now in use"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/orders",
  operationId: "create_order",
  summary: "Hold one or more items and get one Paystack payment link",
  description:
    "Holds the units so nobody else can buy them, and returns one Paystack payment_url for the whole order. For pickup, send store_id; when items are at different stores, put each item's store_id on it, and it's still one order and one link. Never split an order into several. For delivery, send the delivery_quote_id the customer agreed to, which sets the stores and adds the fee to the total. After haggling, put the agreed unit price on that item as price; it can't go below the product's counter_offers.final. Put everything the customer wants in items (one entry for a single product), so they pay once and get one receipt; if any item can't be held, nothing is held. Tell the customer how long they have from minutes_left; the hold ends at expires_at. End your message by asking them to reply PAID once they've paid, so you can confirm it. The price always comes from the store's records. Confirm item, store and the customer's name before calling. If it says out_of_stock, hold that item at another store it names, on the same order. If it says reserved, the item is held for someone who hasn't paid yet: tell the customer when it may come back, as the message says.",
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
