import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { API_PREFIX } from "../utils/http";
import { registry } from "./registry";

// Importing the path modules registers every operation.
import "./paths/catalog";
import "./paths/orders";

const readme = `
# Orderly tool guide

Orderly is the source of truth for this business's stores, products, stock, orders and Paystack payments. Never invent a store id, product id, price, stock count, order status or payment result.

## Customer workflow

1. Use \`list_stores\` for store addresses, map links and opening hours.
2. Use \`list_products\` before quoting a price or saying an item is available.
3. Ask whether they'll pick it up or want it delivered. For delivery, get their address and phone number, use \`quote_delivery\`, and get their agreement to the fee.
4. Use \`create_order\` with all the items: \`store_id\` for pickup, or the agreed \`delivery_quote_id\` for delivery.
5. Use \`verify_payment\` whenever the customer says they paid. Never trust a screenshot or payment claim.
6. Use \`get_receipt\` only for an order already confirmed as paid.

## Owner workflow

Use \`add_store\` and \`update_store\` for branches, addresses, map pins and opening hours. Use \`add_product\` for new products (several in one call) and \`update_product\` for any mix of price, details, sale status and stock at several stores in one call. Use \`list_orders\` for sales and orders needing attention. Use \`delivery_settings\` to read or change delivery pricing. Read the whole batch of changes back to the owner once and get confirmation before a write operation.

## Responses

Every response has \`{ success, data, error }\`. When \`success\` is false, follow \`error.message_for_agent\`. Payment verification also returns \`next_step\`; follow it exactly. Every amount comes back as \`{ amount, currency, display }\`; quote \`display\` to customers. Send prices as plain numbers in the main unit of the currency shown by \`list_products\`, never in subunits.
`.trim();

// Generates the standalone OpenAPI document imported by Chord. Paths are relative to the
// versioned server URL, so each operation's full URL is <public url>/v1/<path>.
export function openApiDocument(serverUrl?: string) {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Orderly API",
      version: "1.0.0",
      description: readme,
    },
    servers: serverUrl ? [{ url: `${serverUrl.replace(/\/+$/, "")}${API_PREFIX}` }] : [],
  });
}
