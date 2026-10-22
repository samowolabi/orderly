import { Router } from "express";
import { pool, withTransaction } from "../db/pool";
import { requireRole, type Role } from "../http/auth";
import { ApiError, formatNaira, ok, toKobo, toNaira } from "../http/respond";
import { parse } from "../http/validate";
import { apiKey, body, errorResponses, json, registry, z } from "../openapi/registry";
import { expireStaleOrders, logEvent, type Db } from "../orders/stock";

export const catalog = Router();
const security = [{ [apiKey.name]: [] }];

// ---------- Schemas ----------

const Naira = z.number().positive().max(100_000_000);

const Store = z
  .object({
    id: z.string().openapi({ example: "ikeja" }),
    name: z.string().openapi({ example: "Kola Gadgets Ikeja" }),
    address: z.string(),
    opening_hours: z.string(),
  })
  .openapi("Store");

const StoreStock = z.object({
  store_id: z.string(),
  store_name: z.string(),
  available: z.number().int().openapi({ description: "Units free to sell now (held units already taken off)" }),
});

const Product = z
  .object({
    id: z.string().openapi({ example: "IP13-128" }),
    name: z.string().openapi({ example: "iPhone 13" }),
    variant: z.string().nullable().openapi({ example: "128GB" }),
    price_naira: z.number().openapi({ example: 650000 }),
    price_display: z.string().openapi({ example: "₦650,000" }),
    min_price_naira: z.number().optional().openapi({ description: "Lowest discounted price allowed. Owner only; never shown to customers." }),
    stores: z.array(StoreStock),
    total_available: z.number().int(),
  })
  .openapi("Product");

const StoreId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, numbers and dashes");

const AddStoreBody = z.object({
  id: StoreId.optional().openapi({ description: "Short id, e.g. yaba. Made from the name if left out.", example: "yaba" }),
  name: z.string().trim().min(2).max(80).openapi({ example: "Kola Gadgets Yaba" }),
  address: z.string().trim().min(5).max(200).openapi({ example: "3 Herbert Macaulay Way, Yaba, Lagos" }),
  opening_hours: z.string().trim().min(3).max(120).openapi({ example: "Mon to Sat, 9am to 7pm" }),
});

const ListProductsQuery = z.object({
  store_id: z.string().optional().openapi({ description: "Only show stock at this store" }),
  q: z.string().max(80).optional().openapi({ description: "Search words, e.g. 'iphone 13'. Every word must match.", example: "iphone 13" }),
  product_id: z.string().optional(),
});

const AddProductBody = z
  .object({
    id: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]*$/).max(40).optional()
      .openapi({ description: "Product code, e.g. IP16-256. Made from name and variant if left out." }),
    name: z.string().trim().min(2).max(80).openapi({ example: "iPhone 16" }),
    variant: z.string().trim().max(60).optional().openapi({ example: "256GB" }),
    price_naira: Naira.openapi({ example: 1150000 }),
    min_price_naira: Naira.optional().openapi({ description: "Discount floor. Defaults to the price (no discounts)." }),
    stock: z
      .array(z.object({ store_id: z.string(), quantity: z.number().int().min(0).max(10_000) }))
      .default([])
      .openapi({ description: "Starting units per store. Stores left out start at 0." }),
  })
  .refine((b) => b.min_price_naira === undefined || b.min_price_naira <= b.price_naira, {
    message: "min_price_naira can't be above price_naira",
    path: ["min_price_naira"],
  });

const UpdateStockBody = z
  .object({
    store_id: z.string().openapi({ example: "lekki" }),
    change: z.number().int().min(-10_000).max(10_000).optional()
      .openapi({ description: "Add (positive) or remove (negative) units, e.g. 3 for 'add 3 more'", example: 3 }),
    set_to: z.number().int().min(0).max(10_000).optional()
      .openapi({ description: "Units physically on hand after a count, including ones held for unpaid orders" }),
  })
  .refine((b) => (b.change === undefined) !== (b.set_to === undefined), {
    message: "send exactly one of change or set_to",
  });

