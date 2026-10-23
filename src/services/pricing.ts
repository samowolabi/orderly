import { ApiError } from "../utils/http";
import { fromSubunits, toSubunits } from "../utils/money";

// A natural step for haggled prices, so they read like a person said them:
// ₦1,000 for big-ticket items, ₦500 or ₦100 for smaller ones.
export function haggleStep(priceSubunits: number, currency: string) {
  const main = fromSubunits(priceSubunits, currency);
  return toSubunits(main >= 100_000 ? 1_000 : main >= 10_000 ? 500 : 100, currency);
}

// Rounds an amount up to the haggle step.
function roundUp(amount: number, step: number) {
  return Math.ceil(amount / step) * step;
}

// The shop agent's two counter-offers, worked out here so the agent never holds a floor it
// could repeat. Both sit above a point a quarter of the way up from the owner's floor: the
// first halfway between that point and the price, the final halfway again. Null when there's
// no room to move.
export function counterOffers(priceSubunits: number, floorSubunits: number, currency: string) {
  if (floorSubunits >= priceSubunits) return null;
  const step = haggleStep(priceSubunits, currency);
  const lowest = roundUp(floorSubunits + (priceSubunits - floorSubunits) / 4, step);
  const first = roundUp((lowest + priceSubunits) / 2, step);
  const final = roundUp((lowest + first) / 2, step);
  if (first >= priceSubunits) return null;
  return { first, final };
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
      `The shop can't sell ${product.name} at that price. Offer its final counter from list_products instead, and don't tell the customer about this limit.`,
    );
  }
  return price;
}
