import type { RunFile, CaseResult } from "./runner.js";
import { cosineSimilarity } from "./diff.js";

// ---------------------------------------------------------------------------
// Trend: track a suite across MANY runs (not just two). Answers "is this prompt
// slowly drifting / getting pricier over successive model releases?" — the
// thing a two-run `compare` can't show. Pure over saved run files.
// ---------------------------------------------------------------------------

export interface TrendPoint {
  startedAt: string;
  totalCost: number;
  avgLatencyMs: number;
  broken: number;
  /** Mean similarity of each cell's output to the same cell in the first run. */
  meanSimilarityToFirst: number;
}

export interface TrendCaseSeries {
  key: string; // caseId#inputIndex
  /** Similarity-to-first per run (1.0 for the first run). null where the cell is absent. */
  similarities: (number | null)[];
}

export interface Trend {
  target: string;
  startedAts: string[];
  points: TrendPoint[];
  cases: TrendCaseSeries[];
}

const cellKey = (r: Pick<CaseResult, "caseId" | "inputIndex">) =>
  `${r.caseId}#${r.inputIndex}`;

function pickTarget(run: RunFile, targetId?: string): string | undefined {
  if (targetId) return run.targets.some((t) => t.id === targetId) ? targetId : undefined;
  return run.targets[0]?.id;
}

/**
 * Build a trend across runs for one target. Runs are sorted by `startedAt`. The
 * first run is the reference for similarity. Runs that don't contain the target
 * are skipped.
 */
export function computeTrend(runs: RunFile[], targetId?: string): Trend {
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const perRun: { startedAt: string; byKey: Map<string, CaseResult> }[] = [];
  let resolvedTarget = targetId;
  for (const run of sorted) {
    const tid = pickTarget(run, targetId);
    if (!tid) continue;
    if (!resolvedTarget) resolvedTarget = tid;
    if (tid !== resolvedTarget) continue;
    const byKey = new Map<string, CaseResult>();
    for (const r of run.results) if (r.targetId === tid) byKey.set(cellKey(r), r);
    perRun.push({ startedAt: run.startedAt, byKey });
  }

  if (perRun.length === 0) {
    return { target: resolvedTarget ?? "(none)", startedAts: [], points: [], cases: [] };
  }

  const first = perRun[0].byKey;
  const allKeys = [...new Set(perRun.flatMap((p) => [...p.byKey.keys()]))].sort();

  const cases: TrendCaseSeries[] = allKeys.map((key) => {
    const ref = first.get(key);
    const similarities = perRun.map((p) => {
      const cur = p.byKey.get(key);
      if (!cur || !ref) return null;
      if (cur.status === "BROKEN" || ref.status === "BROKEN") return 0;
      return cosineSimilarity(ref.output, cur.output);
    });
    return { key, similarities };
  });

  const points: TrendPoint[] = perRun.map((p) => {
    const results = [...p.byKey.values()];
    const okLatencies = results.filter((r) => r.status === "OK").map((r) => r.latencyMs);
    const sims = cases
      .map((c) => c.similarities[perRun.indexOf(p)])
      .filter((s): s is number => s !== null);
    return {
      startedAt: p.startedAt,
      totalCost: results.reduce((n, r) => n + r.cost, 0),
      avgLatencyMs: okLatencies.length
        ? Math.round(okLatencies.reduce((n, x) => n + x, 0) / okLatencies.length)
        : 0,
      broken: results.filter((r) => r.status === "BROKEN").length,
      meanSimilarityToFirst: sims.length ? sims.reduce((n, x) => n + x, 0) / sims.length : 1,
    };
  });

  return {
    target: resolvedTarget ?? "(none)",
    startedAts: perRun.map((p) => p.startedAt),
    points,
    cases,
  };
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/**
 * Render a numeric series as a unicode sparkline. `null` values render as a gap
 * (·). When min/max aren't given they are taken from the finite values; a flat
 * series renders mid-height.
 */
export function sparkline(values: (number | null)[], min?: number, max?: number): string {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return "·".repeat(values.length);
  const lo = min ?? Math.min(...finite);
  const hi = max ?? Math.max(...finite);
  const span = hi - lo;
  return values
    .map((v) => {
      if (v === null || !Number.isFinite(v)) return "·";
      if (span === 0) return SPARK_CHARS[Math.floor((SPARK_CHARS.length - 1) / 2)];
      const idx = Math.round(((v - lo) / span) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
    })
    .join("");
}
