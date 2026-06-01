import { describe, it, expect } from "vitest";
import { runFailures } from "../core/runner.js";
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
    caseId: "c",
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

const rf = (results: CaseResult[]): RunFile => ({
  schema: 1,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:00.000Z",
  config: cfg,
  targets: [{ id: "t", provider: "mock", model: "m" }],
  results,
});

describe("runFailures", () => {
  it("counts broken and assertion-failed cells separately", () => {
    const f = runFailures(
      rf([
        res({ assertionsPass: true }),
        res({ status: "BROKEN", output: "", error: "boom" }),
        res({ assertionsPass: false }),
        res({ assertionsPass: false }),
      ])
    );
    expect(f.broken).toBe(1);
    expect(f.assertionFailed).toBe(2);
    expect(f.total).toBe(3);
  });

  it("is all-zero for a clean run", () => {
    expect(runFailures(rf([res({ assertionsPass: true }), res({})])).total).toBe(0);
  });

  it("does not count a BROKEN cell twice even if assertionsPass is false-ish", () => {
    // BROKEN cells have no assertions; ensure they count only as broken.
    const f = runFailures(rf([res({ status: "BROKEN", output: "", assertionsPass: undefined })]));
    expect(f.broken).toBe(1);
    expect(f.assertionFailed).toBe(0);
  });
});
