import { randomBytes } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { pool, withTransaction } from "../db/pool";
import { requireRole } from "../http/auth";
import { ApiError, formatNaira, lagosTime, ok, toNaira } from "../http/respond";
import { parse } from "../http/validate";
import { apiKey, body, errorResponses, json, paymentErrorResponses, registry, z } from "../openapi/registry";
import { expireStaleOrders, failOrder, holdStock, logEvent, type Db } from "../orders/stock";
import { initializeTransaction, PaystackUnavailable, verifyTransaction, type PaystackTransaction } from "../paystack";

export const orders = Router();
const security = [{ [apiKey.name]: [] }];

// After this many declined cards the order is cancelled and the item released.
const MAX_DECLINES = 3;
const IN_PROGRESS = new Set(["ongoing", "pending", "processing", "queued"]);

// ---------- Schemas ----------

const OrderStatus = z.enum(["pending_payment", "paid", "failed", "expired", "paid_no_stock", "handed_over"]);

const Order = z
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

const Receipt = z
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

const CreateOrderBody = z.object({
  product_id: z.string().trim().toUpperCase().min(1).openapi({ description: "From list_products", example: "IP13-128" }),
  store_id: z.string().trim().toLowerCase().min(1).openapi({ description: "Store the customer will collect from", example: "ikeja" }),
  quantity: z.number().int().min(1).max(10).default(1),
  buyer_name: z.string().trim().min(1).max(100).openapi({ example: "Tunde Bakare" }),
  buyer_email: z.email().optional().openapi({ description: "For the Paystack receipt. Leave out if the customer didn't give one." }),
});

const OrderParams = z.object({ id: z.string().trim().toUpperCase().openapi({ example: "ORD-1001" }) });

