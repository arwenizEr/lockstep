import { describe, it, expect } from "vitest";
import { describeRun, planRun } from "../core/runner.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";
import type { Case } from "../core/cases.js";

function result(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c", inputIndex: 0, targetId: "t", model: "m", provider: "mock",
    prompt: "p", status: "OK", output: "o", tokensIn: 1, tokensOut: 1,
    cost: 0.002, priced: true, latencyMs: 10, ...over,
  };
}

describe("describeRun", () => {
  it("summarizes targets, totals, broken count, and cost", () => {
    const run: RunFile = {
      schema: 1, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
      config: { targets: [], cases_dir: "./cases", pricing: {}, diff: { similarity_threshold: 0.9 } },
      targets: [
        { id: "a", provider: "mock", model: "m1" },
        { id: "b", provider: "mock", model: "m2" },
      ],
      results: [
        result({ targetId: "a", cost: 0.001 }),
        result({ targetId: "b", cost: 0.003 }),
        result({ targetId: "b", status: "BROKEN", cost: 0 }),
      ],
    };
    const d = describeRun(run);
    expect(d.targets).toEqual(["a", "b"]);
    expect(d.total).toBe(3);
    expect(d.broken).toBe(1);
    expect(d.totalCost).toBeCloseTo(0.004, 9);
  });
});

const cases: Case[] = [
  { id: "a", prompt: "p", inputs: ["x", "y"], assert: [] },
  { id: "b", prompt: "p", inputs: ["z"], assert: [] },
];
function planCfg(): Config {
  return {
    targets: [
      { id: "t1", provider: "mock", model: "m1" },
      { id: "t2", provider: "mock", model: "m2" },
    ],
    cases_dir: "./cases",
    pricing: { m1: { in: 1, out: 2 } },
    diff: { similarity_threshold: 0.9 },
  };
}

describe("planRun", () => {
  it("computes the full matrix and flags unpriced models", () => {
    const plan = planRun(planCfg(), cases);
    expect(plan.totalCells).toBe(6);
    expect(plan.perTarget.find((t) => t.id === "t1")?.priced).toBe(true);
    expect(plan.perTarget.find((t) => t.id === "t2")?.priced).toBe(false);
  });

  it("respects a target filter", () => {
    const plan = planRun(planCfg(), cases, ["t1"]);
    expect(plan.perTarget).toHaveLength(1);
    expect(plan.totalCells).toBe(3);
  });
});
