-- Record the exact Paystack reference that confirmed an order. An order can
-- have several payment links after declines, and an older link may still pay.
ALTER TABLE orders ADD COLUMN paid_reference text;

-- Webhooks identify an order by one reference in its payment_references array.
CREATE INDEX orders_payment_references_idx ON orders USING gin (payment_references);
