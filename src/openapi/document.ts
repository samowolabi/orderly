import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
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
3. Use \`create_order\` only after confirming the product, collection store, quantity and buyer name.
4. Use \`verify_payment\` whenever the customer says they paid. Never trust a screenshot or payment claim.
5. Use \`get_receipt\` only for an order already confirmed as paid.

## Owner workflow

Use \`add_store\` and \`update_store\` for branches, addresses, map pins and opening hours. Use \`add_product\` for new products (several in one call) and \`update_product\` for any mix of price, details, sale status and stock at several stores in one call. Use \`list_orders\` for sales and orders needing attention. Read the whole batch of changes back to the owner once and get confirmation before a write operation.

## Responses

Every response has \`{ ok, data, error }\`. When \`ok\` is false, follow \`error.message_for_agent\`. Payment verification also returns \`next_step\`; follow it exactly. Every amount comes back as \`{ amount, currency, display }\`; quote \`display\` to customers. Send prices as plain numbers in the main unit of the currency shown by \`list_products\`, never in subunits.
`.trim();

// Generates the standalone OpenAPI document imported by Chord.
export function openApiDocument(serverUrl?: string) {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Orderly API",
      version: "1.0.0",
      description: readme,
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
  });
}
