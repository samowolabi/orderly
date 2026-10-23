import { randomBytes } from "node:crypto";
import { paymentProcessor } from "../adapters";
import {
  PaymentProcessorUnavailable,
  type PaymentTransaction,
  type PaymentWebhookEvent,
} from "../adapters/payment/payment-processor";
import { config } from "../config";
import { pool, withTransaction } from "../db/pool";
import { lagosTime } from "../utils/format";
import { ApiError } from "../utils/http";
import { formatMoney, moneyView } from "../utils/money";
import { formatAddress, type AddressRow } from "../utils/store-location";
import { expireStaleOrders, failOrder, holdStock, logEvent, type Db } from "./stock";

const MAX_DECLINES = 3;
const IN_PROGRESS = new Set(["ongoing", "pending", "processing", "queued"]);

type OrderStatus = "pending_payment" | "paid" | "failed" | "expired" | "paid_no_stock" | "handed_over";
type PaymentOutcome =
  | "paid"
  | "already_paid"
  | "paid_late_reheld"
  | "paid_no_stock"
  | "not_paid_yet"
  | "payment_processing"
  | "declined"
  | "declined_final"
  | "expired"
  | "failed"
  | "handed_over";

type CreateOrderInput = {
  product_id: string;
  store_id: string;

  quantity: number;

  buyer_name: string;
  buyer_email?: string;
};

type ListOrdersInput = {
  status?: OrderStatus;
  store_id?: string;

  period: "today" | "7d" | "30d" | "all";
  limit: number;
};

type OrderRow = {
  id: string;

  product_id: string;
  product_name: string;
  product_variant: string | null;

  store_id: string;
  store_name: string;

  quantity: number;
  unit_price_subunit: number;
  amount_subunit: number;
  currency: string;

  buyer_name: string;
  buyer_email: string | null;

  status: OrderStatus;
  failure_reason: string | null;

  payment_url: string | null;
  payment_references: string[];
  paid_reference: string | null;
  payment_channel: string | null;
  declined_attempts: number;

  expires_at: Date;
  paid_at: Date | null;
  created_at: Date;
} & AddressRow;

type VerifyResult =
  | { outcome: PaymentOutcome }
  | { outcome: "declined"; newLink: true }
  | { outcome: "amount_mismatch"; paidSubunits: number; currency: string };

const ORDER_SELECT = `
  SELECT o.*, p.name AS product_name, p.variant AS product_variant,
         s.name AS store_name, s.address_line1, s.address_line2, s.area, s.city, s.state,
         s.country_code, s.postal_code, s.latitude, s.longitude, s.directions_note
  FROM orders o
  JOIN products p ON p.id = o.product_id
  JOIN stores s ON s.id = o.store_id`;

// Loads one order with the product and store fields needed by API views.
async function loadOrder(db: Db, id: string): Promise<OrderRow> {
  const { rows } = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "order_not_found", `No order ${id}. Check the order number with the customer.`);
  return rows[0];
}

// Formats an order's product name with its optional variant.
const itemName = (order: OrderRow) =>
  order.product_variant ? `${order.product_name} (${order.product_variant})` : order.product_name;

// Converts an order row into the customer-safe API representation.
function orderView(order: OrderRow) {
  const pending = order.status === "pending_payment";
  return {
    order_id: order.id,
    status: order.status,
    product: { id: order.product_id, name: order.product_name, variant: order.product_variant },
    store: { id: order.store_id, name: order.store_name },
    quantity: order.quantity,
    unit_price: moneyView(order.unit_price_subunit, order.currency),
    amount: moneyView(order.amount_subunit, order.currency),
    buyer_name: order.buyer_name,
    payment_url: pending ? order.payment_url : null,
    expires_at: order.expires_at.toISOString(),
    minutes_left: pending ? Math.max(0, Math.ceil((order.expires_at.getTime() - Date.now()) / 60_000)) : 0,
    declined_attempts: order.declined_attempts,
    paid_at: order.paid_at?.toISOString() ?? null,
    created_at: order.created_at.toISOString(),
  };
}

// Builds structured and ready-to-send receipt data for a paid order.
function receiptView(order: OrderRow) {
  const paidAt = order.paid_at ?? new Date();
  const business = config().BUSINESS_NAME;
  const reference = order.paid_reference ?? order.payment_references.at(-1) ?? order.id;
  const storeAddress = formatAddress(order);
  const total = formatMoney(order.amount_subunit, order.currency);
  const lines = [
    `${business} receipt ${order.id}`,
    `${order.store_name}, ${storeAddress}`,
    "",
    `${itemName(order)} x${order.quantity}: ${total}`,
    `Total paid: ${total}`,
    "",
    `Paid ${lagosTime(paidAt)}${order.payment_channel ? ` by ${order.payment_channel}` : ""}`,
    `Paystack reference: ${reference}`,
    `Thank you for shopping with ${business}.`,
  ];

  return {
    receipt_number: order.id,
    business,
    store: { name: order.store_name, address: storeAddress },
    item: itemName(order),
    quantity: order.quantity,
    unit_price: moneyView(order.unit_price_subunit, order.currency),
    total: moneyView(order.amount_subunit, order.currency),
    buyer_name: order.buyer_name,
    paid_at: paidAt.toISOString(),
    paid_at_display: lagosTime(paidAt),
    payment_reference: reference,
    payment_channel: order.payment_channel,
    text: lines.join("\n"),
  };
}

