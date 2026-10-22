-- Orderly schema: stores, products, stock, orders, events.
-- Money is kobo (bigint). Agents only see naira; the API converts.

CREATE TABLE stores (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name          text NOT NULL,
  address       text NOT NULL,
  opening_hours text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id             text PRIMARY KEY CHECK (id ~ '^[A-Z0-9][A-Z0-9-]*$'),
  name           text NOT NULL,
  variant        text,
  price_kobo     bigint NOT NULL CHECK (price_kobo > 0),
  -- Floor for owner-approved discounts (stretch feature). Never above price.
  min_price_kobo bigint NOT NULL CHECK (min_price_kobo > 0),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (min_price_kobo <= price_kobo)
);

-- One row per product per store. Holds are taken with
--   UPDATE stock SET available = available - $qty WHERE ... AND available >= $qty
-- and the CHECK is the last line of defence against overselling.
CREATE TABLE stock (
  product_id text NOT NULL REFERENCES products(id),
  store_id   text NOT NULL REFERENCES stores(id),
  available  integer NOT NULL CHECK (available >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, store_id)
);

CREATE SEQUENCE order_number_seq START 1001;

CREATE TABLE orders (
  -- Also used as the Paystack transaction reference.
  id              text PRIMARY KEY DEFAULT 'ORD-' || nextval('order_number_seq'),
  product_id      text NOT NULL REFERENCES products(id),
  store_id        text NOT NULL REFERENCES stores(id),
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_kobo bigint NOT NULL CHECK (unit_price_kobo > 0),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  currency        text NOT NULL DEFAULT 'NGN',
  buyer_name      text NOT NULL,
  buyer_email     text,
  status          text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                    'pending_payment', 'paid', 'failed', 'expired', 'paid_no_stock', 'handed_over'
                  )),
  payment_url     text,
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_kobo = unit_price_kobo * quantity)
);

CREATE INDEX orders_status_expires_idx ON orders (status, expires_at);
CREATE INDEX orders_store_created_idx ON orders (store_id, created_at DESC);

-- Append-only log. order_id is null for events not tied to an order
-- (stock changes, price changes, new stores).
CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  order_id   text REFERENCES orders(id),
  type       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_order_idx ON events (order_id, created_at);
