// DBnomics: one API over many providers (ECB, OECD, IMF, BIS, Eurostat...). No key.
// https://api.db.nomics.world/v22/apidocs
// Freshness varies by provider: check `indexed_at` against the original source before relying on it.

import { getJson } from "../http.ts";
import { toNumber, type Connector, type RawObservation } from "./types.ts";

const BASE = "https://api.db.nomics.world/v22";

interface SeriesResponse {
  series?: {
    num_found?: number;
    docs?: { series_code: string; period?: string[]; value?: unknown[]; indexed_at?: string }[];
  };
}

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export const dbnomics: Connector = {
  id: "dbnomics",
  label: "DBnomics",
  sourceUrl: (key) => `https://db.nomics.world/${encodeKey(key)}`,
  async fetch(series, ctx) {
    if (series.key.split("/").length !== 3) {
      throw new Error(`DBnomics key must be provider/dataset/series, got "${series.key}"`);
    }
    const json = await getJson<SeriesResponse>(
      `${BASE}/series/${encodeKey(series.key)}?observations=1&format=json&metadata=false`,
      ctx.http,
    );
    const docs = json.series?.docs ?? [];
    if (docs.length !== 1) throw new Error(`DBnomics returned ${docs.length} series for ${series.key}, expected 1`);
    const doc = docs[0];
    const periods = doc.period ?? [];
    const values = doc.value ?? [];
    if (periods.length !== values.length) throw new Error("DBnomics period and value arrays differ in length");
    const observations: RawObservation[] = [];
    periods.forEach((period, i) => {
      const value = toNumber(values[i]);
      if (value !== null) observations.push({ period, value });
    });
    return { observations, sourceUpdated: doc.indexed_at ?? null };
  },
};
