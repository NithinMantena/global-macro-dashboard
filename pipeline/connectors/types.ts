import type { HttpOptions } from "../http.ts";
import type { SeriesConfig, SourceId } from "../../shared/types.ts";

/** Raw observations as the source labels them; the pipeline normalizes periods afterwards. */
export interface RawObservation {
  period: string;
  value: number;
}

export interface FetchResult {
  observations: RawObservation[];
  /** When the source says it last updated the series or dataset, if it says. */
  sourceUpdated: string | null;
}

export interface ConnectorContext {
  env: Record<string, string | undefined>;
  http: HttpOptions;
}

export interface Connector {
  id: SourceId;
  label: string;
  /** A page a person can open to see the series at the source. */
  sourceUrl(key: string): string;
  fetch(series: SeriesConfig, ctx: ConnectorContext): Promise<FetchResult>;
}

/** Keep only finite numbers; sources mark gaps with ".", "NA", null or empty strings. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "." || value === "NA") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
