import { config } from "../config";

// Money is stored as an integer count of the currency's minor unit (kobo for
// NGN, cents for USD) next to its ISO 4217 code. Nothing here assumes a
// particular currency: the minor-unit size comes from Intl.

export type MoneyView = {
  amount: number;
  currency: string;
  display: string;
};

export class InvalidMoneyAmount extends Error {}

const formatters = new Map<string, Intl.NumberFormat>();

// Returns how many decimal places the currency's minor unit has, e.g. 2 for NGN.
export function minorDigits(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// Converts an amount in the main unit into integer minor units, rejecting extra precision.
export function toMinor(amount: number, currency: string) {
  const factor = 10 ** minorDigits(currency);
  const minor = Math.round(amount * factor);
  if (Math.abs(minor - amount * factor) > 1e-6) {
    throw new InvalidMoneyAmount(`${currency} amounts can have at most ${minorDigits(currency)} decimal places`);
  }
  return minor;
}

// Converts integer minor units into an amount in the main unit.
export const fromMinor = (minor: number, currency: string) => minor / 10 ** minorDigits(currency);

// Formats minor units for people: whole amounts drop the decimals ("₦650,000"),
// anything else shows all of them ("$749.50", never "$749.5").
export function formatMoney(minor: number, currency: string, locale = config().BUSINESS_LOCALE) {
  const digits = minorDigits(currency);
  const whole = minor % 10 ** digits === 0;
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
  return formatter.format(fromMinor(minor, currency));
}

// Builds the API's money shape from stored minor units.
export function moneyView(minor: number, currency: string): MoneyView {
  return { amount: fromMinor(minor, currency), currency, display: formatMoney(minor, currency) };
}
