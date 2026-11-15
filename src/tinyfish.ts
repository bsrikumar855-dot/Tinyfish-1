import "dotenv/config";
import { NptelError } from "./errors.js";
import { Semaphore, WindowLimiter } from "./limiter.js";
import { FetchResponse } from "./schemas.js";

const agentSlots = new Semaphore(2);
const fetchLimiter = new WindowLimiter(150, 60_000);
export const AGENT_TIMEOUT_MS = Number(process.env.NPTEL_AGENT_TIMEOUT_MS ?? 120_000);

function key(): string {
  const k = process.env.TINYFISH_API_KEY;
  if (!k) throw new NptelError("TINYFISH_FAILED", "TINYFISH_API_KEY is not set (add it to .env)");
  return k;
}

function httpError(status: number, where: string): NptelError {
  if (status === 429) return new NptelError("RATE_LIMITED", `TinyFish ${where} rate limit hit (HTTP 429). Retry later.`);
  return new NptelError("TINYFISH_FAILED", `TinyFish ${where} returned HTTP ${status}`);
}

export interface SseEvent { type: string; [k: string]: unknown }

/** Parse a full SSE body into events (exported for fixture tests). */
export function parseSse(body: string): SseEvent[] {
  return body.split("\n").filter((l) => l.startsWith("data: ")).flatMap((l) => {
    try { return [JSON.parse(l.slice(6)) as SseEvent]; } catch { return []; }
  });
}

/** Interpret the COMPLETE event. COMPLETED is not proof of success: caller must still validate `result`. */
export function resultFromEvents(events: SseEvent[]): unknown {
  const done = events.filter((e) => e.type === "COMPLETE").pop();
  if (!done) throw new NptelError("TINYFISH_FAILED", "Agent stream ended without a COMPLETE event");
  if (done.status !== "COMPLETED") {
    throw new NptelError("TINYFISH_FAILED", `Agent run ${String(done.run_id ?? "?")} ${String(done.status)}: ${String(done.error ?? "no error message")}`);
  }
  if (done.result == null) throw new NptelError("TINYFISH_FAILED", "Agent run COMPLETED but returned no result");
  const text = JSON.stringify(done.result);
  if (/captcha|access denied|blocked by|bot detection/i.test(text) && text.length < 600) {
    throw new NptelError("TINYFISH_FAILED", `Agent run COMPLETED but result signals a block: ${text}`);
  }
  return done.result;
}

export async function runAgent(url: string, goal: string, outputSchema?: object, retries = 1): Promise<unknown> {
  return agentSlots.run(async () => {
    for (let attempt = 0; ; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), AGENT_TIMEOUT_MS);
      try {
        const r = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
          method: "POST",
          signal: ac.signal,
          headers: { "X-API-Key": key(), "Content-Type": "application/json" },
          body: JSON.stringify({ url, goal, ...(outputSchema ? { output_schema: outputSchema } : {}) }),
        });
        if (!r.ok) throw httpError(r.status, "Agent");
        return resultFromEvents(parseSse(await r.text()));
      } catch (e) {
        const retryable = e instanceof NptelError ? e.code === "TINYFISH_FAILED" : true;
        if (attempt < retries && retryable) continue;
        if (e instanceof NptelError) throw e;
        const aborted = (e as Error).name === "AbortError";
        throw new NptelError("TINYFISH_FAILED", `Agent call failed: ${aborted ? `timed out after ${AGENT_TIMEOUT_MS}ms` : (e as Error).message}`);
      } finally { clearTimeout(timer); }
    }
  });
}

export interface FetchOutcome { texts: Map<string, string>; failed: Map<string, { error: string; status: number | null }> }

export async function fetchPages(urls: string[], ttl?: number): Promise<FetchOutcome> {
  await fetchLimiter.take(urls.length);
  let r: Response;
  try {
    r = await fetch("https://api.fetch.tinyfish.ai", {
      method: "POST",
      signal: AbortSignal.timeout(150_000),
      headers: { "X-API-Key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({ urls, ...(ttl !== undefined ? { ttl } : {}) }),
    });
  } catch (e) { throw new NptelError("TINYFISH_FAILED", `Fetch call failed: ${(e as Error).message}`); }
  if (!r.ok) throw httpError(r.status, "Fetch");
  return parseFetchResponse(await r.json());
}

export function parseFetchResponse(raw: unknown): FetchOutcome {
  const p = FetchResponse.safeParse(raw);
  if (!p.success) throw new NptelError("TINYFISH_FAILED", `Unexpected Fetch response shape: ${p.error.issues[0]?.path.join(".")}`);
  const texts = new Map(p.data.results.map((x) => [x.url, x.text]));
  const failed = new Map(p.data.errors.map((x) => [x.url, { error: x.error, status: x.status ?? null }]));
  return { texts, failed };
}

/** TinyFish Search API (GET). Response: {query, results:[{position, site_name, snippet, title, url}]}. */
export async function searchWeb(query: string): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(`https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(30_000), headers: { "X-API-Key": key() } });
  } catch (e) { throw new NptelError("TINYFISH_FAILED", `Search call failed: ${(e as Error).message}`); }
  if (!r.ok) throw httpError(r.status, "Search");
  return r.json();
}
