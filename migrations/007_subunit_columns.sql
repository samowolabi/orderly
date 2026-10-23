-- Name amounts after Paystack's term: an integer count of the currency's
-- subunit (kobo for NGN, cents for USD). Same values, clearer names.
ALTER TABLE products RENAME COLUMN price_minor TO price_subunit;
ALTER TABLE products RENAME COLUMN min_price_minor TO min_price_subunit;
ALTER TABLE orders RENAME COLUMN unit_price_minor TO unit_price_subunit;
ALTER TABLE orders RENAME COLUMN amount_minor TO amount_subunit;
