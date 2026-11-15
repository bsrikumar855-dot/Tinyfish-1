import fs from "node:fs";
import path from "node:path";

const DIR = process.env.NPTEL_CACHE_DIR ?? path.resolve(process.cwd(), ".cache");
const FILE = path.join(DIR, "nptel-cache.json");
type Store = Record<string, { at: number; ttl: number; value: unknown }>;

function load(): Store {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}

export function cacheGet<T>(key: string, bypass = false): T | undefined {
  if (bypass) return undefined;
  const e = load()[key];
  if (!e || Date.now() - e.at > e.ttl * 1000) return undefined;
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  try {
    const s = load();
    s[key] = { at: Date.now(), ttl: ttlSeconds, value };
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s));
  } catch { /* cache is best-effort */ }
}

export const TTL = {
  search: Number(process.env.NPTEL_SEARCH_TTL ?? 86400),
  detail: Number(process.env.NPTEL_DETAIL_TTL ?? 21600),
};
