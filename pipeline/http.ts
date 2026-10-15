// HTTP with timeouts, retries and exponential backoff. Secrets in URLs never reach logs or errors.

export interface HttpOptions {
  timeoutMs: number;
  retries: number;
  /** Base delay before the first retry; doubles (x4) each time. Tests set this to 0. */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Hide credentials that appear in query strings. */
export function redact(text: string): string {
  return text.replace(/(api_key|apikey|key|token)=[^&\s"]+/gi, "$1=REDACTED");
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T = unknown>(url: string, opts: HttpOptions): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const backoff = opts.backoffMs ?? 1000;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt > 0) await sleep(backoff * 4 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "global-macro-dashboard (GitHub Actions data refresh)" },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? (err.name === "TimeoutError" ? `timed out after ${opts.timeoutMs / 1000}s` : err.message) : String(err);
      lastError = new Error(redact(`Request failed: ${reason}`));
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(redact(`Response was not JSON: ${text.slice(0, 160)}`));
      }
    }
    const body = redact((await res.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " "));
    lastError = new HttpError(res.status, `HTTP ${res.status}${body ? `: ${body}` : ""}`);
    if (!RETRYABLE(res.status)) break;
  }
  throw lastError ?? new Error("Request failed");
}
