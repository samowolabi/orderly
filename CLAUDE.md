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
- Hosting: Railway, always on

## Demo business
Kola Gadgets, a made-up Lagos phone and gadget store. Stores are rows in a `stores` table, so any number is supported; the seed data has two stores, Ikeja and Lekki.

## Two Chord teammates
- **Orderly Shop**: customer side, on the WhatsApp simulator. Tools: list_stores, list_products, create_order, verify_payment, get_receipt. Built-in: schedule_reminder, handover_to_human.
- **Orderly Owner**: owner side, on the Chord direct line or an owner chat link. Tools: list_stores, list_products, get_receipt, add_store, add_product, update_stock, update_price, list_orders.

## Rules the API must enforce (not just the prompts)
1. Never sell twice: hold stock atomically at order creation (`UPDATE stock SET available = available - qty WHERE available >= qty`), release after 30 minutes unpaid.
2. Never confirm without Paystack: verify status, amount and currency against the order.
3. Never invent prices or stock: every figure comes from the database.
4. Customers can't change anything: buyer key vs seller key, checked on every request.
5. Late payment after the hold expired: re-hold if stock is there, otherwise mark `paid_no_stock` for an owner refund.

Every response has the shape `{ ok, data, error: { code, message_for_agent } }`. Money is stored in kobo; the agents only send and receive naira.

## Local dev
- Postgres runs as a project-local cluster in `.pgdata/` (gitignored) on port 5440, user `orderly`, trust auth. The system Postgres on 5432 needs a password, and something else already uses 5433.
- `npm run db:start` / `db:stop`, then `npm run db:reset` (migrate and reseed; the seed wipes all data).
- `npm run dev` serves on :3000. `GET /health` checks the database.
- Migrations are plain SQL in `migrations/`, applied in name order and tracked in `schema_migrations`.
- Seed: Kola Gadgets, 2 stores, 9 products. `IP15P-256` has a single unit (Ikeja) for the last-unit race test.

## Build order
1. Database and seed data
2. Tier 1 endpoints, tested with curl including failure cases
3. Deploy to Railway, generate the OpenAPI spec, import into Chord
4. Orderly Shop skill and simulator test
5. Orderly Owner skill
6. Edge cases: two buyers on the last unit, declined card, quiet customer, late payment, handover

## Working rules
- Test keys and made-up data only. Never commit `.env` or any key.
- Keep skill files in `skills/` as the source of truth; upload to Chord from there and remember to **publish** the draft.
- Test endpoints with curl before any Chord test chat, since chats spend credits.
- When something in Chord breaks or confuses, add an entry to `docs/field-notes.md` right away.
- Written docs use plain, direct language and no em dashes.
