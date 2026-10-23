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

  // Google Maps: geocoding for store map pins and routes for delivery quotes.
  GOOGLE_MAPS_API_KEY: z.string().min(1, "set GOOGLE_MAPS_API_KEY for store map pins and delivery quotes"),
  // Google endpoints; tests point them at the local stand-in in dev/fake-google.ts.
  GOOGLE_GEOCODING_URL: z.string().url().default("https://maps.googleapis.com/maps/api/geocode/json"),
  GOOGLE_ROUTES_URL: z.string().url().default("https://routes.googleapis.com/directions/v2:computeRoutes"),

  // Owner email alerts (paid orders, refunds needed). Off unless both are set.
  RESEND_API_KEY: z.string().min(1).optional(),
  OWNER_EMAIL: z.email().optional(),
  EMAIL_FROM: z.string().default("Orderly <onboarding@resend.dev>"),
  RESEND_URL: z.string().url().default("https://api.resend.com/emails"),

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

  // Delivery fee in the business currency's main unit: base plus a rate per km, rounded up.
  DELIVERY_BASE_FEE: z.coerce.number().nonnegative().default(1500),
  DELIVERY_FEE_PER_KM: z.coerce.number().nonnegative().default(150),
  // Minutes to pack an order and hand it to a rider, added to the drive time.
  DELIVERY_PREP_MINUTES: z.coerce.number().int().nonnegative().default(20),
  // Added to the delivery time when items have to be brought over from another store first.
  DELIVERY_TRANSFER_MINUTES: z.coerce.number().int().nonnegative().default(60),
  // How long a delivery quote can be used to place an order.
  DELIVERY_QUOTE_MINUTES: z.coerce.number().int().positive().default(30),

  // Base URL written into the OpenAPI spec's servers list; see hostUrl() for the fallback.
  PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

type Config = z.infer<typeof Env>;

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
      RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
      OWNER_EMAIL: process.env.OWNER_EMAIL || undefined,
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

    cached = parsed.data;
  }
  return cached;
}
