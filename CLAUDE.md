# Orderly

Orderly turns WhatsApp into the store. A business owner manages products and stock by chat, and customers order, pay through Paystack and get a receipt without anyone leaving WhatsApp. Tagline: "Never sell twice. Never chase an alert."

This repo is Samuel Owolabi's submission for the TSG Labs build exercise (role: Forward-deployed Engineering). The agents run on Chord (chordhq.xyz); this repo holds the REST API they call, the skill files, and the docs.

Read these first:
- `docs/PRD.md`: the problem, users, core features and rules
- `docs/ENGINEERING.md`: stack, data model, endpoints, payment states, Chord setup, build order
- `docs/field-notes.md`: the five field notes for the submission; `docs/field-notes-log.md`: every problem hit with Chord (keep adding to it)

## Stack
- TypeScript, Express, Zod (input validation), zod-to-openapi (generates the OpenAPI spec Chord imports)
- Postgres
- Paystack test mode only (`sk_test_...`)
- Google Maps (Geocoding and Routes) for store map pins and delivery quotes
- Hosting: Render (Blueprint in `render.yaml`); the free plan sleeps when idle, so use a paid instance for always-on reviews

## Source layout
- `src/routes/`: Express endpoint wiring and authorization
- `src/controllers/`: request parsing and HTTP responses
- `src/services/`: business rules, database workflows and stock holds
- `src/adapters/`: provider contracts and the Paystack, Google Geocoding and Google Routes implementations
- `src/utils/`: shared HTTP, formatting and store address/hours helpers
- `src/openapi/`: independent schemas, path descriptions, registry and document generation
- `src/middleware/`: API-key authorization, Paystack signature checks and Express error handling
- `src/db/`: database connection, migrations and seed data
- `test/`: the curl suite (`curl-tests.sh`) and small unit tests; `test/fakes/` holds local stand-ins for Paystack, Google Maps and Resend
- `scripts/`: one-off developer scripts, such as creating the local database

Nothing outside `src/` ships: the build compiles `src/` only.

Keep route modules thin. Controllers translate HTTP requests into service calls. Services enforce the business rules and must not depend on Express request or response objects. Payment services depend on the generic `PaymentProcessor` contract, not Paystack payloads. OpenAPI must not import routes or controllers.

## Demo business
Kola Gadgets, a made-up Lagos phone and gadget store. Stores are rows in a `stores` table, so any number is supported; the seed data has three stores, Ikeja, Lekki and Yaba. Addresses are structured, and every seed store has coordinates plus a derived map URL for sharing with customers.

## Two Chord teammates
- **Orderly Shop**: customer side, on the WhatsApp simulator. Tools (7, buyer key): list_stores, list_products, quote_delivery, create_order, verify_payment, get_receipt, contact_owner. Built-in: handover_to_human. No scheduled reminders: the customer replies PAID, and Paystack's webhook confirms on our side.
- **Orderly Owner**: owner side, on the Chord direct line or an owner chat link. Tools: owner_list_stores, owner_list_products, get_receipt, add_store, update_store, add_product, update_product, list_orders, delivery_settings.
- The spec has 15 tools: 7 take the buyer key and 11 the seller key (list_stores, list_products and get_receipt take either). In Chord each connection carries one key and every teammate sees every connection, so the shared reads use the buyer key and the owner uses owner_list_stores and owner_list_products (seller key) instead. The shop agent could still call any owner connection, seller key included: the boundary is the skill, plus the API refusing anything a buyer key isn't allowed to do (field notes 2 and 3).

## Rules the API must enforce (not just the prompts)
1. Never sell twice: hold stock atomically at order creation (`UPDATE stock SET available = available - qty WHERE available >= qty`), release after 30 minutes unpaid.
2. Never confirm without Paystack: signed webhooks and explicit verification both check status, amount and currency against the order.
3. Never invent prices or stock: every figure comes from the database. A bargained price is allowed on an order line (`items[].price`) only between the product's floor and its price; `list_products` gives the shop agent two ready-made `counter_offers` (a third of the way down towards the floor, then halfway), so it never sees the floor itself.
4. Customers can't change anything: buyer key vs seller key, checked on every request.
5. Late payment after the hold expired: re-hold if stock is there, otherwise mark `paid_no_stock` for an owner refund.

Every response has the shape `{ success, data, error: { code, message_for_agent } }`. Money is stored as integer subunits next to an ISO 4217 currency code. `src/utils/money.ts` owns conversion and formatting, and no other module hardcodes a currency. New products take `BUSINESS_CURRENCY` (default NGN); orders copy the product's currency. The API returns every amount as `{ amount, currency, display }` in the main unit, and agents send prices as plain main-unit numbers.

