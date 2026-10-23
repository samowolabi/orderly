-- A delivery quote prices one trip from a store to a customer's address. An order
-- for delivery refers to its quote, so the fee always comes from a stored quote,
-- never from the request, and a quote pays for at most one order.
CREATE TABLE delivery_quotes (
  id           text PRIMARY KEY,
  store_id     text NOT NULL REFERENCES stores(id),
  address      text NOT NULL,
  phone        text NOT NULL,
  latitude     double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  distance_m   integer NOT NULL CHECK (distance_m >= 0),
  duration_s   integer NOT NULL CHECK (duration_s >= 0),
  fee_subunit  bigint NOT NULL CHECK (fee_subunit >= 0),
  currency     text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Pickup orders have no quote and no fee; amount_subunit is items plus the fee.
ALTER TABLE orders
  ADD COLUMN delivery_quote_id text UNIQUE REFERENCES delivery_quotes(id),
  ADD COLUMN delivery_fee_subunit bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_subunit >= 0);
