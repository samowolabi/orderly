import { config } from "../config";

// Formats a timestamp for people in the business's time zone and locale.
export const formatLocalTime = (
  date: Date,
  timeZone = config().BUSINESS_TIMEZONE,
  locale = config().BUSINESS_LOCALE,
) =>
  date.toLocaleString(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Formats just the clock time for people, e.g. "15:40", in the business's time zone and locale.
export const formatLocalClock = (
  date: Date,
  timeZone = config().BUSINESS_TIMEZONE,
  locale = config().BUSINESS_LOCALE,
) => date.toLocaleTimeString(locale, { timeZone, hour: "numeric", minute: "2-digit" });
