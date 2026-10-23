-- The owner sets only the base fee and the rate per km. Fees round up to a whole 100,
-- packing time comes from DELIVERY_PREP_MINUTES, and there's no distance limit.
ALTER TABLE delivery_settings
  DROP COLUMN round_to_subunit,
  DROP COLUMN max_km,
  DROP COLUMN prep_minutes;
