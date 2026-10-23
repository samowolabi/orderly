import { geocodingProvider } from "../adapters";
import { GeocodingProviderUnavailable } from "../adapters/geocoding/geocoding-provider";
import { config } from "../config";
import { pool, withTransaction } from "../db/pool";
import { ApiError } from "../utils/http";
import { InvalidMoneyAmount, moneyView, toSubunits } from "../utils/money";
import { DAYS, hoursView, toRows, type HourRow, type HoursInputValue } from "../utils/store-hours";
import {
  addressSearchText,
  addressView,
  type AddressInputValue,
  type AddressPatchValue,
  type AddressRow,
  type CoordinatesInputValue,
  type ResolvedAddressValue,
} from "../utils/store-location";
import { expireStaleOrders, logEvent, type Db } from "./stock";

type ProductRow = {
  id: string;
  name: string;
  variant: string | null;

  price_subunit: number;
  min_price_subunit: number;
  currency: string;

  stores: {
    store_id: string;
    store_name: string;
    available: number;
  }[];
};

type StoreRow = {
  id: string;
  name: string;

  hours: HourRow[];
} & AddressRow;

type Role = "buyer" | "seller";

type AddStoreInput = {
  id?: string;
  name: string;

  address: AddressInputValue;
  location?: CoordinatesInputValue | null;

  hours: HoursInputValue;
};

type UpdateStoreInput = {
  name?: string;

  address?: AddressPatchValue;
  location?: CoordinatesInputValue | null;

  hours?: HoursInputValue;
  closed_days?: (typeof DAYS)[number][];
};

type AddProductInput = {
  id?: string;
  name: string;
  variant?: string;

  price: number;
  min_price?: number;

  stock: {
    store_id: string;
    quantity: number;
  }[];
};

type UpdateStockInput = {
  store_id: string;

  change?: number;
  set_to?: number;
};

type UpdatePriceInput = {
  price: number;
  min_price?: number;
};

// Loads active products and their store-level stock using optional filters.
async function findProducts(db: Db, filters: { productId?: string; storeId?: string; words?: string[] }) {
  const { rows } = await db.query<ProductRow>(
    `SELECT p.id, p.name, p.variant, p.price_subunit, p.min_price_subunit, p.currency,
            json_agg(json_build_object('store_id', s.id, 'store_name', s.name, 'available', st.available)
                     ORDER BY s.id) AS stores
     FROM products p
     JOIN stock st ON st.product_id = p.id
     JOIN stores s ON s.id = st.store_id AND s.active
     WHERE p.active
       AND ($1::text IS NULL OR st.store_id = $1)
       AND ($2::text[] IS NULL OR (
             SELECT bool_and((p.id || ' ' || p.name || ' ' || coalesce(p.variant, '')) ILIKE '%' || word || '%')
             FROM unnest($2::text[]) AS word))
       AND ($3::text IS NULL OR p.id = $3)
     GROUP BY p.id
     ORDER BY p.name, p.variant`,
    [filters.storeId ?? null, filters.words?.length ? filters.words : null, filters.productId ?? null],
  );
  return rows;
}

// Converts a product row into the role-appropriate API representation.
function productView(row: ProductRow, role: Role) {
  return {
    id: row.id,
    name: row.name,
    variant: row.variant,
    price: moneyView(row.price_subunit, row.currency),
    ...(role === "seller" ? { min_price: moneyView(row.min_price_subunit, row.currency) } : {}),
    stores: row.stores,
    total_available: row.stores.reduce(
      // Adds one store's available units to the product total.
      (total, store) => total + store.available,
      0,
    ),
  };
}

// Converts an owner-entered amount into subunits, reporting extra decimals as bad input.
function priceToSubunits(field: string, amount: number, currency: string) {
  try {
    return toSubunits(amount, currency);
  } catch (error) {
    if (error instanceof InvalidMoneyAmount) throw new ApiError(400, "invalid_input", `${field}: ${error.message}.`);
    throw error;
  }
}

// Loads one product or raises a consistent not-found error.
async function loadProduct(db: Db, id: string, role: Role) {
  const [row] = await findProducts(db, { productId: id });
  if (!row) throw new ApiError(404, "product_not_found", `No product with id ${id}.`);
  return productView(row, role);
}

// Ensures an active store exists before a dependent operation runs.
async function assertStore(db: Db, storeId: string) {
  const { rows } = await db.query("SELECT id FROM stores WHERE id = $1 AND active", [storeId]);
  if (!rows[0]) {
    throw new ApiError(404, "store_not_found", `No store with id ${storeId}. Call list_stores for the right id.`);
  }
}

