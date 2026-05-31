import type { CompareReport } from "./compare.js";

/** Status names `--fail-on` accepts, each mapping to a summary counter. */
export const GATE_STATUSES = [
  "drifted",
  "broken",
  "pricier",
  "slower",
  "cheaper",
  "faster",
] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export interface GateResult {
  failed: boolean;
  tripped: { status: GateStatus; count: number }[];
}

/**
 * Decide whether a comparison should fail CI. `statuses` is the user's
 * `--fail-on` list; the gate trips if any named status has a non-zero count.
 * Throws on an unknown status name so a typo fails loudly instead of silently
 * never gating.
 */
export function evaluateGate(report: CompareReport, statuses: string[]): GateResult {
  const tripped: { status: GateStatus; count: number }[] = [];
  for (const raw of statuses) {
    const s = raw.trim().toLowerCase();
    if (s === "") continue;
    if (!(GATE_STATUSES as readonly string[]).includes(s)) {
      throw new Error(
        `Unknown --fail-on status "${raw}". Valid: ${GATE_STATUSES.join(", ")}.`
      );
    }
    const status = s as GateStatus;
    const count = report.summary[status];
    if (count > 0) tripped.push({ status, count });
  }
  return { failed: tripped.length > 0, tripped };
}
