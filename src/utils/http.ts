import type { Response } from "express";
import type { z } from "zod";

// Sends a successful response in Orderly's standard envelope.
// The version prefix for the Chord tool routes. Infrastructure (/health, the Paystack
// webhook, /openapi.json) stays unversioned, since its callers fix those URLs.
export const API_PREFIX = "/v1";

export function success<T>(response: Response, data: T, status = 200) {
  return response.status(status).json({ success: true, data, error: null });
}

// Sends a failed response with guidance for the calling agent.
export function fail(response: Response, status: number, code: string, message_for_agent: string) {
  return response.status(status).json({ success: false, data: null, error: { code, message_for_agent } });
}

export class ApiError extends Error {
  // Creates an HTTP-safe application error with an agent-readable code and message.
  constructor(
    readonly status: number,
    readonly code: string,
    message_for_agent: string,
  ) {
    super(message_for_agent);
  }
}

// Parses request data or throws a field-specific validation error.
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;

  // Converts each Zod issue into concise guidance for the agent.
  const problems = result.error.issues.map((issue) => {
    const field = issue.path.join(".") || "request";
    const missing = issue.code === "invalid_type" && /received undefined/.test(issue.message);
    return missing ? `${field} is required` : `${field}: ${issue.message}`;
  });
  throw new ApiError(400, "invalid_input", `Fix these and try again (ask the person if you need to): ${problems.join("; ")}.`);
}
