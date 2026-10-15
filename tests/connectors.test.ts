// Connector parsing against trimmed copies of real responses (shapes captured 2026-10-15).

import { describe, expect, it } from "vitest";
import { dbnomics } from "../pipeline/connectors/dbnomics.ts";
import { eurostat, parseJsonStat } from "../pipeline/connectors/eurostat.ts";
import { fred } from "../pipeline/connectors/fred.ts";
import type { ConnectorContext } from "../pipeline/connectors/types.ts";
import { getJson, redact } from "../pipeline/http.ts";
import type { SeriesConfig } from "../shared/types.ts";

const base: SeriesConfig = {
  id: "T.I1", indicator: "I1", economy: "US", source: "fred", key: "CPIAUCNS", frequency: "M", transform: "yoy",
  source_measure: "", seasonal_adjustment: "NSA", licence: "test", verified: null,
};

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment));
    if (!hit) return new Response("not found", { status: 404 });
    const { status = 200, body } = hit[1];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const ctx = (fetchImpl: typeof fetch, env: Record<string, string> = {}): ConnectorContext => ({
  env,
  http: { timeoutMs: 1000, retries: 2, backoffMs: 0, fetchImpl },
});

describe("FRED", () => {
  it("parses observations, skips '.' gaps and reads last_updated", async () => {
    const { impl } = mockFetch({
      "/series/observations": { body: { observations: [
        { date: "2026-08-01", value: "335.1" },
        { date: "2026-09-01", value: "." },
      ] } },
      "/fred/series?": { body: { seriess: [{ id: "CPIAUCNS", last_updated: "2026-10-14 07:44:02-05" }] } },
    });
    const r = await fred.fetch(base, ctx(impl, { FRED_API_KEY: "secret123" }));
    expect(r.observations).toEqual([{ period: "2026-08-01", value: 335.1 }]);
    expect(r.sourceUpdated).toBe("2026-10-14 07:44:02-05");
  });

  it("fails clearly without an API key", async () => {
    await expect(fred.fetch(base, ctx(mockFetch({}).impl))).rejects.toThrow(/FRED_API_KEY is not set/);
  });

  it("never leaks the API key in errors", async () => {
    const { impl } = mockFetch({ "/series": { status: 400, body: { error_message: "Bad series_id=NOPE&api_key=secret123" } } });
    const err = await fred.fetch(base, ctx(impl, { FRED_API_KEY: "secret123" })).catch((e: Error) => e);
    expect(String(err)).toMatch(/HTTP 400/);
    expect(String(err)).not.toContain("secret123");
  });
});

describe("DBnomics", () => {
  it("parses period/value arrays and skips NA", async () => {
    const { impl, calls } = mockFetch({
      "/v22/series/ECB/IRS/": { body: { series: { num_found: 1, docs: [{
        series_code: "M.U2.L.L40.CI.0000.EUR.N.Z",
        period: ["2026-06", "2026-07", "2026-08"],
        value: [3.44, "NA", 3.6026326031330993],
        indexed_at: "2026-10-01T05:51:32.938Z",
      }] } } },
    });
    const r = await dbnomics.fetch({ ...base, source: "dbnomics", key: "ECB/IRS/M.U2.L.L40.CI.0000.EUR.N.Z" }, ctx(impl));
    expect(calls[0]).toContain("/v22/series/ECB/IRS/M.U2.L.L40.CI.0000.EUR.N.Z?observations=1");
    expect(r.observations).toEqual([{ period: "2026-06", value: 3.44 }, { period: "2026-08", value: 3.6026326031330993 }]);
    expect(r.sourceUpdated).toBe("2026-10-01T05:51:32.938Z");
  });

  it("rejects keys that are not provider/dataset/series", async () => {
    await expect(dbnomics.fetch({ ...base, source: "dbnomics", key: "ECB/IRS" }, ctx(mockFetch({}).impl))).rejects.toThrow(/provider\/dataset\/series/);
  });
});

describe("Eurostat JSON-stat", () => {
  const response = {
    id: ["freq", "unit", "coicop18", "geo", "time"],
    size: [1, 1, 1, 1, 3],
    updated: "2026-10-02T11:00:00+0200",
    value: { "0": 2.1, "2": 3.8 },
    dimension: { time: { category: { index: { "2026-07": 0, "2026-08": 1, "2026-09": 2 } } } },
  };

  it("maps sparse values to time codes", () => {
    expect(parseJsonStat(response)).toEqual([{ period: "2026-07", value: 2.1 }, { period: "2026-09", value: 3.8 }]);
  });

  it("refuses filters that match more than one series", () => {
    expect(() => parseJsonStat({ ...response, size: [1, 2, 1, 1, 3] })).toThrow(/match 2 series/);
  });

  it("builds the query from the key", async () => {
    const { impl, calls } = mockFetch({ "/data/prc_hicp_minr": { body: response } });
    const r = await eurostat.fetch({ ...base, source: "eurostat", key: "prc_hicp_minr?freq=M&unit=RCH_A&coicop18=TOTAL&geo=EA" }, ctx(impl));
    expect(calls[0]).toContain("/data/prc_hicp_minr?format=JSON&lang=EN&freq=M&unit=RCH_A&coicop18=TOTAL&geo=EA");
    expect(r.sourceUpdated).toBe("2026-10-02T11:00:00+0200");
  });
});

describe("http", () => {
  it("retries server errors, then succeeds", async () => {
    let n = 0;
    const impl = (async () => (++n < 3 ? new Response("busy", { status: 503 }) : new Response('{"ok":true}'))) as typeof fetch;
    await expect(getJson("https://x.test/a", { timeoutMs: 1000, retries: 3, backoffMs: 0, fetchImpl: impl })).resolves.toEqual({ ok: true });
    expect(n).toBe(3);
  });

  it("does not retry client errors", async () => {
    let n = 0;
    const impl = (async () => (n++, new Response("nope", { status: 404 }))) as typeof fetch;
    await expect(getJson("https://x.test/a", { timeoutMs: 1000, retries: 3, backoffMs: 0, fetchImpl: impl })).rejects.toThrow(/HTTP 404/);
    expect(n).toBe(1);
  });

  it("redacts credentials", () => {
    expect(redact("https://api/x?series_id=A&api_key=abc123&file_type=json")).toBe("https://api/x?series_id=A&api_key=REDACTED&file_type=json");
  });
});
