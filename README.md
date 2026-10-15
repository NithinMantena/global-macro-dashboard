# Global Macro Dashboard

A calm, low-frequency view of the world economy for a long-term investor: about 30 indicators across
15 economies, each shown with its direction and where it sits against its own history, and explained in
plain English. The product spec is the PRD in the owner's notes (`Apps/Economic Dashboard/Global Macro
Dashboard — Product Requirements Document.md`).

**Everything lives in this repository.** There is no database server and no backend:

```
GitHub Actions (daily 06:00 UTC, or "Run workflow")
  fetch      FRED · Eurostat · ECB via DBnomics   (pipeline/connectors/)
  normalize  periods → first day of month/quarter/year
  upsert     data/observations/*.csv, revisions logged to data/revisions.csv
  derive     trend, percentile, z-score, staleness → data/derived/metrics.json
  log        data/status/*.json
  commit     the data folder is the database; git history is the audit trail
  build      Vite + React site, with small JSON bundles built from data/
  deploy     GitHub Pages
```

The site only reads precomputed files. Nothing a visitor does calls an outside data API.

## Status

Phase 0 (foundations) is built: configuration for all 15 economies and 31 indicators, the pipeline with
FRED, DBnomics and Eurostat connectors, 10 starter series (US and Euro Area GDP growth, CPI, unemployment,
policy rate, 10-year yield), unit tests, the Data Status page, and the scheduled workflow.

Phase 0 gate (PRD 11), checked by the owner:

- [ ] 10 series refresh automatically every day for 3 consecutive days with no manual help
      (quarterly GDP refreshes on Mondays, per the PRD schedule)
- [x] Rerunning a job creates no duplicate rows (`tests/pipeline.test.ts`)
- [x] A changed historical value is recorded in `data/revisions.csv` (`tests/pipeline.test.ts`)
- [x] A broken series shows its error on the Data Status page while the others still update

## Setup

1. **FRED API key.** Free at <https://fred.stlouisfed.org/docs/api/api_key.html>. Add it as the
   repository secret `FRED_API_KEY` (Settings → Secrets and variables → Actions). For local runs, copy
   `.env.example` to `.env` and paste it there (`.env` is gitignored).
2. **GitHub Pages** must use "GitHub Actions" as its source (Settings → Pages).

## Working locally

Node 24 or later runs the TypeScript pipeline directly, with no build step.

```bash
npm install
npm run refresh -- --tier all          # fetch every series into data/
npm run refresh -- --only US.I1,EA.R2  # just these series
npm run dev                            # http://localhost:5174
npm test
npm run typecheck
```

`--tier scheduled` does what the daily run does: the daily tier, plus weekly on Mondays and monthly on
the 1st (UTC).

## Refreshing by hand

Data Status → **Run refresh on GitHub**, or Actions → *Refresh data* → **Run workflow**. Leave *only*
blank for everything, or list series IDs.

## Layout

| Path | What it holds |
| --- | --- |
| `config/economies.yaml` | The 15 economies: region, GDP weight, inflation target, data gaps |
| `config/indicators.yaml` | The 31 indicators: unit, reference line, stress direction, trend deadband |
| `config/series.yaml` | Indicator–economy pairs: source, verified series key, transform, lag, licence |
| `config/settings.yaml` | Percentile window and bands, trend lookbacks, stale rule, schedule |
| `pipeline/` | Connectors, upsert and revisions, transforms, derived metrics, the run CLI |
| `data/observations/` | One CSV per series (`period,value,first_seen,last_changed`); daily series split by year |
| `data/revisions.csv` | Every revised value: when it was seen, old and new value |
| `data/derived/metrics.json` | Latest value, trend, percentile, z-score, stress and stale flag per series |
| `data/status/` | Last fetch result per series and the last 120 run summaries |
| `src/` | The web app |
| `scripts/build-data.ts` | Builds `public/data/*.json` for the app from `data/` (not committed) |

## Adding a series, indicator or economy

No code change is needed:

1. Find the series at its source and **check the identifier against the live source**. Record what you
   saw and when under `verified`, and the reuse terms under `licence`.
2. Add an entry to `config/series.yaml` (and to `indicators.yaml` or `economies.yaml` if new).
3. Run `npm run refresh -- --only <ID>` and check the Data Status page.

If you change an existing series' `source` or `key`, the next run replaces its stored history instead of
logging every value as a revision. A new source needs a connector in `pipeline/connectors/` that returns
`{ period, value }` pairs.

## Source notes

- **FRED** needs the API key. Data are public domain with citation requested; some third-party series
  (for example ICE BofA credit spreads) restrict reproduction. Check before adding them, because this site is public.
- **DBnomics** is used where its copy is current (ECB datasets). Its copies of Eurostat and BIS had stopped
  updating as of October 2026, so those come straight from the source.
- **Eurostat** moved the HICP to ECOICOP ver. 2 in 2026 (dataset `prc_hicp_minr`). Growth rates for the euro
  area are taken as published: computing them from levels breaks when membership changes (Bulgaria, 2026).
