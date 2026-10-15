// Builds the small JSON bundles the web app reads (public/data/, not committed) from the committed
// data/ folder. Runs before every dev start and production build.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, scheduleOf } from "../pipeline/config.ts";
import { connectors } from "../pipeline/connectors/index.ts";
import { NEVER } from "../pipeline/pipeline.ts";
import { Store } from "../pipeline/store.ts";
import { applyTransform } from "../pipeline/transform.ts";
import { addMonths } from "../shared/periods.ts";
import type { DerivedMetrics, RunSummary, SeriesStatus, StatusBundle, StatusRow } from "../shared/types.ts";

const root = path.resolve(import.meta.dirname, "..");
const config = loadConfig(root);
const store = new Store(path.join(root, "data"));
const repo = process.env.GITHUB_REPOSITORY ?? config.settings.site.repo;

const statuses = store.readJson<Record<string, SeriesStatus>>("status/series.json", {});
const derived = store.readJson<Record<string, DerivedMetrics>>("derived/metrics.json", {});
const runs = store.readJson<RunSummary[]>("status/runs.json", []);

/** Up to the last 5 years of display values, thinned to at most 60 points. */
function sparkline(id: string): number[] {
  const s = config.series.find((x) => x.id === id)!;
  const stored = store.readSeries(s.id, s.frequency);
  const display = applyTransform(stored, s.transform, s.frequency, config.settings.trend.daily_max_gap_days);
  if (!display.length) return [];
  const from = addMonths(display[display.length - 1].period, -60);
  const recent = display.filter((o) => o.period >= from);
  const step = Math.max(1, Math.ceil(recent.length / 60));
  const thinned = recent.filter((_, i) => (recent.length - 1 - i) % step === 0);
  return thinned.map((o) => o.value);
}

const rows: StatusRow[] = config.series
  .filter((s) => s.active !== false)
  .map((s) => {
    const indicator = config.indicatorById.get(s.indicator)!;
    const economy = s.economy ? config.economyById.get(s.economy)! : null;
    const connector = connectors[s.source];
    return {
      id: s.id,
      indicator: s.indicator,
      indicator_name: indicator.name,
      unit: indicator.unit,
      decimals: indicator.decimals,
      economy: s.economy,
      economy_name: economy?.name ?? null,
      source: s.source,
      source_label: connector.label,
      key: s.key,
      source_url: connector.sourceUrl(s.key),
      frequency: s.frequency,
      schedule: scheduleOf(s, config.settings),
      licence: s.licence,
      verified: s.verified,
      notes: s.notes ?? null,
      status: statuses[s.id] ?? { ...NEVER },
      derived: derived[s.id] ?? null,
      spark: sparkline(s.id),
    };
  });

const lastGoodRun = runs.find((r) => r.ok > 0);
const bundle: StatusBundle = {
  generated_at: new Date().toISOString(),
  data_as_of: lastGoodRun?.finished_at ?? null,
  repo,
  refresh_url: `https://github.com/${repo}/actions/workflows/${config.settings.site.refresh_workflow}`,
  economies: config.economies.map(({ id, name, region, group }) => ({ id, name, region, group })),
  series: rows,
  runs: runs.slice(0, 20),
  revisions: store.readRevisions().slice(-50).reverse(),
  coverage: {
    economies: config.economies.length,
    indicators: config.indicators.length,
    series_configured: rows.length,
  },
};

const outDir = path.join(root, "public", "data");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "status.json"), JSON.stringify(bundle));
console.log(`Wrote public/data/status.json (${rows.length} series, ${runs.length} runs)`);
