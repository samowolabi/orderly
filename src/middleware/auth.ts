import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../config";
import { fail } from "../utils/http";

// Orderly Shop sends the buyer key, Orderly Owner the seller key.
// Checked on every request, so a tricked agent still cannot use owner tools.
export type Role = "buyer" | "seller";

const digest = (value: string) => createHash("sha256").update(value).digest();
const same = (left: string, right: string) => timingSafeEqual(digest(left), digest(right));

function roleFor(key: string): Role | null {
  const { BUYER_API_KEY, SELLER_API_KEY } = config();
  if (same(key, SELLER_API_KEY)) return "seller";
  if (same(key, BUYER_API_KEY)) return "buyer";
  return null;
}

export function requireRole(...allowed: Role[]): RequestHandler {
  return (request, response, next) => {
    const header = request.get("x-api-key") ?? request.get("authorization")?.replace(/^Bearer\s+/i, "");
    const role = header ? roleFor(header) : null;

    if (!role) {
      return fail(
        response,
        401,
        "unauthorized",
        "The API key is missing or wrong. This is a setup problem: hand over to a person.",
      );
    }
    if (!allowed.includes(role)) {
      return fail(
        response,
        403,
        "owner_only",
        "Only the store owner can do this. Tell the customer you can't change prices, stock or store details, and offer to help with something else.",
      );
    }

    response.locals.role = role;
    next();
  };
}
