import type pg from "pg";

export type Db = pg.Pool | pg.PoolClient;

// Appends one auditable business event to the event log.
export async function logEvent(db: Db, orderId: string | null, type: string, detail: Record<string, unknown> = {}) {
  await db.query("INSERT INTO events (order_id, type, detail) VALUES ($1, $2, $3)", [orderId, type, detail]);
}

// Atomically holds stock so two buyers racing for the last unit cannot both succeed.
export async function holdStock(db: Db, productId: string, storeId: string, quantity: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE stock SET available = available - $3, updated_at = now()
     WHERE product_id = $1 AND store_id = $2 AND available >= $3`,
    [productId, storeId, quantity],
  );
  return rowCount === 1;
}

// An order line; price is a haggled unit price in the main unit, when one was agreed, and
// store_id the store to hold it at, when it differs from the order's store.
export type HoldItem = { product_id: string; quantity: number; price?: number; store_id?: string };

// A line with the store it's held at.
export type StoreLine = HoldItem & { store_id: string };

// Adds up repeats of the same product, keeping the order the customer asked for them in
// and the first agreed price and store given for it.
export function mergeItems(items: HoldItem[]): HoldItem[] {
  const merged = new Map<string, HoldItem>();
  for (const item of items) {
    const seen = merged.get(item.product_id);
    const price = seen?.price ?? item.price;
    const storeId = seen?.store_id ?? item.store_id;
    merged.set(item.product_id, {
      product_id: item.product_id,
      quantity: (seen?.quantity ?? 0) + item.quantity,
      ...(price !== undefined ? { price } : {}),
      ...(storeId !== undefined ? { store_id: storeId } : {}),
    });
  }
  return [...merged.values()];
}

// Holds every line of an order at its store, or none of them. Returns the first line that
// couldn't be held; the caller must roll back its transaction (or savepoint) when it does.
export async function holdItems(db: Db, lines: StoreLine[]): Promise<StoreLine | null> {
  for (const line of lines) {
    if (!(await holdStock(db, line.product_id, line.store_id, line.quantity))) return line;
  }
  return null;
}

// Returns an order's held units to the stock of the stores they were held at.
async function releaseOrderStock(db: Db, orderId: string) {
  await db.query(
    `UPDATE stock st SET available = st.available + i.quantity, updated_at = now()
     FROM order_items i
     WHERE i.order_id = $1 AND st.product_id = i.product_id AND st.store_id = i.store_id`,
    [orderId],
  );
}

// Expires elapsed holds and safely returns their stock during concurrent sweeps.
export async function expireStaleOrders(db: Db): Promise<number> {
  const { rowCount } = await db.query(`
    WITH expired AS (
      UPDATE orders SET status = 'expired', updated_at = now()
      WHERE status = 'pending_payment' AND expires_at <= now()
      RETURNING id
    ), lines AS (
      SELECT e.id, i.store_id, i.product_id, i.quantity
      FROM expired e JOIN order_items i ON i.order_id = e.id
    ), restocked AS (
      UPDATE stock st SET available = st.available + l.qty, updated_at = now()
      FROM (SELECT product_id, store_id, sum(quantity)::int AS qty FROM lines GROUP BY 1, 2) l
      WHERE st.product_id = l.product_id AND st.store_id = l.store_id
    )
    INSERT INTO events (order_id, type, detail)
    SELECT id, 'hold_expired', jsonb_build_object('released', sum(quantity)) FROM lines GROUP BY id
  `);
  return rowCount ?? 0;
}

// Returns when enough unpaid holds at a store will have expired to free `quantity`
// units, or null when the store couldn't cover it even then.
export async function whenStockFrees(db: Db, productId: string, storeId: string, quantity: number): Promise<Date | null> {
  const { rows } = await db.query<{ available: number; quantity: number | null; expires_at: Date | null }>(
    `SELECT st.available, held.quantity, held.expires_at
     FROM stock st
     LEFT JOIN LATERAL (
       SELECT i.quantity, o.expires_at
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.product_id = st.product_id AND i.store_id = st.store_id AND o.status = 'pending_payment'
     ) held ON true
     WHERE st.product_id = $1 AND st.store_id = $2
     ORDER BY held.expires_at`,
    [productId, storeId],
  );

  let free = rows[0]?.available ?? 0;
  for (const row of rows) {
    if (row.quantity === null || !row.expires_at) continue;
    free += row.quantity;
    if (free >= quantity) return row.expires_at;
  }
  return null;
}

// Fails an order, releases any active hold and records the reason.
export async function failOrder(db: Db, orderId: string, reason: string, detail: Record<string, unknown> = {}) {
  const { rows } = await db.query(
    `UPDATE orders SET status = 'failed', failure_reason = $2, updated_at = now()
     WHERE id = $1 AND status = 'pending_payment'
     RETURNING id`,
    [orderId, reason],
  );
  const held = rows[0];
  if (held) await releaseOrderStock(db, orderId);
  await logEvent(db, orderId, "order_failed", { reason, released: Boolean(held), ...detail });
}
