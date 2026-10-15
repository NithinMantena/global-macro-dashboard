// The ingestion pipeline (PRD 9.2): fetch → normalize → upsert and detect revisions → transform →
// derive → log. Each series is isolated: one failure is recorded and the others carry on.
// Change detection (step 6) arrives with the Phase 1 analytics.

import path from "node:path";
import { normalizePeriod, todayUtc } from "../shared/periods.ts";
import type { DerivedMetrics, Observation, RunSummary, SeriesConfig, SeriesStatus, SourceId } from "../shared/types.ts";
import { loadConfig, resolveTiers, scheduleOf, type Config } from "./config.ts";
import { connectors as defaultConnectors } from "./connectors/index.ts";
import type { Connector } from "./connectors/types.ts";
import { derive } from "./derive.ts";
import { redact } from "./http.ts";
import { Store } from "./store.ts";
import { applyTransform } from "./transform.ts";
import { upsert } from "./upsert.ts";

export interface RunOptions {
  /** Repository root: config/ is read from here. */
  root: string;
  /** Defaults to <root>/data. */
  dataDir?: string;
  tier: string;
  only?: string[];
  today?: string;
  now?: () => Date;
  env: Record<string, string | undefined>;
  trigger?: string;
  config?: Config;
  connectors?: Record<SourceId, Connector>;
  httpBackoffMs?: number;
  log?: (line: string) => void;
}

export const NEVER: SeriesStatus = {
  source_key: null,
  last_attempt: null,
  last_success: null,
  result: "never",
  error: null,
  consecutive_failures: 0,
  new_rows: 0,
  revised_rows: 0,
  total_rows: 0,
  oldest_period: null,
  newest_period: null,
  source_updated: null,
  duration_ms: null,
};

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export function selectSeries(config: Config, tier: string, only: string[], today: string): SeriesConfig[] {
  const active = config.series.filter((s) => s.active !== false);
  if (only.length) {
    const unknown = only.filter((id) => !config.series.some((s) => s.id === id));
    if (unknown.length) throw new Error(`Unknown series: ${unknown.join(", ")}`);
    return active.filter((s) => only.includes(s.id));
  }
  const tiers = resolveTiers(tier, today, config.settings);
  return active.filter((s) => tiers.has(scheduleOf(s, config.settings)));
}

/** Stored values → display values → derived metrics, for every active series. */
export function deriveAll(config: Config, store: Store, today: string): Record<string, DerivedMetrics> {
  const out: Record<string, DerivedMetrics> = {};
  for (const s of config.series) {
    if (s.active === false) continue;
    const indicator = config.indicatorById.get(s.indicator)!;
    const stored = store.readSeries(s.id, s.frequency).sort((a, b) => (a.period < b.period ? -1 : 1));
    const display = applyTransform(stored, s.transform, s.frequency, config.settings.trend.daily_max_gap_days);
    out[s.id] = derive(s, indicator, stored, display, config.settings, today);
  }
  return out;
}

export async function runPipeline(opts: RunOptions): Promise<RunSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const config = opts.config ?? loadConfig(opts.root);
  const store = new Store(opts.dataDir ?? path.join(opts.root, "data"));
  const today = opts.today ?? todayUtc();
  const connectors = opts.connectors ?? defaultConnectors;
  const startedAt = now().toISOString();
  const selected = selectSeries(config, opts.tier, opts.only ?? [], today);
  const { fetch: fetchSettings, revisions: revisionSettings } = config.settings;

  const previous = store.readJson<Record<string, SeriesStatus>>("status/series.json", {});
  const statuses: Record<string, SeriesStatus> = {};
  for (const s of config.series) statuses[s.id] = previous[s.id] ?? { ...NEVER };

  const failures: RunSummary["failures"] = [];
  let ok = 0, newRows = 0, revisedRows = 0;

  log(`Refreshing ${selected.length} series (tier: ${opts.only?.length ? "only " + opts.only.join(",") : opts.tier}, date ${today})`);
  await pool(selected, fetchSettings.concurrency, async (s) => {
    const t0 = Date.now();
    const prev = statuses[s.id];
    const attempt = now().toISOString();
    try {
      const connector = connectors[s.source];
      if (!connector) throw new Error(`No connector for source "${s.source}"`);
      const result = await connector.fetch(s, {
        env: opts.env,
        http: { timeoutMs: fetchSettings.timeout_seconds * 1000, retries: fetchSettings.retries, backoffMs: opts.httpBackoffMs },
      });
      const observations: Observation[] = result.observations.map((o) => ({
        period: normalizePeriod(o.period, s.frequency),
        value: o.value,
      }));
      if (!observations.length) throw new Error("Source returned no observations");

      // A new source or key means different data, not revisions: start the history afresh.
      const sourceKey = `${s.source}:${s.key}`;
      const replaced = prev.source_key !== null && prev.source_key !== sourceKey;
      if (replaced) {
        store.clearSeries(s.id, s.frequency);
        log(`  note  ${s.id.padEnd(8)} source changed from ${prev.source_key}; history replaced`);
      }
      const existing = store.readSeries(s.id, s.frequency);
      const merged = upsert(s.id, existing, observations, today, revisionSettings.tolerance);
      store.writeSeries(s.id, s.frequency, merged.rows);
      store.appendRevisions(merged.revisions);

      ok++;
      newRows += merged.added;
      revisedRows += merged.revisions.length;
      statuses[s.id] = {
        source_key: sourceKey,
        last_attempt: attempt,
        last_success: attempt,
        result: "ok",
        error: null,
        consecutive_failures: 0,
        new_rows: merged.added,
        revised_rows: merged.revisions.length,
        total_rows: merged.rows.length,
        oldest_period: merged.rows[0]?.period ?? null,
        newest_period: merged.rows[merged.rows.length - 1]?.period ?? null,
        source_updated: result.sourceUpdated,
        duration_ms: Date.now() - t0,
      };
      log(`  ok    ${s.id.padEnd(8)} +${merged.added} new, ${merged.revisions.length} revised (${merged.rows.length} rows)`);
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err)).slice(0, 500);
      failures.push({ series: s.id, error: message });
      statuses[s.id] = {
        ...prev,
        last_attempt: attempt,
        result: "error",
        error: message,
        consecutive_failures: prev.consecutive_failures + 1,
        new_rows: 0,
        revised_rows: 0,
        duration_ms: Date.now() - t0,
      };
      log(`  ERROR ${s.id.padEnd(8)} ${message}`);
    }
  });

  // Derived metrics are recomputed for every series, since staleness depends on today's date.
  store.writeJson("derived/metrics.json", deriveAll(config, store, today));
  store.writeJson("status/series.json", statuses);

  const summary: RunSummary = {
    id: startedAt,
    started_at: startedAt,
    finished_at: now().toISOString(),
    trigger: opts.trigger ?? "local",
    tier: opts.only?.length ? `only:${opts.only.join(",")}` : opts.tier,
    attempted: selected.length,
    ok,
    failed: failures.length,
    new_rows: newRows,
    revised_rows: revisedRows,
    failures: failures.sort((a, b) => a.series.localeCompare(b.series)),
  };
  const runs = store.readJson<RunSummary[]>("status/runs.json", []);
  store.writeJson("status/runs.json", [summary, ...runs].slice(0, config.settings.status.keep_runs));
  log(`Done: ${ok} ok, ${failures.length} failed, ${newRows} new rows, ${revisedRows} revisions`);
  return summary;
}
