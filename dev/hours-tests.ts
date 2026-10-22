import assert from "node:assert/strict";
import { HoursInput } from "../src/openapi/schemas/catalog";
import { formatHours, hoursView, isOpen, toRows, type HourRow } from "../src/utils/store-hours";

const rows: HourRow[] = toRows([
  { days: ["mon", "tue", "wed", "thu", "fri"], opens: "09:00", closes: "19:00" },
  { days: ["sat"], opens: "10:00", closes: "16:30" },
]);

assert.equal(formatHours(rows), "Mon to Fri, 9am to 7pm; Sat, 10am to 4:30pm; Sun, closed");
assert.deepEqual(hoursView(rows, new Date("2025-01-06T08:00:00Z")).hours[0], {
  day: "Monday",
  opens: "09:00",
  closes: "19:00",
});

// Lagos is UTC+1 and has no daylight-saving clock changes.
assert.equal(isOpen(rows, new Date("2025-01-06T07:59:00Z")), false);
assert.equal(isOpen(rows, new Date("2025-01-06T08:00:00Z")), true);
assert.equal(isOpen(rows, new Date("2025-01-06T17:59:00Z")), true);
assert.equal(isOpen(rows, new Date("2025-01-06T18:00:00Z")), false);
assert.equal(isOpen(rows, new Date("2025-01-05T12:00:00Z")), false);

assert.equal(
  HoursInput.safeParse([{ days: ["mon"], opens: "19:00", closes: "09:00" }]).success,
  false,
);
assert.equal(
  HoursInput.safeParse([
    { days: ["mon", "tue"], opens: "09:00", closes: "17:00" },
    { days: ["tue"], opens: "10:00", closes: "16:00" },
  ]).success,
  false,
);

console.log("Store hours tests passed");
