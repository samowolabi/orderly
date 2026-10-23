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

// Returns previously held units to a store's available stock.
async function releaseStock(db: Db, productId: string, storeId: string, quantity: number) {
  await db.query(
    `UPDATE stock SET available = available + $3, updated_at = now()
     WHERE product_id = $1 AND store_id = $2`,
    [productId, storeId, quantity],
  );
}

// Expires elapsed holds and safely returns their stock during concurrent sweeps.
export async function expireStaleOrders(db: Db): Promise<number> {
  const { rowCount } = await db.query(`
    WITH expired AS (
      UPDATE orders SET status = 'expired', updated_at = now()
      WHERE status = 'pending_payment' AND expires_at <= now()
      RETURNING id, product_id, store_id, quantity
    ), restocked AS (
      UPDATE stock st SET available = st.available + e.qty, updated_at = now()
      FROM (SELECT product_id, store_id, sum(quantity)::int AS qty FROM expired GROUP BY 1, 2) e
      WHERE st.product_id = e.product_id AND st.store_id = e.store_id
    )
    INSERT INTO events (order_id, type, detail)
    SELECT id, 'hold_expired', jsonb_build_object('released', quantity) FROM expired
  `);
  return rowCount ?? 0;
}

// Returns when enough unpaid holds at a store will have expired to free `quantity`
// units, or null when the store couldn't cover it even then.
export async function whenStockFrees(db: Db, productId: string, storeId: string, quantity: number): Promise<Date | null> {
  const { rows } = await db.query<{ available: number; quantity: number | null; expires_at: Date | null }>(
    `SELECT st.available, o.quantity, o.expires_at
     FROM stock st
     LEFT JOIN orders o ON o.product_id = st.product_id AND o.store_id = st.store_id AND o.status = 'pending_payment'
     WHERE st.product_id = $1 AND st.store_id = $2
     ORDER BY o.expires_at`,
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
     RETURNING product_id, store_id, quantity`,
    [orderId, reason],
  );
  const held = rows[0];
  if (held) await releaseStock(db, held.product_id, held.store_id, held.quantity);
  await logEvent(db, orderId, "order_failed", { reason, released: held ? held.quantity : 0, ...detail });
}
