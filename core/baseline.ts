import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * A pinned "golden" run. When set, `compare`/`report` with no explicit runs diff
 * the newest run against this baseline instead of against the previous run — so a
 * suite is measured against a known-good snapshot, not just the last execution.
 */
export interface Baseline {
  /** Path to the pinned run file. */
  run: string;
  /** Optional target id within the baseline run to compare against. */
  target?: string;
  setAt: string;
}

function pointerPath(baseDir: string): string {
  return join(baseDir, ".lockstep", "baseline.json");
}

export function setBaseline(
  baseDir: string,
  runPath: string,
  target: string | undefined,
  now: string
): Baseline {
  mkdirSync(join(baseDir, ".lockstep"), { recursive: true });
  const baseline: Baseline = { run: runPath, target, setAt: now };
  writeFileSync(pointerPath(baseDir), JSON.stringify(baseline, null, 2), "utf8");
  return baseline;
}

/** Read the pinned baseline, or undefined if none is set / the pointer is junk. */
export function getBaseline(baseDir: string): Baseline | undefined {
  const p = pointerPath(baseDir);
  if (!existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as Baseline;
    return typeof parsed.run === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Remove the pinned baseline. Returns true if a pointer existed. */
export function clearBaseline(baseDir: string): boolean {
  const p = pointerPath(baseDir);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}
