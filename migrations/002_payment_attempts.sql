-- A declined card gets a fresh Paystack link for the same order (Paystack
-- references are single-use), so an order can have several references.
-- Each is the order id plus a random suffix, e.g. ORD-1001-3fa9c2.
ALTER TABLE orders
  ADD COLUMN payment_references text[] NOT NULL DEFAULT '{}',
  ADD COLUMN declined_attempts  integer NOT NULL DEFAULT 0,
  ADD COLUMN payment_channel    text,
  ADD COLUMN failure_reason     text;
