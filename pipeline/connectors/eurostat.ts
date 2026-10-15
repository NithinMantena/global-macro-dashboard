// Eurostat dissemination API (JSON-stat 2.0). No key.
// https://wikis.ec.europa.eu/display/EUROSTATHELP/API+Statistics+-+data+query
// Key format: <dataset>?<dimension>=<code>&...  The filters must select exactly one series.

import { getJson } from "../http.ts";
import { toNumber, type Connector, type RawObservation } from "./types.ts";

const BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

interface JsonStat {
  id?: string[];
  size?: number[];
  value?: Record<string, unknown> | unknown[];
  updated?: string;
  dimension?: Record<string, { category: { index: Record<string, number> | string[] } }>;
}

function splitKey(key: string): { dataset: string; query: string } {
  const [dataset, query = ""] = key.split("?");
  if (!dataset || !/^[a-z0-9_]+$/i.test(dataset)) throw new Error(`Bad Eurostat dataset in key "${key}"`);
  return { dataset, query };
}

/** Parse a single-series JSON-stat response into time-labelled observations. */
export function parseJsonStat(json: JsonStat): RawObservation[] {
  const ids = json.id ?? [];
  const size = json.size ?? [];
  const timePos = ids.indexOf("time");
  if (timePos < 0 || !json.dimension) throw new Error("Eurostat response has no time dimension");
  const series = size.reduce((n, s, i) => (i === timePos ? n : n * s), 1);
  if (series !== 1) throw new Error(`Eurostat filters match ${series} series, expected exactly 1`);

  const index = json.dimension.time.category.index;
  const timeCodes: string[] = Array.isArray(index)
    ? index
    : Object.keys(index).sort((a, b) => index[a] - index[b]);
  // With every other dimension of size 1, the flat value index is the time position.
  const out: RawObservation[] = [];
  const values = json.value ?? {};
  const entries: [number, unknown][] = Array.isArray(values)
    ? values.map((v, i) => [i, v])
    : Object.entries(values).map(([k, v]) => [Number(k), v]);
  for (const [i, raw] of entries) {
    const value = toNumber(raw);
    const period = timeCodes[i];
    if (value !== null && period) out.push({ period, value });
  }
  return out;
}

export const eurostat: Connector = {
  id: "eurostat",
  label: "Eurostat",
  sourceUrl: (key) => `https://ec.europa.eu/eurostat/databrowser/view/${splitKey(key).dataset}/default/table`,
  async fetch(series, ctx) {
    const { dataset, query } = splitKey(series.key);
    const json = await getJson<JsonStat>(`${BASE}/${dataset}?format=JSON&lang=EN&${query}`, ctx.http);
    return { observations: parseJsonStat(json), sourceUpdated: json.updated ?? null };
  },
};
