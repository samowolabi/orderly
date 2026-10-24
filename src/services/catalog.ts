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
import { counterOffers } from "./pricing";
import { expireStaleOrders, logEvent, type Db } from "./stock";

type ProductRow = {
  id: string;
  name: string;
  variant: string | null;

  price_subunit: number;
  min_price_subunit: number;
  currency: string;

  active: boolean;

  stores: {
    store_id: string;
    store_name: string;
    available: number;
    open: boolean;
    held: number;
  }[];
};

type StoreRow = {
  id: string;
  name: string;
  active: boolean;

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

  active?: boolean;
  move_stock_to?: string;
};

type NewProductInput = {
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

type StockChangeInput = {
  store_id: string;

  change?: number;
  set_to?: number;
};

type UpdateProductInput = {
  name?: string;
  variant?: string | null;

  price?: number;
  min_price?: number;

  active?: boolean;

  stock?: StockChangeInput[];
};

// Loads products and their store-level stock; off-sale products only when asked for.
async function findProducts(
  db: Db,
  filters: { productId?: string; storeId?: string; words?: string[]; includeInactive?: boolean; includeClosedStores?: boolean },
) {
  const { rows } = await db.query<ProductRow>(
    `SELECT p.id, p.name, p.variant, p.price_subunit, p.min_price_subunit, p.currency, p.active,
            json_agg(json_build_object(
                       'store_id', s.id, 'store_name', s.name, 'available', st.available, 'open', s.active,
                       'held', (SELECT coalesce(sum(i.quantity), 0)::int FROM order_items i JOIN orders o ON o.id = i.order_id
                                WHERE i.product_id = p.id AND i.store_id = s.id AND o.status = 'pending_payment'))
                     ORDER BY s.active DESC, s.id) AS stores
     FROM products p
     JOIN stock st ON st.product_id = p.id
     JOIN stores s ON s.id = st.store_id AND (s.active OR $5)
     WHERE ($4::boolean OR p.active)
       AND ($1::text IS NULL OR st.store_id = $1)
       AND ($2::text[] IS NULL OR (
             SELECT bool_and((p.id || ' ' || p.name || ' ' || coalesce(p.variant, '')) ILIKE '%' || word || '%')
             FROM unnest($2::text[]) AS word))
       AND ($3::text IS NULL OR p.id = $3)
     GROUP BY p.id
     ORDER BY p.name, p.variant`,
    [
      filters.storeId ?? null,
      filters.words?.length ? filters.words : null,
      filters.productId ?? null,
      filters.includeInactive ?? false,
      filters.includeClosedStores ?? false,
    ],
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
    counter_offers: haggleView(row),
    ...(role === "seller" ? { min_price: moneyView(row.min_price_subunit, row.currency), active: row.active } : {}),
    // The owner also sees closed stores and units held for unpaid orders; customers see open stores only.
    stores: row.stores.map((store) =>
      role === "seller"
        ? store
        : { store_id: store.store_id, store_name: store.store_name, available: store.available },
    ),
    total_available: row.stores.reduce(
      // Adds one open store's available units to the product total.
      (total, store) => (store.open ? total + store.available : total),
      0,
    ),
  };
}

// The counter-offers for a product as money, or null when there's no room to haggle.
function haggleView(row: ProductRow) {
  const offers = counterOffers(row.price_subunit, row.min_price_subunit, row.currency);
  return offers && { first: moneyView(offers.first, row.currency), final: moneyView(offers.final, row.currency) };
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

// Loads one product or raises a consistent not-found error; owners also see off-sale products.
async function loadProduct(db: Db, id: string, role: Role) {
  const [row] = await findProducts(db, { productId: id, includeInactive: role === "seller" });
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

// Loads open stores (and closed ones too, for the owner) with structured addresses and opening hours.
async function findStores(db: Db, id?: string, includeClosed = false) {
  const { rows } = await db.query<StoreRow>(
    `SELECT s.id, s.name, s.active, s.address_line1, s.address_line2, s.area, s.city, s.state,
            s.country_code, s.postal_code, s.latitude, s.longitude, s.directions_note,
            coalesce(json_agg(json_build_object(
                       'weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
                     ORDER BY h.weekday) FILTER (WHERE h.store_id IS NOT NULL), '[]') AS hours
     FROM stores s
     LEFT JOIN store_hours h ON h.store_id = s.id
     WHERE (s.active OR $2) AND ($1::text IS NULL OR s.id = $1)
     GROUP BY s.id
     ORDER BY s.active DESC, s.created_at, s.id`,
    [id ?? null, includeClosed],
  );
  const now = new Date();
  const { BUSINESS_COUNTRY: homeCountry, BUSINESS_TIMEZONE: timeZone } = config();
  // Converts one store row into its customer-facing location and hours view.
  return rows.map((store) => ({
    id: store.id,
    name: store.name,
    active: store.active,
    ...addressView(store, homeCountry),
    ...hoursView(store.hours, timeZone, now),
    // A closed store is never open, whatever its hours say.
    ...(store.active ? {} : { open_now: false }),
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
    return await geocodingProvider().geocodeAddress({
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

// Applies an address patch over a store's current address, for geocoding the result.
function patchedAddress(current: ReturnType<typeof addressView>["address_details"], patch: AddressPatchValue): ResolvedAddressValue {
  // Picks the patched value when one was sent (null clears it), otherwise the current one.
  const pick = (next: string | null | undefined, now: string | null) => (next === undefined ? now : next) ?? undefined;
  return {
    line1: patch.line1 ?? current.line1,
    line2: pick(patch.line2, current.line2),
    area: patch.area ?? current.area,
    city: patch.city ?? current.city,
    state: patch.state ?? current.state,
    country_code: patch.country_code ?? current.country_code,
    postal_code: pick(patch.postal_code, current.postal_code),
    directions_note: pick(patch.directions_note, current.directions_note),
  };
}

// Returns every active store with normalized location and hours data.
export async function listStores(role: Role) {
  return { stores: await findStores(pool, undefined, role === "seller") };
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
      throw new ApiError(409, "store_exists", `A store with id ${id} already exists (it may be closed; list_stores shows closed stores to the owner). Reopen it with update_store active true, or pick another id.`);
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
    const locked = await db.query<{ active: boolean }>("SELECT active FROM stores WHERE id = $1 FOR UPDATE", [id]);
    if (!locked.rows[0]) throw new ApiError(404, "store_not_found", `No store ${id}. Call list_stores for the right id.`);
    const before = (await findStores(db, id, true))[0]!;
    const closing = input.active === false && locked.rows[0].active;
    if (closing) {
      const { rows } = await db.query("SELECT 1 FROM stores WHERE active AND id <> $1 FOR UPDATE", [id]);
      if (!rows.length) {
        throw new ApiError(
          409,
          "last_store",
          `${before.name} is the only open store, so closing it would stop all sales. Nothing was changed. To pause for a while, close it on certain days (closed_days), or take products off sale.`,
        );
      }
    }
    const moved = input.move_stock_to ? await moveAllStock(db, id, input.move_stock_to) : [];

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
    // A new address gets a new pin unless one was sent; keeping the old pin would point at the old place.
    const location =
      input.location !== undefined
        ? input.location
        : input.address
          ? await resolveStoreLocation(patchedAddress(before.address_details, input.address), undefined)
          : undefined;
    if (location !== undefined) {
      await db.query("UPDATE stores SET latitude = $2, longitude = $3 WHERE id = $1", [
        id,
        location?.latitude ?? null,
        location?.longitude ?? null,
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

    if (input.active !== undefined) await db.query("UPDATE stores SET active = $2 WHERE id = $1", [id, input.active]);

    const after = (await findStores(db, id, true))[0]!;
    // Units still at the store, and unpaid orders holding items there, so the owner can deal with them.
    const { rows: left } = await db.query<{ units: number }>("SELECT coalesce(sum(available), 0)::int AS units FROM stock WHERE store_id = $1", [id]);
    const { rows: pending } = await db.query<{ id: string }>(
      `SELECT DISTINCT o.id FROM orders o JOIN order_items i ON i.order_id = o.id
       WHERE i.store_id = $1 AND o.status = 'pending_payment' ORDER BY o.id`,
      [id],
    );
    await logEvent(db, null, "store_updated", {
      store_id: id,
      from: { name: before.name, address: before.address_details, location: before.location, hours: before.hours, active: before.active },
      to: { name: after.name, address: after.address_details, location: after.location, hours: after.hours, active: after.active },
      moved,
    });
    return {
      store: after,
      previous: before,
      moved_stock: moved,
      units_left: left[0]!.units,
      pending_orders: pending.map((row) => row.id),
    };
  });
}

// Moves every free unit at one store to another, product by product. Units held for
// unpaid orders stay, so those orders can still be paid for.
async function moveAllStock(db: Db, fromId: string, toId: string) {
  if (toId === fromId) throw new ApiError(400, "invalid_input", "move_stock_to must be a different store. Nothing was changed.");
  await assertStore(db, toId);
  const { rows } = await db.query<{ product_id: string; name: string; variant: string | null; quantity: number }>(
    `WITH source AS (
       SELECT product_id, available FROM stock WHERE store_id = $1 AND available > 0 FOR UPDATE
     ), added AS (
       UPDATE stock st SET available = st.available + source.available, updated_at = now()
       FROM source WHERE st.store_id = $2 AND st.product_id = source.product_id
     ), emptied AS (
       UPDATE stock st SET available = 0, updated_at = now()
       FROM source WHERE st.store_id = $1 AND st.product_id = source.product_id
     )
     SELECT source.product_id, p.name, p.variant, source.available AS quantity
     FROM source JOIN products p ON p.id = source.product_id
     ORDER BY p.name`,
    [fromId, toId],
  );
  return rows.map((row) => ({
    product: { id: row.product_id, name: row.name, variant: row.variant },
    quantity: row.quantity,
    to_store_id: toId,
  }));
}

// Searches active products after expiring stale stock holds.
export async function listProducts(filters: { product_id?: string; store_id?: string; q?: string }, role: Role) {
  await expireStaleOrders(pool);
  const owner = role === "seller";
  // The owner can look at a closed store's stock too; customers only at open stores.
  if (filters.store_id) {
    const { rows } = await pool.query("SELECT 1 FROM stores WHERE id = $1 AND (active OR $2)", [filters.store_id, owner]);
    if (!rows[0]) throw new ApiError(404, "store_not_found", `No store with id ${filters.store_id}. Call list_stores for the right id.`);
  }
  const words = filters.q?.trim().split(/\s+/).filter(Boolean).map(escapeLike);
  const rows = await findProducts(pool, {
    storeId: filters.store_id,
    words,
    productId: filters.product_id,
    includeInactive: owner,
    includeClosedStores: owner,
  });
  // Converts one product row into the caller's permitted view.
  return { products: rows.map((row) => productView(row, role)) };
}

// Builds a product code from its name and variant, e.g. "IPHONE-16-256GB".
const productCode = (name: string, variant?: string | null) =>
  `${name} ${variant ?? ""}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Matches products case-insensitively by name and variant.
const sameProductKey = (name: string, variant?: string | null) => `${name.toLowerCase()}|${(variant ?? "").toLowerCase()}`;

// Creates one or more products and their per-store stock rows, all or none.
export async function addProducts(products: NewProductInput[]) {
  // 1. Give every product its code, and reject repeats within the request.
  const planned = products.map((product) => ({ ...product, id: product.id ?? productCode(product.name, product.variant) }));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const product of planned) {
    const key = sameProductKey(product.name, product.variant);
    if (seenIds.has(product.id) || seenKeys.has(key)) {
      throw new ApiError(400, "invalid_input", `${product.id} appears more than once in this request. Send each product once.`);
    }
    seenIds.add(product.id);
    seenKeys.add(key);
  }

  // Persists every product and its stock rows in one transaction.
  return withTransaction(async (db) => {
    // 2. Check stores and existing products before writing anything.
    const stores = (await db.query<{ id: string }>("SELECT id FROM stores")).rows.map(
      // Extracts each known store id for stock validation and insertion.
      (row) => row.id,
    );
    const unknown = [...new Set(planned.flatMap(
      // Collects the store ids one product asks to stock.
      (product) => product.stock.map((stock) => stock.store_id),
    ))].filter((storeId) => !stores.includes(storeId));
    if (unknown.length) {
      throw new ApiError(404, "store_not_found", `Unknown store: ${unknown.join(", ")}. Call list_stores for the right ids. Nothing was added.`);
    }

    for (const product of planned) {
      const duplicate = await db.query<{ id: string }>(
        `SELECT id FROM products
         WHERE id = $1 OR (lower(name) = lower($2) AND lower(coalesce(variant, '')) = lower($3))`,
        [product.id, product.name, product.variant ?? ""],
      );
      if (duplicate.rows[0]) {
        throw new ApiError(
          409,
          "product_exists",
          `${product.name} already exists as ${duplicate.rows[0].id}, so nothing was added. Use update_product for it, and send the others again.`,
        );
      }
    }

    // 3. Insert products in the business currency, with a stock row at every store.
    const currency = config().BUSINESS_CURRENCY;
    for (const product of planned) {
      const price = priceToSubunits("price", product.price, currency);
      const floor = product.min_price === undefined ? price : priceToSubunits("min_price", product.min_price, currency);
      await db.query(
        `INSERT INTO products (id, name, variant, price_subunit, min_price_subunit, currency)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [product.id, product.name, product.variant || null, price, floor, currency],
      );

      // Converts each requested stock row into a store-to-quantity entry.
      const units = new Map(product.stock.map((stock) => [stock.store_id, stock.quantity]));
      for (const storeId of stores) {
        await db.query("INSERT INTO stock (product_id, store_id, available) VALUES ($1, $2, $3)", [
          product.id,
          storeId,
          units.get(storeId) ?? 0,
        ]);
      }
      await logEvent(db, null, "product_added", {
        product_id: product.id,
        price_subunit: price,
        currency,
        stock: Object.fromEntries(units),
      });
    }

    const added = [];
    for (const product of planned) added.push(await loadProduct(db, product.id, "seller"));
    return { products: added };
  });
}

// Applies one store's stock change inside a caller's transaction; held units count as on hand.
// Held units are counted by the store each order line is held at, not the order's main store.
async function applyStockChange(db: Db, productId: string, input: StockChangeInput) {
  await assertStore(db, input.store_id);
  const { rows } = await db.query<{ available: number; held: number }>(
    `SELECT st.available,
            coalesce((SELECT sum(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id
                      WHERE i.product_id = st.product_id AND i.store_id = st.store_id
                        AND o.status = 'pending_payment'), 0)::int AS held
     FROM stock st WHERE st.product_id = $1 AND st.store_id = $2
     FOR UPDATE`,
    [productId, input.store_id],
  );
  const current = rows[0];
  if (!current) throw new ApiError(404, "product_not_found", `No product with id ${productId}. Call list_products for the right id.`);

  const next = input.set_to !== undefined ? input.set_to - current.held : current.available + (input.change ?? 0);
  if (next < 0) {
    const why =
      input.set_to !== undefined
        ? `${current.held} unit(s) at ${input.store_id} are held for unpaid orders, so on hand can't be set below ${current.held}.`
        : `Only ${current.available} unit(s) are free at ${input.store_id}, so ${-(input.change ?? 0)} can't be removed.`;
    throw new ApiError(409, "stock_below_zero", `${why} Nothing was changed. Tell the owner and ask what they want to do.`);
  }

  await db.query("UPDATE stock SET available = $3, updated_at = now() WHERE product_id = $1 AND store_id = $2", [
    productId,
    input.store_id,
    next,
  ]);
  await logEvent(db, null, "stock_updated", { product_id: productId, store_id: input.store_id, from: current.available, to: next });
  return { store_id: input.store_id, available: next, held_for_unpaid_orders: current.held, on_hand: next + current.held };
}

// Changes any mix of a product's name, variant, price, floor, sale status and stock in one transaction.
export async function updateProduct(id: string, input: UpdateProductInput) {
  await expireStaleOrders(pool);

  // Locks the product so every requested change lands together or not at all.
  return withTransaction(async (db) => {
    // 1. Load the current product.
    const { rows } = await db.query<{
      name: string;
      variant: string | null;
      price_subunit: number;
      min_price_subunit: number;
      currency: string;
      active: boolean;
    }>(
      "SELECT name, variant, price_subunit, min_price_subunit, currency, active FROM products WHERE id = $1 FOR UPDATE",
      [id],
    );
    const old = rows[0];
    if (!old) throw new ApiError(404, "product_not_found", `No product with id ${id}. Call list_products for the right id.`);

    // 2. Work out the new values, keeping name and variant unique.
    const name = input.name ?? old.name;
    const variant = input.variant === undefined ? old.variant : input.variant || null;
    if (sameProductKey(name, variant) !== sameProductKey(old.name, old.variant)) {
      const clash = await db.query<{ id: string }>(
        `SELECT id FROM products
         WHERE id <> $1 AND lower(name) = lower($2) AND lower(coalesce(variant, '')) = lower($3)`,
        [id, name, variant ?? ""],
      );
      if (clash.rows[0]) {
        throw new ApiError(409, "product_exists", `Another product, ${clash.rows[0].id}, already has that name and variant. Nothing was changed.`);
      }
    }

    // The price is in the product's own currency, whatever the business default is now.
    const price = input.price === undefined ? old.price_subunit : priceToSubunits("price", input.price, old.currency);
    let floor = input.min_price === undefined ? old.min_price_subunit : priceToSubunits("min_price", input.min_price, old.currency);
    if (floor > price) {
      if (input.min_price !== undefined) {
        throw new ApiError(400, "invalid_input", "min_price can't be above the price. Nothing was changed.");
      }
      floor = price;
    }
    const active = input.active ?? old.active;

    // 3. Apply the product fields, then each store's stock.
    await db.query(
      `UPDATE products
       SET name = $2, variant = $3, price_subunit = $4, min_price_subunit = $5, active = $6, updated_at = now()
       WHERE id = $1`,
      [id, name, variant, price, floor, active],
    );
    await logEvent(db, null, "product_updated", {
      product_id: id,
      currency: old.currency,
      from: { name: old.name, variant: old.variant, price_subunit: old.price_subunit, min_price_subunit: old.min_price_subunit, active: old.active },
      to: { name, variant, price_subunit: price, min_price_subunit: floor, active },
    });

    const stock = [];
    for (const change of input.stock ?? []) stock.push(await applyStockChange(db, id, change));

    // 4. Return the product as it is now, what it was, and each stock result.
    return {
      product: await loadProduct(db, id, "seller"),
      previous: {
        name: old.name,
        variant: old.variant,
        price: moneyView(old.price_subunit, old.currency),
        min_price: moneyView(old.min_price_subunit, old.currency),
        active: old.active,
      },
      stock,
    };
  });
}
