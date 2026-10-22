// Converts an integer kobo amount into naira.
export const toNaira = (kobo: number) => kobo / 100;
// Converts a naira amount into integer kobo.
export const toKobo = (naira: number) => Math.round(naira * 100);

const nairaFormat = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

// Formats a kobo amount as Nigerian currency for display.
export const formatNaira = (kobo: number) => nairaFormat.format(toNaira(kobo));

// Formats a timestamp in the store's Lagos timezone.
export const lagosTime = (date: Date) =>
  date.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