const UpdatePriceBody = z.object({
  price_naira: Naira.openapi({ example: 630000 }),
  min_price_naira: Naira.optional().openapi({ description: "New discount floor. Lowered to the price if it would be above it." }),
});

const ProductParams = z.object({ id: z.string().openapi({ example: "IP13-128" }) });

// ---------- Queries ----------

type ProductRow = {
  id: string;
  name: string;
  variant: string | null;
  price_kobo: number;
  min_price_kobo: number;
  stores: { store_id: string; store_name: string; available: number }[];
};

async function findProducts(db: Db, f: { storeId?: string; words?: string[]; productId?: string }) {
  const { rows } = await db.query<ProductRow>(
    `SELECT p.id, p.name, p.variant, p.price_kobo, p.min_price_kobo,
            json_agg(json_build_object('store_id', s.id, 'store_name', s.name, 'available', st.available)
                     ORDER BY s.id) AS stores
     FROM products p
     JOIN stock st ON st.product_id = p.id
     JOIN stores s ON s.id = st.store_id AND s.active
     WHERE p.active
       AND ($1::text IS NULL OR st.store_id = $1)
       AND ($2::text[] IS NULL OR (
             SELECT bool_and((p.id || ' ' || p.name || ' ' || coalesce(p.variant, '')) ILIKE '%' || w || '%')
             FROM unnest($2::text[]) AS w))
       AND ($3::text IS NULL OR p.id = $3)
     GROUP BY p.id
     ORDER BY p.name, p.variant`,
    [f.storeId ?? null, f.words?.length ? f.words : null, f.productId ?? null],
  );
  return rows;
}

function productView(r: ProductRow, role: Role) {
  return {
    id: r.id,
    name: r.name,
    variant: r.variant,
    price_naira: toNaira(r.price_kobo),
    price_display: formatNaira(r.price_kobo),
    ...(role === "seller" ? { min_price_naira: toNaira(r.min_price_kobo) } : {}),
    stores: r.stores,
    total_available: r.stores.reduce((n, s) => n + s.available, 0),
  };
}

async function loadProduct(db: Db, id: string, role: Role) {
  const [row] = await findProducts(db, { productId: id });
  if (!row) throw new ApiError(404, "product_not_found", `No product with id ${id}.`);
  return productView(row, role);
}

async function assertStore(db: Db, storeId: string) {
  const { rows } = await db.query("SELECT id FROM stores WHERE id = $1 AND active", [storeId]);
  if (!rows[0]) {
    throw new ApiError(404, "store_not_found", `No store with id ${storeId}. Call list_stores for the right id.`);
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------- list_stores ----------

registry.registerPath({
  method: "get",
  path: "/stores",
  operationId: "list_stores",
  summary: "List the stores",
  description: "Every open Kola Gadgets store with its address and opening hours. Use the id with other tools.",
  security,
  responses: { 200: json(z.object({ stores: z.array(Store) }), "The stores"), 401: errorResponses[401] },
});

catalog.get("/stores", requireRole("buyer", "seller"), async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, address, opening_hours FROM stores WHERE active ORDER BY created_at, id",
  );
  ok(res, { stores: rows });
});

// ---------- add_store ----------

registry.registerPath({
  method: "post",
  path: "/stores",
  operationId: "add_store",
  summary: "Add a store or branch (owner only)",
  description:
    "Creates a new store. Every product gets a stock line of 0 there; use update_stock to add units. Confirm name, address and hours with the owner first.",
  security,
  request: { body: body(AddStoreBody) },
  responses: { 201: json(Store, "The new store"), ...errorResponses },
});

