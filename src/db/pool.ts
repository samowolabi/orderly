import "dotenv/config";
import pg from "pg";

// Parses bigint columns (money in subunits) as numbers instead of pg's default strings;
// every stored value fits safely in a JavaScript number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const pool = new pg.Pool({
  connectionString,
  // Railway's managed Postgres needs TLS; local dev does not.
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
});

// Runs a database operation inside a committed or rolled-back transaction.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
