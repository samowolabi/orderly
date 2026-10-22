-- Opening hours as data instead of free text, so the API can answer
-- "are you open now?" and format hours the same way everywhere.
-- One row per open day; a day with no row is closed.
CREATE TABLE store_hours (
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  weekday  smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1 = Monday, 7 = Sunday
  opens    time NOT NULL,
  closes   time NOT NULL,
  PRIMARY KEY (store_id, weekday),
  CHECK (closes > opens)
);

-- Preserve the schedules written by the seed before removing the legacy
-- column. Free text cannot be parsed safely in general, so stop the migration
-- instead of silently treating an unknown schedule as closed.
INSERT INTO store_hours (store_id, weekday, opens, closes)
SELECT s.id, d.weekday, time '09:00', time '19:00'
FROM stores s
CROSS JOIN generate_series(1, 6) AS d(weekday)
WHERE s.opening_hours = 'Mon to Sat, 9am to 7pm';

INSERT INTO store_hours (store_id, weekday, opens, closes)
SELECT s.id, d.weekday, time '10:00', time '20:00'
FROM stores s
CROSS JOIN generate_series(1, 6) AS d(weekday)
WHERE s.opening_hours IN (
  'Mon to Sat, 10am to 8pm',
  'Mon to Sat, 10am to 8pm; Sun, 12pm to 5pm'
);

INSERT INTO store_hours (store_id, weekday, opens, closes)
SELECT s.id, 7, time '12:00', time '17:00'
FROM stores s
WHERE s.opening_hours = 'Mon to Sat, 10am to 8pm; Sun, 12pm to 5pm';

DO $$
DECLARE
  unmigrated text;
BEGIN
  SELECT string_agg(s.id, ', ' ORDER BY s.id)
  INTO unmigrated
  FROM stores s
  WHERE NOT EXISTS (SELECT 1 FROM store_hours h WHERE h.store_id = s.id);

  IF unmigrated IS NOT NULL THEN
    RAISE EXCEPTION 'Could not normalize opening_hours for stores: %', unmigrated
      USING HINT = 'Add their schedules to migration 003_store_hours.sql before deploying.';
  END IF;
END $$;

ALTER TABLE stores DROP COLUMN opening_hours;