catalog.post("/stores", requireRole("seller"), async (req, res) => {
  const b = parse(AddStoreBody, req.body);
  const id =
    b.id ??
    b.name
      .toLowerCase()
      .replace(/^kola gadgets\s*/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  if (!id) throw new ApiError(400, "invalid_input", "Give the store a short id, e.g. yaba.");

  const store = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO stores (id, name, address, opening_hours) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, name, address, opening_hours`,
      [id, b.name, b.address, b.opening_hours],
    );
    if (!rows[0]) {
      throw new ApiError(409, "store_exists", `A store with id ${id} already exists. Pick another id, or call list_stores.`);
    }
    await db.query(
      "INSERT INTO stock (product_id, store_id, available) SELECT id, $1, 0 FROM products",
      [id],
    );
    await logEvent(db, null, "store_added", { store_id: id });
    return rows[0];
  });
  ok(res, store, 201);
});

// ---------- list_products ----------

registry.registerPath({
  method: "get",
  path: "/products",
  operationId: "list_products",
  summary: "Look up products, prices and stock",
  description:
    "Live prices and units available at each store. Always call this before quoting a price or saying something is in stock; never guess. Search with q, or narrow to one store with store_id.",
  security,
  request: { query: ListProductsQuery },
  responses: { 200: json(z.object({ products: z.array(Product) }), "Matching products"), ...errorResponses },
});

catalog.get("/products", requireRole("buyer", "seller"), async (req, res) => {
  const q = parse(ListProductsQuery, req.query);
  await expireStaleOrders(pool);
  if (q.store_id) await assertStore(pool, q.store_id);
  const words = q.q?.trim().split(/\s+/).filter(Boolean).map(escapeLike);
  const rows = await findProducts(pool, { storeId: q.store_id, words, productId: q.product_id });
  ok(res, { products: rows.map((r) => productView(r, res.locals.role)) });
});

// ---------- add_product ----------

registry.registerPath({
  method: "post",
  path: "/products",
  operationId: "add_product",
  summary: "Add a new product (owner only)",
  description:
    "Adds a product with its price and starting stock per store. Read the details back to the owner and get a yes before calling. Use update_stock for products that already exist.",
  security,
  request: { body: body(AddProductBody) },
  responses: { 201: json(Product, "The new product"), ...errorResponses },
});

catalog.post("/products", requireRole("seller"), async (req, res) => {
  const b = parse(AddProductBody, req.body);
  const id =
    b.id ??
    `${b.name} ${b.variant ?? ""}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  const product = await withTransaction(async (db) => {
    const dup = await db.query(
      `SELECT id FROM products
       WHERE id = $1 OR (lower(name) = lower($2) AND lower(coalesce(variant, '')) = lower($3))`,
      [id, b.name, b.variant ?? ""],
    );
    if (dup.rows[0]) {
      throw new ApiError(
        409,
        "product_exists",
        `This product already exists as ${dup.rows[0].id}. Use update_stock to add units or update_price to change the price.`,
      );
    }

    const stores = (await db.query<{ id: string }>("SELECT id FROM stores")).rows.map((r) => r.id);
    const unknown = b.stock.map((s) => s.store_id).filter((s) => !stores.includes(s));
    if (unknown.length) {
      throw new ApiError(404, "store_not_found", `Unknown store: ${unknown.join(", ")}. Call list_stores for the right ids.`);
    }

    const price = toKobo(b.price_naira);
    await db.query(
      "INSERT INTO products (id, name, variant, price_kobo, min_price_kobo) VALUES ($1, $2, $3, $4, $5)",
      [id, b.name, b.variant ?? null, price, b.min_price_naira === undefined ? price : toKobo(b.min_price_naira)],
    );
    const units = new Map(b.stock.map((s) => [s.store_id, s.quantity]));
    for (const store of stores) {
      await db.query("INSERT INTO stock (product_id, store_id, available) VALUES ($1, $2, $3)", [
        id,
        store,
        units.get(store) ?? 0,
      ]);
    }
    await logEvent(db, null, "product_added", { product_id: id, price_kobo: price, stock: Object.fromEntries(units) });
    return loadProduct(db, id, "seller");
  });
  ok(res, product, 201);
});

// ---------- update_stock ----------

registry.registerPath({
  method: "post",
  path: "/products/{id}/stock",
  operationId: "update_stock",
  summary: "Change stock at one store (owner only)",
  description:
    "Use change to add or remove units ('add 3 more to Lekki' is change: 3), or set_to after a physical count. Units held for unpaid orders are counted as on hand.",
  security,
  request: { params: ProductParams, body: body(UpdateStockBody) },
  responses: {
    200: json(
      z.object({
        product: Product,
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

catalog.post("/products/:id/stock", requireRole("seller"), async (req, res) => {
  const { id } = parse(ProductParams, req.params);
  const b = parse(UpdateStockBody, req.body);
  await expireStaleOrders(pool);

  const result = await withTransaction(async (db) => {
    await assertStore(db, b.store_id);
    const { rows } = await db.query<{ available: number; held: number }>(
      `SELECT st.available,
              coalesce((SELECT sum(quantity) FROM orders o
                        WHERE o.product_id = st.product_id AND o.store_id = st.store_id
                          AND o.status = 'pending_payment'), 0)::int AS held
       FROM stock st WHERE st.product_id = $1 AND st.store_id = $2
       FOR UPDATE`,
      [id, b.store_id],
    );
    const current = rows[0];
    if (!current) throw new ApiError(404, "product_not_found", `No product with id ${id}. Call list_products for the right id.`);

    const next = b.set_to !== undefined ? b.set_to - current.held : current.available + (b.change ?? 0);
    if (next < 0) {
      const why =
        b.set_to !== undefined
          ? `${current.held} unit(s) are held for unpaid orders, so on hand can't be set below ${current.held}.`
          : `Only ${current.available} unit(s) are free at this store, so ${-(b.change ?? 0)} can't be removed.`;
      throw new ApiError(409, "stock_below_zero", `${why} Tell the owner and ask what they want to do.`);
    }
    await db.query(
      "UPDATE stock SET available = $3, updated_at = now() WHERE product_id = $1 AND store_id = $2",
      [id, b.store_id, next],
    );
    await logEvent(db, null, "stock_updated", { product_id: id, store_id: b.store_id, from: current.available, to: next });
    return { available: next, held: current.held, product: await loadProduct(db, id, "seller") };
  });

  ok(res, {
    product: result.product,
    store_id: b.store_id,
    available: result.available,
    held_for_unpaid_orders: result.held,
    on_hand: result.available + result.held,
  });
});

// ---------- update_price ----------

registry.registerPath({
  method: "patch",
  path: "/products/{id}",
  operationId: "update_price",
  summary: "Change a product's price (owner only)",
  description:
    "Sets one price for every store. Orders already waiting for payment keep the price they were created with. Confirm the new price with the owner first.",
  security,
  request: { params: ProductParams, body: body(UpdatePriceBody) },
  responses: { 200: json(z.object({ product: Product, old_price_naira: z.number() }), "The updated product"), ...errorResponses },
});

catalog.patch("/products/:id", requireRole("seller"), async (req, res) => {
  const { id } = parse(ProductParams, req.params);
  const b = parse(UpdatePriceBody, req.body);
  const price = toKobo(b.price_naira);

  const result = await withTransaction(async (db) => {
    const { rows } = await db.query<{ price_kobo: number; min_price_kobo: number }>(
      "SELECT price_kobo, min_price_kobo FROM products WHERE id = $1 AND active FOR UPDATE",
      [id],
    );
    const old = rows[0];
    if (!old) throw new ApiError(404, "product_not_found", `No product with id ${id}. Call list_products for the right id.`);
    const floor = Math.min(b.min_price_naira === undefined ? old.min_price_kobo : toKobo(b.min_price_naira), price);
    await db.query(
      "UPDATE products SET price_kobo = $2, min_price_kobo = $3, updated_at = now() WHERE id = $1",
      [id, price, floor],
    );
    await logEvent(db, null, "price_updated", { product_id: id, from: old.price_kobo, to: price, min_price_kobo: floor });
    return { old: old.price_kobo, product: await loadProduct(db, id, "seller") };
  });
  ok(res, { product: result.product, old_price_naira: toNaira(result.old) });
});
