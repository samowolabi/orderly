import "dotenv/config";
import { z } from "zod";

// Validates BUSINESS_CURRENCY as an ISO 4217 code Intl recognises.
const isCurrencyCode = (code: string) => Intl.supportedValuesOf("currency").includes(code);

// Validates BUSINESS_COUNTRY as an ISO 3166 region Intl recognises.
function isCountryCode(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
  return !!name && name !== code && name !== "Unknown Region";
}

// Validates BUSINESS_TIMEZONE at startup by asking Intl to use it.
function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const Env = z.object({
  DATABASE_URL: z.string().url(),

  GEOAPIFY_API_KEY: z.string().min(1),

  PAYSTACK_SECRET_KEY: z
    .string()
    .startsWith("sk_test_", "Orderly only runs with a Paystack test key"),
  // Paystack API origin.
  PAYSTACK_BASE_URL: z.string().url().default("https://api.paystack.co"),

  BUYER_API_KEY: z.string().min(16),
  SELLER_API_KEY: z.string().min(16),

  // Name customers see on receipts and in agent replies; required, never guessed.
  BUSINESS_NAME: z.string().trim().min(1, "set the business name customers will see"),
  // Two-letter country for new store addresses; addresses here leave it off when formatted.
  BUSINESS_COUNTRY: z
    .string()
    .trim()
    .toUpperCase()
    .default("NG")
    .refine(isCountryCode, "use an ISO 3166 two-letter country code, e.g. NG"),
  // Currency new products are priced in, and the locale prices are shown in.
  BUSINESS_CURRENCY: z
    .string()
    .trim()
    .toUpperCase()
    .default("NGN")
    .refine(isCurrencyCode, "use an ISO 4217 currency code, e.g. NGN"),
  BUSINESS_LOCALE: z.string().default("en-NG"),
  // IANA zone for opening hours, "today" and receipt times.
  BUSINESS_TIMEZONE: z.string().default("Africa/Lagos").refine(isTimeZone, "use an IANA time zone, e.g. Africa/Lagos"),
  HOLD_MINUTES: z.coerce.number().int().positive().default(30),

  // Base URL written into the OpenAPI spec's servers list.
  PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

type Config = z.infer<typeof Env>;

// Parsed on first use so the db scripts only need DATABASE_URL.
let cached: Config | undefined;

// Parses, validates and caches the process environment.
export function config(): Config {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
      // Formats each environment validation issue for the startup error.
      const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment:\n  ${fields.join("\n  ")}`);
    }
    if (process.env.NODE_ENV === "production" && !parsed.data.PUBLIC_URL) {
      throw new Error("PUBLIC_URL is required in production, so the OpenAPI spec gives Chord the public https URL");
    }
    if (parsed.data.BUYER_API_KEY === parsed.data.SELLER_API_KEY) {
      throw new Error("BUYER_API_KEY and SELLER_API_KEY must be different");
    }
    cached = parsed.data;
  }
  return cached;
}
