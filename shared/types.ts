// Types shared by the pipeline, the build-data script and the web app.

export type Frequency = "D" | "M" | "Q" | "A";
export type Schedule = "daily" | "weekly" | "monthly";
export type Transform = "none" | "yoy" | "qoq_saar";
export type StressDirection = "high" | "low" | "both" | "none";
export type SourceId = "fred" | "dbnomics" | "eurostat";
export type TrendLabel = "rising" | "falling" | "flat";

export interface Economy {
  id: string;
  name: string;
  region: string;
  group?: string;
  member_of?: string;
  gdp_weight: number;
  inflation_target: number | null;
  inflation_target_note?: string;
  why: string;
  data_gaps: string | null;
  notes?: string;
}

export interface ReferenceLine {
  value?: number;
  label: string;
  kind: "fixed" | "inflation_target";
}

export interface Indicator {
  id: string;
  name: string;
  short_name: string;
  category: string;
  scope: "economy" | "global";
  frequency: Frequency;
  unit: string;
  display_transform: string;
  reference_line: ReferenceLine | null;
  stress_direction: StressDirection;
  deadband: number;
  deadband_type?: "absolute" | "relative";
  decimals: number;
  derived?: boolean;
  track_last_change?: boolean;
  phase: number;
  notes?: string;
}

export interface SeriesConfig {
  id: string;
  indicator: string;
  economy: string | null;
  source: SourceId;
  key: string;
  frequency: Frequency;
  transform: Transform;
  source_measure: string;
  seasonal_adjustment: string;
  lag_days?: number;
  schedule?: Schedule;
  active?: boolean;
  licence: string;
  verified: { on: string; note: string } | null;
  notes?: string;
}

/** A value for one period. Periods are ISO dates: the first day of the month, quarter or year. */
export interface Observation {
  period: string;
  value: number;
}

export interface StoredObservation extends Observation {
  /** UTC date the pipeline first saw this period. */
  first_seen: string;
  /** UTC date the value was last set (equals first_seen unless revised). */
  last_changed: string;
}

export interface Revision {
  detected_on: string;
  series: string;
  period: string;
  old_value: number;
  new_value: number;
}

export interface DerivedMetrics {
  series: string;
  observations: number;
  latest: { period: string; value: number; first_seen: string } | null;
  /** Change in display units (or % for relative-deadband indicators) vs N months earlier. */
  changes: Record<string, number | null>;
  trends: Record<string, TrendLabel | null>;
  /** The headline trend (6-month comparison; 12-month for annual data). */
  trend: TrendLabel | null;
  percentile: number | null;
  band: string | null;
  z_score: number | null;
  window_start: string | null;
  short_window: boolean;
  stress: "normal" | "elevated" | "extreme" | null;
  stale: boolean;
  stale_after: string | null;
  last_change: { date: string; from: number; to: number } | null;
}

export interface SeriesStatus {
  /** source:key of the last successful fetch. A change means the stored history is replaced. */
  source_key: string | null;
  last_attempt: string | null;
  last_success: string | null;
  result: "ok" | "error" | "never";
  error: string | null;
  consecutive_failures: number;
  new_rows: number;
  revised_rows: number;
  total_rows: number;
  oldest_period: string | null;
  newest_period: string | null;
  source_updated: string | null;
  duration_ms: number | null;
}

export interface RunSummary {
  id: string;
  started_at: string;
  finished_at: string;
  trigger: string;
  tier: string;
  attempted: number;
  ok: number;
  failed: number;
  new_rows: number;
  revised_rows: number;
  failures: { series: string; error: string }[];
}

/** The bundle the Data Status page reads (public/data/status.json). */
export interface StatusBundle {
  generated_at: string;
  data_as_of: string | null;
  repo: string;
  refresh_url: string;
  economies: Pick<Economy, "id" | "name" | "region" | "group">[];
  series: StatusRow[];
  runs: RunSummary[];
  revisions: Revision[];
  coverage: { economies: number; indicators: number; series_configured: number };
}

export interface StatusRow {
  id: string;
  indicator: string;
  indicator_name: string;
  unit: string;
  decimals: number;
  economy: string | null;
  economy_name: string | null;
  source: SourceId;
  source_label: string;
  key: string;
  source_url: string;
  frequency: Frequency;
  schedule: Schedule;
  licence: string;
  verified: { on: string; note: string } | null;
  notes: string | null;
  status: SeriesStatus;
  derived: DerivedMetrics | null;
  /** Display values for a small sparkline: up to the last 5 years, at most 60 points. */
  spark: number[];
}