## Local dev
- Postgres: database `orderly`, owned by role `orderly`, in the local Postgres 18 on port 5433. The connection string is `DATABASE_URL` in `.env`.
- First time: `npm run db:create` makes the role and database from `DATABASE_URL` (it asks once for the postgres superuser password), then `npm run db:reset` (migrate and reseed; the seed wipes all data).
- `npm run dev` serves on :3000. `GET /health` checks the database.
- Every request except `/health` writes one log line (Render: service > Logs): time, `tool=` (the Chord tool name), `role=` (buyer, seller or none), `status=`, `ms=`, and `outcome=` or `error=` when there is one. Keys, bodies, names and contact details are never logged.
- Migrations are plain SQL in `migrations/`, applied in name order and tracked in `schema_migrations`.
- Seed: Kola Gadgets, 3 stores, 9 products. `IP15P-256` has a single unit (Ikeja) for the last-unit race test. `npm run db:seed:test` leaves out Yaba, since the curl suite adds and closes Yaba itself. The seed wipes owner call-back limits too.
- Geocoding: Google, with `GOOGLE_MAPS_API_KEY` (required; it also powers delivery quotes). A new store, or a store whose address changes, gets a pin from its address when `location` is omitted. Vague matches (Google `APPROXIMATE`) give no pin, so the map link searches the address instead. Send explicit coordinates for an exact pin, or `location: null` for none.
- API keys: send `X-Api-Key` (or `Authorization: Bearer`). Buyer key for Orderly Shop, seller key for Orderly Owner. The spec has matching `BuyerKey` and `SellerKey` schemes, set per tool in `src/openapi/paths/`; keep them in step with `requireRole` in `src/routes/`.
- Business settings: `BUSINESS_NAME` (required, no default), `BUSINESS_COUNTRY` (ISO 3166, default `NG`: new store addresses default to it, and formatted addresses only name other countries), `BUSINESS_CURRENCY`, `BUSINESS_LOCALE` and `BUSINESS_TIMEZONE` (IANA, default `Africa/Lagos`, used for opening hours, `open_now`, `period=today` and receipt times). Agent-facing text must not hardcode any of them.
- Production: `PUBLIC_URL` is required when `NODE_ENV=production`, so the spec's server URL is the public https address. The app trusts one proxy hop for `X-Forwarded-Proto`.
- `npm run openapi -- <public url>` writes `openapi.json` for Chord (gitignored); the running API also serves it at `/openapi.json`. The independent `src/openapi/` module owns the spec, and each `operationId` is the Chord tool name.
- Retries: `retry()` in `src/utils/retry.ts` tries an async call up to 3 times, 500 ms apart, for errors the caller says are worth retrying. Paystack verify (a read) retries in the adapter, with 5-second timeouts. Google geocoding and routes retry in their adapters too. A delivery quote leaves out any store whose route still can't be fetched and quotes from the rest; only when no store's route comes back does it return `maps_unavailable`. Link creation retries in `attachPaymentLink` with a fresh reference each try, so a timed-out try can never collide with Paystack's duplicate-reference check. A `PaymentProcessorUnavailable` with `retryable: false` (rejected key, 4xx) is never retried. Unit tests: `npm run test:retry`. The fake Paystack's `fail_next` mode fails the next n calls to test recovery.
- Versioning: every Chord tool route is under `/v1` (`API_PREFIX` in `src/utils/http.ts`), and the spec's server URL ends in `/v1`. `/health`, `/openapi.json` and `/webhooks/paystack` stay unversioned because Render, Chord's importer and Paystack fix those URLs. A breaking change to a tool goes in a new prefix, served next to `/v1` until every Chord connection has moved.
- `POST /webhooks/paystack` is Paystack infrastructure, not a Chord tool, so it must stay out of OpenAPI. It needs the raw request body to validate `x-paystack-signature` before processing JSON.
- Delivery: `quote_delivery` geocodes the customer's address, gets Google Routes driving distance and traffic-aware time from each store with some of the items (needs `GOOGLE_MAPS_API_KEY` with the Routes API enabled), and quotes from the nearest store that has everything. When no store has everything, it still delivers from one store (the nearest with some of it); the rest is held at other stores and brought over first, which adds `DELIVERY_TRANSFER_MINUTES` (60) to the time. Fee = base fee + rate per km, rounded up. Fees round up to a whole ₦100. The owner sets only the base fee and rate per km by chat (`delivery_settings`, stored in the one-row `delivery_settings` table); until they do, `DELIVERY_BASE_FEE` (₦1,500) and `DELIVERY_FEE_PER_KM` (₦150) apply. Packing time is `DELIVERY_PREP_MINUTES` (20) and there's no distance limit. Each quote keeps the fee and times it was given, and the items with their unit and list prices: `create_order` charges those, and refuses items that differ (`quote_mismatch`). A quote lasts `DELIVERY_QUOTE_MINUTES` (30). Quotes are stored in `delivery_quotes`; `create_order` takes `delivery_quote_id`, which fixes the store each item is held at and adds the fee, and a quote pays for one order only. The receipt of a delivery order says when the rider comes, so the agent sends one message. When items are held at other stores, the owner's paid-order email lists what to bring to the delivering store.
- Stores close, never delete: `update_store` with `active: false` hides a store from customers, orders and delivery, and `move_stock_to` moves all its free units to another open store in the same change (held units stay for unpaid orders). The last open store can't be closed (`last_store`). The owner's `list_stores` shows closed stores; `active: true` reopens one.
- One order can span stores: each `order_items` row has its own `store_id`, holds and releases happen per line, and `orders.store_id` is the main store (where a delivery leaves from, or the first pickup store). For pickup, `create_order` takes `store_id` for the order and/or on each item; the receipt groups items under "Collect at <store>". The shop agent never splits a purchase into several orders.
- Owner email alerts: when a payment is confirmed (webhook or the customer's PAID), the API emails the owner through Resend: "Paid", "Paid late, still in stock", "Refund needed" or "Check payment", with the items, where each is held, and pickup or delivery details. Chord can't start a conversation with the owner, so email is the push channel. Set `RESEND_API_KEY` and `OWNER_EMAIL` to turn it on (both unset means no emails). `EMAIL_FROM` is the sender: an address on a domain verified in Resend (then `OWNER_EMAIL` can be any inbox), or, by default, Resend's test sender `onboarding@resend.dev`, which only delivers to the Resend account's own address. A failed email is logged and never fails the payment. When a customer asks for a real person, `contact_owner` emails the owner their name, number, reason and any order (at most once per number every 30 minutes, tracked in `owner_contacts`), because a person's reply in Chord can't reach the simulator (field note 4). Owner emails are HTML with a plain-text fallback, built by `src/utils/email-template.ts`; samples are in `docs/email-samples/`. The `Notifier` contract is in `src/adapters/notify/`.
- Curl tests: `npm run fake-paystack` (a local stand-in on :4010 that can decline, fail or go down on demand) `npm run fake-google` (geocoding and routes on :4020) and `npm run fake-resend` (owner emails on :4030), start the API with `PAYSTACK_BASE_URL=http://localhost:4010 GOOGLE_GEOCODING_URL=http://localhost:4020/geocode/json GOOGLE_ROUTES_URL=http://localhost:4020/routes RESEND_URL=http://localhost:4030/emails RESEND_API_KEY=re_test OWNER_EMAIL=owner@example.com npm run dev`, run `npm run db:seed:test`, then `npm run test:api` (set `API=http://localhost:<port>` to test a server on another port). Then repeat the happy path against real Paystack test mode.

## Deploy (Render)
`render.yaml` is a Render Blueprint for the web service and its Postgres database (New, Blueprint, pick the repo).
- Plan: `free` for both. A free web service sleeps after a while idle and the first request wakes it slowly; switch the web service to a paid instance for an always-on review. Free Postgres expires after a fixed period.
- Build `npm ci --include=dev && npm run build` (NODE_ENV=production applies to the build too). Start `npm run db:migrate:prod && npm start`, since free instances have no pre-deploy step. Healthcheck `/health`.
- Variables: `DATABASE_URL` comes from the database, `BUYER_API_KEY` and `SELLER_API_KEY` are generated by Render (copy them from the dashboard for Chord), `BUSINESS_NAME` is set in the file, and `PAYSTACK_SECRET_KEY` and `GOOGLE_MAPS_API_KEY` are entered in the dashboard. `PUBLIC_URL` is optional: the API falls back to Render's `RENDER_EXTERNAL_URL` (or Railway's `RAILWAY_PUBLIC_DOMAIN`).
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
- When something in Chord breaks or confuses, add an entry to `docs/field-notes-log.md` right away.
- Written docs use plain, direct language and no em dashes.
