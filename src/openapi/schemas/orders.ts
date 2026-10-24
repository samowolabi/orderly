import { z } from "../registry";
import { Money } from "./money";

// ISO 8601 timestamps, so agents can compare and convert them reliably.
const Timestamp = z.string().openapi({ format: "date-time" });

const DeliveryDetails = z
  .object({
    address: z.string(),
    phone: z.string(),
    fee: Money,
    distance_km: z.number(),
    minutes: z.number().int().openapi({ description: "Packing plus driving time, from when it's paid" }),
    area: z.string().nullable().openapi({ description: "Set when only the customer's area was found on the map: the rider calls to find them" }),
  })
  .nullable()
  .openapi({ description: "Set for delivery orders, null for pickup" });

export const OrderStatus = z.enum(["pending_payment", "paid", "failed", "expired", "paid_no_stock", "handed_over"]);

export const Order = z
  .object({
    order_id: z.string().openapi({ example: "ORD-1001" }),
    status: OrderStatus,
    store: z.object({ id: z.string(), name: z.string() }).openapi({ description: "Where a delivery leaves from, or the first pickup store" }),
    items: z.array(
      z.object({
        product: z.object({ id: z.string(), name: z.string(), variant: z.string().nullable() }),
        store: z.object({ id: z.string(), name: z.string() }).openapi({ description: "The store this item is held at" }),
        quantity: z.number().int(),
        unit_price: Money,
        amount: Money,
        saving: Money.openapi({ description: "What haggling took off this line; 0 at the list price" }),
      }),
    ),
    fulfilment: z.enum(["pickup", "delivery"]),
    delivery: DeliveryDetails,
    amount: Money.openapi({ description: "Total for the whole order, including any delivery fee, paid with one link" }),
    buyer_name: z.string(),
    payment_url: z.string().nullable().openapi({ description: "Paystack page to pay on. Only set while waiting for payment." }),
    expires_at: Timestamp.openapi({ description: "When the hold ends" }),
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
  items: z.array(
    z.object({
      item: z.string().openapi({ example: "iPhone 13 (128GB)" }),
      collect_at: z
        .object({ name: z.string(), address: z.string() })
        .nullable()
        .openapi({ description: "For pickup: the store to collect this item from. Null for delivery." }),
      quantity: z.number().int(),
      unit_price: Money,
      amount: Money,
      saving: Money,
    }),
  ),
  delivery: DeliveryDetails,
  total: Money,
  buyer_name: z.string(),
  paid_at: Timestamp,
  paid_at_display: z.string().openapi({ description: "In the business's local time" }),
  payment_reference: z.string(),
  payment_channel: z.string().nullable(),
  text: z.string().openapi({ description: "Ready-to-send receipt. Send it as is." }),
});

export const Receipt = ReceiptFields.openapi("Receipt");

const Items = z
  .array(
    z.object({
      product_id: z.string().trim().toUpperCase().min(1).openapi({ description: "From list_products", example: "IP14-128" }),
      quantity: z.number().int().min(1).max(10).default(1),
      price: z
        .number()
        .positive()
        .optional()
        .openapi({ description: "Only after haggling: the unit price the customer agreed, in the main unit. Never below counter_offers.final. Leave out to sell at the list price.", example: 635000 }),
      store_id: z
        .string()
        .trim()
        .toLowerCase()
        .min(1)
        .optional()
        .openapi({ description: "For pickup from more than one store: the store to collect this item from. Leave out to use the order's store_id. Ignored for delivery.", example: "lekki" }),
    }),
  )
  .min(1)
  .max(10);

export const CreateOrderBody = z
  .object({
    items: Items.openapi({
      description:
        "Everything the customer wants, held together and paid with one link, even when the items are at different stores. One entry for a single product.",
      example: [
        { product_id: "IP14-128", quantity: 1 },
        { product_id: "ANKER-20K", quantity: 1 },
      ],
    }),
    store_id: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .optional()
      .openapi({ description: "For pickup: the store the customer will collect from, for every item without its own store_id. Leave out for delivery.", example: "ikeja" }),
    delivery_quote_id: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .optional()
      .openapi({ description: "For delivery: the quote_id from quote_delivery, once the customer has agreed to the fee. It sets the store and adds the fee.", example: "DQ-3F9A2C1B" }),
    buyer_name: z.string().trim().min(1).max(100).openapi({ example: "Tunde Bakare" }),
    buyer_email: z.email().optional().openapi({ description: "For the Paystack receipt. Leave out if the customer didn't give one." }),
    replace_order_id: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .openapi({ description: "An unpaid order this one replaces, e.g. a delivery order when the customer switches to pickup. Its hold is released first.", example: "ORD-1004" }),
  })
  .refine(
    (input) => input.store_id !== undefined || input.delivery_quote_id !== undefined || input.items.every((item) => item.store_id !== undefined),
    { message: "send store_id (for the order or on each item) for pickup, or delivery_quote_id for delivery" },
  );

