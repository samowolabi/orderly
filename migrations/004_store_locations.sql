-- Store addresses as data so agents can quote them consistently, build a map
-- link and, when coordinates are known, send a native WhatsApp location pin.
ALTER TABLE stores
  ADD COLUMN address_line1   text,
  ADD COLUMN address_line2   text,
  ADD COLUMN area            text,
  ADD COLUMN city            text,
  ADD COLUMN state           text,
  ADD COLUMN country_code    text,
  ADD COLUMN postal_code     text,
  ADD COLUMN latitude        double precision,
  ADD COLUMN longitude       double precision,
  ADD COLUMN directions_note text;

-- Preserve the two demo locations before removing the legacy address string.
UPDATE stores
SET address_line1 = '14 Allen Avenue',
    area = 'Ikeja',
    city = 'Lagos',
    state = 'Lagos',
    country_code = 'NG',
    latitude = 6.604718,
    longitude = 3.350299
WHERE address = '14 Allen Avenue, Ikeja, Lagos';

UPDATE stores
SET address_line1 = '8 Admiralty Way',
    area = 'Lekki Phase 1',
    city = 'Lagos',
    state = 'Lagos',
    country_code = 'NG',
    latitude = 6.448381,
    longitude = 3.479260
WHERE address = '8 Admiralty Way, Lekki Phase 1, Lagos';

DO $$
DECLARE
  unmigrated text;
BEGIN
  SELECT string_agg(s.id, ', ' ORDER BY s.id)
  INTO unmigrated
  FROM stores s
  WHERE s.address_line1 IS NULL;

  IF unmigrated IS NOT NULL THEN
    RAISE EXCEPTION 'Could not normalize addresses for stores: %', unmigrated
      USING HINT = 'Add their structured addresses to migration 004_store_locations.sql before deploying.';
  END IF;
END $$;

ALTER TABLE stores
  ALTER COLUMN address_line1 SET NOT NULL,
  ALTER COLUMN area SET NOT NULL,
  ALTER COLUMN city SET NOT NULL,
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN country_code SET NOT NULL,
  ADD CONSTRAINT stores_country_code_check CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT stores_coordinates_pair_check CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT stores_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT stores_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  DROP COLUMN address;
