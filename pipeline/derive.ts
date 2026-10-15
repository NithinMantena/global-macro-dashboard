// Derived context for one series (PRD 5.1, 5.2, 5.3, 5.6): percentile, z-score, trend, stress, staleness.
// Cycle phases (5.4) and change detection (5.5) build on these in Phase 1.

import { addDays, addMonths, daysBetween, PERIOD_DAYS, periodEnd } from "../shared/periods.ts";
import type { DerivedMetrics, Indicator, Observation, SeriesConfig, StoredObservation, TrendLabel } from "../shared/types.ts";
import type { Settings } from "./config.ts";
import { valueAt } from "./transform.ts";

const round = (v: number, dp: number) => Number(v.toFixed(dp));

/** Mid-rank percentile of `value` within `values` (0-100): ties count half. */
export function percentileOf(values: number[], value: number): number | null {
  if (values.length < 2) return null;
  let below = 0, equal = 0;
  for (const v of values) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + 0.5 * equal) / values.length) * 100;
}

export function zScore(values: number[], value: number): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return sd < 1e-12 ? null : (value - mean) / sd;
}

export function bandFor(percentile: number, bands: Settings["percentile"]["bands"]): string {
  for (const b of bands) {
    if ("below" in b && percentile < b.below) return b.label;
    if ("upto" in b && percentile <= b.upto) return b.label;
  }
  return bands[bands.length - 1].label;
}

export function trendFor(change: number | null, deadband: number): TrendLabel | null {
  if (change === null) return null;
  // Round first so 4.3 - 4.2 (0.0999...) is not treated as smaller than a 0.1 deadband.
  const c = round(change, 9);
  if (Math.abs(c) < deadband) return "flat";
  return c > 0 ? "rising" : "falling";
}

export function stressFor(percentile: number | null, direction: Indicator["stress_direction"]): DerivedMetrics["stress"] {
  if (percentile === null || direction === "none") return null;
  const highSide = percentile > 90 ? "extreme" : percentile > 75 ? "elevated" : "normal";
  const lowSide = percentile < 10 ? "extreme" : percentile < 25 ? "elevated" : "normal";
  if (direction === "high") return highSide;
  if (direction === "low") return lowSide;
  return highSide !== "normal" ? highSide : lowSide;
}

export function derive(
  series: SeriesConfig,
  indicator: Indicator,
  stored: StoredObservation[],
  display: Observation[],
  settings: Settings,
  today: string,
): DerivedMetrics {
  const empty: DerivedMetrics = {
    series: series.id,
    observations: display.length,
    latest: null,
    changes: {},
    trends: {},
    trend: null,
    percentile: null,
    band: null,
    z_score: null,
    window_start: null,
    short_window: false,
    stress: null,
    stale: true,
    stale_after: null,
    last_change: null,
  };
  if (!display.length || !stored.length) return empty;

  const freq = series.frequency;
  const latest = display[display.length - 1];
  const firstSeen = stored.find((r) => r.period === latest.period)?.first_seen ?? stored[stored.length - 1].first_seen;

  // Trend (5.2): compare with 3, 6 and 12 months earlier (1, 2 and 4 quarters; years for annual data).
  const annual = freq === "A";
  const lookbacks = annual ? settings.trend.annual_lookback_months : settings.trend.lookback_months;
  const headline = annual ? settings.trend.annual_headline : settings.trend.headline;
  const relative = indicator.deadband_type === "relative";
  const changes: Record<string, number | null> = {};
  const trends: Record<string, TrendLabel | null> = {};
  for (const months of lookbacks) {
    const base = valueAt(display, addMonths(latest.period, -months), freq, settings.trend.daily_max_gap_days);
    let change: number | null = null;
    if (base !== null) change = relative ? (base === 0 ? null : (latest.value / base - 1) * 100) : latest.value - base;
    changes[`${months}m`] = change === null ? null : round(change, 4);
    trends[`${months}m`] = trendFor(change, indicator.deadband);
  }

  // Percentile and z-score (5.1) over the trailing window, or all history if shorter.
  const windowFrom = addMonths(latest.period, -12 * settings.percentile.window_years);
  const windowRows = display.filter((o) => o.period >= windowFrom);
  const windowStart = windowRows[0].period;
  const values = windowRows.map((o) => o.value);
  // Rounded before banding so the label always agrees with the number shown (10.0 is "Low").
  const rawPct = percentileOf(values, latest.value);
  const pct = rawPct === null ? null : round(rawPct, 1);
  const z = zScore(values, latest.value);
  const windowYears = daysBetween(windowStart, latest.period) / 365.25;

  // Staleness (5.6) uses the newest stored observation, so a transform's lookback never hides it.
  const newest = stored[stored.length - 1].period;
  const lag = series.lag_days ?? settings.stale.default_lag_days[freq];
  const staleAfter = addDays(periodEnd(newest, freq), settings.stale.interval_multiple * PERIOD_DAYS[freq] + lag);

  let lastChange: DerivedMetrics["last_change"] = null;
  if (indicator.track_last_change) {
    for (let i = display.length - 2; i >= 0; i--) {
      if (display[i].value !== latest.value) {
        lastChange = { date: display[i + 1].period, from: display[i].value, to: latest.value };
        break;
      }
    }
  }

  return {
    ...empty,
    latest: { period: latest.period, value: latest.value, first_seen: firstSeen },
    changes,
    trends,
    trend: trends[`${headline}m`] ?? null,
    percentile: pct,
    band: pct === null ? null : bandFor(pct, settings.percentile.bands),
    z_score: z === null ? null : round(z, 2),
    window_start: windowStart,
    short_window: windowYears < settings.percentile.min_years,
    stress: stressFor(pct, indicator.stress_direction),
    stale: today > staleAfter,
    stale_after: staleAfter,
    last_change: lastChange,
  };
}