// Loads active stores with structured addresses and opening hours.
async function findStores(db: Db, id?: string) {
  const { rows } = await db.query<StoreRow>(
    `SELECT s.id, s.name, s.address_line1, s.address_line2, s.area, s.city, s.state,
            s.country_code, s.postal_code, s.latitude, s.longitude, s.directions_note,
            coalesce(json_agg(json_build_object(
                       'weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
                     ORDER BY h.weekday) FILTER (WHERE h.store_id IS NOT NULL), '[]') AS hours
     FROM stores s
     LEFT JOIN store_hours h ON h.store_id = s.id
     WHERE s.active AND ($1::text IS NULL OR s.id = $1)
     GROUP BY s.id
     ORDER BY s.created_at, s.id`,
    [id ?? null],
  );
  const now = new Date();
  const { BUSINESS_COUNTRY: homeCountry, BUSINESS_TIMEZONE: timeZone } = config();
  // Converts one store row into its customer-facing location and hours view.
  return rows.map((store) => ({
    id: store.id,
    name: store.name,
    ...addressView(store, homeCountry),
    ...hoursView(store.hours, timeZone, now),
  }));
}

// Escapes SQL LIKE wildcard characters in product search words.
const escapeLike = (value: string) => value.replace(
  /[\\%_]/g,
  // Prefixes one wildcard character with a SQL escape slash.
  (character) => `\\${character}`,
);

// Escapes text so it matches literally inside a regular expression.
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Uses an explicit map pin or resolves the store address through the configured geocoder.
async function resolveStoreLocation(address: ResolvedAddressValue, location: CoordinatesInputValue | null | undefined) {
  if (location !== undefined) return location;

  try {
    return await geocodingProvider.geocodeAddress({
      address: addressSearchText(address),
      countryCode: address.country_code,
    });
  } catch (error) {
    if (error instanceof GeocodingProviderUnavailable) {
      throw new ApiError(
        502,
        "geocoding_unavailable",
        "The address could not be mapped right now. Retry, send location as null to continue without a pin, or provide latitude and longitude.",
      );
    }

    throw error;
  }
}

// Returns every active store with normalized location and hours data.
export async function listStores() {
  return { stores: await findStores(pool) };
}

