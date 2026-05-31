import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareRuns, loadRunFile } from "../core/compare.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";

function cfg(threshold = 0.9): Config {
  return {
    targets: [],
    cases_dir: "./cases",
    pricing: {},
    diff: { similarity_threshold: threshold },
  };
}

function result(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c1",
    inputIndex: 0,
    targetId: "t",
    model: "m",
    provider: "anthropic",
    prompt: "p",
    status: "OK",
    output: "hello world",
    tokensIn: 100,
    tokensOut: 50,
    cost: 0.001,
    priced: true,
    latencyMs: 1000,
    ...over,
  };
}

function runFile(targetId: string, model: string, results: CaseResult[], threshold = 0.9): RunFile {
  return {
    schema: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    config: cfg(threshold),
    targets: [{ id: targetId, provider: "anthropic", model }],
    results: results.map((r) => ({ ...r, targetId, model })),
  };
}

describe("compareRuns", () => {
  it("pairs by caseId+inputIndex and marks OK for identical", () => {
    const a = runFile("opus-4-7", "claude-opus-4-7", [result({ output: "same text here" })]);
    const b = runFile("opus-4-8", "claude-opus-4-8", [result({ output: "same text here" })]);
    const rep = compareRuns(a, b);
    expect(rep.aTargetId).toBe("opus-4-7");
    expect(rep.bTargetId).toBe("opus-4-8");
    expect(rep.summary.total).toBe(1);
    expect(rep.summary.ok).toBe(1);
    expect(rep.pairs[0].cell?.statuses).toEqual(["OK"]);
  });

  it("detects drift", () => {
    const a = runFile("a", "ma", [result({ output: "the quick brown fox jumps" })]);
    const b = runFile("b", "mb", [result({ output: "totally unrelated content string" })]);
    const rep = compareRuns(a, b);
    expect(rep.summary.drifted).toBe(1);
  });

  it("detects cost delta direction", () => {
    const a = runFile("a", "ma", [result({ cost: 0.002 })]);
    const b = runFile("b", "mb", [result({ cost: 0.001 })]);
    const rep = compareRuns(a, b);
    expect(rep.summary.cheaper).toBe(1);
    expect(rep.pairs[0].cell?.costDelta).toBeCloseTo(-0.001, 9);
  });

  it("treats a missing pair side as broken", () => {
    const a = runFile("a", "ma", [
      result({ caseId: "c1" }),
      result({ caseId: "c2" }),
    ]);
    const b = runFile("b", "mb", [result({ caseId: "c1" })]);
    const rep = compareRuns(a, b);
    expect(rep.summary.total).toBe(2);
    expect(rep.summary.broken).toBe(1);
  });

  it("counts assertion failure as broken", () => {
    const a = runFile("a", "ma", [result({ assertionsPass: true })]);
    const b = runFile("b", "mb", [result({ assertionsPass: false })]);
    const rep = compareRuns(a, b);
    expect(rep.summary.broken).toBe(1);
  });

  it("sums total cost per side", () => {
    const a = runFile("a", "ma", [result({ cost: 0.001 }), result({ caseId: "c2", cost: 0.002 })]);
    const b = runFile("b", "mb", [result({ cost: 0.003 }), result({ caseId: "c2", cost: 0.004 })]);
    const rep = compareRuns(a, b);
    expect(rep.summary.totalCostA).toBeCloseTo(0.003, 9);
    expect(rep.summary.totalCostB).toBeCloseTo(0.007, 9);
  });

  it("excludes one-sided cases from cost totals (only paired cells count)", () => {
    const a = runFile("a", "ma", [result({ caseId: "c1", cost: 0.001 })]);
    const b = runFile("b", "mb", [
      result({ caseId: "c1", cost: 0.002 }),
      result({ caseId: "extra", cost: 0.005 }), // only in B
    ]);
    const rep = compareRuns(a, b);
    expect(rep.summary.broken).toBe(1); // the one-sided "extra"
    expect(rep.summary.totalCostA).toBeCloseTo(0.001, 9);
    expect(rep.summary.totalCostB).toBeCloseTo(0.002, 9); // 0.005 excluded
  });

  it("selects target explicitly when run has several", () => {
    const a: RunFile = {
      ...runFile("x", "mx", [result({ targetId: "x" })]),
      targets: [
        { id: "x", provider: "anthropic", model: "mx" },
        { id: "y", provider: "anthropic", model: "my" },
      ],
      results: [
        result({ targetId: "x", model: "mx", output: "from x" }),
        result({ targetId: "y", model: "my", output: "from y" }),
      ],
    };
    const b = runFile("b", "mb", [result({ output: "from x" })]);
    const rep = compareRuns(a, b, { aTargetId: "y" });
    expect(rep.aTargetId).toBe("y");
    // y output "from y" vs "from x" should differ
    expect(rep.pairs[0].a?.output).toBe("from y");
  });

  it("throws on unknown target", () => {
    const a = runFile("a", "ma", [result({})]);
    const b = runFile("b", "mb", [result({})]);
    expect(() => compareRuns(a, b, { aTargetId: "nope" })).toThrow();
  });
});

describe("loadRunFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "lockstep-runs-"));
  const write = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content, "utf8");
    return p;
  };

  it("names the file on a missing path", () => {
    const missing = join(dir, "does-not-exist.json");
    expect(() => loadRunFile(missing)).toThrow(missing);
  });

  it("names the file on invalid JSON", () => {
    const p = write("bad.json", "{ not json ");
    expect(() => loadRunFile(p)).toThrow(/bad\.json is not valid JSON/);
  });

  it("rejects JSON that is not a lockstep run file", () => {
    const p = write("wrong.json", JSON.stringify({ schema: 99 }));
    expect(() => loadRunFile(p)).toThrow(/not a valid lockstep run file/);
  });

  it("loads a well-formed run file", () => {
    const rf = runFile("a", "ma", [result({})]);
    const p = write("ok.json", JSON.stringify(rf));
    expect(loadRunFile(p).results).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
