import { readFileSync } from "node:fs";
import type { RunFile, CaseResult } from "./runner.js";
import { compareCell, type CompareCell } from "./diff.js";

export function loadRunFile(path: string): RunFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`Could not read run file ${path}: ${(e as Error).message}`);
  }
  let parsed: RunFile;
  try {
    parsed = JSON.parse(raw) as RunFile;
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (parsed.schema !== 1 || !Array.isArray(parsed.results)) {
    throw new Error(`${path} is not a valid lockstep run file.`);
  }
  return parsed;
}

const cellKey = (r: Pick<CaseResult, "caseId" | "inputIndex">) =>
  `${r.caseId}#${r.inputIndex}`;

export interface PairedResult {
  caseId: string;
  inputIndex: number;
  a?: CaseResult;
  b?: CaseResult;
  cell?: CompareCell;
}

export interface CompareReport {
  aTargetId: string;
  bTargetId: string;
  aModel: string;
  bModel: string;
  similarityThreshold: number;
  /** Optional human timestamp for the report footer (set by the CLI). */
  generatedAt?: string;
  pairs: PairedResult[];
  /** Aggregate counts across all pairs. */
  summary: {
    total: number;
    ok: number;
    drifted: number;
    broken: number;
    cheaper: number;
    pricier: number;
    faster: number;
    slower: number;
    totalCostA: number;
    totalCostB: number;
  };
}

/**
 * Compare two runs. Each run may contain several targets; pick one target from
 * each (default: the first target in each file, or the explicitly named ones).
 * Pairs are matched by caseId + inputIndex.
 */
export function compareRuns(
  runA: RunFile,
  runB: RunFile,
  opts: { aTargetId?: string; bTargetId?: string; similarityThreshold?: number } = {}
): CompareReport {
  const aTargetId = opts.aTargetId ?? runA.targets[0]?.id;
  const bTargetId = opts.bTargetId ?? runB.targets[0]?.id;
  if (!aTargetId) throw new Error("Run A has no targets.");
  if (!bTargetId) throw new Error("Run B has no targets.");

  const threshold =
    opts.similarityThreshold ??
    runB.config?.diff?.similarity_threshold ??
    runA.config?.diff?.similarity_threshold ??
    0.9;

  const aResults = runA.results.filter((r) => r.targetId === aTargetId);
  const bResults = runB.results.filter((r) => r.targetId === bTargetId);
  if (aResults.length === 0)
    throw new Error(`No results for target "${aTargetId}" in run A.`);
  if (bResults.length === 0)
    throw new Error(`No results for target "${bTargetId}" in run B.`);

  const aByKey = new Map(aResults.map((r) => [cellKey(r), r]));
  const bByKey = new Map(bResults.map((r) => [cellKey(r), r]));
  const allKeys = [...new Set([...aByKey.keys(), ...bByKey.keys()])].sort();

  const pairs: PairedResult[] = [];
  const summary = {
    total: 0,
    ok: 0,
    drifted: 0,
    broken: 0,
    cheaper: 0,
    pricier: 0,
    faster: 0,
    slower: 0,
    totalCostA: 0,
    totalCostB: 0,
  };

  for (const key of allKeys) {
    const a = aByKey.get(key);
    const b = bByKey.get(key);
    const [caseId, idxStr] = key.split("#");
    const inputIndex = parseInt(idxStr, 10);

    if (a) summary.totalCostA += a.cost;
    if (b) summary.totalCostB += b.cost;

    if (!a || !b) {
      // Missing on one side — treat as broken pair.
      summary.total++;
      summary.broken++;
      pairs.push({ caseId, inputIndex, a, b });
      continue;
    }

    const cell = compareCell(
      {
        caseId,
        inputIndex,
        aOutput: a.output,
        bOutput: b.output,
        aBroken: a.status === "BROKEN",
        bBroken: b.status === "BROKEN",
        aAssertFail: a.assertionsPass === false,
        bAssertFail: b.assertionsPass === false,
        aCost: a.cost,
        bCost: b.cost,
        aLatency: a.latencyMs,
        bLatency: b.latencyMs,
      },
      threshold
    );

    summary.total++;
    if (cell.statuses.includes("BROKEN")) summary.broken++;
    if (cell.statuses.includes("DRIFTED")) summary.drifted++;
    if (cell.statuses.includes("CHEAPER")) summary.cheaper++;
    if (cell.statuses.includes("PRICIER")) summary.pricier++;
    if (cell.statuses.includes("FASTER")) summary.faster++;
    if (cell.statuses.includes("SLOWER")) summary.slower++;
    if (cell.statuses.length === 1 && cell.statuses[0] === "OK") summary.ok++;

    pairs.push({ caseId, inputIndex, a, b, cell });
  }

  return {
    aTargetId,
    bTargetId,
    aModel: aResults[0].model,
    bModel: bResults[0].model,
    similarityThreshold: threshold,
    pairs,
    summary,
  };
}
