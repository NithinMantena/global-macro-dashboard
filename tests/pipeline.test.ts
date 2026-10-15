// End-to-end pipeline runs against fake sources and a temporary data folder. These cover the
// Phase 0 gates: reruns create no duplicates, revisions are logged, and one broken series does not
// stop the others.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../pipeline/config.ts";
import type { Connector } from "../pipeline/connectors/types.ts";
import { runPipeline } from "../pipeline/pipeline.ts";
import { Store } from "../pipeline/store.ts";
import type { SeriesConfig, SeriesStatus, SourceId } from "../shared/types.ts";

const root = path.resolve(import.meta.dirname, "..");

function testConfig(): Config {
  const config = loadConfig(root);
  const mk = (id: string, indicator: string, key: string, frequency: SeriesConfig["frequency"]): SeriesConfig => ({
    id, indicator, economy: "US", source: "fred", key, frequency, transform: "none",
    source_measure: "", seasonal_adjustment: "SA", licence: "test", verified: null,
  });
  config.series = [mk("US.L1", "L1", "GOOD_M", "M"), mk("US.R2", "R2", "GOOD_D", "D"), mk("US.I1", "I1", "BROKEN", "M")];
  return config;
}

let data: Record<string, { period: string; value: number }[]>;

const fake: Connector = {
  id: "fred",
  label: "Fake",
  sourceUrl: (k) => k,
  async fetch(series) {
    if (series.key === "BROKEN") throw new Error("HTTP 400: Bad Request. The series does not exist.");
    return { observations: data[series.key] ?? [], sourceUpdated: "2026-10-14" };
  },
};
const connectors = { fred: fake, dbnomics: fake, eurostat: fake } as Record<SourceId, Connector>;

describe("runPipeline", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "gmd-run-"));
    data = {
      GOOD_M: [{ period: "2026-07", value: 4.1 }, { period: "2026-08", value: 4.2 }],
      GOOD_D: [{ period: "2026-10-12", value: 5.2 }, { period: "2026-10-13", value: 5.21 }],
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (today: string, config = testConfig()) =>
    runPipeline({ root, dataDir: dir, tier: "all", today, env: {}, config, connectors, httpBackoffMs: 0 });

  it("isolates a failing series and records its error for the Data Status page", async () => {
    const summary = await run("2026-10-15");
    expect(summary).toMatchObject({ attempted: 3, ok: 2, failed: 1, new_rows: 4 });
    expect(summary.failures).toEqual([{ series: "US.I1", error: "HTTP 400: Bad Request. The series does not exist." }]);
    const status = new Store(dir).readJson<Record<string, SeriesStatus>>("status/series.json", {});
    expect(status["US.I1"]).toMatchObject({ result: "error", consecutive_failures: 1, last_success: null });
    expect(status["US.L1"]).toMatchObject({ result: "ok", total_rows: 2, newest_period: "2026-08-01", source_key: "fred:GOOD_M" });
  });

  it("creates no duplicate rows or file changes when rerun", async () => {
    await run("2026-10-15");
    const before = readFileSync(path.join(dir, "observations", "US.L1.csv"), "utf8");
    const second = await run("2026-10-15");
    expect(second.new_rows).toBe(0);
    expect(readFileSync(path.join(dir, "observations", "US.L1.csv"), "utf8")).toBe(before);
    expect(new Store(dir).readSeries("US.R2", "D")).toHaveLength(2);
  });

  it("logs a revised historical value", async () => {
    await run("2026-10-15");
    data.GOOD_M = [{ period: "2026-07", value: 4.0 }, { period: "2026-08", value: 4.2 }, { period: "2026-09", value: 4.3 }];
    const summary = await run("2026-10-16");
    expect(summary).toMatchObject({ new_rows: 1, revised_rows: 1 });
    expect(new Store(dir).readRevisions()).toEqual([
      { detected_on: "2026-10-16", series: "US.L1", period: "2026-07-01", old_value: 4.1, new_value: 4 },
    ]);
  });

  it("keeps the last good data and counts consecutive failures", async () => {
    await run("2026-10-15");
    const config = testConfig();
    config.series[0].key = "BROKEN";
    // Key changed AND broken: the failure must not wipe stored history.
    await run("2026-10-16", config);
    await run("2026-10-17", config);
    const store = new Store(dir);
    const status = store.readJson<Record<string, SeriesStatus>>("status/series.json", {});
    expect(status["US.L1"]).toMatchObject({ result: "error", consecutive_failures: 2, total_rows: 2 });
    expect(store.readSeries("US.L1", "M")).toHaveLength(2);
  });

  it("replaces history instead of logging revisions when a series' source key changes", async () => {
    await run("2026-10-15");
    const config = testConfig();
    config.series[0].key = "NEW_KEY";
    data.NEW_KEY = [{ period: "2026-08", value: 9.9 }];
    const summary = await run("2026-10-16", config);
    expect(summary.revised_rows).toBe(0);
    expect(new Store(dir).readSeries("US.L1", "M")).toEqual([
      { period: "2026-08-01", value: 9.9, first_seen: "2026-10-16", last_changed: "2026-10-16" },
    ]);
  });

  it("refreshes only the tiers due on a scheduled run", async () => {
    const config = testConfig();
    config.series.push({ ...config.series[0], id: "US.G1", indicator: "G1", key: "GOOD_M", frequency: "Q" });
    // 2026-10-14 is a Wednesday: quarterly series (weekly tier) are skipped.
    const wed = await runPipeline({ root, dataDir: dir, tier: "scheduled", today: "2026-10-14", env: {}, config, connectors });
    expect(wed.attempted).toBe(3);
    // 2026-10-19 is a Monday: the weekly tier joins.
    const mon = await runPipeline({ root, dataDir: dir, tier: "scheduled", today: "2026-10-19", env: {}, config, connectors });
    expect(mon.attempted).toBe(4);
  });
});
