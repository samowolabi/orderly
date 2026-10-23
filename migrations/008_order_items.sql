-- An order can hold several products from one store and is paid with one link.
-- The order keeps the total, currency and payment state; each line keeps its
-- product, quantity and the price at the time of the order.
CREATE TABLE order_items (
  order_id           text NOT NULL REFERENCES orders(id),
  line               smallint NOT NULL CHECK (line > 0),
  product_id         text NOT NULL REFERENCES products(id),
  quantity           integer NOT NULL CHECK (quantity > 0),
  unit_price_subunit bigint NOT NULL CHECK (unit_price_subunit > 0),
  amount_subunit     bigint NOT NULL CHECK (amount_subunit = unit_price_subunit * quantity),
  PRIMARY KEY (order_id, line),
  UNIQUE (order_id, product_id)
);

CREATE INDEX order_items_product_idx ON order_items (product_id);

-- Every existing order becomes a one-line order.
INSERT INTO order_items (order_id, line, product_id, quantity, unit_price_subunit, amount_subunit)
SELECT id, 1, product_id, quantity, unit_price_subunit, amount_subunit FROM orders;

-- Dropping the columns also drops the old amount = unit price * quantity check.
ALTER TABLE orders
  DROP COLUMN product_id,
  DROP COLUMN quantity,
  DROP COLUMN unit_price_subunit;
