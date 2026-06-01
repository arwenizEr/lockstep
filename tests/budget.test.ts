import { describe, it, expect } from "vitest";
import { evaluateBudget, parseBudget } from "../core/budget.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";

const cfg: Config = {
  targets: [],
  cases_dir: "./cases",
  pricing: {},
  diff: { similarity_threshold: 0.9 },
  redact: [],
};

function result(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c1",
    inputIndex: 0,
    targetId: "t",
    model: "m",
    provider: "mock",
    prompt: "p",
    status: "OK",
    output: "x",
    tokensIn: 1,
    tokensOut: 1,
    cost: 0,
    priced: true,
    latencyMs: 1,
    ...over,
  };
}

function runFile(results: CaseResult[]): RunFile {
  return {
    schema: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    config: cfg,
    targets: [{ id: "t", provider: "mock", model: "m" }],
    results,
  };
}

describe("evaluateBudget", () => {
  it("sums cost and flags when over the limit", () => {
    const r = evaluateBudget(runFile([result({ cost: 0.4 }), result({ cost: 0.3 })]), 0.5);
    expect(r.total).toBeCloseTo(0.7);
    expect(r.exceeded).toBe(true);
  });

  it("passes when at or under the limit", () => {
    expect(evaluateBudget(runFile([result({ cost: 0.5 })]), 0.5).exceeded).toBe(false);
  });

  it("flags unpriced OK results so the total is known to undercount", () => {
    const r = evaluateBudget(runFile([result({ cost: 0, priced: false })]), 1);
    expect(r.unpriced).toBe(true);
  });

  it("ignores priced=false on BROKEN rows (no spend)", () => {
    const r = evaluateBudget(runFile([result({ status: "BROKEN", cost: 0, priced: false })]), 1);
    expect(r.unpriced).toBe(false);
  });
});

describe("parseBudget", () => {
  it("parses plain and $-prefixed numbers", () => {
    expect(parseBudget("0.50")).toBe(0.5);
    expect(parseBudget("$2")).toBe(2);
  });
  it("rejects negative and non-numeric", () => {
    expect(() => parseBudget("-1")).toThrow(/Invalid/);
    expect(() => parseBudget("abc")).toThrow(/Invalid/);
  });
});
