# Orderly

Orderly turns WhatsApp into the store. A business owner manages products and stock by chat, and customers order, pay through Paystack and get a receipt without anyone leaving WhatsApp. Tagline: "Never sell twice. Never chase an alert."

This repo is Samuel Owolabi's submission for the TSG Labs build exercise (role: Forward-deployed Engineering). The agents run on Chord (chordhq.xyz); this repo holds the REST API they call, the skill files, and the docs.

Read these first:
- `docs/PRD.md`: the problem, users, core features and rules
- `docs/ENGINEERING.md`: stack, data model, endpoints, payment states, Chord setup, build order
- `docs/field-notes.md`: problems hit so far with Chord (keep adding to it)

## Stack
- TypeScript, Express, Zod (input validation), zod-to-openapi (generates the OpenAPI spec Chord imports)
- Postgres
- Paystack test mode only (`sk_test_...`)
- Geoapify for converting new store addresses into optional map pins
- Hosting: Render (Blueprint in `render.yaml`); the free plan sleeps when idle, so use a paid instance for always-on reviews

## Source layout
- `src/routes/`: Express endpoint wiring and authorization
- `src/controllers/`: request parsing and HTTP responses
- `src/services/`: business rules, database workflows and stock holds
- `src/adapters/`: provider contracts, provider selection, Paystack and Geoapify implementations
- `src/utils/`: shared HTTP, formatting and store address/hours helpers
- `src/openapi/`: independent schemas, path descriptions, registry and document generation
- `src/middleware/`: API-key authorization, Paystack signature checks and Express error handling
- `src/db/`: database connection, migrations and seed data

Keep route modules thin. Controllers translate HTTP requests into service calls. Services enforce the business rules and must not depend on Express request or response objects. Payment services depend on the generic `PaymentProcessor` contract, not Paystack payloads. OpenAPI must not import routes or controllers.

## Demo business
Kola Gadgets, a made-up Lagos phone and gadget store. Stores are rows in a `stores` table, so any number is supported; the seed data has two stores, Ikeja and Lekki. Addresses are structured, and both seed stores have coordinates plus a derived map URL for sharing with customers.

## Two Chord teammates
- **Orderly Shop**: customer side, on the WhatsApp simulator. Tools: list_stores, list_products, create_order, verify_payment, get_receipt. Built-in: schedule_reminder, handover_to_human.
- **Orderly Owner**: owner side, on the Chord direct line or an owner chat link. Tools: list_stores, list_products, get_receipt, add_store, update_store, add_product, update_product, list_orders.

## Rules the API must enforce (not just the prompts)
1. Never sell twice: hold stock atomically at order creation (`UPDATE stock SET available = available - qty WHERE available >= qty`), release after 30 minutes unpaid.
2. Never confirm without Paystack: signed webhooks and explicit verification both check status, amount and currency against the order.
3. Never invent prices or stock: every figure comes from the database.
4. Customers can't change anything: buyer key vs seller key, checked on every request.
5. Late payment after the hold expired: re-hold if stock is there, otherwise mark `paid_no_stock` for an owner refund.

Every response has the shape `{ ok, data, error: { code, message_for_agent } }`. Money is stored as integer subunits next to an ISO 4217 currency code. `src/utils/money.ts` owns conversion and formatting, and no other module hardcodes a currency. New products take `BUSINESS_CURRENCY` (default NGN); orders copy the product's currency. The API returns every amount as `{ amount, currency, display }` in the main unit, and agents send prices as plain main-unit numbers.

