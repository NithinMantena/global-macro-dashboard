// FRED (St. Louis Fed) REST API. Needs a free API key in FRED_API_KEY.
// https://fred.stlouisfed.org/docs/api/fred/series_observations.html

import { getJson } from "../http.ts";
import { toNumber, type Connector, type RawObservation } from "./types.ts";

const BASE = "https://api.stlouisfed.org/fred";

interface ObservationsResponse {
  observations?: { date: string; value: string }[];
}
interface SeriesResponse {
  seriess?: { id: string; last_updated?: string }[];
}

export const fred: Connector = {
  id: "fred",
  label: "FRED",
  sourceUrl: (key) => `https://fred.stlouisfed.org/series/${encodeURIComponent(key)}`,
  async fetch(series, ctx) {
    const apiKey = ctx.env.FRED_API_KEY;
    if (!apiKey) {
      throw new Error("FRED_API_KEY is not set. Add it as a repository secret (or to .env for local runs).");
    }
    const q = `series_id=${encodeURIComponent(series.key)}&api_key=${encodeURIComponent(apiKey)}&file_type=json`;
    const [obs, info] = await Promise.all([
      getJson<ObservationsResponse>(`${BASE}/series/observations?${q}`, ctx.http),
      getJson<SeriesResponse>(`${BASE}/series?${q}`, ctx.http),
    ]);
    if (!Array.isArray(obs.observations)) throw new Error("FRED response had no observations array");
    const observations: RawObservation[] = [];
    for (const o of obs.observations) {
      const value = toNumber(o.value);
      if (value !== null) observations.push({ period: o.date, value });
    }
    return { observations, sourceUpdated: info.seriess?.[0]?.last_updated ?? null };
  },
};
