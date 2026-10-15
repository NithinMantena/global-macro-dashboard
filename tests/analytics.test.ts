import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../pipeline/config.ts";
import { bandFor, derive, percentileOf, stressFor, trendFor, zScore } from "../pipeline/derive.ts";
import { applyTransform, valueAt } from "../pipeline/transform.ts";
import { addMonths } from "../shared/periods.ts";
import type { Indicator, Observation, SeriesConfig, StoredObservation } from "../shared/types.ts";

const { settings } = loadConfig(path.resolve(import.meta.dirname, ".."));

/** A monthly series starting Jan 2000 with the given values. */
function monthly(values: number[], start = "2000-01-01"): Observation[] {
  return values.map((value, i) => ({ period: addMonths(start, i), value }));
}
const stored = (obs: Observation[]): StoredObservation[] =>
  obs.map((o) => ({ ...o, first_seen: "2026-01-01", last_changed: "2026-01-01" }));

const indicator: Indicator = {
  id: "L1", name: "Unemployment rate", short_name: "Unemployment", category: "labor", scope: "economy",
  frequency: "M", unit: "%", display_transform: "", reference_line: null, stress_direction: "high",
  deadband: 0.1, decimals: 1, phase: 0,
};
const series: SeriesConfig = {
  id: "XX.L1", indicator: "L1", economy: "XX", source: "fred", key: "TEST", frequency: "M", transform: "none",
  source_measure: "", seasonal_adjustment: "SA", lag_days: 10, licence: "test", verified: null,
};

describe("transforms", () => {
  it("computes year-over-year change for monthly data", () => {
    const idx = monthly(Array.from({ length: 13 }, (_, i) => 100 + i));
    const yoy = applyTransform(idx, "yoy", "M");
    expect(yoy).toHaveLength(1);
    expect(yoy[0]).toEqual({ period: "2001-01-01", value: 12 });
  });

  it("computes annualized quarter-over-quarter growth", () => {
    const q = [{ period: "2025-01-01", value: 100 }, { period: "2025-04-01", value: 101 }];
    expect(applyTransform(q, "qoq_saar", "Q")[0].value).toBeCloseTo(4.060401, 5);
  });

  it("looks up daily values on or before a date, within a gap limit", () => {
    const d = [{ period: "2026-01-02", value: 1 }, { period: "2026-01-09", value: 2 }];
    expect(valueAt(d, "2026-01-05", "D", 10)).toBe(1);
    expect(valueAt(d, "2026-01-30", "D", 10)).toBeNull();
    expect(valueAt(d, "2026-01-01", "D", 10)).toBeNull();
  });
});

describe("percentile, z-score and bands (PRD 5.1)", () => {
  it("uses mid-rank percentiles so ties count half", () => {
    expect(percentileOf([1, 2, 3, 4], 4)).toBe(87.5);
    expect(percentileOf([1, 1, 1, 1], 1)).toBe(50);
    expect(percentileOf([5], 5)).toBeNull();
  });

  it("computes z-scores against the window", () => {
    expect(zScore([1, 2, 3, 4, 5], 5)).toBeCloseTo(1.4142, 4);
    expect(zScore([2, 2, 2], 2)).toBeNull();
  });

  it("labels the PRD bands", () => {
    const b = settings.percentile.bands;
    expect(bandFor(5, b)).toBe("Very low");
    expect(bandFor(10, b)).toBe("Low");
    expect(bandFor(50, b)).toBe("Normal");
    expect(bandFor(75, b)).toBe("Normal");
    expect(bandFor(82, b)).toBe("High");
    expect(bandFor(95, b)).toBe("Very high");
  });
});

describe("trend and stress (PRD 5.2, 5.3)", () => {
  it("treats changes inside the deadband as flat, including float noise", () => {
    expect(trendFor(4.3 - 4.2, 0.1)).toBe("rising");
    expect(trendFor(0.05, 0.1)).toBe("flat");
    expect(trendFor(-0.3, 0.1)).toBe("falling");
    expect(trendFor(null, 0.1)).toBeNull();
  });

  it("colours distance from normal only in the stress direction", () => {
    expect(stressFor(95, "high")).toBe("extreme");
    expect(stressFor(5, "high")).toBe("normal");
    expect(stressFor(5, "low")).toBe("extreme");
    expect(stressFor(20, "both")).toBe("elevated");
    expect(stressFor(95, "none")).toBeNull();
  });
});

describe("derive", () => {
  // 25 years of a gently rising series with a jump at the end.
  const values = Array.from({ length: 300 }, (_, i) => 4 + (i % 12) * 0.01);
  values.push(5, 5.2, 5.5);
  const obs = monthly(values);
  const latestPeriod = obs[obs.length - 1].period; // 2025-03-01

  it("matches hand-calculated trend, percentile and window", () => {
    const d = derive(series, indicator, stored(obs), obs, settings, "2025-04-20");
    expect(d.latest).toEqual({ period: latestPeriod, value: 5.5, first_seen: "2026-01-01" });
    // 3 months earlier (Dec 2024) the value was 4.11: change 1.39, rising.
    expect(d.changes["3m"]).toBe(1.39);
    expect(d.trend).toBe("rising");
    // Window: 20 years back from Mar 2025 = Mar 2005 onward (241 points); latest is the unique maximum.
    expect(d.window_start).toBe("2005-03-01");
    expect(d.percentile).toBe(Number(((240.5 / 241) * 100).toFixed(1)));
    expect(d.band).toBe("Very high");
    expect(d.stress).toBe("extreme");
    expect(d.short_window).toBe(false);
  });

  it("flags staleness from the newest period, interval and lag (PRD 5.6)", () => {
    // Mar 2025 ends 1 Apr; + 1.5 x 30.4 days + 10 days lag = 55.6, rounded to 56 days = 27 May 2025.
    expect(derive(series, indicator, stored(obs), obs, settings, "2025-05-27").stale).toBe(false);
    const late = derive(series, indicator, stored(obs), obs, settings, "2025-05-28");
    expect(late.stale).toBe(true);
    expect(late.stale_after).toBe("2025-05-27");
  });

  it("uses all history when shorter than the window and flags short windows", () => {
    const short = monthly([1, 2, 3, 4, 5, 6, 7], "2024-01-01");
    const d = derive(series, indicator, stored(short), short, settings, "2024-08-01");
    expect(d.window_start).toBe("2024-01-01");
    expect(d.short_window).toBe(true);
  });

  it("finds the date of the last policy rate change", () => {
    const daily = [
      { period: "2026-09-14", value: 2.25 },
      { period: "2026-09-15", value: 2.25 },
      { period: "2026-09-16", value: 2.5 },
      { period: "2026-09-17", value: 2.5 },
    ];
    const r1 = { ...indicator, id: "R1", track_last_change: true, stress_direction: "none" as const };
    const d = derive({ ...series, frequency: "D" }, r1, stored(daily), daily, settings, "2026-09-18");
    expect(d.last_change).toEqual({ date: "2026-09-16", from: 2.25, to: 2.5 });
    expect(d.stress).toBeNull();
  });
});
