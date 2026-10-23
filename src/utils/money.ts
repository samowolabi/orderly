import { config } from "../config";

// Money is stored as an integer count of the currency's subunit (kobo for
// NGN, cents for USD) next to its ISO 4217 code. Nothing here assumes a
// particular currency: the subunit size comes from Intl.

export type MoneyView = {
  amount: number;
  currency: string;
  display: string;
};

export class InvalidMoneyAmount extends Error {}

const formatters = new Map<string, Intl.NumberFormat>();

// Returns how many decimal places the currency's subunit has, e.g. 2 for NGN.
export function subunitDigits(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// Converts an amount in the main unit into integer subunits, rejecting extra precision.
export function toSubunits(amount: number, currency: string) {
  const factor = 10 ** subunitDigits(currency);
  const subunits = Math.round(amount * factor);
  if (Math.abs(subunits - amount * factor) > 1e-6) {
    throw new InvalidMoneyAmount(`${currency} amounts can have at most ${subunitDigits(currency)} decimal places`);
  }
  return subunits;
}

// Converts integer subunits into an amount in the main unit.
export const fromSubunits = (subunits: number, currency: string) => subunits / 10 ** subunitDigits(currency);

// Formats subunits for people: whole amounts drop the decimals ("₦650,000"),
// anything else shows all of them ("$749.50", never "$749.5").
export function formatMoney(subunits: number, currency: string, locale = config().BUSINESS_LOCALE) {
  const digits = subunitDigits(currency);
  const whole = subunits % 10 ** digits === 0;
  const key = `${locale}:${currency}:${whole}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(fromSubunits(subunits, currency));
}

// Builds the API's money shape from stored subunits.
export function moneyView(subunits: number, currency: string): MoneyView {
  return { amount: fromSubunits(subunits, currency), currency, display: formatMoney(subunits, currency) };
}
