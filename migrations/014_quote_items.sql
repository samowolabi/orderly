-- A delivery quote keeps the items and unit prices the customer agreed to, so the order
-- charges exactly the quoted total even if a price changes before they order.
ALTER TABLE delivery_quotes ADD COLUMN items jsonb NOT NULL DEFAULT '[]'::jsonb;
