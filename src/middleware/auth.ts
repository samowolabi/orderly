import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../config";
import { fail } from "../utils/http";

// Orderly Shop sends the buyer key, Orderly Owner the seller key.
// Checked on every request, so a tricked agent still cannot use owner tools.
export type Role = "buyer" | "seller";

// Hashes API keys into fixed-length values for safe comparison.
const digest = (value: string) => createHash("sha256").update(value).digest();
// Compares API keys without leaking early mismatch timing.
const same = (left: string, right: string) => timingSafeEqual(digest(left), digest(right));

// Resolves an API key to its buyer or seller role.
function roleFor(key: string): Role | null {
  const { BUYER_API_KEY, SELLER_API_KEY } = config();
  if (same(key, SELLER_API_KEY)) return "seller";
  if (same(key, BUYER_API_KEY)) return "buyer";
  return null;
}

// Builds middleware that accepts only the requested API roles.
export function requireRole(...allowed: Role[]): RequestHandler {
  // Authenticates the request and exposes its role to downstream handlers.
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
    // Recorded before the permission check, so a refused call still logs which key tried it.
    response.locals.role = role;
    if (!allowed.includes(role)) {
      return fail(
        response,
        403,
        "owner_only",
        "Only the store owner can do this. Tell the customer you can't change prices, stock or store details, and offer to help with something else.",
      );
    }

    next();
  };
}
