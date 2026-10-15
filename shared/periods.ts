// Period handling. Every stored period is an ISO date: the first day of its day, month, quarter or year.

import type { Frequency } from "./types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/**
 * Convert a source period label to the standard date for its frequency.
 * Accepts 2026-09-15, 2026-09, 2026M09, 2026-Q3, 2026Q3, 2026-q3 and 2026.
 */
export function normalizePeriod(raw: string, freq: Frequency): string {
  const s = raw.trim();
  let y: number, m = 1, d = 1;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{4})-?M?(\d{2})$/))) {
    [y, m] = [Number(match[1]), Number(match[2])];
  } else if ((match = s.match(/^(\d{4})-?[Qq]([1-4])$/))) {
    [y, m] = [Number(match[1]), (Number(match[2]) - 1) * 3 + 1];
  } else if ((match = s.match(/^(\d{4})$/))) {
    y = Number(match[1]);
  } else {
    throw new Error(`Unrecognised period "${raw}"`);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Invalid period "${raw}"`);
  switch (freq) {
    case "D":
      return iso(y, m, d);
    case "M":
      return iso(y, m, 1);
    case "Q":
      return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
    case "A":
      return iso(y, 1, 1);
  }
}

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(dt: Date): string {
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Add calendar months, clamping to the end of the month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return iso(ny, nm, Math.min(d, lastDay));
}

export function addDays(date: string, days: number): string {
  const dt = parse(date);
  dt.setUTCDate(dt.getUTCDate() + Math.round(days));
  return format(dt);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export const MONTHS_PER_PERIOD: Record<Frequency, number> = { D: 0, M: 1, Q: 3, A: 12 };

/** Typical length of one period in days, for staleness arithmetic. */
export const PERIOD_DAYS: Record<Frequency, number> = { D: 1, M: 30.4, Q: 91.3, A: 365.25 };

/** First day after the period ends. */
export function periodEnd(period: string, freq: Frequency): string {
  return freq === "D" ? addDays(period, 1) : addMonths(period, MONTHS_PER_PERIOD[freq]);
}

/** Human label for a period: "13 Oct 2026", "Sep 2026", "Q2 2026", "2025". */
export function formatPeriod(period: string, freq: Frequency): string {
  const [y, m, d] = period.split("-").map(Number);
  switch (freq) {
    case "D":
      return `${d} ${MONTHS[m - 1]} ${y}`;
    case "M":
      return `${MONTHS[m - 1]} ${y}`;
    case "Q":
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "A":
      return String(y);
  }
}

/** "13 Oct 2026" for an ISO date or timestamp. */
export function formatDate(dateOrTimestamp: string): string {
  return formatPeriod(dateOrTimestamp.slice(0, 10), "D");
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
