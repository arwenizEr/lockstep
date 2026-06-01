import type { RunFile } from "./runner.js";

export interface BudgetResult {
  /** Whether the run exceeded the budget. */
  exceeded: boolean;
  /** Total cost of all priced results in the run. */
  total: number;
  /** The budget that was checked against. */
  limit: number;
  /** True if any OK result had no price entry — the total understates real spend. */
  unpriced: boolean;
}

/**
 * Decide whether a run's total cost exceeds a budget. Pure — powers
 * `run --max-cost`. Unpriced models contribute 0, so `unpriced` is surfaced to
 * warn that the reported total may be an undercount.
 */
export function evaluateBudget(run: RunFile, limit: number): BudgetResult {
  let total = 0;
  let unpriced = false;
  for (const r of run.results) {
    total += r.cost;
    if (r.status === "OK" && !r.priced) unpriced = true;
  }
  return { exceeded: total > limit, total, limit, unpriced };
}

/** Parse a `--max-cost` argument; throws on a non-positive / non-numeric value. */
export function parseBudget(raw: string): number {
  const n = Number(raw.replace(/^\$/, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --max-cost "${raw}". Expected a non-negative number (USD).`);
  }
  return n;
}
