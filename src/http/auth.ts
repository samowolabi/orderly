import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../config";
import { fail } from "./respond";

// Orderly Shop sends the buyer key, Orderly Owner the seller key.
// Checked on every request, so a tricked agent still can't use owner tools.
export type Role = "buyer" | "seller";

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function roleFor(key: string): Role | null {
  const { BUYER_API_KEY, SELLER_API_KEY } = config();
  if (same(key, SELLER_API_KEY)) return "seller";
  if (same(key, BUYER_API_KEY)) return "buyer";
  return null;
}

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, res, next) => {
    const header = req.get("x-api-key") ?? req.get("authorization")?.replace(/^Bearer\s+/i, "");
    const role = header ? roleFor(header) : null;
    if (!role) {
      return fail(res, 401, "unauthorized", "The API key is missing or wrong. This is a setup problem: hand over to a person.");
    }
    if (!allowed.includes(role)) {
      return fail(
        res,
        403,
        "owner_only",
        "Only the store owner can do this. Tell the customer you can't change prices, stock or store details, and offer to help with something else.",
      );
    }
    res.locals.role = role;
    next();
  };
}
