import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

// Path modules add definitions to this registry. Express routes are kept
// separate, so the OpenAPI document can be generated on its own.
export const registry = new OpenAPIRegistry();

export const apiKey = registry.registerComponent("securitySchemes", "ApiKey", {
  type: "apiKey",
  in: "header",
  name: "X-Api-Key",
  description: "Buyer key for Orderly Shop, seller key for Orderly Owner.",
});

const ErrorBody = z
  .object({
    code: z.string().openapi({ example: "out_of_stock" }),
    message_for_agent: z.string().openapi({ description: "What went wrong and what to do next. Follow it." }),
  })
  .openapi("Error");

// Wraps a successful response schema in Orderly's standard envelope.
function envelope<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), data, error: z.null() });
}

const Failure = z
  .object({ ok: z.literal(false), data: z.null(), error: ErrorBody })
  .openapi("Failure");

// Builds a documented failure response with the shared error schema.
const failure = (description: string) => ({
  description,
  content: { "application/json": { schema: Failure } },
});

export const errorResponses = {
  400: failure("Invalid input. message_for_agent names the fields to fix."),
  401: failure("Missing or wrong API key."),
  403: failure("Owner-only action called with the buyer key."),
  404: failure("Unknown product, store or order."),
  409: failure("Not possible in the current state, for example out of stock."),
};

export const paymentErrorResponses = {
  502: failure("Paystack could not create a payment link."),
  503: failure("Paystack did not answer. Do not confirm anything."),
};

// Builds a documented JSON success response for a data schema.
export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema: envelope(schema) } },
});

// Builds a JSON request-body definition for a schema.
export const body = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
});

export { z };
