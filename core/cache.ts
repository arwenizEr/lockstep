import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RunRequest } from "./providers/types.js";

/**
 * What we persist for a cached call. Latency is the *original* call's latency —
 * a cache hit replays it rather than reporting ~0ms, so cost/latency tables stay
 * meaningful across cached runs.
 */
export interface CacheEntry {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface ProviderCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

/**
 * Stable cache key over everything that can change a model's output: provider,
 * model, system, the full message array, effort/mode, and sampling params. The
 * object is built in a fixed key order so JSON.stringify is deterministic.
 */
export function cacheKey(provider: string, req: RunRequest): string {
  const canonical = {
    provider,
    model: req.model,
    system: req.system ?? null,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    effort: req.effort ?? null,
    mode: req.mode ?? null,
    temperature: req.temperature ?? null,
    topP: req.topP ?? null,
    topK: req.topK ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** In-memory cache — used by tests and as a single-run dedupe. */
export class MemoryCache implements ProviderCache {
  private map = new Map<string, CacheEntry>();
  get(key: string): CacheEntry | undefined {
    return this.map.get(key);
  }
  set(key: string, entry: CacheEntry): void {
    this.map.set(key, entry);
  }
}

/**
 * On-disk cache under `.lockstep/cache/`. One JSON file per key. Reads are
 * best-effort: a corrupt or unreadable entry is treated as a miss rather than
 * crashing a run.
 */
export class FileCache implements ProviderCache {
  private dir: string;
  constructor(baseDir: string) {
    this.dir = join(baseDir, ".lockstep", "cache");
    mkdirSync(this.dir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.dir, `${key}.json`);
  }
  get(key: string): CacheEntry | undefined {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
    } catch {
      return undefined;
    }
  }
  set(key: string, entry: CacheEntry): void {
    writeFileSync(this.path(key), JSON.stringify(entry), "utf8");
  }
}
