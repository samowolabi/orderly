import { randomBytes } from "node:crypto";
import { geocodingProvider, routingProvider } from "../adapters";
import { GeocodingProviderUnavailable } from "../adapters/geocoding/geocoding-provider";
import { RoutingProviderUnavailable, type DrivingRoute } from "../adapters/routing/routing-provider";
import { config } from "../config";
import { pool } from "../db/pool";
import { formatLocalClock } from "../utils/format";
import { ApiError } from "../utils/http";
import { moneyView, toSubunits } from "../utils/money";
import { linePrice } from "./pricing";
import { logEvent, mergeItems, type Db, type HoldItem } from "./stock";

type QuoteInput = {
  items: HoldItem[];
  address: string;
  phone: string;
  store_id?: string;
};

// Owner changes in the main unit of the business currency.
type SettingsInput = {
  base_fee?: number;
  fee_per_km?: number;
};

type SettingsRow = {
  currency: string;
  base_fee_subunit: number;
  fee_per_km_subunit: number;
};

type CandidateStore = { id: string; name: string; latitude: number; longitude: number };

export type DeliveryQuoteRow = {
  id: string;
  store_id: string;
  address: string;
  phone: string;
  distance_m: number;
  duration_s: number;
  fee_subunit: number;
  currency: string;
  prep_minutes: number;
  item_stores: Record<string, string>;
  // What the customer agreed to: each product, its quantity, its unit price and the list price
  // at the time, in subunits.
  items: { product_id: string; quantity: number; unit_price_subunit: number; list_price_subunit: number }[];
  transfer_minutes: number;
  expires_at: Date;
};

// Minutes from when it's paid until a rider could arrive: packing time plus the drive.
export const deliveryMinutes = (durationSeconds: number, prepMinutes: number) => prepMinutes + Math.ceil(durationSeconds / 60);

// Rounds a distance to one decimal place of a kilometre, e.g. 31783 m to 31.8.
export const distanceKm = (meters: number) => Math.round(meters / 100) / 10;

// The owner's delivery pricing, or the environment's defaults until the owner sets any.
async function loadSettings(db: Db): Promise<SettingsRow & { set_by_owner: boolean }> {
  const { rows } = await db.query<SettingsRow>("SELECT currency, base_fee_subunit, fee_per_km_subunit FROM delivery_settings");
  if (rows[0]) return { ...rows[0], set_by_owner: true };
  const env = config();
  const currency = env.BUSINESS_CURRENCY;
  return {
    currency,
    base_fee_subunit: toSubunits(env.DELIVERY_BASE_FEE, currency),
    fee_per_km_subunit: toSubunits(env.DELIVERY_FEE_PER_KM, currency),
    set_by_owner: false,
  };
}

// Prices a trip: base fee plus a rate per km, rounded up to a whole 100 (e.g. ₦100).
function deliveryFee(meters: number, settings: SettingsRow) {
  const step = toSubunits(100, settings.currency);
  return Math.ceil((settings.base_fee_subunit + settings.fee_per_km_subunit * (meters / 1000)) / step) * step;
}

// What the owner sees: the pricing, and what a few typical trips would cost.
function settingsView(settings: SettingsRow & { set_by_owner: boolean }) {
  const money = (subunits: number) => moneyView(subunits, settings.currency);
  return {
    base_fee: money(settings.base_fee_subunit),
    fee_per_km: money(settings.fee_per_km_subunit),
    set_by_owner: settings.set_by_owner,
    examples: [2, 5, 10, 20].map((km) => ({ km, fee: money(deliveryFee(km * 1000, settings)) })),
  };
}

