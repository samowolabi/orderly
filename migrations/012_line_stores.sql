-- One order can take items from several stores: each line is held at its own store,
-- and the whole order is still paid with one link. orders.store_id stays as the order's
-- main store: the first pickup store, or the store a delivery leaves from.
ALTER TABLE order_items ADD COLUMN store_id text REFERENCES stores(id);
UPDATE order_items i SET store_id = o.store_id FROM orders o WHERE o.id = i.order_id;
ALTER TABLE order_items ALTER COLUMN store_id SET NOT NULL;
CREATE INDEX order_items_store_idx ON order_items (store_id, product_id);

-- A delivery still leaves from one store. Items that store doesn't have are brought over
-- from another store first: the quote keeps which store each product is held at, and
-- how long bringing them over adds to the trip.
ALTER TABLE delivery_quotes
  ADD COLUMN item_stores jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN transfer_minutes integer NOT NULL DEFAULT 0 CHECK (transfer_minutes >= 0);
