import * as schema from "../schemas/catalog";
import { Money } from "../schemas/money";
import { body, errorResponses, json, registry, security, z } from "../registry";

registry.registerPath({
  method: "get",
  path: "/stores",
  operationId: "list_stores",
  summary: "List the stores",
  description:
    "Every open store with its address, opening hours (in the business's local time) and whether it is open right now. The owner also sees closed stores, with active false. Quote opening_hours as written. Use the id with other tools.",
  security: security.buyerOrSeller,
  responses: { 200: json(z.object({ stores: z.array(schema.Store) }), "The stores"), 401: errorResponses[401] },
});

registry.registerPath({
  method: "post",
  path: "/stores",
  operationId: "add_store",
  summary: "Add a store or branch (owner only)",
  description:
    "Creates a new store. Every product gets a stock line of 0 there; use update_product to add units. Turn hours like 'Mon to Sat, 9 to 7' into days and 24-hour times, and read them back to the owner before calling.",
  security: security.seller,
  request: { body: body(schema.AddStoreBody) },
  responses: { 201: json(schema.Store, "The new store"), ...errorResponses },
});

registry.registerPath({
  method: "patch",
  path: "/stores/{id}",
  operationId: "update_store",
  summary: "Change a store's name, address or hours, close or reopen it, or move its stock (owner only)",
  description:
    "Send only what changes, and at least one of name, address, location, hours, closed_days, active or move_stock_to. To close a store for good, send active false, usually with move_stock_to so its stock goes to another store; the store is kept and can be reopened with active true. The only open store can't be closed (last_store). The reply lists what moved (moved_stock), units still there (units_left) and unpaid orders holding items there (pending_orders); tell the owner about any of those. A day can't be in both hours and closed_days. hours updates just the days listed and leaves the rest alone; closed_days closes days. Turn 'Saturdays now 10 to 4' into 24-hour times, and read the change back to the owner before calling.",
  security: security.seller,
  request: { params: schema.StoreParams, body: body(schema.UpdateStoreBody) },
  responses: {
    200: json(
      z.object({
        store: schema.Store,
        previous: schema.Store,
        moved_stock: z.array(
          z.object({
            product: z.object({ id: z.string(), name: z.string(), variant: z.string().nullable() }),
            quantity: z.number().int(),
            to_store_id: z.string(),
          }),
        ),
        units_left: z.number().int().openapi({ description: "Free units still at this store after the change" }),
        pending_orders: z.array(z.string()).openapi({ description: "Unpaid orders still holding items at this store" }),
      }),
      "The store after the change, what it was before, and what happened to its stock",
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
  summary: "Add one or more new products (owner only)",
  description:
    "Adds products with their prices and starting stock per store. Put every product the owner mentions in one call; they are added together or not at all. Read them all back to the owner once and get a yes before calling. Use update_product for products that already exist.",
  security: security.seller,
  request: { body: body(schema.AddProductBody) },
  responses: { 201: json(z.object({ products: z.array(schema.Product) }), "The new products"), ...errorResponses },
});

const StockResult = z.object({
  store_id: z.string(),
  available: z.number().int(),
  held_for_unpaid_orders: z.number().int(),
  on_hand: z.number().int(),
});

registry.registerPath({
  method: "patch",
  path: "/products/{id}",
  operationId: "update_product",
  summary: "Change a product's price, details, sale status or stock (owner only)",
  description:
    "Send only what changes, in one call: price, min_price, name, variant, active, and stock changes for any number of stores. Everything applies together or nothing does. Price is the same at every store, and orders already waiting for payment keep their price. active: false takes a product off sale. Read the whole change back to the owner once and get a yes before calling.",
  security: security.seller,
  request: { params: schema.ProductParams, body: body(schema.UpdateProductBody) },
  responses: {
    200: json(
      z.object({
        product: schema.Product,
        previous: z.object({
          name: z.string(),
          variant: z.string().nullable(),
          price: Money,
          min_price: Money,
          active: z.boolean(),
        }),
        stock: z.array(StockResult).openapi({ description: "One entry per store in the request" }),
      }),
      "The product after the change, what it was before, and each store's stock",
    ),
    ...errorResponses,
  },
});
