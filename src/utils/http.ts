import type { Response } from "express";
import type { z } from "zod";

export function ok<T>(response: Response, data: T, status = 200) {
  return response.status(status).json({ ok: true, data, error: null });
}

export function fail(response: Response, status: number, code: string, message_for_agent: string) {
  return response.status(status).json({ ok: false, data: null, error: { code, message_for_agent } });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message_for_agent: string,
  ) {
    super(message_for_agent);
  }
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const field = issue.path.join(".") || "request";
    const missing = issue.code === "invalid_type" && /received undefined/.test(issue.message);
    return missing ? `${field} is required` : `${field}: ${issue.message}`;
  });
  throw new ApiError(400, "invalid_input", `Fix these and try again (ask the person if you need to): ${problems.join("; ")}.`);
}
