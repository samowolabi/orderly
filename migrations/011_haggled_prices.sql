-- A line can sell below the list price after haggling (never below the product's
-- floor, which the API checks). Keep the list price beside it so the receipt can
-- show what the customer saved.
ALTER TABLE order_items ADD COLUMN list_price_subunit bigint;
UPDATE order_items SET list_price_subunit = unit_price_subunit;
ALTER TABLE order_items
  ALTER COLUMN list_price_subunit SET NOT NULL,
  ADD CONSTRAINT order_items_haggled_price_check CHECK (unit_price_subunit <= list_price_subunit);
