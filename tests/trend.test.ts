import { describe, it, expect } from "vitest";
import { computeTrend, sparkline } from "../core/trend.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";

const cfg: Config = {
  targets: [],
  cases_dir: "./cases",
  pricing: {},
  diff: { similarity_threshold: 0.9 },
  redact: [],
};

function res(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c1",
    inputIndex: 0,
    targetId: "t",
    model: "m",
    provider: "mock",
    prompt: "p",
    status: "OK",
    output: "hello world",
    tokensIn: 1,
    tokensOut: 1,
    cost: 0.001,
    priced: true,
    latencyMs: 100,
    ...over,
  };
}

function run(startedAt: string, results: CaseResult[]): RunFile {
  return {
    schema: 1,
    startedAt,
    finishedAt: startedAt,
    config: cfg,
    targets: [{ id: "t", provider: "mock", model: "m" }],
    results,
  };
}

describe("computeTrend", () => {
  it("sorts by startedAt and measures similarity to the first run", () => {
    const r1 = run("2026-01-01T00:00:00.000Z", [res({ output: "the quick brown fox" })]);
    const r2 = run("2026-01-02T00:00:00.000Z", [res({ output: "the quick brown fox" })]);
    const r3 = run("2026-01-03T00:00:00.000Z", [res({ output: "a totally different sentence here" })]);
    // pass out of order — computeTrend must sort
    const trend = computeTrend([r3, r1, r2]);
    expect(trend.target).toBe("t");
    expect(trend.points).toHaveLength(3);
    const sims = trend.cases[0].similarities;
    expect(sims[0]).toBe(1); // first vs itself
    expect(sims[1]).toBe(1); // identical
    expect(sims[2]!).toBeLessThan(1); // drifted
  });

  it("aggregates cost, latency, and broken counts per run", () => {
    const r1 = run("2026-01-01T00:00:00.000Z", [res({ cost: 0.002, latencyMs: 200 })]);
    const r2 = run("2026-01-02T00:00:00.000Z", [res({ status: "BROKEN", output: "", cost: 0, latencyMs: 0 })]);
    const trend = computeTrend([r1, r2]);
    expect(trend.points[0].totalCost).toBeCloseTo(0.002);
    expect(trend.points[0].avgLatencyMs).toBe(200);
    expect(trend.points[1].broken).toBe(1);
    expect(trend.cases[0].similarities[1]).toBe(0); // broken => 0 similarity
  });

  it("skips runs that lack the requested target", () => {
    const r1 = run("2026-01-01T00:00:00.000Z", [res({})]);
    const other: RunFile = {
      ...run("2026-01-02T00:00:00.000Z", [res({ targetId: "x" })]),
      targets: [{ id: "x", provider: "mock", model: "m" }],
    };
    const trend = computeTrend([r1, other], "t");
    expect(trend.points).toHaveLength(1);
  });
});

describe("sparkline", () => {
  it("maps a rising series to rising bars", () => {
    const s = sparkline([0, 0.5, 1], 0, 1);
    expect(s.length).toBe(3);
    expect(s[0]).toBe("▁");
    expect(s[2]).toBe("█");
  });
  it("renders nulls as gaps", () => {
    expect(sparkline([null, null])).toBe("··");
  });
  it("renders a flat series at mid height", () => {
    expect(sparkline([5, 5, 5])).toBe("▄▄▄");
  });
});