// Creates a test-safe email when a WhatsApp buyer did not provide one.
const placeholderEmail = (orderId: string) => `buyer+${orderId.toLowerCase()}@example.com`;
// Creates a unique Paystack reference for one payment attempt.
const newReference = (orderId: string) => `${orderId}-${randomBytes(3).toString("hex")}`;

// Initializes the payment processor and attaches its checkout link to an order.
async function attachPaymentLink(
  order: Pick<OrderRow, "id" | "product_id" | "store_id" | "amount_subunit" | "currency" | "buyer_email">,
) {
  const reference = newReference(order.id);
  const { checkoutUrl } = await paymentProcessor.createCheckout({
    reference,
    amountSubunits: order.amount_subunit,
    currency: order.currency,
    email: order.buyer_email ?? placeholderEmail(order.id),
    metadata: { order_id: order.id, product_id: order.product_id, store_id: order.store_id },
  });
  await pool.query(
    `UPDATE orders SET payment_url = $2, payment_references = array_append(payment_references, $3), updated_at = now()
     WHERE id = $1`,
    [order.id, checkoutUrl, reference],
  );
  await logEvent(pool, order.id, "payment_link_created", { reference });
}

// Holds stock, creates an order and attaches its first payment link.
export async function createOrder(input: CreateOrderInput) {
  await expireStaleOrders(pool);

  // Holds stock and inserts the order in one transaction.
  const order = await withTransaction(async (db) => {
    const product = (await db.query("SELECT id FROM products WHERE id = $1 AND active", [input.product_id])).rows[0];
    if (!product) {
      throw new ApiError(404, "product_not_found", `No product ${input.product_id}. Call list_products to find the right id.`);
    }
    const store = (await db.query("SELECT id FROM stores WHERE id = $1 AND active", [input.store_id])).rows[0];
    if (!store) throw new ApiError(404, "store_not_found", `No store ${input.store_id}. Call list_stores for the right id.`);

    if (!(await holdStock(db, input.product_id, input.store_id, input.quantity))) {
      const { rows: elsewhere } = await db.query<{ name: string; available: number }>(
        `SELECT s.name, st.available FROM stock st JOIN stores s ON s.id = st.store_id
         WHERE st.product_id = $1 AND st.store_id <> $2 AND s.active AND st.available >= $3
         ORDER BY st.available DESC`,
        [input.product_id, input.store_id, input.quantity],
      );
      const hint = elsewhere.length
        ? `It is available at ${elsewhere.map(
            // Formats one alternative store and its available quantity.
            (candidate) => `${candidate.name} (${candidate.available})`,
          ).join(", ")}. Offer that store instead.`
        : "It is sold out at every store. Say so honestly and offer something similar from list_products.";
      throw new ApiError(
        409,
        "out_of_stock",
        `Not enough ${input.product_id} at ${input.store_id} for ${input.quantity}. ${hint}`,
      );
    }

    // Price and currency both come from the product row, never from the request.
    const { rows } = await db.query<{ id: string; amount_subunit: number; currency: string }>(
      `INSERT INTO orders (
         product_id, store_id, quantity, unit_price_subunit, amount_subunit, currency, buyer_name, buyer_email, expires_at
       )
       SELECT p.id, $2, $3::int, p.price_subunit, p.price_subunit * $3::int, p.currency, $4, $5,
              now() + make_interval(mins => $6::int)
       FROM products p WHERE p.id = $1
       RETURNING id, amount_subunit, currency`,
      [input.product_id, input.store_id, input.quantity, input.buyer_name, input.buyer_email ?? null, config().HOLD_MINUTES],
    );
    const created = rows[0]!;
    await logEvent(db, created.id, "order_created", {
      held: input.quantity,
      amount_subunit: created.amount_subunit,
      currency: created.currency,
    });
    return created;
  });

  try {
    await attachPaymentLink({
      id: order.id,
      amount_subunit: order.amount_subunit,
      currency: order.currency,
      buyer_email: input.buyer_email ?? null,
      product_id: input.product_id,
      store_id: input.store_id,
    });
  } catch (error) {
    if (!(error instanceof PaymentProcessorUnavailable)) throw error;
    console.error(`[paystack] ${order.id}: ${error.message}`);
    // Releases the held stock if Paystack cannot create a link.
    await withTransaction((db) => failOrder(db, order.id, "payment_link_failed", { error: error.message }));
    throw new ApiError(
      502,
      "payment_link_failed",
      "Paystack could not make a payment link, so the item was released and nothing was charged. Apologise and offer to try again. If it fails a second time, hand over to a person.",
    );
  }

  return orderView(await loadOrder(pool, order.id));
}

