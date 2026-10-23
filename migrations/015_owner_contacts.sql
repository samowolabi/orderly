-- Customers who asked the shop assistant to talk to the owner. Each request emails the owner
-- the customer's number; a number gets at most one email every 30 minutes.
CREATE TABLE owner_contacts (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  phone       text NOT NULL,
  phone_key   text NOT NULL,
  reason      text NOT NULL,
  order_id    text REFERENCES orders(id),
  emailed     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_contacts_phone_idx ON owner_contacts (phone_key, created_at DESC);