const ListOrdersQuery = z.object({
  status: OrderStatus.optional(),
  store_id: z.string().optional(),
  period: z.enum(["today", "7d", "30d", "all"]).default("today").openapi({ description: "today is Lagos time" }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const Outcome = z.enum([
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

// ---------- Rows and views ----------

type OrderRow = {
  id: string;
  product_id: string;
  store_id: string;
  quantity: number;
  unit_price_kobo: number;
  amount_kobo: number;
  currency: string;
  buyer_name: string;
  buyer_email: string | null;
  status: z.infer<typeof OrderStatus>;
  payment_url: string | null;
  payment_references: string[];
  declined_attempts: number;
  payment_channel: string | null;
  failure_reason: string | null;
  expires_at: Date;
  paid_at: Date | null;
  created_at: Date;
  product_name: string;
  product_variant: string | null;
  store_name: string;
  store_address: string;
};

const ORDER_SELECT = `
  SELECT o.*, p.name AS product_name, p.variant AS product_variant,
         s.name AS store_name, s.address AS store_address
  FROM orders o
  JOIN products p ON p.id = o.product_id
  JOIN stores s ON s.id = o.store_id`;

async function loadOrder(db: Db, id: string): Promise<OrderRow> {
  const { rows } = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "order_not_found", `No order ${id}. Check the order number with the customer.`);
  return rows[0];
}

const itemName = (o: OrderRow) => (o.product_variant ? `${o.product_name} (${o.product_variant})` : o.product_name);

function orderView(o: OrderRow) {
  const pending = o.status === "pending_payment";
  return {
    order_id: o.id,
    status: o.status,
    product: { id: o.product_id, name: o.product_name, variant: o.product_variant },
    store: { id: o.store_id, name: o.store_name },
    quantity: o.quantity,
    unit_price_naira: toNaira(o.unit_price_kobo),
    amount_naira: toNaira(o.amount_kobo),
    amount_display: formatNaira(o.amount_kobo),
    buyer_name: o.buyer_name,
    payment_url: pending ? o.payment_url : null,
    expires_at: o.expires_at.toISOString(),
    minutes_left: pending ? Math.max(0, Math.ceil((o.expires_at.getTime() - Date.now()) / 60_000)) : 0,
    declined_attempts: o.declined_attempts,
    paid_at: o.paid_at?.toISOString() ?? null,
    created_at: o.created_at.toISOString(),
  };
}

function receiptView(o: OrderRow) {
  const paidAt = o.paid_at ?? new Date();
  const business = config().BUSINESS_NAME;
  const reference = o.payment_references.at(-1) ?? o.id;
  const lines = [
    `${business} receipt ${o.id}`,
    `${o.store_name}, ${o.store_address}`,
    ``,
    `${itemName(o)} x${o.quantity}: ${formatNaira(o.amount_kobo)}`,
    `Total paid: ${formatNaira(o.amount_kobo)}`,
    ``,
    `Paid ${lagosTime(paidAt)}${o.payment_channel ? ` by ${o.payment_channel}` : ""}`,
    `Paystack reference: ${reference}`,
    `Thank you for shopping with ${business}.`,
  ];
  return {
    receipt_number: o.id,
    business,
    store: { name: o.store_name, address: o.store_address },
    item: itemName(o),
    quantity: o.quantity,
    unit_price_naira: toNaira(o.unit_price_kobo),
    total_naira: toNaira(o.amount_kobo),
    total_display: formatNaira(o.amount_kobo),
    buyer_name: o.buyer_name,
    paid_at: paidAt.toISOString(),
    paid_at_display: lagosTime(paidAt),
    payment_reference: reference,
    payment_channel: o.payment_channel,
    text: lines.join("\n"),
  };
}

// Paystack needs an email; WhatsApp buyers rarely give one (see PRD risks).
const placeholderEmail = (orderId: string) => `buyer+${orderId.toLowerCase()}@example.com`;

// Paystack references are unique across the whole account, forever, so a
// reseeded database or a second environment on the same test key would
// collide on plain order ids. Each link gets the order id plus a random suffix.
const newReference = (orderId: string) => `${orderId}-${randomBytes(3).toString("hex")}`;

async function attachPaymentLink(o: Pick<OrderRow, "id" | "amount_kobo" | "buyer_email" | "product_id" | "store_id">) {
  const reference = newReference(o.id);
  const { authorization_url } = await initializeTransaction({
    reference,
    amountKobo: o.amount_kobo,
    email: o.buyer_email ?? placeholderEmail(o.id),
    metadata: { order_id: o.id, product_id: o.product_id, store_id: o.store_id },
  });
  await pool.query(
    `UPDATE orders SET payment_url = $2, payment_references = array_append(payment_references, $3), updated_at = now()
     WHERE id = $1`,
    [o.id, authorization_url, reference],
  );
  await logEvent(pool, o.id, "payment_link_created", { reference });
}

// ---------- create_order ----------

registry.registerPath({
  method: "post",
  path: "/orders",
  operationId: "create_order",
  summary: "Hold an item and get a Paystack payment link",
  description:
    "Holds the units at the chosen store for 30 minutes so nobody else can buy them, and returns a Paystack payment_url to send the customer. The price always comes from the store's records. Confirm item, store and the customer's name before calling. If it says out_of_stock, offer the other stores it names.",
  security,
  request: { body: body(CreateOrderBody) },
  responses: { 201: json(Order, "The held order with its payment link"), ...errorResponses, ...paymentErrorResponses },
});

orders.post("/orders", requireRole("buyer"), async (req, res) => {
  const b = parse(CreateOrderBody, req.body);
  await expireStaleOrders(pool);

  const order = await withTransaction(async (db) => {
    const product = (await db.query("SELECT id FROM products WHERE id = $1 AND active", [b.product_id])).rows[0];
    if (!product) {
      throw new ApiError(404, "product_not_found", `No product ${b.product_id}. Call list_products to find the right id.`);
    }
    const store = (await db.query("SELECT id FROM stores WHERE id = $1 AND active", [b.store_id])).rows[0];
    if (!store) throw new ApiError(404, "store_not_found", `No store ${b.store_id}. Call list_stores for the right id.`);

    if (!(await holdStock(db, b.product_id, b.store_id, b.quantity))) {
      const { rows: elsewhere } = await db.query<{ name: string; available: number }>(
        `SELECT s.name, st.available FROM stock st JOIN stores s ON s.id = st.store_id
         WHERE st.product_id = $1 AND st.store_id <> $2 AND s.active AND st.available >= $3
         ORDER BY st.available DESC`,
        [b.product_id, b.store_id, b.quantity],
      );
      const hint = elsewhere.length
        ? `It is available at ${elsewhere.map((s) => `${s.name} (${s.available})`).join(", ")}. Offer that store instead.`
        : "It is sold out at every store. Say so honestly and offer something similar from list_products.";
      throw new ApiError(409, "out_of_stock", `Not enough ${b.product_id} at ${b.store_id} for ${b.quantity}. ${hint}`);
    }

    const { rows } = await db.query<{ id: string; amount_kobo: number }>(
      `INSERT INTO orders (product_id, store_id, quantity, unit_price_kobo, amount_kobo, buyer_name, buyer_email, expires_at)
       SELECT p.id, $2, $3::int, p.price_kobo, p.price_kobo * $3::int, $4, $5, now() + make_interval(mins => $6::int)
       FROM products p WHERE p.id = $1
       RETURNING id, amount_kobo`,
      [b.product_id, b.store_id, b.quantity, b.buyer_name, b.buyer_email ?? null, config().HOLD_MINUTES],
    );
    const created = rows[0]!;
    await logEvent(db, created.id, "order_created", { held: b.quantity, amount_kobo: created.amount_kobo });
    return created;
  });

  try {
    await attachPaymentLink(
      { id: order.id, amount_kobo: order.amount_kobo, buyer_email: b.buyer_email ?? null, product_id: b.product_id, store_id: b.store_id },
    );
  } catch (err) {
    if (!(err instanceof PaystackUnavailable)) throw err;
    console.error(`[paystack] ${order.id}: ${err.message}`);
    await withTransaction((db) => failOrder(db, order.id, "payment_link_failed", { error: err.message }));
    throw new ApiError(
      502,
      "payment_link_failed",
      "Paystack could not make a payment link, so the item was released and nothing was charged. Apologise and offer to try again. If it fails a second time, hand over to a person.",
    );
  }

  ok(res, orderView(await loadOrder(pool, order.id)), 201);
});

// ---------- verify_payment ----------

type VerifyResult =
  | { outcome: z.infer<typeof Outcome> }
  | { outcome: "declined"; newLink: true }
  | { outcome: "amount_mismatch"; paidKobo: number; currency: string };

function nextStep(outcome: z.infer<typeof Outcome>, o: OrderRow): string {
  switch (outcome) {
    case "paid":
      return "Paystack confirmed the payment. Send the customer the receipt text.";
    case "already_paid":
      return "This order was already confirmed. Send the receipt text again if they need it.";
    case "paid_late_reheld":
      return "The payment came in after the hold ran out, but the item was still in stock, so the order is confirmed. Send the receipt text.";
    case "paid_no_stock":
      return "The customer paid after the hold ran out and the item has since sold out. Tell them honestly, say the owner will refund them in full, and hand over to a person.";
    case "not_paid_yet":
      return `Paystack has no payment for this order yet. If the customer says they paid, tell them politely it hasn't come through and resend the payment link. ${orderView(o).minutes_left} minute(s) left on the hold.`;
    case "payment_processing":
      return "The payment is still processing at Paystack. Ask the customer to wait a minute, then check again.";
    case "declined":
      return o.declined_attempts >= 2
        ? "The card was declined again and nothing was charged. Send the new payment link, and hand over to a person since payment has failed twice."
        : "The card was declined and nothing was charged. Send the new payment link and suggest another card or bank transfer on the Paystack page.";
    case "declined_final":
      return "Payment was declined too many times, so the order was cancelled and the item released. Hand over to a person.";
    case "expired":
      return "The 30-minute hold ran out without payment and the item went back on sale. Ask if they still want it; if so, create a new order.";
    case "failed":
      return "This order was cancelled and nothing was charged. If the customer still wants the item, create a new order.";
    case "handed_over":
      return "A person is handling this order. Tell the customer the team will follow up.";
  }
}

registry.registerPath({
  method: "post",
  path: "/orders/{id}/verify",
  operationId: "verify_payment",
  summary: "Check with Paystack whether an order is paid",
  description:
    "The only way to know if a customer has paid. Call it whenever they say they've paid; never trust a screenshot or their word. Returns an outcome and next_step: follow next_step. On paid it includes the receipt.",
  security,
  request: { params: OrderParams },
  responses: {
    200: json(
      z.object({ outcome: Outcome, next_step: z.string(), order: Order, receipt: Receipt.nullable() }),
      "What Paystack says, and what to do next",
    ),
    ...errorResponses,
    ...paymentErrorResponses,
  },
});

orders.post("/orders/:id/verify", requireRole("buyer"), async (req, res) => {
  const { id } = parse(OrderParams, req.params);
  await expireStaleOrders(pool);
  const before = await loadOrder(pool, id);

  const result = await verifyOrder(before);

  if (result.outcome === "amount_mismatch") {
    throw new ApiError(
      409,
      "amount_mismatch",
      `Paystack shows a payment of ${result.currency} ${toNaira(result.paidKobo)}, which does not match this order. The order is NOT confirmed. Do not send a receipt. Tell the customer a person will sort it out, and hand over.`,
    );
  }

  if ("newLink" in result) {
    try {
      await attachPaymentLink(before);
    } catch (err) {
      if (!(err instanceof PaystackUnavailable)) throw err;
      console.error(`[paystack] ${id}: ${err.message}`);
      throw new ApiError(
        502,
        "payment_link_failed",
        "The card was declined and Paystack could not make a new link. Nothing was charged. Hand over to a person.",
      );
    }
  }

  const after = await loadOrder(pool, id);
  const paid = after.status === "paid";
  ok(res, {
    outcome: result.outcome,
    next_step: nextStep(result.outcome, after),
    order: orderView(after),
    receipt: paid ? receiptView(after) : null,
  });
});

async function verifyOrder(order: OrderRow): Promise<VerifyResult> {
  if (order.status === "paid") return { outcome: "already_paid" };
  if (order.status === "paid_no_stock" || order.status === "handed_over") return { outcome: order.status };
  // A failed order with no link, or a wrong amount, has nothing more to find at Paystack.
  if (order.status === "failed" && (!order.payment_references.length || order.failure_reason === "amount_mismatch")) {
    return { outcome: "failed" };
  }

  // Check every link this order has had, newest first: a customer may finish
  // paying on an older page after a decline.
  let paid: PaystackTransaction | null = null;
  let latest: PaystackTransaction | null = null;
  try {
    const refs = [...order.payment_references].reverse();
    for (const [i, ref] of refs.entries()) {
      const tx = await verifyTransaction(ref);
      if (i === 0) latest = tx;
      if (tx?.status === "success") {
        paid = tx;
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof PaystackUnavailable)) throw err;
    console.error(`[paystack] verify ${order.id}: ${err.message}`);
    await logEvent(pool, order.id, "verify_unavailable", { error: err.message });
    throw new ApiError(
      503,
      "paystack_unreachable",
      "Paystack is not answering, so the payment can't be confirmed right now. Do NOT tell the customer it is paid. Say you can't confirm it at the moment and hand over to a person.",
    );
  }

  return withTransaction(async (db): Promise<VerifyResult> => {
    // Re-read under a lock: another verify or the expiry sweep may have moved it.
    const { rows } = await db.query<OrderRow>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [order.id]);
    const current = rows[0]!;
    if (current.status === "paid") return { outcome: "already_paid" };

    if (paid) {
      if (paid.amount !== current.amount_kobo || paid.currency !== current.currency) {
        if (current.status === "pending_payment") {
          await failOrder(db, current.id, "amount_mismatch", { paid_kobo: paid.amount, currency: paid.currency });
        } else {
          await db.query("UPDATE orders SET status = 'failed', failure_reason = 'amount_mismatch', updated_at = now() WHERE id = $1", [current.id]);
          await logEvent(db, current.id, "order_failed", { reason: "amount_mismatch", paid_kobo: paid.amount });
        }
        return { outcome: "amount_mismatch", paidKobo: paid.amount, currency: paid.currency };
      }

      let status: "paid" | "paid_no_stock" = "paid";
      let outcome: z.infer<typeof Outcome> = "paid";
      if (current.status !== "pending_payment") {
        // Hold already gone (expired, or cancelled after declines): take the stock again if it's there.
        const reheld = await holdStock(db, current.product_id, current.store_id, current.quantity);
        status = reheld ? "paid" : "paid_no_stock";
        outcome = reheld ? "paid_late_reheld" : "paid_no_stock";
      }
      await db.query(
        `UPDATE orders SET status = $2, paid_at = coalesce($3::timestamptz, now()), payment_channel = $4, updated_at = now()
         WHERE id = $1`,
        [current.id, status, paid.paid_at, paid.channel],
      );
      await logEvent(db, current.id, outcome === "paid" ? "payment_confirmed" : outcome, {
        reference: paid.reference,
        amount_kobo: paid.amount,
      });
      return { outcome };
    }

    if (current.status === "expired") return { outcome: "expired" };
    if (current.status !== "pending_payment") return { outcome: "failed" };

    if (latest?.status === "failed") {
      const declined = current.declined_attempts + 1;
      await db.query("UPDATE orders SET declined_attempts = $2, updated_at = now() WHERE id = $1", [current.id, declined]);
      await logEvent(db, current.id, "payment_declined", { attempt: declined, gateway_response: latest.gateway_response });
      if (declined >= MAX_DECLINES) {
        await failOrder(db, current.id, "declined");
        return { outcome: "declined_final" };
      }
      return { outcome: "declined", newLink: true };
    }

    return { outcome: latest && IN_PROGRESS.has(latest.status) ? "payment_processing" : "not_paid_yet" };
  });
}

// ---------- get_receipt ----------

registry.registerPath({
  method: "get",
  path: "/orders/{id}/receipt",
  operationId: "get_receipt",
  summary: "Get the receipt for a paid order",
  description: "Only works once verify_payment has confirmed the order. Send the text field as is.",
  security,
  request: { params: OrderParams },
  responses: { 200: json(Receipt, "The receipt"), ...errorResponses },
});

orders.get("/orders/:id/receipt", requireRole("buyer", "seller"), async (req, res) => {
  const { id } = parse(OrderParams, req.params);
  const order = await loadOrder(pool, id);
  if (order.status !== "paid") {
    const hint =
      order.status === "pending_payment"
        ? "Call verify_payment first to check with Paystack."
        : `The order status is ${order.status}, so there is no receipt.`;
    throw new ApiError(409, "not_paid", `Order ${id} is not paid. ${hint}`);
  }
  ok(res, receiptView(order));
});

// ---------- list_orders ----------

registry.registerPath({
  method: "get",
  path: "/orders",
  operationId: "list_orders",
  summary: "List orders (owner only)",
  description:
    "Orders with a summary by status, for questions like 'what sold today?'. needs_attention lists orders the owner must act on, such as refunds for paid_no_stock.",
  security,
  request: { query: ListOrdersQuery },
  responses: {
    200: json(
      z.object({
        period: z.string(),
        summary: z.object({
          counts: z.record(z.string(), z.number().int()),
          paid_total_naira: z.number(),
          paid_total_display: z.string(),
        }),
        needs_attention: z.array(z.object({ order_id: z.string(), status: OrderStatus, reason: z.string() })),
        orders: z.array(Order),
      }),
      "Orders, newest first",
    ),
    ...errorResponses,
  },
});

orders.get("/orders", requireRole("seller"), async (req, res) => {
  const q = parse(ListOrdersQuery, req.query);
  await expireStaleOrders(pool);

  const since = `(CASE $1::text
      WHEN 'today' THEN date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
      WHEN '7d' THEN now() - interval '7 days'
      WHEN '30d' THEN now() - interval '30 days'
    END)`;
  const inPeriod = `(${since} IS NULL OR o.created_at >= ${since} OR o.paid_at >= ${since})
    AND ($2::text IS NULL OR o.store_id = $2)`;

  const [list, summary] = await Promise.all([
    pool.query<OrderRow>(
      `${ORDER_SELECT} WHERE ${inPeriod} AND ($3::text IS NULL OR o.status = $3)
       ORDER BY o.created_at DESC LIMIT $4`,
      [q.period, q.store_id ?? null, q.status ?? null, q.limit],
    ),
    pool.query<{ status: string; n: number; paid_kobo: number }>(
      `SELECT o.status, count(*)::int AS n, coalesce(sum(o.amount_kobo) FILTER (WHERE o.status = 'paid'), 0)::bigint AS paid_kobo
       FROM orders o WHERE ${inPeriod} GROUP BY o.status`,
      [q.period, q.store_id ?? null],
    ),
  ]);

  const counts = Object.fromEntries(summary.rows.map((r) => [r.status, r.n]));
  const paidKobo = summary.rows.reduce((n, r) => n + r.paid_kobo, 0);
  const attention = await pool.query<{ id: string; status: z.infer<typeof OrderStatus>; failure_reason: string | null }>(
    `SELECT o.id, o.status, o.failure_reason FROM orders o
     WHERE (o.status IN ('paid_no_stock', 'handed_over') OR o.failure_reason = 'amount_mismatch')
       AND ($1::text IS NULL OR o.store_id = $1)
     ORDER BY o.updated_at DESC LIMIT 20`,
    [q.store_id ?? null],
  );

  ok(res, {
    period: q.period,
    summary: { counts, paid_total_naira: toNaira(paidKobo), paid_total_display: formatNaira(paidKobo) },
    needs_attention: attention.rows.map((r) => ({
      order_id: r.id,
      status: r.status,
      reason:
        r.status === "paid_no_stock"
          ? "Paid after the hold ran out and the item sold out: refund the customer"
          : r.status === "handed_over"
            ? "Handed to a person"
            : "Paystack amount did not match the order: check and refund if needed",
    })),
    orders: list.rows.map(orderView),
  });
});
