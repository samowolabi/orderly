import type { ErrorRequestHandler, RequestHandler } from "express";
import { ApiError, fail } from "../utils/http";

// Returns the standard response for an unknown endpoint.
export const notFound: RequestHandler = (_request, response) =>
  fail(response, 404, "not_found", "This endpoint does not exist. Check the tool name.");

// Converts known and unexpected errors into the standard API envelope.
export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ApiError) return fail(response, error.status, error.code, error.message);
  if (error instanceof SyntaxError && "body" in error) {
    return fail(response, 400, "bad_json", "The request body was not valid JSON.");
  }

  console.error(error);
  return fail(
    response,
    500,
    "internal_error",
    "Something went wrong on our side. Do not retry; hand over to a person.",
  );
};
