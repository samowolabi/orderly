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

  // Geocoding for new store addresses: Google when its key is set, otherwise Geoapify.
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
  GEOAPIFY_API_KEY: z.string().min(1).optional(),
  GEOCODING_PROVIDER: z.enum(["google", "geoapify"]).optional(),

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
  // First payment check after an order is placed; later checks double the gap (20s, 40s, 80s…).
  PAYMENT_CHECK_FIRST_SECONDS: z.coerce.number().int().positive().default(20),

  // Base URL written into the OpenAPI spec's servers list; see hostUrl() for the fallback.
  PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

type Config = Omit<z.infer<typeof Env>, "GEOCODING_PROVIDER"> & { GEOCODING_PROVIDER: "google" | "geoapify" };

// The public URL a host publishes for the service, used when PUBLIC_URL isn't set.
function hostUrl() {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return undefined;
}

// Parsed on first use so the db scripts only need DATABASE_URL.
let cached: Config | undefined;

// Parses, validates and caches the process environment.
export function config(): Config {
  if (!cached) {
    const parsed = Env.safeParse({
      ...process.env,
      PUBLIC_URL: process.env.PUBLIC_URL || hostUrl(),
      // An empty variable means unset, so a blank key doesn't pick that provider.
      GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || undefined,
      GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY || undefined,
    });
    if (!parsed.success) {
      // Formats each environment validation issue for the startup error.
      const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment:\n  ${fields.join("\n  ")}`);
    }
    if (process.env.NODE_ENV === "production" && !parsed.data.PUBLIC_URL) {
      throw new Error("Set PUBLIC_URL in production (Render and Railway set their own URL), so the OpenAPI spec gives Chord the public https URL");
    }
    if (parsed.data.BUYER_API_KEY === parsed.data.SELLER_API_KEY) {
      throw new Error("BUYER_API_KEY and SELLER_API_KEY must be different");
    }

    const { GOOGLE_MAPS_API_KEY, GEOAPIFY_API_KEY } = parsed.data;
    const provider = parsed.data.GEOCODING_PROVIDER ?? (GOOGLE_MAPS_API_KEY ? "google" : "geoapify");
    if (provider === "google" && !GOOGLE_MAPS_API_KEY) throw new Error("GEOCODING_PROVIDER is google but GOOGLE_MAPS_API_KEY is not set");
    if (provider === "geoapify" && !GEOAPIFY_API_KEY) throw new Error("Set GOOGLE_MAPS_API_KEY (or GEOAPIFY_API_KEY) for store map pins");
    cached = { ...parsed.data, GEOCODING_PROVIDER: provider };
  }
  return cached;
}
