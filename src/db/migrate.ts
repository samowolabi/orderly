import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool, withTransaction } from "./pool";

// Resolves the same way from src/db (tsx) and dist/db (built).
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

export async function migrate(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const done = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

if (require.main === module) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
