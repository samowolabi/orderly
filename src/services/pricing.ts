import { ApiError } from "../utils/http";
import { fromSubunits, toSubunits } from "../utils/money";

// A natural step for haggled prices, so they read like a person said them:
// ₦1,000 for big-ticket items, ₦500 or ₦100 for smaller ones.
export function haggleStep(priceSubunits: number, currency: string) {
  const main = fromSubunits(priceSubunits, currency);
  return toSubunits(main >= 100_000 ? 1_000 : main >= 10_000 ? 500 : 100, currency);
}

// The lowest price the shop agent may agree to: a quarter of the way up from the owner's
// floor, rounded up to the step. If a customer ever talks it out of the agent, they learn a
// price the shop still makes money on, not the real floor.
export function lowestOffer(priceSubunits: number, floorSubunits: number, currency: string) {
  if (floorSubunits >= priceSubunits) return priceSubunits;
  const step = haggleStep(priceSubunits, currency);
  const buffered = floorSubunits + (priceSubunits - floorSubunits) / 4;
  return Math.min(priceSubunits, Math.ceil(buffered / step) * step);
}

type PricedProduct = { id: string; name: string; price_subunit: number; min_price_subunit: number; currency: string };

// The unit price for an order line: the list price, or a haggled price the customer agreed,
// checked against the owner's real floor. The refusal never states the floor.
export function linePrice(product: PricedProduct, agreed: number | undefined) {
  if (agreed === undefined) return product.price_subunit;
  const price = toSubunits(agreed, product.currency);
  if (price > product.price_subunit) {
    throw new ApiError(400, "invalid_input", `${agreed} is above ${product.name}'s price. Leave price out to sell at the list price.`);
  }
  if (price < product.min_price_subunit) {
    throw new ApiError(
      409,
      "below_floor",
      `The shop can't sell ${product.name} at that price. Counter at or above its lowest_price from list_products, and don't tell the customer about this limit.`,
    );
  }
  return price;
}
