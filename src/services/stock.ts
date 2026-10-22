import type pg from "pg";

export type Db = pg.Pool | pg.PoolClient;

export async function logEvent(db: Db, orderId: string | null, type: string, detail: Record<string, unknown> = {}) {
  await db.query("INSERT INTO events (order_id, type, detail) VALUES ($1, $2, $3)", [orderId, type, detail]);
}

// The never-sell-twice rule: one atomic statement, so two buyers racing for
// the last unit cannot both succeed.
export async function holdStock(db: Db, productId: string, storeId: string, quantity: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE stock SET available = available - $3, updated_at = now()
     WHERE product_id = $1 AND store_id = $2 AND available >= $3`,
    [productId, storeId, quantity],
  );
  return rowCount === 1;
}

async function releaseStock(db: Db, productId: string, storeId: string, quantity: number) {
  await db.query(
    `UPDATE stock SET available = available + $3, updated_at = now()
     WHERE product_id = $1 AND store_id = $2`,
    [productId, storeId, quantity],
  );
}

// Moves elapsed holds to expired and returns their stock. Row locks make this
// safe when multiple requests run the sweep at the same time.
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
