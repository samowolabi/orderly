// Formats a timestamp in the store's Lagos timezone.
export const lagosTime = (date: Date) =>
  date.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
