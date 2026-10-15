// The repository is the database. Layout under data/:
//   observations/<series>.csv           monthly, quarterly and annual series (one file each)
//   observations/<series>/<year>.csv    daily series, one file per year so a daily refresh only
//                                       rewrites the small current-year file
//   revisions.csv                       append-only log of revised values
//   derived/metrics.json                latest derived context per series
//   status/series.json, status/runs.json  fetch results for the Data Status page
// Files are only rewritten when their content changes, so reruns produce no diff.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Frequency, Revision, StoredObservation } from "../shared/types.ts";

const HEADER = "period,value,first_seen,last_changed";
const REVISIONS_HEADER = "detected_on,series,period,old_value,new_value";

export function serializeRows(rows: StoredObservation[]): string {
  return [HEADER, ...rows.map((r) => `${r.period},${r.value},${r.first_seen},${r.last_changed}`)].join("\n") + "\n";
}

export function parseRows(text: string, file = "csv"): StoredObservation[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  if (lines[0].trim() !== HEADER) throw new Error(`${file}: unexpected header "${lines[0]}"`);
  return lines.slice(1).map((line, i) => {
    const [period, value, first_seen, last_changed] = line.split(",");
    const n = Number(value);
    if (!period || !Number.isFinite(n)) throw new Error(`${file}: bad row ${i + 2}: "${line}"`);
    return { period, value: n, first_seen, last_changed };
  });
}

/** Write a file only if its content differs. Returns true when written. */
export function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/** Stable JSON: two-space indent, trailing newline. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export class Store {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private obsDir() {
    return path.join(this.root, "observations");
  }

  readSeries(id: string, freq: Frequency): StoredObservation[] {
    if (freq === "D") {
      const dir = path.join(this.obsDir(), id);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => /^\d{4}\.csv$/.test(f))
        .sort()
        .flatMap((f) => parseRows(readFileSync(path.join(dir, f), "utf8"), `${id}/${f}`));
    }
    const file = path.join(this.obsDir(), `${id}.csv`);
    return existsSync(file) ? parseRows(readFileSync(file, "utf8"), `${id}.csv`) : [];
  }

  /** Returns the number of files written. */
  writeSeries(id: string, freq: Frequency, rows: StoredObservation[]): number {
    if (freq !== "D") return writeIfChanged(path.join(this.obsDir(), `${id}.csv`), serializeRows(rows)) ? 1 : 0;
    const byYear = new Map<string, StoredObservation[]>();
    for (const r of rows) {
      const y = r.period.slice(0, 4);
      byYear.set(y, [...(byYear.get(y) ?? []), r]);
    }
    let written = 0;
    for (const [year, yearRows] of byYear) {
      if (writeIfChanged(path.join(this.obsDir(), id, `${year}.csv`), serializeRows(yearRows))) written++;
    }
    return written;
  }

  /** Remove a series' stored history (used when its source key changes). Git keeps the old files. */
  clearSeries(id: string, freq: Frequency): void {
    const target = freq === "D" ? path.join(this.obsDir(), id) : path.join(this.obsDir(), `${id}.csv`);
    rmSync(target, { recursive: true, force: true });
  }

  appendRevisions(revisions: Revision[]): void {
    if (!revisions.length) return;
    const file = path.join(this.root, "revisions.csv");
    if (!existsSync(file)) writeFileSync(file, REVISIONS_HEADER + "\n");
    appendFileSync(
      file,
      revisions.map((r) => `${r.detected_on},${r.series},${r.period},${r.old_value},${r.new_value}`).join("\n") + "\n",
    );
  }

  readRevisions(): Revision[] {
    const file = path.join(this.root, "revisions.csv");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const [detected_on, series, period, old_value, new_value] = line.split(",");
        return { detected_on, series, period, old_value: Number(old_value), new_value: Number(new_value) };
      });
  }

  readJson<T>(relative: string, fallback: T): T {
    const file = path.join(this.root, relative);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
  }

  writeJson(relative: string, value: unknown): boolean {
    return writeIfChanged(path.join(this.root, relative), toJson(value));
  }
}
