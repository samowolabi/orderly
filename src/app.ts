import express from "express";
import { config } from "./config";
import { pool } from "./db/pool";
import { errorHandler, notFound } from "./middleware/errors";
import { openApiDocument } from "./openapi/document";
import { catalog } from "./routes/catalog";
import { orders } from "./routes/orders";
import { webhooks } from "./routes/webhooks";
import { ok } from "./utils/http";

// Builds the Express application with infrastructure and Chord-facing routes.
export function createApp() {
  const app = express();

  // Paystack signs the exact request bytes, so this route must run before JSON parsing.
  app.use(webhooks);
  app.use(express.json({ limit: "100kb" }));

  // Confirms that the API can reach its database.
  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    ok(res, { status: "up" });
  });

  // Public, so Chord can import it by URL. Holds no secrets.
  // Serves a public OpenAPI document using the current request host as fallback.
  app.get("/openapi.json", (req, res) => {
    res.json(openApiDocument(config().PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`));
  });

  app.use(catalog);
  app.use(orders);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
