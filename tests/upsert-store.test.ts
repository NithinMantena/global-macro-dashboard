import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRows, serializeRows, Store } from "../pipeline/store.ts";
import { cleanValue, upsert } from "../pipeline/upsert.ts";

const TOL = 1e-9;

describe("upsert", () => {
  const first = upsert("X", [], [
    { period: "2026-01-01", value: 1 },
    { period: "2026-02-01", value: 2 },
  ], "2026-03-10", TOL);

  it("inserts new periods with today's date as first seen", () => {
    expect(first.added).toBe(2);
    expect(first.revisions).toEqual([]);
    expect(first.rows[0]).toEqual({ period: "2026-01-01", value: 1, first_seen: "2026-03-10", last_changed: "2026-03-10" });
  });

  it("is idempotent: the same fetch again changes nothing", () => {
    const again = upsert("X", first.rows, [
      { period: "2026-01-01", value: 1 },
      { period: "2026-02-01", value: 2 },
    ], "2026-03-11", TOL);
    expect(again.added).toBe(0);
    expect(again.revisions).toEqual([]);
    expect(again.rows).toEqual(first.rows);
  });

  it("records a changed historical value as a revision", () => {
    const revised = upsert("X", first.rows, [
      { period: "2026-01-01", value: 1.5 },
      { period: "2026-02-01", value: 2 },
      { period: "2026-03-01", value: 3 },
    ], "2026-04-02", TOL);
    expect(revised.added).toBe(1);
    expect(revised.revisions).toEqual([
      { detected_on: "2026-04-02", series: "X", period: "2026-01-01", old_value: 1, new_value: 1.5 },
    ]);
    const jan = revised.rows.find((r) => r.period === "2026-01-01")!;
    expect(jan).toEqual({ period: "2026-01-01", value: 1.5, first_seen: "2026-03-10", last_changed: "2026-04-02" });
  });

  it("ignores float noise and keeps periods the source dropped", () => {
    const noisy = upsert("X", first.rows, [{ period: "2026-02-01", value: 2.0000000000001 }], "2026-03-12", TOL);
    expect(noisy.revisions).toEqual([]);
    expect(noisy.rows).toHaveLength(2);
  });

  it("cleans float noise from stored values", () => {
    expect(cleanValue(3.6026326031330993)).toBe(3.60263260313);
  });
});

describe("Store", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const rows = (periods: string[]) => periods.map((p, i) => ({ period: p, value: i, first_seen: "2026-01-01", last_changed: "2026-01-01" }));

  it("round-trips CSV", () => {
    const r = rows(["2026-01-01", "2026-02-01"]);
    expect(parseRows(serializeRows(r))).toEqual(r);
  });

  it("splits daily series into one file per year and only rewrites changed files", () => {
    dir = mkdtempSync(path.join(tmpdir(), "gmd-"));
    const store = new Store(dir);
    const daily = rows(["2025-12-30", "2025-12-31", "2026-01-02"]);
    expect(store.writeSeries("US.R2", "D", daily)).toBe(2);
    expect(readdirSync(path.join(dir, "observations", "US.R2")).sort()).toEqual(["2025.csv", "2026.csv"]);
    expect(store.readSeries("US.R2", "D")).toEqual(daily);

    const before = statSync(path.join(dir, "observations", "US.R2", "2025.csv")).mtimeMs;
    const more = [...daily, ...rows(["2026-01-05"]).map((r) => ({ ...r, value: 9 }))];
    expect(store.writeSeries("US.R2", "D", more)).toBe(1);
    expect(statSync(path.join(dir, "observations", "US.R2", "2025.csv")).mtimeMs).toBe(before);
    expect(store.writeSeries("US.R2", "D", more)).toBe(0);
  });

  it("appends revisions to a CSV log", () => {
    dir = mkdtempSync(path.join(tmpdir(), "gmd-"));
    const store = new Store(dir);
    store.appendRevisions([{ detected_on: "2026-04-02", series: "X", period: "2026-01-01", old_value: 1, new_value: 1.5 }]);
    store.appendRevisions([{ detected_on: "2026-04-03", series: "Y", period: "2026-02-01", old_value: 2, new_value: 2.5 }]);
    expect(readFileSync(path.join(dir, "revisions.csv"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(store.readRevisions()[1]).toEqual({ detected_on: "2026-04-03", series: "Y", period: "2026-02-01", old_value: 2, new_value: 2.5 });
  });
});
