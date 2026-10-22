import type { Response } from "express";

// Every response: { ok, data, error: { code, message_for_agent } }.
// message_for_agent is written for the Chord agent to act on, not for logs.

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ ok: true, data, error: null });
}

export function fail(res: Response, status: number, code: string, message_for_agent: string) {
  return res.status(status).json({ ok: false, data: null, error: { code, message_for_agent } });
}

export const toNaira = (kobo: number) => kobo / 100;
export const toKobo = (naira: number) => Math.round(naira * 100);
