import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config";
import { pool } from "./db/pool";
import { ApiError, fail, ok } from "./http/respond";
import { openApiDocument } from "./openapi/document";
import { catalog } from "./routes/catalog";
import { orders } from "./routes/orders";

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

  app.use((_req, res) => {
    fail(res, 404, "not_found", "This endpoint does not exist. Check the tool name.");
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) return fail(res, err.status, err.code, err.message);
    if (err instanceof SyntaxError && "body" in err) {
      return fail(res, 400, "bad_json", "The request body was not valid JSON.");
    }
    console.error(err);
    fail(res, 500, "internal_error", "Something went wrong on our side. Do not retry; hand over to a person.");
  });

  return app;
}
