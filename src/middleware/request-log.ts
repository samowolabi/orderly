import type { RequestHandler } from "express";

// Chord tool names by route, so each log line says which tool was called.
const TOOLS: Record<string, string> = {
  "GET /stores": "list_stores",
  "POST /stores": "add_store",
  "PATCH /stores/:id": "update_store",
  "GET /products": "list_products",
  "POST /products": "add_product",
  "PATCH /products/:id": "update_product",
  "POST /delivery/quote": "quote_delivery",
  "POST /orders": "create_order",
  "GET /orders": "list_orders",
  "POST /orders/:id/verify": "verify_payment",
  "GET /orders/:id/receipt": "get_receipt",
  "POST /webhooks/paystack": "paystack_webhook",
  "GET /openapi.json": "openapi",
};

// Path patterns for requests that fail before routing (bad JSON, missing key).
const PATTERNS = Object.entries(TOOLS).map(([route, tool]) => {
  const [method, path] = route.split(" ");
  return { method, pattern: new RegExp(`^${path!.replace(/:[a-z]+/g, "[^/]+")}$`), tool };
});

// Finds the tool for a request from its matched route, or from its method and path.
function toolFor(method: string, routePath: string | undefined, path: string) {
  if (routePath && TOOLS[`${method} ${routePath}`]) return TOOLS[`${method} ${routePath}`];
  return PATTERNS.find((entry) => entry.method === method && entry.pattern.test(path))?.tool ?? "unknown";
}

// Uptime pings and the host's root probes would drown out the tool calls.
const QUIET_PATHS = new Set(["/health", "/"]);

// Writes one line per request: time, tool, key role, status, duration and any
// error code or payment outcome. Never keys, bodies, names or contact details.
export const requestLog: RequestHandler = (request, response, next) => {
  if (QUIET_PATHS.has(request.path)) return next();

  const started = process.hrtime.bigint();
  let errorCode: string | undefined;
  let outcome: string | undefined;

  // Reads only the error code and payment outcome from the JSON reply.
  const json = response.json.bind(response);
  response.json = (body: unknown) => {
    const reply = body as { error?: { code?: unknown } | null; data?: { outcome?: unknown } | null } | undefined;
    if (typeof reply?.error?.code === "string") errorCode = reply.error.code;
    if (typeof reply?.data?.outcome === "string") outcome = reply.data.outcome;
    return json(body);
  };

  // Logs after the response is sent, when the route, role and status are known.
  response.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const fields = [
      new Date().toISOString(),
      `tool=${toolFor(request.method, request.route?.path, request.path)}`,
      `role=${response.locals.role ?? "none"}`,
      `status=${response.statusCode}`,
      `ms=${Math.round(ms)}`,
      outcome && `outcome=${outcome}`,
      errorCode && `error=${errorCode}`,
      `${request.method} ${request.path}`,
    ];
    console.log(fields.filter(Boolean).join(" "));
  });

  next();
};
