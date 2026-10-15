// Display transforms (PRD 9.2 step 4): turn stored source values into the values the app shows.

import { addMonths, daysBetween } from "../shared/periods.ts";
import type { Frequency, Observation, Transform } from "../shared/types.ts";

const round = (v: number) => Number(v.toPrecision(10));

/**
 * The value at a date. Monthly, quarterly and annual series need an exact period match; daily
 * series take the last observation on or before the date, within maxGapDays.
 */
export function valueAt(sorted: Observation[], date: string, freq: Frequency, maxGapDays: number): number | null {
  if (freq !== "D") {
    // Binary search for the exact period.
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = sorted[mid].period;
      if (p === date) return sorted[mid].value;
      if (p < date) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }
  let lo = 0, hi = sorted.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].period <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  return daysBetween(sorted[found].period, date) <= maxGapDays ? sorted[found].value : null;
}

/** Rows must be sorted by period. */
export function applyTransform(rows: Observation[], transform: Transform, freq: Frequency, maxGapDays = 10): Observation[] {
  if (transform === "none") return rows.map(({ period, value }) => ({ period, value }));
  const out: Observation[] = [];
  for (const { period, value } of rows) {
    if (transform === "yoy") {
      const base = valueAt(rows, addMonths(period, -12), freq, maxGapDays);
      if (base !== null && base > 0) out.push({ period, value: round((value / base - 1) * 100) });
    } else {
      const prev = valueAt(rows, addMonths(period, -3), freq, maxGapDays);
      if (prev !== null && prev > 0) out.push({ period, value: round(((value / prev) ** 4 - 1) * 100) });
    }
  }
  return out;
}
