import { describe, it, expect } from "vitest";
import { renderJUnit } from "../core/junit.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";

function cfg(): Config {
  return { targets: [], cases_dir: "./cases", pricing: {}, diff: { similarity_threshold: 0.9 } };
}
function result(over: Partial<CaseResult>): CaseResult {
  return {
    caseId: "c1", inputIndex: 0, targetId: "t1", model: "m", provider: "mock",
    prompt: "p", status: "OK", output: "ok", tokensIn: 1, tokensOut: 1,
    cost: 0, priced: true, latencyMs: 1200, ...over,
  };
}
function runFile(results: CaseResult[]): RunFile {
  return {
    schema: 1, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
    config: cfg(), targets: [{ id: "t1", provider: "mock", model: "m" }], results,
  };
}

describe("renderJUnit", () => {
  it("counts tests, failures, and errors", () => {
    const x = renderJUnit(
      runFile([
        result({ caseId: "ok", assertionsPass: true }),
        result({ caseId: "broke", status: "BROKEN", error: "boom" }),
        result({
          caseId: "assertfail",
          assertionsPass: false,
          assertions: [{ type: "contains", pass: false, detail: 'missing "x"' }],
        }),
      ])
    );
    expect(x).toContain('tests="3"');
    expect(x).toContain('failures="1"');
    expect(x).toContain('errors="1"');
  });

  it("emits <error> for BROKEN cells", () => {
    const x = renderJUnit(runFile([result({ status: "BROKEN", error: "rate limited" })]));
    expect(x).toMatch(/<error message="rate limited"/);
  });

  it("emits <failure> with the assertion detail", () => {
    const x = renderJUnit(
      runFile([
        result({
          assertionsPass: false,
          assertions: [{ type: "json_valid", pass: false, detail: "no valid JSON found" }],
        }),
      ])
    );
    expect(x).toMatch(/<failure message="json_valid: no valid JSON found"/);
  });

  it("includes a <system-out> with the output + meta for passing testcases", () => {
    const x = renderJUnit(
      runFile([result({ caseId: "good", output: "hello there", assertionsPass: true })])
    );
    expect(x).toContain("<system-out>");
    expect(x).toContain("hello there");
    expect(x).toMatch(/1\/1 tok · 1200ms/);
  });

  it("includes the judge score in <system-out> when present", () => {
    const x = renderJUnit(
      runFile([result({ output: "x", judge: { score: 0.85, reason: "good" }, assertionsPass: true })])
    );
    expect(x).toContain("judge 0.85");
  });

  it("truncates very long output in <system-out>", () => {
    const long = "a".repeat(5000);
    const x = renderJUnit(runFile([result({ output: long, assertionsPass: true })]));
    expect(x).toContain("…");
    expect(x).not.toContain("a".repeat(5000));
  });

  it("omits <system-out> for BROKEN cells (the <error> carries the message)", () => {
    const x = renderJUnit(runFile([result({ status: "BROKEN", error: "boom" })]));
    expect(x).not.toContain("<system-out>");
  });

  it("XML-escapes special characters", () => {
    const x = renderJUnit(runFile([result({ status: "BROKEN", error: 'a<b>&"c' })]));
    expect(x).toContain("a&lt;b&gt;&amp;&quot;c");
    expect(x).not.toMatch(/message="a<b>/);
  });

  it("starts with the XML declaration", () => {
    const x = renderJUnit(runFile([result({})]));
    expect(x.startsWith('<?xml version="1.0"')).toBe(true);
  });
});
