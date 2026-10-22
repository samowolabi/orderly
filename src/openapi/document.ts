import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry";

// Importing the routes registers their paths.
import "../routes/catalog";
import "../routes/orders";

export function openApiDocument(serverUrl?: string) {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Orderly API",
      version: "1.0.0",
      description:
        "Stores, stock, orders and Paystack payments for Kola Gadgets. Every response is { ok, data, error: { code, message_for_agent } }. When ok is false, follow message_for_agent. All money is in naira.",
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
  });
}