// Reads the delivery pricing, or changes the base fee or rate per km and returns the result.
export async function deliverySettings(input: SettingsInput) {
  const current = await loadSettings(pool);
  if (input.base_fee === undefined && input.fee_per_km === undefined) return settingsView(current);

  const { currency } = current;
  const next: SettingsRow = {
    currency,
    base_fee_subunit: input.base_fee !== undefined ? toSubunits(input.base_fee, currency) : current.base_fee_subunit,
    fee_per_km_subunit: input.fee_per_km !== undefined ? toSubunits(input.fee_per_km, currency) : current.fee_per_km_subunit,
  };
  await pool.query(
    `INSERT INTO delivery_settings (id, currency, base_fee_subunit, fee_per_km_subunit) VALUES (true, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET currency = $1, base_fee_subunit = $2, fee_per_km_subunit = $3, updated_at = now()`,
    [next.currency, next.base_fee_subunit, next.fee_per_km_subunit],
  );
  await logEvent(pool, null, "delivery_settings_updated", { before: current, after: next });
  return settingsView({ ...next, set_by_owner: true });
}

type StockedStore = { id: string; name: string; latitude: number | null; longitude: number | null; has: Map<string, number> };

// What every open store has of the wanted products. A store without a map pin can still
// supply items for a delivery; only the store the rider leaves from needs a pin.
async function stockByStore(db: Db, items: HoldItem[]) {
  const { rows } = await db.query<Omit<StockedStore, "has"> & { product_id: string | null; available: number | null }>(
    `SELECT s.id, s.name, s.latitude, s.longitude, st.product_id, st.available
     FROM stores s
     LEFT JOIN stock st ON st.store_id = s.id AND st.product_id = ANY($1::text[]) AND st.available > 0
     WHERE s.active
     ORDER BY s.id`,
    [items.map((item) => item.product_id)],
  );
  const stores = new Map<string, StockedStore>();
  for (const row of rows) {
    const store = stores.get(row.id) ?? { id: row.id, name: row.name, latitude: row.latitude, longitude: row.longitude, has: new Map() };
    if (row.product_id) store.has.set(row.product_id, row.available!);
    stores.set(row.id, store);
  }
  return [...stores.values()];
}

// A store the rider can leave from: it has a map pin.
const isPinned = (store: StockedStore): store is StockedStore & CandidateStore => store.latitude !== null && store.longitude !== null;

// Which store each product is held at when a delivery leaves from `from`: there if it has
// enough, otherwise the store with the most of it, to be brought over before the rider leaves.
function assignStores(from: { id: string; has: Map<string, number> }, items: HoldItem[], stores: { id: string; has: Map<string, number> }[]) {
  const assigned: Record<string, string> = {};
  for (const item of items) {
    if ((from.has.get(item.product_id) ?? 0) >= item.quantity) {
      assigned[item.product_id] = from.id;
      continue;
    }
    const source = stores
      .filter((store) => (store.has.get(item.product_id) ?? 0) >= item.quantity)
      .sort((a, b) => b.has.get(item.product_id)! - a.has.get(item.product_id)!)[0];
    if (!source) return null;
    assigned[item.product_id] = source.id;
  }
  return assigned;
}

