-- Store every amount next to its currency. Amounts are integer minor units
-- (kobo for NGN, cents for USD), so the columns say "minor", not "kobo".
ALTER TABLE products RENAME COLUMN price_kobo TO price_minor;
ALTER TABLE products RENAME COLUMN min_price_kobo TO min_price_minor;
ALTER TABLE orders RENAME COLUMN unit_price_kobo TO unit_price_minor;
ALTER TABLE orders RENAME COLUMN amount_kobo TO amount_minor;

-- Every price written before this migration was in naira, so that is the
-- truthful backfill. New products take BUSINESS_CURRENCY from the API.
ALTER TABLE products ADD COLUMN currency text;
UPDATE products SET currency = 'NGN';
ALTER TABLE products
  ALTER COLUMN currency SET NOT NULL,
  ADD CONSTRAINT products_currency_check CHECK (currency ~ '^[A-Z]{3}$');

-- Orders copy the product's currency at creation; no silent default.
ALTER TABLE orders
  ALTER COLUMN currency DROP DEFAULT,
  ADD CONSTRAINT orders_currency_check CHECK (currency ~ '^[A-Z]{3}$');
