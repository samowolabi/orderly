import type { z } from "zod";
import { ApiError } from "./respond";

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
