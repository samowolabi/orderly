import type { Response } from "express";

// Every response: { ok, data, error: { code, message_for_agent } }.
// message_for_agent is written for the Chord agent to act on, not for logs.

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ ok: true, data, error: null });
}

export function fail(res: Response, status: number, code: string, message_for_agent: string) {
  return res.status(status).json({ ok: false, data: null, error: { code, message_for_agent } });
}

// Thrown from handlers; the app's error handler turns it into fail().
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message_for_agent: string,
  ) {
    super(message_for_agent);
  }
}

export const toNaira = (kobo: number) => kobo / 100;
export const toKobo = (naira: number) => Math.round(naira * 100);

const nairaFormat = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const formatNaira = (kobo: number) => nairaFormat.format(kobo / 100);

export const lagosTime = (d: Date) =>
  d.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
