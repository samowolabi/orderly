import express from "express";
import { config } from "./config";
import { pool } from "./db/pool";
import { errorHandler, notFound } from "./middleware/errors";
import { openApiDocument } from "./openapi/document";
import { catalog } from "./routes/catalog";
import { orders } from "./routes/orders";
import { ok } from "./utils/http";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    ok(res, { status: "up" });
  });

  // Public, so Chord can import it by URL. Holds no secrets.
  app.get("/openapi.json", (req, res) => {
    res.json(openApiDocument(config().PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`));
  });

  app.use(catalog);
  app.use(orders);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
