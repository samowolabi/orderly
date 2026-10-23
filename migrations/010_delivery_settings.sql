-- Delivery pricing the owner sets by chat. A single row; until the owner changes
-- anything there is no row, and the API uses the defaults from its environment.
CREATE TABLE delivery_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  currency            text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  base_fee_subunit    bigint NOT NULL CHECK (base_fee_subunit >= 0),
  fee_per_km_subunit  bigint NOT NULL CHECK (fee_per_km_subunit >= 0),
  round_to_subunit    bigint NOT NULL CHECK (round_to_subunit > 0),
  max_km              numeric CHECK (max_km IS NULL OR max_km > 0),
  prep_minutes        integer NOT NULL CHECK (prep_minutes >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- A quote keeps the packing time it was priced with, so an order's arrival time
-- doesn't change if the owner changes the setting later.
ALTER TABLE delivery_quotes ADD COLUMN prep_minutes integer NOT NULL DEFAULT 20 CHECK (prep_minutes >= 0);
ALTER TABLE delivery_quotes ALTER COLUMN prep_minutes DROP DEFAULT;
