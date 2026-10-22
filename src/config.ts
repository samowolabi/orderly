import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  PAYSTACK_SECRET_KEY: z
    .string()
    .startsWith("sk_test_", "Orderly only runs with a Paystack test key"),
  BUYER_API_KEY: z.string().min(16),
  SELLER_API_KEY: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Config = z.infer<typeof Env>;

// Parsed on first use so the db scripts only need DATABASE_URL.
let cached: Config | undefined;

export function config(): Config {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
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