// Quotes delivery from the nearest store that has everything, and stores the quote for create_order.
export async function quoteDelivery(input: QuoteInput) {
  const routing = routingProvider();
  const items = mergeItems(input.items);
  const settings = await loadSettings(pool);
  const { currency } = settings;

  const { rows: products } = await pool.query<{ id: string; name: string; price_subunit: number; min_price_subunit: number; currency: string }>(
    "SELECT id, name, price_subunit, min_price_subunit, currency FROM products WHERE id = ANY($1::text[]) AND active",
    [items.map((item) => item.product_id)],
  );
  const unknown = items.find((item) => !products.some((product) => product.id === item.product_id));
  if (unknown) throw new ApiError(404, "product_not_found", `No product ${unknown.product_id}. Call list_products to find the right id.`);
  // The fee is priced in the business currency, so the items must be too, to share one payment.
  if (products.some((product) => product.currency !== currency)) {
    throw new ApiError(400, "invalid_input", `Delivery can only be added to items priced in ${currency}. Offer pickup instead.`);
  }

  if (input.store_id) {
    const store = (await pool.query("SELECT 1 FROM stores WHERE id = $1 AND active", [input.store_id])).rows[0];
    if (!store) throw new ApiError(404, "store_not_found", `No store ${input.store_id}. Call list_stores for the right id.`);
  }
  // Every item must be in stock somewhere; the delivery then leaves from one store, and
  // anything that store lacks is brought over from another store first.
  const stores = await stockByStore(pool, items);
  const missing = items.find((item) => !stores.some((store) => (store.has.get(item.product_id) ?? 0) >= item.quantity));
  if (missing) {
    const name = products.find((product) => product.id === missing.product_id)!.name;
    throw new ApiError(
      409,
      "out_of_stock",
      `${name} isn't in stock at any store right now, so it can't be delivered. Say so, and offer to deliver the rest or something similar from list_products.`,
    );
  }
  // The rider leaves from a pinned store: the one asked for, else any that holds some of the
  // items, else any pinned store at all (everything is brought over to it first).
  const pinned = stores.filter(isPinned);
  const holding = pinned.filter((store) => items.some((item) => store.has.has(item.product_id)));
  const dispatchFrom = input.store_id ? pinned.filter((store) => store.id === input.store_id) : holding.length ? holding : pinned;
  const plans = dispatchFrom.map((store) => ({ store, item_stores: assignStores(store, items, stores)! }));
  if (!plans.length) {
    throw new ApiError(
      422,
      "no_route",
      input.store_id
        ? `${input.store_id} has no map pin to deliver from. Leave out store_id to deliver from the nearest store, or offer pickup.`
        : "No store has a map pin to deliver from. Offer pickup.",
    );
  }

  let destination;
  try {
    // Customers often give only their area. That's enough to price the trip; the rider calls to find them.
    destination = await geocodingProvider().geocodeAddress({ address: input.address, countryCode: config().BUSINESS_COUNTRY, allowArea: true });
  } catch (error) {
    if (!(error instanceof GeocodingProviderUnavailable)) throw error;
    console.error(`[geocoding] delivery quote: ${error.message}`);
    throw new ApiError(503, "maps_unavailable", "The map service isn't answering, so delivery can't be priced right now. Offer pickup, or try again in a minute.");
  }
  if (!destination) {
    throw new ApiError(
      422,
      "address_not_found",
      "That address couldn't be found on the map. Ask the customer for a fuller address: house number, street, area and city, or a nearby landmark.",
    );
  }

  // A store whose route can't be fetched is left out; the quote comes from the stores that
  // answered. Only when none answered is the map service treated as down.
  let unreachable = 0;
  const routes = await Promise.all(
    plans.map((plan) =>
      routing.drivingRoute(plan.store, destination).catch((error) => {
        if (!(error instanceof RoutingProviderUnavailable)) throw error;
        console.error(`[routing] delivery quote from ${plan.store.id}: ${error.message}`);
        unreachable++;
        return undefined;
      }),
    ),
  );
  if (unreachable === plans.length) {
    throw new ApiError(503, "maps_unavailable", "The map service isn't answering, so delivery can't be priced right now. Offer pickup, or try again in a minute.");
  }

  // Prefer a store that has everything, so nothing has to be brought over; then the
  // shortest drive right now.
  const transfers = (itemStores: Record<string, string>, from: string) => new Set(Object.values(itemStores).filter((id) => id !== from));
  const options = plans
    .map((plan, index) => ({ ...plan, route: routes[index] }))
    .filter((option): option is typeof option & { route: DrivingRoute } => option.route != null)
    .sort(
      (a, b) =>
        transfers(a.item_stores, a.store.id).size - transfers(b.item_stores, b.store.id).size ||
        a.route.durationSeconds - b.route.durationSeconds,
    );
  const best = options[0];
  if (!best) {
    throw new ApiError(422, "no_route", "There's no road route from any store to that address. Check the address with the customer, or offer pickup.");
  }

  const km = distanceKm(best.route.distanceMeters);

  // Items from other stores are brought to the delivering store first, which adds a fixed time.
  const sources = [...transfers(best.item_stores, best.store.id)].map((id) => stores.find((store) => store.id === id)!);
  const transferMinutes = sources.length ? config().DELIVERY_TRANSFER_MINUTES : 0;

  const fee = deliveryFee(best.route.distanceMeters, settings);
  // The prices are fixed now (a haggled line at its agreed price), so the order charges exactly this total.
  const productOf = new Map(products.map((product) => [product.id, product]));
  const quotedItems = items.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price_subunit: linePrice(productOf.get(item.product_id)!, item.price),
    list_price_subunit: productOf.get(item.product_id)!.price_subunit,
  }));
  const subtotal = quotedItems.reduce((total, item) => total + item.unit_price_subunit * item.quantity, 0);

  const id = `DQ-${randomBytes(4).toString("hex").toUpperCase()}`;
  const { rows } = await pool.query<{ expires_at: Date }>(
    `INSERT INTO delivery_quotes (id, store_id, address, phone, latitude, longitude, distance_m, duration_s, fee_subunit, currency, prep_minutes,
                                  item_stores, items, transfer_minutes, matched_area, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now() + make_interval(mins => $16::int))
     RETURNING expires_at`,
    [
      id,
      best.store.id,
      input.address,
      input.phone,
      destination.latitude,
      destination.longitude,
      best.route.distanceMeters,
      best.route.durationSeconds,
      fee,
      currency,
      config().DELIVERY_PREP_MINUTES,
      best.item_stores,
      JSON.stringify(quotedItems),
      transferMinutes,
      destination.area ?? null,
      config().DELIVERY_QUOTE_MINUTES,
    ],
  );

  const minutes = deliveryMinutes(best.route.durationSeconds, config().DELIVERY_PREP_MINUTES + transferMinutes);
  const broughtFrom = sources.map((source) => source.name).join(" and ");
  const area = destination.area;
  const where = area ? `${area} (the map found the area, not the street)` : "";

  return {
    quote_id: id,
    store: { id: best.store.id, name: best.store.name },
    brought_from: sources.map((source) => ({ id: source.id, name: source.name })),
    address: input.address,
    phone: input.phone,
    matched_area: area ?? null,
    distance_km: km,
    minutes,
    arrives_around: formatLocalClock(new Date(Date.now() + minutes * 60_000)),
    fee: moneyView(fee, currency),
    items_subtotal: moneyView(subtotal, currency),
    total: moneyView(subtotal + fee, currency),
    expires_at: rows[0]!.expires_at.toISOString(),
    next_step: `${broughtFrom ? `Some items come over from ${broughtFrom} first; the time already allows for it, so there's no need to mention it. ` : ""}${where ? `The map only found ${where}, so the fee is for the area. Don't ask for more of the address: say the rider will call ${input.phone} to find them. ` : ""}Tell the customer: delivery from ${best.store.name}, ${km} km, about ${minutes} minutes once paid, for ${moneyView(fee, currency).display}, making ${moneyView(subtotal + fee, currency).display} in total. Ask them to confirm. If they agree, call create_order with the same items and delivery_quote_id ${id}. If they'd rather not pay for delivery, offer pickup${broughtFrom ? ", collecting each item from the store that has it" : ` at ${best.store.name}`}.`,
  };
}

// Loads and locks an unused, unexpired quote for an order being created in the caller's transaction.
export async function claimDeliveryQuote(db: Db, quoteId: string): Promise<DeliveryQuoteRow> {
  const { rows } = await db.query<DeliveryQuoteRow & { used_by: string | null }>(
    `SELECT q.*, o.id AS used_by
     FROM delivery_quotes q LEFT JOIN orders o ON o.delivery_quote_id = q.id
     WHERE q.id = $1 FOR UPDATE OF q`,
    [quoteId],
  );
  const quote = rows[0];
  if (!quote) throw new ApiError(404, "quote_not_found", `No delivery quote ${quoteId}. Call quote_delivery again with the customer's address.`);
  if (quote.used_by) {
    throw new ApiError(409, "quote_used", `Delivery quote ${quoteId} was already used for order ${quote.used_by}. For a new order, call quote_delivery again.`);
  }
  if (quote.expires_at.getTime() <= Date.now()) {
    throw new ApiError(409, "quote_expired", "That delivery quote has expired. Call quote_delivery again; the fee may have changed with traffic.");
  }
  return quote;
}
