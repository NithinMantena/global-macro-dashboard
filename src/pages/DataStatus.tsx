import { useMemo } from "react";
import { formatPeriod } from "../../shared/periods.ts";
import type { StatusBundle, StatusRow } from "../../shared/types.ts";
import { Sparkline } from "../components/Sparkline.tsx";
import { formatTimestamp, formatValue, percentilePhrase, relativeTime, TREND_ARROW } from "../lib/format.ts";
import { useStatus } from "../lib/useStatus.ts";

type Health = "ok" | "stale" | "error" | "never";

function healthOf(row: StatusRow): Health {
  if (row.status.result === "never") return "never";
  if (row.status.result === "error") return "error";
  return row.derived?.stale ? "stale" : "ok";
}

const HEALTH_LABEL: Record<Health, string> = { ok: "Up to date", stale: "Stale", error: "Failing", never: "Not fetched yet" };
const HEALTH_ICON: Record<Health, string> = { ok: "●", stale: "◐", error: "✕", never: "○" };

export function DataStatus() {
  const { data, error } = useStatus();
  if (error) return <section className="page"><h1>Data status</h1><p className="notice error">{error}</p></section>;
  if (!data) return <section className="page"><h1>Data status</h1><p className="muted">Loading…</p></section>;
  return <StatusView data={data} />;
}