// Maps a payment outcome to the exact conversational instruction for Chord.
function nextStep(outcome: PaymentOutcome, order: OrderRow): string {
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
      return `Paystack has no payment for this order yet. If the customer says they paid, tell them politely it hasn't come through and resend the payment link. ${orderView(order).minutes_left} minute(s) left on the hold.`;
    case "payment_processing":
      return "The payment is still processing at Paystack. Ask the customer to wait a minute, then check again.";
    case "declined":
      return order.declined_attempts >= 2
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

// Checks every payment attempt and applies the latest verified order outcome.
async function verifyOrder(order: OrderRow): Promise<VerifyResult> {
  if (order.status === "paid") return { outcome: "already_paid" };
  if (order.status === "paid_no_stock" || order.status === "handed_over") return { outcome: order.status };
  if (order.status === "failed" && (!order.payment_references.length || order.failure_reason === "amount_mismatch")) {
    return { outcome: "failed" };
  }

  let paid: PaymentTransaction | null = null;
  let latest: PaymentTransaction | null = null;
  try {
    const references = [...order.payment_references].reverse();
    for (const [index, reference] of references.entries()) {
      const transaction = await paymentProcessor.verifyTransaction(reference);
      if (index === 0) latest = transaction;
      if (transaction?.status === "success") {
        paid = transaction;
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof PaymentProcessorUnavailable)) throw error;
    console.error(`[paystack] verify ${order.id}: ${error.message}`);
    await logEvent(pool, order.id, "verify_unavailable", { error: error.message });
    throw new ApiError(
      503,
      "paystack_unreachable",
      "Paystack is not answering, so the payment can't be confirmed right now. Do NOT tell the customer it is paid. Say you can't confirm it at the moment and hand over to a person.",
    );
  }

  // Locks the order before applying the verified payment state.
  return withTransaction(async (db): Promise<VerifyResult> => {
    const { rows } = await db.query<OrderRow>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [order.id]);
    const current = rows[0]!;

    if (paid) {
      return confirmSuccessfulPayment(db, current, paid);
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

// Applies one verified successful transaction without double-selling stock.
async function confirmSuccessfulPayment(db: Db, order: OrderRow, transaction: PaymentTransaction): Promise<VerifyResult> {
  if (order.status === "paid") return { outcome: "already_paid" };
  if (order.status === "paid_no_stock" || order.status === "handed_over") return { outcome: order.status };

  if (transaction.amount !== order.amount_subunit || transaction.currency !== order.currency) {
    if (order.failure_reason === "amount_mismatch") {
      return { outcome: "amount_mismatch", paidSubunits: transaction.amount, currency: transaction.currency };
    }

    if (order.status === "pending_payment") {
      await failOrder(db, order.id, "amount_mismatch", {
        paid_subunit: transaction.amount,
        currency: transaction.currency,
        reference: transaction.reference,
      });
    } else {
      await db.query(
        "UPDATE orders SET status = 'failed', failure_reason = 'amount_mismatch', updated_at = now() WHERE id = $1",
        [order.id],
      );
      await logEvent(db, order.id, "order_failed", {
        reason: "amount_mismatch",
        paid_subunit: transaction.amount,
        currency: transaction.currency,
        reference: transaction.reference,
      });
    }

    return { outcome: "amount_mismatch", paidSubunits: transaction.amount, currency: transaction.currency };
  }

  let status: "paid" | "paid_no_stock" = "paid";
  let outcome: PaymentOutcome = "paid";

  if (order.status !== "pending_payment") {
    const reheld = await holdStock(db, order.product_id, order.store_id, order.quantity);
    status = reheld ? "paid" : "paid_no_stock";
    outcome = reheld ? "paid_late_reheld" : "paid_no_stock";
  }

  await db.query(
    `UPDATE orders
     SET status = $2, paid_at = coalesce($3::timestamptz, now()), payment_channel = $4,
         paid_reference = $5, updated_at = now()
     WHERE id = $1`,
    [order.id, status, transaction.paid_at, transaction.channel, transaction.reference],
  );
  await logEvent(db, order.id, outcome === "paid" ? "payment_confirmed" : outcome, {
    reference: transaction.reference,
    amount_subunit: transaction.amount,
    currency: transaction.currency,
  });

  return { outcome };
}

// Confirms a normalized payment-success event against its matching order.
export async function processPaymentWebhook(webhook: PaymentWebhookEvent) {
  if (webhook.type === "ignored") {
    return { outcome: "ignored" as const, event: webhook.sourceEvent };
  }

  const { transaction } = webhook;
  await expireStaleOrders(pool);

  // Locks the referenced order while applying the idempotent confirmation.
  return withTransaction(async (db) => {
    const { rows } = await db.query<OrderRow>(
      `SELECT * FROM orders
       WHERE payment_references @> ARRAY[$1]::text[]
       LIMIT 1
       FOR UPDATE`,
      [transaction.reference],
    );
    const order = rows[0];
    if (!order) return { outcome: "unknown_reference" as const, reference: transaction.reference };

    const result = await confirmSuccessfulPayment(db, order, transaction);
    return { ...result, order_id: order.id, reference: transaction.reference };
  });
}

// Exposes payment verification, recovery guidance and any available receipt.
export async function verifyPayment(id: string) {
  await expireStaleOrders(pool);
  const before = await loadOrder(pool, id);
  const result = await verifyOrder(before);

  if (result.outcome === "amount_mismatch") {
    throw new ApiError(
      409,
      "amount_mismatch",
      `Paystack shows a payment of ${formatMoney(result.paidSubunits, result.currency)}, which does not match this order. The order is NOT confirmed. Do not send a receipt. Tell the customer a person will sort it out, and hand over.`,
    );
  }

  if ("newLink" in result) {
    try {
      await attachPaymentLink(before);
    } catch (error) {
      if (!(error instanceof PaymentProcessorUnavailable)) throw error;
      console.error(`[paystack] ${id}: ${error.message}`);
      throw new ApiError(
        502,
        "payment_link_failed",
        "The card was declined and Paystack could not make a new link. Nothing was charged. Hand over to a person.",
      );
    }
  }

  const after = await loadOrder(pool, id);
  return {
    outcome: result.outcome,
    next_step: nextStep(result.outcome, after),
    order: orderView(after),
    receipt: after.status === "paid" ? receiptView(after) : null,
  };
}

// Returns a receipt only when the order is confirmed paid.
export async function getReceipt(id: string) {
  const order = await loadOrder(pool, id);
  if (order.status !== "paid") {
    const hint =
      order.status === "pending_payment"
        ? "Call verify_payment first to check with Paystack."
        : `The order status is ${order.status}, so there is no receipt.`;
    throw new ApiError(409, "not_paid", `Order ${id} is not paid. ${hint}`);
  }
  return receiptView(order);
}

// Lists filtered orders with sales totals and owner attention items.
export async function listOrders(input: ListOrdersInput) {
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
      [input.period, input.store_id ?? null, input.status ?? null, input.limit],
    ),
    pool.query<{ status: string; currency: string; n: number; paid_subunit: number }>(
      `SELECT o.status, o.currency, count(*)::int AS n,
              coalesce(sum(o.amount_subunit) FILTER (WHERE o.status = 'paid'), 0)::bigint AS paid_subunit
       FROM orders o WHERE ${inPeriod} GROUP BY o.status, o.currency`,
      [input.period, input.store_id ?? null],
    ),
  ]);

  const counts: Record<string, number> = {};
  const paidByCurrency = new Map<string, number>();
  for (const row of summary.rows) {
    counts[row.status] = (counts[row.status] ?? 0) + row.n;
    // Totals are kept per currency; amounts in different currencies are never added together.
    if (row.status === "paid") paidByCurrency.set(row.currency, (paidByCurrency.get(row.currency) ?? 0) + row.paid_subunit);
  }
  const attention = await pool.query<{ id: string; status: OrderStatus; failure_reason: string | null }>(
    `SELECT o.id, o.status, o.failure_reason FROM orders o
     WHERE (o.status IN ('paid_no_stock', 'handed_over') OR o.failure_reason = 'amount_mismatch')
       AND ($1::text IS NULL OR o.store_id = $1)
     ORDER BY o.updated_at DESC LIMIT 20`,
    [input.store_id ?? null],
  );

  return {
    period: input.period,
    summary: {
      counts,
      // Converts one currency total into the API money shape.
      paid_totals: [...paidByCurrency].map(([currency, subunits]) => moneyView(subunits, currency)),
    },
    // Converts one exceptional order into an owner action item.
    needs_attention: attention.rows.map((row) => ({
      order_id: row.id,
      status: row.status,
      reason:
        row.status === "paid_no_stock"
          ? "Paid after the hold ran out and the item sold out: refund the customer"
          : row.status === "handed_over"
            ? "Handed to a person"
            : "Paystack amount did not match the order: check and refund if needed",
    })),
    orders: list.rows.map(orderView),
  };
}
