import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../core/report-md.js";
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

describe("renderMarkdown", () => {
  const a = runFile("opus-4-7", "claude-opus-4-7", [result({ output: "the quick brown fox" })]);
  const b = runFile("opus-4-8", "claude-opus-4-8", [result({ output: "utterly different text here" })]);
  const rep = compareRuns(a, b);
  rep.generatedAt = "2026-06-01T00:00:00.000Z";
  const md = renderMarkdown(rep);

  it("includes the headline and a summary table", () => {
    expect(md).toContain("# Lockstep report");
    expect(md).toContain("claude-opus-4-8");
    expect(md).toContain("claude-opus-4-7");
    expect(md).toMatch(/\| ok \| drifted \| broken/);
  });

  it("lists each case with its status", () => {
    expect(md).toContain("`c1#0`");
    expect(md).toContain("DRIFTED");
  });

  it("escapes pipe characters in table cells", () => {
    const a2 = runFile("x", "mx", [result({ caseId: "a|b", output: "one" })]);
    const b2 = runFile("y", "my", [result({ caseId: "a|b", output: "two totally different" })]);
    const m = renderMarkdown(compareRuns(a2, b2));
    expect(m).toContain("a\\|b");
  });

  it("puts changed outputs in a collapsible block", () => {
    expect(md).toContain("<details>");
    expect(md).toContain("the quick brown fox");
    expect(md).toContain("utterly different text here");
  });

  it("omits the changed-outputs section when everything is OK", () => {
    const same = runFile("p", "mp", [result({ output: "identical text" })]);
    const same2 = runFile("q", "mq", [result({ output: "identical text" })]);
    const m = renderMarkdown(compareRuns(same, same2));
    expect(m).not.toContain("## Changed outputs");
  });

  it("adds a `best` column to the Cases table", () => {
    expect(md).toMatch(/\| case \| similarity \| Δ cost \| Δ latency \| status \| best \|/);
    // cheaper/faster/tie verdict for the drifted-but-not-broken pair
    expect(md).toMatch(/tie|cheaper|faster/);
  });

  it("shows judge scores in the detail block when present", () => {
    const ja = runFile("a", "ma", [result({ output: "one", judge: { score: 0.4, reason: "weak" } })]);
    const jb = runFile("b", "mb", [
      result({ output: "two totally different", judge: { score: 0.9, reason: "strong" } }),
    ]);
    const m = renderMarkdown(compareRuns(ja, jb));
    expect(m).toContain("judge — A: 0.40");
    expect(m).toContain("B: 0.90 — strong");
    // judge gap > 0.05 → best column picks B
    expect(m).toContain("B (judge)");
  });
});