function StatusView({ data }: { data: StatusBundle }) {
  const counts = useMemo(() => {
    const c: Record<Health, number> = { ok: 0, stale: 0, error: 0, never: 0 };
    for (const s of data.series) c[healthOf(s)]++;
    return c;
  }, [data]);

  const groups = useMemo(() => {
    const order = new Map(data.economies.map((e, i) => [e.id, i]));
    const byEconomy = new Map<string, StatusRow[]>();
    for (const s of data.series) {
      const key = s.economy ?? "GLOBAL";
      byEconomy.set(key, [...(byEconomy.get(key) ?? []), s]);
    }
    return [...byEconomy.entries()].sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [data]);

  const lastRun = data.runs[0];
  return (
    <section className="page">
      <header className="page-head">
        <h1>Data status</h1>
        <p className="lede">Every series the dashboard tracks: where it comes from, when it was last fetched, and whether it is healthy.</p>
      </header>

      <div className="stats">
        <Stat label="Data as of" value={data.data_as_of ? formatTimestamp(data.data_as_of) : "No successful run yet"} />
        <Stat
          label="Last run"
          value={lastRun ? relativeTime(lastRun.finished_at) : "Never"}
          detail={lastRun ? `${lastRun.ok} ok · ${lastRun.failed} failed · ${lastRun.trigger}` : undefined}
        />
        <Stat
          label="Series"
          value={`${counts.ok} of ${data.series.length} up to date`}
          detail={[counts.error && `${counts.error} failing`, counts.stale && `${counts.stale} stale`, counts.never && `${counts.never} not fetched`]
            .filter(Boolean)
            .join(" · ") || "All healthy"}
          tone={counts.error ? "error" : counts.stale ? "warn" : "ok"}
        />
        <Stat label="Next scheduled run" value="Daily, 06:00 UTC" detail="Quarterly series on Mondays" />
      </div>

      <div className="panel refresh">
        <div>
          <h2>Refresh now</h2>
          <p>
            Opens the refresh workflow on GitHub. Choose <strong>Run workflow</strong>, then leave <em>only</em> blank for all
            series or enter IDs such as <code>US.I1,EA.R2</code>. The site updates a few minutes after the run finishes.
          </p>
        </div>
        <a className="button" href={data.refresh_url} target="_blank" rel="noreferrer">
          Run refresh on GitHub ↗
        </a>
      </div>

      <h2 className="section-title">Series</h2>
      {groups.map(([economy, rows]) => (
        <div key={economy} className="group">
          <h3>{rows[0].economy_name ?? "Global markets"}</h3>
          <div className="table" role="table" aria-label={`${rows[0].economy_name ?? "Global"} series`}>
            <div className="tr th" role="row">
              <span role="columnheader">Indicator</span>
              <span role="columnheader">Latest</span>
              <span role="columnheader">5 years</span>
              <span role="columnheader">Source</span>
              <span role="columnheader">Last fetch</span>
              <span role="columnheader">Status</span>
            </div>
            {rows.map((row) => (
              <SeriesRow key={row.id} row={row} />
            ))}
          </div>
        </div>
      ))}

      <h2 className="section-title">Recent runs</h2>
      {data.runs.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <div className="runs" role="table" aria-label="Recent runs">
          <div className="tr th" role="row">
            <span role="columnheader">Finished</span>
            <span role="columnheader">Trigger</span>
            <span role="columnheader">Scope</span>
            <span role="columnheader">Result</span>
            <span role="columnheader">New rows</span>
            <span role="columnheader">Revisions</span>
          </div>
          {data.runs.map((r) => (
            <div className="tr" role="row" key={r.id}>
              <span role="cell" data-label="Finished">{formatTimestamp(r.finished_at)}</span>
              <span role="cell" data-label="Trigger">{r.trigger}</span>
              <span role="cell" data-label="Scope">{r.tier}</span>
              <span role="cell" data-label="Result" className={r.failed ? "tone-error" : "tone-ok"}>
                {r.ok} ok{r.failed ? ` · ${r.failed} failed` : ""}
              </span>
              <span role="cell" data-label="New rows" className="num">{r.new_rows.toLocaleString("en-US")}</span>
              <span role="cell" data-label="Revisions" className="num">{r.revised_rows}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="section-title">Recent revisions</h2>
      {data.revisions.length === 0 ? (
        <p className="muted">No revised values detected yet. When a source changes a number it already published, it is listed here.</p>
      ) : (
        <ul className="revisions">
          {data.revisions.map((r) => (
            <li key={`${r.series}-${r.period}-${r.detected_on}`}>
              <code>{r.series}</code> {r.period}: {r.old_value} → {r.new_value} <span className="muted">(seen {r.detected_on})</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">External links</h2>
      <p className="muted">Link checks start in Phase 1, when the indicator explanations and their outside links are added.</p>
    </section>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "ok" | "warn" | "error" }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

function SeriesRow({ row }: { row: StatusRow }) {
  const health = healthOf(row);
  const d = row.derived;
  const latest = d?.latest;
  const phrase = d ? percentilePhrase(d) : null;
  return (
    <div className={`tr series health-${health}`} role="row">
      <span role="cell" data-label="Indicator" className="cell-indicator">
        <strong>{row.indicator_name}</strong>
        <code>{row.id}</code>
      </span>
      <span role="cell" data-label="Latest" className="cell-latest">
        {latest ? (
          <>
            <span className="value">{formatValue(latest.value, row.unit, row.decimals)}</span>
            <span className="period">{formatPeriod(latest.period, row.frequency)}</span>
            {d.trend && (
              <span className={`trend trend-${d.trend}`}>
                <span aria-hidden="true">{TREND_ARROW[d.trend]}</span> {d.trend[0].toUpperCase() + d.trend.slice(1)} over 6 months
              </span>
            )}
            {phrase && <span className={`pct stress-${d.stress ?? "neutral"}`}>{phrase}</span>}
            {d.last_change && (
              <span className="period">
                Last changed {formatPeriod(d.last_change.date, "D")} ({d.last_change.from} → {d.last_change.to})
              </span>
            )}
          </>
        ) : (
          <span className="muted">No data</span>
        )}
      </span>
      <span role="cell" data-label="5 years" className="cell-spark">
        <Sparkline values={row.spark} label={`${row.indicator_name}, last five years`} />
      </span>
      <span role="cell" data-label="Source" className="cell-source">
        <a href={row.source_url} target="_blank" rel="noreferrer">
          {row.source_label} ↗
        </a>
        <code className="key" title={row.key}>{row.key}</code>
        {row.verified && <span className="muted small">Verified {row.verified.on}</span>}
      </span>
      <span role="cell" data-label="Last fetch" className="cell-fetch">
        {row.status.last_attempt ? (
          <>
            <span title={formatTimestamp(row.status.last_attempt)}>{relativeTime(row.status.last_attempt)}</span>
            <span className="muted small">
              {row.status.total_rows.toLocaleString("en-US")} rows
              {row.status.result === "ok" && ` · +${row.status.new_rows} new · ${row.status.revised_rows} revised`}
            </span>
            <span className="muted small">Schedule: {row.schedule}</span>
          </>
        ) : (
          <span className="muted">Never</span>
        )}
      </span>
      <span role="cell" data-label="Status" className="cell-status">
        <span className={`badge badge-${health}`}>
          <span aria-hidden="true">{HEALTH_ICON[health]}</span> {HEALTH_LABEL[health]}
        </span>
        {health === "stale" && d?.stale_after && <span className="muted small">Expected new data by {formatPeriod(d.stale_after, "D")}</span>}
        {row.status.result === "error" && row.status.consecutive_failures > 1 && (
          <span className="muted small">{row.status.consecutive_failures} failures in a row</span>
        )}
      </span>
      {row.status.error && (
        <p className="row-error" role="cell">
          <strong>Error:</strong> {row.status.error}
          {row.status.last_success && <> Last success {formatTimestamp(row.status.last_success)}; showing that data.</>}
        </p>
      )}
    </div>
  );
}
