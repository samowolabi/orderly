import "dotenv/config";
import { z } from "zod";

// Validates BUSINESS_CURRENCY at startup; kept here so config has no app imports.
const isCurrencyCode = (code: string) => Intl.supportedValuesOf("currency").includes(code);

const Env = z.object({
  DATABASE_URL: z.string().url(),

  GEOAPIFY_API_KEY: z.string().min(1),

  PAYSTACK_SECRET_KEY: z
    .string()
    .startsWith("sk_test_", "Orderly only runs with a Paystack test key"),
  // Overridable so local tests can point at dev/fake-paystack.ts.
  PAYSTACK_BASE_URL: z.string().url().default("https://api.paystack.co"),

  BUYER_API_KEY: z.string().min(16),
  SELLER_API_KEY: z.string().min(16),

  BUSINESS_NAME: z.string().default("Kola Gadgets"),
  // Currency new products are priced in, and the locale prices are shown in.
  BUSINESS_CURRENCY: z
    .string()
    .trim()
    .toUpperCase()
    .default("NGN")
    .refine(isCurrencyCode, "use an ISO 4217 currency code, e.g. NGN"),
  BUSINESS_LOCALE: z.string().default("en-NG"),
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
    if (parsed.data.BUYER_API_KEY === parsed.data.SELLER_API_KEY) {
      throw new Error("BUYER_API_KEY and SELLER_API_KEY must be different");
    }
    cached = parsed.data;
  }
  return cached;
}
