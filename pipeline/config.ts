// Loads and validates config/*.yaml. Invalid configuration stops the run before any fetch.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Economy, Frequency, Indicator, Schedule, SeriesConfig, Transform } from "../shared/types.ts";

export interface Settings {
  percentile: {
    window_years: number;
    min_years: number;
    bands: ({ below: number; label: string } | { upto: number; label: string })[];
  };
  trend: {
    lookback_months: number[];
    annual_lookback_months: number[];
    headline: number;
    annual_headline: number;
    daily_max_gap_days: number;
  };
  stale: { interval_multiple: number; default_lag_days: Record<Frequency, number> };
  revisions: { tolerance: number };
  fetch: { timeout_seconds: number; retries: number; concurrency: number };
  schedule: { weekly_on: number; monthly_on: number; default_by_frequency: Record<Frequency, Schedule> };
  status: { keep_runs: number };
  site: { repo: string; refresh_workflow: string };
}

export interface Config {
  economies: Economy[];
  indicators: Indicator[];
  series: SeriesConfig[];
  settings: Settings;
  economyById: Map<string, Economy>;
  indicatorById: Map<string, Indicator>;
}

const FREQUENCIES: Frequency[] = ["D", "M", "Q", "A"];
const TRANSFORMS: Transform[] = ["none", "yoy", "qoq_saar"];
const SOURCES = ["fred", "dbnomics", "eurostat"];

function readYaml<T>(file: string): T {
  return parse(readFileSync(file, "utf8")) as T;
}

export function loadConfig(root: string): Config {
  const dir = path.join(root, "config");
  const { economies } = readYaml<{ economies: Economy[] }>(path.join(dir, "economies.yaml"));
  const { indicators } = readYaml<{ indicators: Indicator[] }>(path.join(dir, "indicators.yaml"));
  const { series } = readYaml<{ series: SeriesConfig[] }>(path.join(dir, "series.yaml"));
  const settings = readYaml<Settings>(path.join(dir, "settings.yaml"));
  const config: Config = {
    economies,
    indicators,
    series,
    settings,
    economyById: new Map(economies.map((e) => [e.id, e])),
    indicatorById: new Map(indicators.map((i) => [i.id, i])),
  };
  const problems = validate(config);
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join("\n- ")}`);
  return config;
}

export function validate(config: Config): string[] {
  const problems: string[] = [];
  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${what} id ${id}`);
      seen.add(id);
    }
  };
  dupes(config.economies.map((e) => e.id), "economy");
  dupes(config.indicators.map((i) => i.id), "indicator");
  dupes(config.series.map((s) => s.id), "series");

  for (const ind of config.indicators) {
    if (!FREQUENCIES.includes(ind.frequency)) problems.push(`indicator ${ind.id}: bad frequency ${ind.frequency}`);
    if (!["high", "low", "both", "none"].includes(ind.stress_direction))
      problems.push(`indicator ${ind.id}: bad stress_direction ${ind.stress_direction}`);
    if (typeof ind.deadband !== "number") problems.push(`indicator ${ind.id}: deadband must be a number`);
  }
  for (const s of config.series) {
    const ind = config.indicatorById.get(s.indicator);
    if (!ind) problems.push(`series ${s.id}: unknown indicator ${s.indicator}`);
    if (ind?.scope === "economy" && !s.economy) problems.push(`series ${s.id}: economy required for ${s.indicator}`);
    if (s.economy && !config.economyById.has(s.economy)) problems.push(`series ${s.id}: unknown economy ${s.economy}`);
    const expectedId = s.economy ? `${s.economy}.${s.indicator}` : s.indicator;
    if (!s.id.startsWith(expectedId)) problems.push(`series ${s.id}: id should start with ${expectedId}`);
    if (!/^[A-Za-z0-9._-]+$/.test(s.id)) problems.push(`series ${s.id}: id may only use letters, digits, . _ -`);
    if (!SOURCES.includes(s.source)) problems.push(`series ${s.id}: unknown source ${s.source}`);
    if (!s.key) problems.push(`series ${s.id}: key is required`);
    if (!FREQUENCIES.includes(s.frequency)) problems.push(`series ${s.id}: bad frequency ${s.frequency}`);
    if (!TRANSFORMS.includes(s.transform)) problems.push(`series ${s.id}: bad transform ${s.transform}`);
    if (s.transform === "qoq_saar" && s.frequency !== "Q") problems.push(`series ${s.id}: qoq_saar needs quarterly data`);
    if (!s.licence) problems.push(`series ${s.id}: licence must be recorded (PRD 9.4)`);
  }
  return problems;
}

export function scheduleOf(series: SeriesConfig, settings: Settings): Schedule {
  return series.schedule ?? settings.schedule.default_by_frequency[series.frequency];
}

/** Which schedule tiers a run covers. "scheduled" works them out from the date (UTC). */
export function resolveTiers(tier: string, today: string, settings: Settings): Set<Schedule> {
  switch (tier) {
    case "all":
      return new Set(["daily", "weekly", "monthly"]);
    case "daily":
    case "weekly":
    case "monthly":
      return new Set([tier]);
    case "scheduled": {
      const date = new Date(`${today}T00:00:00Z`);
      const tiers = new Set<Schedule>(["daily"]);
      if (date.getUTCDay() === settings.schedule.weekly_on) tiers.add("weekly");
      if (date.getUTCDate() === settings.schedule.monthly_on) tiers.add("monthly");
      return tiers;
    }
    default:
      throw new Error(`Unknown tier "${tier}" (use scheduled, all, daily, weekly or monthly)`);
  }
}
