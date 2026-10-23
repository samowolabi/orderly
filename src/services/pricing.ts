import { ApiError } from "../utils/http";
import { fromSubunits, toSubunits } from "../utils/money";

// The shop agent's two counter-offers: a third of the way down from the price towards the
// owner's floor, then halfway. Rounded up to ₦1,000 (₦100 below ₦100,000) so they read like
// a person said them, and never below the floor. Null when the price can't move.
export function counterOffers(priceSubunits: number, floorSubunits: number, currency: string) {
  const step = toSubunits(fromSubunits(priceSubunits, currency) >= 100_000 ? 1_000 : 100, currency);
  const roundUp = (amount: number) => Math.ceil(amount / step) * step;
  const gap = priceSubunits - floorSubunits;
  const first = roundUp(priceSubunits - gap / 3);
  if (gap <= 0 || first >= priceSubunits) return null;
  return { first, final: roundUp(priceSubunits - gap / 2) };
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
