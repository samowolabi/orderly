export const toNaira = (kobo: number) => kobo / 100;
export const toKobo = (naira: number) => Math.round(naira * 100);

const nairaFormat = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const formatNaira = (kobo: number) => nairaFormat.format(toNaira(kobo));

export const lagosTime = (date: Date) =>
  date.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