## Local dev
- Postgres: database `orderly`, owned by role `orderly`, in the local Postgres 18 on port 5433. The connection string is `DATABASE_URL` in `.env`.
- First time: `npm run db:create` makes the role and database from `DATABASE_URL` (it asks once for the postgres superuser password), then `npm run db:reset` (migrate and reseed; the seed wipes all data).
- `npm run dev` serves on :3000. `GET /health` checks the database.
- Migrations are plain SQL in `migrations/`, applied in name order and tracked in `schema_migrations`.
- Seed: Kola Gadgets, 2 stores, 9 products. `IP15P-256` has a single unit (Ikeja) for the last-unit race test.
- `GEOAPIFY_API_KEY` geocodes a new store when `location` is omitted. Send explicit coordinates to use an exact pin, or `location: null` to skip geocoding.
- API keys: send `X-Api-Key` (or `Authorization: Bearer`). Buyer key for Orderly Shop, seller key for Orderly Owner. The spec has matching `BuyerKey` and `SellerKey` schemes, set per tool in `src/openapi/paths/`; keep them in step with `requireRole` in `src/routes/`.
- Business settings: `BUSINESS_NAME` (required, no default), `BUSINESS_COUNTRY` (ISO 3166, default `NG`: new store addresses default to it, and formatted addresses only name other countries), `BUSINESS_CURRENCY`, `BUSINESS_LOCALE` and `BUSINESS_TIMEZONE` (IANA, default `Africa/Lagos`, used for opening hours, `open_now`, `period=today` and receipt times). Agent-facing text must not hardcode any of them.
- Production: `PUBLIC_URL` is required when `NODE_ENV=production`, so the spec's server URL is the public https address. The app trusts one proxy hop for `X-Forwarded-Proto`.
- `npm run openapi -- <public url>` writes `openapi.json` for Chord (gitignored); the running API also serves it at `/openapi.json`. The independent `src/openapi/` module owns the spec, and each `operationId` is the Chord tool name.
- `POST /webhooks/paystack` is Paystack infrastructure, not a Chord tool, so it must stay out of OpenAPI. It needs the raw request body to validate `x-paystack-signature` before processing JSON.
- Curl tests: `npm run fake-paystack` (a local stand-in on :4010 that can decline, fail or go down on demand), start the API with `PAYSTACK_BASE_URL=http://localhost:4010 npm run dev`, run `npm run db:seed`, then `npm run test:api` (set `API=http://localhost:<port>` to test a server on another port). Then repeat the happy path against real Paystack test mode.

## Deploy (Render)
`render.yaml` is a Render Blueprint for the web service and its Postgres database (New, Blueprint, pick the repo).
- Plan: `free` for both. A free web service sleeps after a while idle and the first request wakes it slowly; switch the web service to a paid instance for an always-on review. Free Postgres expires after a fixed period.
- Build `npm ci --include=dev && npm run build` (NODE_ENV=production applies to the build too). Start `npm run db:migrate:prod && npm start`, since free instances have no pre-deploy step. Healthcheck `/health`.
- Variables: `DATABASE_URL` comes from the database, `BUYER_API_KEY` and `SELLER_API_KEY` are generated by Render (copy them from the dashboard for Chord), `BUSINESS_NAME` is set in the file, and `PAYSTACK_SECRET_KEY` and `GEOAPIFY_API_KEY` are entered in the dashboard. `PUBLIC_URL` is optional: the API falls back to Render's `RENDER_EXTERNAL_URL` (or Railway's `RAILWAY_PUBLIC_DOMAIN`).
- Seed once from a laptop with the database's external URL: `DATABASE_URL='<external url>' npm run db:seed`. Never in a deploy step.
- Paystack test webhook URL: `https://<domain>/webhooks/paystack`.

## Build order
1. Database and seed data
2. Tier 1 endpoints, tested with curl including failure cases
3. Deploy to Render, generate the OpenAPI spec, import into Chord
4. Orderly Shop skill and simulator test
5. Orderly Owner skill
6. Edge cases: two buyers on the last unit, declined card, quiet customer, late payment, handover

## Working rules
- Test keys and made-up data only. Never commit `.env` or any key.
- Keep skill files in `skills/` as the source of truth; upload to Chord from there and remember to **publish** the draft.
- Test endpoints with curl before any Chord test chat, since chats spend credits.
- When something in Chord breaks or confuses, add an entry to `docs/field-notes.md` right away.
- Written docs use plain, direct language and no em dashes.
