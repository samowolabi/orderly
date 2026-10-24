-- When the map only found the customer's area, not their street, the quote is priced from the
-- area and the rider calls to find them. Null means the address matched exactly.
ALTER TABLE delivery_quotes ADD COLUMN matched_area text;
