// Weekdays are ISO numbers in the database (1 = Monday) and short names in
// the API, so the agent can write "mon" to "sat" the way owners say it.
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Day = (typeof DAYS)[number];

export type HourRow = {
  weekday: number;

  opens: string;
  closes: string;
};

export type HoursInputValue = {
  days: Day[];

  opens: string;
  closes: string;
}[];

// Expands grouped weekday input into one sorted database row per open day.
export const toRows = (groups: HoursInputValue): HourRow[] =>
  groups
    .flatMap(
      // Expands one hours group into its weekday rows.
      (group) => group.days.map(
        // Converts one short weekday into an ISO weekday row.
        (day) => ({ weekday: DAYS.indexOf(day) + 1, opens: group.opens, closes: group.closes }),
      ),
    )
    // Orders expanded rows by ISO weekday number.
    .sort((a, b) => a.weekday - b.weekday);

// Converts a 24-hour clock value into compact conversational text.
function clock(time: string) {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const suffix = hour < 12 ? "am" : "pm";
  const twelveHour = hour % 12 || 12;
  return minute ? `${twelveHour}:${String(minute).padStart(2, "0")}${suffix}` : `${twelveHour}${suffix}`;
}

// Groups adjacent identical schedules into a readable weekly summary.
export function formatHours(rows: HourRow[]): string {
  // Converts one open-day row into its weekday and formatted time range.
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

// Extracts the current Lagos weekday and 24-hour clock value.
function lagosNow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  // Finds one requested date part in the localized timestamp.
  const get = (type: string) => parts.find(
    // Matches a localized date part by its type.
    (part) => part.type === type,
  )?.value ?? "";
  return { weekday: SHORT.indexOf(get("weekday")) + 1, time: `${get("hour")}:${get("minute")}` };
}

// Reports whether the supplied weekly schedule is open at a given time.
export function isOpen(rows: HourRow[], now = new Date()): boolean {
  const { weekday, time } = lagosNow(now);
  // Finds today's opening-hours row if the store opens today.
  const today = rows.find((row) => row.weekday === weekday);
  return !!today && time >= today.opens && time < today.closes;
}

// Builds the text, structured schedule and live open state returned by the API.
export function hoursView(rows: HourRow[], now = new Date()) {
  return {
    opening_hours: formatHours(rows),
    // Converts one database hours row into its API representation.
    hours: rows.map((row) => ({ day: LONG[row.weekday - 1]!, opens: row.opens, closes: row.closes })),
    open_now: isOpen(rows, now),
  };
}
