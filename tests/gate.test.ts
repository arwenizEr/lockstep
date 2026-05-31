import { describe, it, expect } from "vitest";
import { evaluateGate } from "../core/gate.js";
import { compareRuns } from "../core/compare.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";

function cfg(): Config {
  return { targets: [], cases_dir: "./cases", pricing: {}, diff: { similarity_threshold: 0.9 } };
}
function result(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c1", inputIndex: 0, targetId: "t", model: "m", provider: "mock",
    prompt: "p", status: "OK", output: "hello world", tokensIn: 10, tokensOut: 5,
    cost: 0.001, priced: true, latencyMs: 1000, ...over,
  };
}
function runFile(targetId: string, model: string, results: CaseResult[]): RunFile {
  return {
    schema: 1, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
    config: cfg(), targets: [{ id: targetId, provider: "mock", model }],
    results: results.map((r) => ({ ...r, targetId, model })),
  };
}
const drifty = () =>
  compareRuns(
    runFile("a", "ma", [result({ output: "the quick brown fox" })]),
    runFile("b", "mb", [result({ output: "utterly different words here" })])
  );

describe("evaluateGate", () => {
  it("passes when no listed status is present", () => {
    const rep = compareRuns(
      runFile("a", "ma", [result({ output: "same text here" })]),
      runFile("b", "mb", [result({ output: "same text here" })])
    );
    expect(evaluateGate(rep, ["drifted", "broken"]).failed).toBe(false);
  });

  it("fails when a listed status has a non-zero count", () => {
    const gate = evaluateGate(drifty(), ["drifted"]);
    expect(gate.failed).toBe(true);
    expect(gate.tripped[0]).toEqual({ status: "drifted", count: 1 });
  });

  it("ignores non-listed statuses", () => {
    expect(evaluateGate(drifty(), ["broken"]).failed).toBe(false);
  });

  it("throws on an unknown status name", () => {
    expect(() => evaluateGate(drifty(), ["typo"])).toThrow(/Unknown --fail-on/);
  });

  it("tolerates blank entries from a trailing comma", () => {
    expect(() => evaluateGate(drifty(), ["broken", ""])).not.toThrow();
  });
});
