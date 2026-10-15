// Merge fetched observations into stored ones (PRD 9.2 step 3). Pure: no I/O.
// New periods are inserted with today's date as first_seen; changed values are revised and logged.
// Periods missing from a fetch are kept, so a source hiccup never deletes history.

import type { Observation, Revision, StoredObservation } from "../shared/types.ts";

/** Round away float noise (e.g. 3.6026326031330993) so stored values and diffs stay stable. */
export function cleanValue(value: number): number {
  return Number(value.toPrecision(12));
}

export function sameValue(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

export interface UpsertResult {
  rows: StoredObservation[];
  added: number;
  revisions: Revision[];
}

export function upsert(
  seriesId: string,
  existing: StoredObservation[],
  incoming: Observation[],
  today: string,
  tolerance: number,
): UpsertResult {
  const byPeriod = new Map(existing.map((r) => [r.period, { ...r }]));
  // If a source repeats a period, the last value wins.
  const fetched = new Map(incoming.map((o) => [o.period, cleanValue(o.value)]));
  let added = 0;
  const revisions: Revision[] = [];
  for (const [period, value] of fetched) {
    const row = byPeriod.get(period);
    if (!row) {
      byPeriod.set(period, { period, value, first_seen: today, last_changed: today });
      added++;
    } else if (!sameValue(row.value, value, tolerance)) {
      revisions.push({ detected_on: today, series: seriesId, period, old_value: row.value, new_value: value });
      row.value = value;
      row.last_changed = today;
    }
  }
  const rows = [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  return { rows, added, revisions };
}
