import { randomBytes } from "node:crypto";
import { geocodingProvider, routingProvider } from "../adapters";
import { GeocodingProviderUnavailable } from "../adapters/geocoding/geocoding-provider";
import { RoutingProviderUnavailable, type DrivingRoute } from "../adapters/routing/routing-provider";
import { config } from "../config";
import { pool } from "../db/pool";
import { formatLocalClock } from "../utils/format";
import { ApiError } from "../utils/http";
import { moneyView, toSubunits } from "../utils/money";
import { mergeItems, type Db, type HoldItem } from "./stock";

type QuoteInput = {
  items: HoldItem[];
  address: string;
  phone: string;
  store_id?: string;
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
  expires_at: Date;
};

// Minutes from now until a rider could arrive: packing time plus the drive.
export const deliveryMinutes = (durationSeconds: number) => config().DELIVERY_PREP_MINUTES + Math.ceil(durationSeconds / 60);

// Rounds a distance to one decimal place of a kilometre, e.g. 31783 m to 31.8.
export const distanceKm = (meters: number) => Math.round(meters / 100) / 10;

// Prices a trip: base fee plus a rate per km, rounded up to the configured step.
function deliveryFee(meters: number, currency: string) {
  const { DELIVERY_BASE_FEE, DELIVERY_FEE_PER_KM, DELIVERY_FEE_ROUND_TO } = config();
  const raw = DELIVERY_BASE_FEE + DELIVERY_FEE_PER_KM * (meters / 1000);
  return toSubunits(Math.ceil(raw / DELIVERY_FEE_ROUND_TO) * DELIVERY_FEE_ROUND_TO, currency);
}

// Finds the stores that have every item in stock and a map pin to drive from.
async function storesWithEverything(db: Db, items: HoldItem[], storeId?: string) {
  const { rows } = await db.query<CandidateStore>(
    `SELECT s.id, s.name, s.latitude, s.longitude
     FROM stores s
     WHERE s.active AND s.latitude IS NOT NULL AND ($3::text IS NULL OR s.id = $3)
       AND NOT EXISTS (
         SELECT 1 FROM unnest($1::text[], $2::int[]) AS want(product_id, quantity)
         LEFT JOIN stock st ON st.store_id = s.id AND st.product_id = want.product_id
         WHERE coalesce(st.available, 0) < want.quantity
       )`,
    [items.map((item) => item.product_id), items.map((item) => item.quantity), storeId ?? null],
  );
  return rows;
}

// Quotes delivery from the nearest store that has everything, and stores the quote for create_order.
export async function quoteDelivery(input: QuoteInput) {
  const routing = routingProvider();
  if (!routing) {
    throw new ApiError(503, "delivery_unavailable", "Delivery isn't set up for this shop. Offer pickup at a store instead.");
  }
  const items = mergeItems(input.items);
  const currency = config().BUSINESS_CURRENCY;

  const { rows: products } = await pool.query<{ id: string; price_subunit: number; currency: string }>(
    "SELECT id, price_subunit, currency FROM products WHERE id = ANY($1::text[]) AND active",
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
  const candidates = await storesWithEverything(pool, items, input.store_id);
  if (!candidates.length) {
    const where = input.store_id ? "That store doesn't" : "No single store";
    throw new ApiError(
      409,
      "out_of_stock",
      `${where} has all of these in stock right now, so there's nothing to deliver from. Call list_products to see which store has what, and offer to deliver what one store has, or pickup.`,
    );
  }

  let destination;
  try {
    destination = await geocodingProvider().geocodeAddress({ address: input.address, countryCode: config().BUSINESS_COUNTRY });
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

  let routes: (DrivingRoute | null)[];
  try {
    routes = await Promise.all(candidates.map((store) => routing.drivingRoute(store, destination)));
  } catch (error) {
    if (!(error instanceof RoutingProviderUnavailable)) throw error;
    console.error(`[routing] delivery quote: ${error.message}`);
    throw new ApiError(503, "maps_unavailable", "The map service isn't answering, so delivery can't be priced right now. Offer pickup, or try again in a minute.");
  }

  // The nearest store is the one with the shortest drive right now.
  const options = candidates
    .map((store, index) => ({ store, route: routes[index] }))
    .filter((option): option is { store: CandidateStore; route: DrivingRoute } => option.route !== null)
    .sort((a, b) => a.route.durationSeconds - b.route.durationSeconds);
  const best = options[0];
  if (!best) {
    throw new ApiError(422, "no_route", "There's no road route from any store to that address. Check the address with the customer, or offer pickup.");
  }

  const km = distanceKm(best.route.distanceMeters);
  const maxKm = config().DELIVERY_MAX_KM;
  if (maxKm !== undefined && km > maxKm) {
    throw new ApiError(
      409,
      "too_far",
      `That address is ${km} km from ${best.store.name}, beyond the ${maxKm} km our riders cover. Offer pickup at ${best.store.name} instead.`,
    );
  }

  const fee = deliveryFee(best.route.distanceMeters, currency);
  const id = `DQ-${randomBytes(4).toString("hex").toUpperCase()}`;
  const { rows } = await pool.query<{ expires_at: Date }>(
    `INSERT INTO delivery_quotes (id, store_id, address, phone, latitude, longitude, distance_m, duration_s, fee_subunit, currency, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(mins => $11::int))
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
      config().DELIVERY_QUOTE_MINUTES,
    ],
  );

  const priceOf = new Map(products.map((product) => [product.id, product.price_subunit]));
  const subtotal = items.reduce((total, item) => total + priceOf.get(item.product_id)! * item.quantity, 0);
  const minutes = deliveryMinutes(best.route.durationSeconds);

  return {
    quote_id: id,
    store: { id: best.store.id, name: best.store.name },
    address: input.address,
    phone: input.phone,
    distance_km: km,
    minutes,
    arrives_around: formatLocalClock(new Date(Date.now() + minutes * 60_000)),
    fee: moneyView(fee, currency),
    items_subtotal: moneyView(subtotal, currency),
    total: moneyView(subtotal + fee, currency),
    expires_at: rows[0]!.expires_at.toISOString(),
    next_step: `Tell the customer: delivery from ${best.store.name}, ${km} km, about ${minutes} minutes once paid, for ${moneyView(fee, currency).display}, making ${moneyView(subtotal + fee, currency).display} in total. Ask them to confirm. If they agree, call create_order with the same items and delivery_quote_id ${id}. If they'd rather not pay for delivery, offer pickup at ${best.store.name}.`,
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
