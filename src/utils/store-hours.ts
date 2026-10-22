// Weekdays are ISO numbers in the database (1 = Monday) and short names in
// the API, so the agent can write "mon" to "sat" the way owners say it.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Day = (typeof DAYS)[number];
export type HourRow = { weekday: number; opens: string; closes: string };
export type HoursInputValue = { days: Day[]; opens: string; closes: string }[];

export const toRows = (groups: HoursInputValue): HourRow[] =>
  groups
    .flatMap((group) =>
      group.days.map((day) => ({ weekday: DAYS.indexOf(day) + 1, opens: group.opens, closes: group.closes })),
    )
    .sort((a, b) => a.weekday - b.weekday);

function clock(time: string) {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const suffix = hour < 12 ? "am" : "pm";
  const twelveHour = hour % 12 || 12;
  return minute ? `${twelveHour}:${String(minute).padStart(2, "0")}${suffix}` : `${twelveHour}${suffix}`;
}

export function formatHours(rows: HourRow[]): string {
  const byDay = new Map(rows.map((row) => [row.weekday, `${clock(row.opens)} to ${clock(row.closes)}`]));
  const parts: string[] = [];
  let start = 1;

  for (let day = 1; day <= 7; day++) {
    const label = byDay.get(day) ?? "closed";
    if (day === 7 || (byDay.get(day + 1) ?? "closed") !== label) {
      const days = start === day ? SHORT[start - 1] : `${SHORT[start - 1]} to ${SHORT[day - 1]}`;
      parts.push(`${days}, ${label}`);
      start = day + 1;
    }
  }

  return parts.join("; ");
}

function lagosNow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: SHORT.indexOf(get("weekday")) + 1, time: `${get("hour")}:${get("minute")}` };
}

export function isOpen(rows: HourRow[], now = new Date()): boolean {
  const { weekday, time } = lagosNow(now);
  const today = rows.find((row) => row.weekday === weekday);
  return !!today && time >= today.opens && time < today.closes;
}

export function hoursView(rows: HourRow[], now = new Date()) {
  return {
    opening_hours: formatHours(rows),
    hours: rows.map((row) => ({ day: LONG[row.weekday - 1]!, opens: row.opens, closes: row.closes })),
    open_now: isOpen(rows, now),
  };
}