export const QuoteDeliveryBody = z.object({
  items: Items.openapi({ description: "Everything the customer wants delivered, as for create_order" }),
  address: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .openapi({ description: "Delivery address as the customer gave it, with house number, street, area and city", example: "12 Admiralty Way, Lekki Phase 1, Lagos" }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, "use a phone number, e.g. 08031234567 or +2348031234567")
    .openapi({ description: "Number the rider calls on arrival", example: "08031234567" }),
  store_id: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .optional()
    .openapi({ description: "Only if the customer insists on one store. Leave out to deliver from the nearest store that has everything." }),
  buyer_name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: "Send it: the items are then held and the Paystack link made in this same call, so the reply to the customer carries the real link. Leave out only to price delivery without holding anything.", example: "Tunde Bakare" }),
  buyer_email: z.email().optional().openapi({ description: "For the Paystack receipt. Leave out if the customer didn't give one." }),
  replace_order_id: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .openapi({ description: "An unpaid order this replaces, e.g. a new address or items for the same customer. Its hold is released first.", example: "ORD-1004" }),
});

export const DeliveryQuote = z
  .object({
    quote_id: z.string().openapi({ example: "DQ-3F9A2C1B" }),
    store: z.object({ id: z.string(), name: z.string() }).openapi({
      description: "The store the delivery leaves from: the nearest with everything in stock, or the nearest with some of it when no store has it all",
    }),
    brought_from: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .openapi({ description: "Stores that send items over to the delivering store first; the time already allows for it. Empty when one store has everything." }),
    address: z.string(),
    phone: z.string(),
    matched_area: z
      .string()
      .nullable()
      .openapi({ description: "Set when the map found only the customer's area, not their street: the fee is for the area, and the rider calls to find them. Null when the address matched exactly." }),
    distance_km: z.number(),
    minutes: z.number().int().openapi({ description: "Packing plus driving time with current traffic, from when it's paid" }),
    arrives_around: z.string().openapi({ description: "Clock time it would arrive if paid now, in the business's time zone" }),
    fee: Money,
    items_subtotal: Money,
    total: Money.openapi({ description: "Items plus delivery" }),
    expires_at: Timestamp.openapi({ description: "Use the quote in create_order before this" }),
    order: Order.nullable().openapi({ description: "The held order with its payment_url, when buyer_name was sent; null for a price-only quote" }),
    next_step: z.string(),
  })
  .openapi("DeliveryQuote");

export const DeliverySettingsBody = z.object({
  base_fee: z.number().min(0).optional().openapi({ description: "Flat part of every delivery fee, in the main unit of the business currency", example: 1500 }),
  fee_per_km: z.number().min(0).optional().openapi({ description: "Added for each km of driving distance", example: 150 }),
});

export const DeliverySettings = z
  .object({
    base_fee: Money,
    fee_per_km: Money,
    set_by_owner: z.boolean().openapi({ description: "false while the shop still uses the default pricing" }),
    examples: z.array(z.object({ km: z.number(), fee: Money })).openapi({ description: "What a few typical trips cost with this pricing" }),
  })
  .openapi("DeliverySettings");

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

export const ContactOwnerBody = z.object({
  name: z.string().trim().min(1).max(100).openapi({ example: "Tunde Bakare" }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, "use a phone number, e.g. 08031234567 or +2348031234567")
    .openapi({ description: "The number the owner should call or WhatsApp back, as the customer gave it", example: "08031234567" }),
  reason: z.string().trim().min(1).max(500).openapi({ description: "What they want to talk about, in a sentence", example: "Wants a bulk price for 5 iPhone 13s" }),
  order_id: OrderParams.shape.id.optional().openapi({ description: "Their order number, if the chat has one" }),
});

export const ContactOwnerResult = z
  .object({
    status: z.enum(["sent", "already_requested", "not_sent"]).openapi({
      description: "sent: the owner was emailed. already_requested: this number asked in the last 30 minutes. not_sent: the email couldn't go out.",
    }),
    next_step: z.string(),
  })
  .openapi("ContactOwnerResult");
