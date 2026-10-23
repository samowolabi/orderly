import * as schema from "../schemas/catalog";
import { Money } from "../schemas/money";
import { body, errorResponses, json, registry, security, z } from "../registry";

registry.registerPath({
  method: "get",
  path: "/stores",
  operationId: "list_stores",
  summary: "List the stores",
  description:
    "Every store with its address, opening hours (in the business's local time) and whether it is open right now. Quote opening_hours as written. Use the id with other tools.",
  security: security.buyerOrSeller,
  responses: { 200: json(z.object({ stores: z.array(schema.Store) }), "The stores"), 401: errorResponses[401] },
});

registry.registerPath({
  method: "post",
  path: "/stores",
  operationId: "add_store",
  summary: "Add a store or branch (owner only)",
  description:
    "Creates a new store. Every product gets a stock line of 0 there; use update_stock to add units. Turn hours like 'Mon to Sat, 9 to 7' into days and 24-hour times, and read them back to the owner before calling.",
  security: security.seller,
  request: { body: body(schema.AddStoreBody) },
  responses: { 201: json(schema.Store, "The new store"), ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/stores/{id}",
  operationId: "update_store",
  summary: "Change a store's name, address or hours (owner only)",
  description:
    "Send only what changes, and at least one of name, address, location, hours or closed_days. A day can't be in both hours and closed_days. hours updates just the days listed and leaves the rest alone; closed_days closes days. Turn 'Saturdays now 10 to 4' into 24-hour times, and read the change back to the owner before calling.",
  security: security.seller,
  request: { params: schema.StoreParams, body: body(schema.UpdateStoreBody) },
  responses: {
    200: json(
      z.object({ store: schema.Store, previous: schema.Store }),
      "The store after the change, and what it was before",
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/products",
  operationId: "list_products",
  summary: "Look up products, prices and stock",
  description:
    "Live prices and units available at each store. Always call this before quoting a price or saying something is in stock; never guess. Search with q, or narrow to one store with store_id.",
  security: security.buyerOrSeller,
  request: { query: schema.ListProductsQuery },
  responses: { 200: json(z.object({ products: z.array(schema.Product) }), "Matching products"), ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/products",
  operationId: "add_product",
  summary: "Add a new product (owner only)",
  description:
    "Adds a product with its price and starting stock per store. Read the details back to the owner and get a yes before calling. Use update_stock for products that already exist.",
  security: security.seller,
  request: { body: body(schema.AddProductBody) },
  responses: { 201: json(schema.Product, "The new product"), ...errorResponses },
});

registry.registerPath({
  method: "post",
  path: "/products/{id}/stock",
  operationId: "update_stock",
  summary: "Change stock at one store (owner only)",
  description:
    "Send exactly one of change or set_to. Use change to add or remove units ('add 3 more to Lekki' is change: 3), or set_to after a physical count. Units held for unpaid orders are counted as on hand.",
  security: security.seller,
  request: { params: schema.ProductParams, body: body(schema.UpdateStockBody) },
  responses: {
    200: json(
      z.object({
        product: schema.Product,
        store_id: z.string(),
        available: z.number().int(),
        held_for_unpaid_orders: z.number().int(),
        on_hand: z.number().int(),
      }),
      "Stock after the change",
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/products/{id}",
  operationId: "update_price",
  summary: "Change a product's price (owner only)",
  description:
    "Sets one price for every store. Orders already waiting for payment keep the price they were created with. Confirm the new price with the owner first.",
  security: security.seller,
  request: { params: schema.ProductParams, body: body(schema.UpdatePriceBody) },
  responses: {
    200: json(z.object({ product: schema.Product, old_price: Money }), "The updated product"),
    ...errorResponses,
  },
});