// Creates a store, its hours and zeroed stock rows in one transaction.
export async function addStore(input: AddStoreInput) {
  const { BUSINESS_COUNTRY, BUSINESS_NAME } = config();
  // "Acme Yaba" becomes "yaba": the business name adds nothing to a store id.
  const businessPrefix = new RegExp(`^${escapeRegExp(BUSINESS_NAME.toLowerCase())}\\s*`);
  const id =
    input.id ??
    input.name
      .toLowerCase()
      .replace(businessPrefix, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  if (!id) throw new ApiError(400, "invalid_input", "Give the store a short id, e.g. yaba.");

  const address: ResolvedAddressValue = { ...input.address, country_code: input.address.country_code ?? BUSINESS_COUNTRY };
  const location = await resolveStoreLocation(address, input.location);

  // Persists the store and all dependent rows atomically.
  return withTransaction(async (db) => {
    const { rowCount } = await db.query(
      `INSERT INTO stores (
         id, name, address_line1, address_line2, area, city, state, country_code,
         postal_code, latitude, longitude, directions_note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        input.name,
        address.line1,
        address.line2 ?? null,
        address.area,
        address.city,
        address.state,
        address.country_code,
        address.postal_code ?? null,
        location?.latitude ?? null,
        location?.longitude ?? null,
        address.directions_note ?? null,
      ],
    );
    if (!rowCount) {
      throw new ApiError(409, "store_exists", `A store with id ${id} already exists. Pick another id, or call list_stores.`);
    }

    await db.query("INSERT INTO stock (product_id, store_id, available) SELECT id, $1, 0 FROM products", [id]);
    for (const hours of toRows(input.hours)) {
      await db.query("INSERT INTO store_hours (store_id, weekday, opens, closes) VALUES ($1, $2, $3, $4)", [
        id,
        hours.weekday,
        hours.opens,
        hours.closes,
      ]);
    }
    await logEvent(db, null, "store_added", { store_id: id });
    return (await findStores(db, id))[0]!;
  });
}

// Applies a partial store update while preserving unchanged fields and days.
export async function updateStore(id: string, input: UpdateStoreInput) {
  // Locks and updates the store atomically.
  return withTransaction(async (db) => {
    const locked = await db.query("SELECT id FROM stores WHERE id = $1 AND active FOR UPDATE", [id]);
    if (!locked.rows[0]) throw new ApiError(404, "store_not_found", `No store ${id}. Call list_stores for the right id.`);
    const before = (await findStores(db, id))[0]!;

    if (input.name !== undefined) await db.query("UPDATE stores SET name = $2 WHERE id = $1", [id, input.name]);
    if (input.address) {
      const columns: Record<string, string | null | undefined> = {
        address_line1: input.address.line1,
        address_line2: input.address.line2,
        area: input.address.area,
        city: input.address.city,
        state: input.address.state,
        country_code: input.address.country_code,
        postal_code: input.address.postal_code,
        directions_note: input.address.directions_note,
      };
      // Keeps only address properties included in the patch.
      const updates = Object.entries(columns).filter((entry) => entry[1] !== undefined);
      // Converts one address update into its parameter value.
      const values: (string | null)[] = [id, ...updates.map((entry) => entry[1] ?? null)];
      // Converts one address column into its parameterized SQL assignment.
      const set = updates.map(([column], index) => `${column} = $${index + 2}`).join(", ");
      await db.query(`UPDATE stores SET ${set} WHERE id = $1`, values);
    }
    if (input.location !== undefined) {
      await db.query("UPDATE stores SET latitude = $2, longitude = $3 WHERE id = $1", [
        id,
        input.location?.latitude ?? null,
        input.location?.longitude ?? null,
      ]);
    }
    for (const hours of input.hours ? toRows(input.hours) : []) {
      await db.query(
        `INSERT INTO store_hours (store_id, weekday, opens, closes) VALUES ($1, $2, $3, $4)
         ON CONFLICT (store_id, weekday) DO UPDATE SET opens = excluded.opens, closes = excluded.closes`,
        [id, hours.weekday, hours.opens, hours.closes],
      );
    }
    if (input.closed_days) {
      await db.query("DELETE FROM store_hours WHERE store_id = $1 AND weekday = ANY($2::smallint[])", [
        id,
        // Converts one short weekday name into its ISO weekday number.
        input.closed_days.map((day) => DAYS.indexOf(day) + 1),
      ]);
    }

    const after = (await findStores(db, id))[0]!;
    await logEvent(db, null, "store_updated", {
      store_id: id,
      from: { name: before.name, address: before.address_details, location: before.location, hours: before.hours },
      to: { name: after.name, address: after.address_details, location: after.location, hours: after.hours },
    });
    return { store: after, previous: before };
  });
}

// Searches active products after expiring stale stock holds.
export async function listProducts(filters: { product_id?: string; store_id?: string; q?: string }, role: Role) {
  await expireStaleOrders(pool);
  if (filters.store_id) await assertStore(pool, filters.store_id);
  const words = filters.q?.trim().split(/\s+/).filter(Boolean).map(escapeLike);
  const rows = await findProducts(pool, { storeId: filters.store_id, words, productId: filters.product_id });
  // Converts one product row into the caller's permitted view.
  return { products: rows.map((row) => productView(row, role)) };
}

// Creates a product and its per-store stock rows atomically.
export async function addProduct(input: AddProductInput) {
  const id =
    input.id ??
    `${input.name} ${input.variant ?? ""}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  // Persists the product and all stock rows in one transaction.
  return withTransaction(async (db) => {
    const duplicate = await db.query(
      `SELECT id FROM products
       WHERE id = $1 OR (lower(name) = lower($2) AND lower(coalesce(variant, '')) = lower($3))`,
      [id, input.name, input.variant ?? ""],
    );
    if (duplicate.rows[0]) {
      throw new ApiError(
        409,
        "product_exists",
        `This product already exists as ${duplicate.rows[0].id}. Use update_stock to add units or update_price to change the price.`,
      );
    }

    // Extracts each known store id for stock validation and insertion.
    const stores = (await db.query<{ id: string }>("SELECT id FROM stores")).rows.map((row) => row.id);
    // Extracts one requested stock row's store id.
    const requestedStores = input.stock.map((stock) => stock.store_id);
    // Keeps requested store ids that are absent from the database.
    const unknown = requestedStores.filter((storeId) => !stores.includes(storeId));
    if (unknown.length) {
      throw new ApiError(404, "store_not_found", `Unknown store: ${unknown.join(", ")}. Call list_stores for the right ids.`);
    }

    // New products are priced in the business currency; the owner never picks one.
    const currency = config().BUSINESS_CURRENCY;
    const price = priceToSubunits("price", input.price, currency);
    const floor = input.min_price === undefined ? price : priceToSubunits("min_price", input.min_price, currency);
    await db.query(
      `INSERT INTO products (id, name, variant, price_subunit, min_price_subunit, currency)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.name, input.variant ?? null, price, floor, currency],
    );
    // Converts each requested stock row into a store-to-quantity entry.
    const units = new Map(input.stock.map((stock) => [stock.store_id, stock.quantity]));
    for (const storeId of stores) {
      await db.query("INSERT INTO stock (product_id, store_id, available) VALUES ($1, $2, $3)", [
        id,
        storeId,
        units.get(storeId) ?? 0,
      ]);
    }
    await logEvent(db, null, "product_added", { product_id: id, price_subunit: price, currency, stock: Object.fromEntries(units) });
    return loadProduct(db, id, "seller");
  });
}

// Adjusts available stock without counting units held by unpaid orders.
export async function updateStock(id: string, input: UpdateStockInput) {
  await expireStaleOrders(pool);

  // Locks the stock row while calculating and applying its new value.
  const result = await withTransaction(async (db) => {
    await assertStore(db, input.store_id);
    const { rows } = await db.query<{ available: number; held: number }>(
      `SELECT st.available,
              coalesce((SELECT sum(quantity) FROM orders o
                        WHERE o.product_id = st.product_id AND o.store_id = st.store_id
                          AND o.status = 'pending_payment'), 0)::int AS held
       FROM stock st WHERE st.product_id = $1 AND st.store_id = $2
       FOR UPDATE`,
      [id, input.store_id],
    );
    const current = rows[0];
    if (!current) throw new ApiError(404, "product_not_found", `No product with id ${id}. Call list_products for the right id.`);

    const next = input.set_to !== undefined ? input.set_to - current.held : current.available + (input.change ?? 0);
    if (next < 0) {
      const why =
        input.set_to !== undefined
          ? `${current.held} unit(s) are held for unpaid orders, so on hand can't be set below ${current.held}.`
          : `Only ${current.available} unit(s) are free at this store, so ${-(input.change ?? 0)} can't be removed.`;
      throw new ApiError(409, "stock_below_zero", `${why} Tell the owner and ask what they want to do.`);
    }

    await db.query("UPDATE stock SET available = $3, updated_at = now() WHERE product_id = $1 AND store_id = $2", [
      id,
      input.store_id,
      next,
    ]);
    await logEvent(db, null, "stock_updated", { product_id: id, store_id: input.store_id, from: current.available, to: next });
    return { available: next, held: current.held, product: await loadProduct(db, id, "seller") };
  });

  return {
    product: result.product,
    store_id: input.store_id,
    available: result.available,
    held_for_unpaid_orders: result.held,
    on_hand: result.available + result.held,
  };
}

// Changes a product price while keeping its discount floor valid.
export async function updatePrice(id: string, input: UpdatePriceInput) {
  // Locks the product while updating its price and discount floor.
  const result = await withTransaction(async (db) => {
    const { rows } = await db.query<{ price_subunit: number; min_price_subunit: number; currency: string }>(
      "SELECT price_subunit, min_price_subunit, currency FROM products WHERE id = $1 AND active FOR UPDATE",
      [id],
    );
    const old = rows[0];
    if (!old) throw new ApiError(404, "product_not_found", `No product with id ${id}. Call list_products for the right id.`);

    // The new price is in the product's own currency, whatever the business default is now.
    const price = priceToSubunits("price", input.price, old.currency);
    const requestedFloor = input.min_price === undefined ? old.min_price_subunit : priceToSubunits("min_price", input.min_price, old.currency);
    const floor = Math.min(requestedFloor, price);
    await db.query("UPDATE products SET price_subunit = $2, min_price_subunit = $3, updated_at = now() WHERE id = $1", [
      id,
      price,
      floor,
    ]);
    await logEvent(db, null, "price_updated", {
      product_id: id,
      currency: old.currency,
      from: old.price_subunit,
      to: price,
      min_price_subunit: floor,
    });
    return { old, product: await loadProduct(db, id, "seller") };
  });

  return { product: result.product, old_price: moneyView(result.old.price_subunit, result.old.currency) };
}
