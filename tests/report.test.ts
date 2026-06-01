import { describe, it, expect } from "vitest";
import { renderReport } from "../core/report.js";
import type { CompareReport } from "../core/compare.js";

const report: CompareReport = {
  aTargetId: "opus-4-7",
  bTargetId: "opus-4-8",
  aModel: "claude-opus-4-7",
  bModel: "claude-opus-4-8",
  similarityThreshold: 0.9,
  pairs: [
    {
      caseId: "extract",
      inputIndex: 0,
      a: {
        caseId: "extract",
        inputIndex: 0,
        targetId: "opus-4-7",
        model: "claude-opus-4-7",
        provider: "anthropic",
        prompt: "p",
        status: "OK",
        output: '{"vendor":"Acme"}',
        tokensIn: 100,
        tokensOut: 20,
        cost: 0.001,
        priced: true,
        latencyMs: 1200,
        assertions: [{ type: "json_valid", pass: true }],
        assertionsPass: true,
      },
      b: {
        caseId: "extract",
        inputIndex: 0,
        targetId: "opus-4-8",
        model: "claude-opus-4-8",
        provider: "anthropic",
        prompt: "p",
        status: "OK",
        output: '{"vendor":"Acme Corp"}',
        tokensIn: 100,
        tokensOut: 22,
        cost: 0.0008,
        priced: true,
        latencyMs: 800,
        assertions: [{ type: "json_valid", pass: true }],
        assertionsPass: true,
        judge: { score: 0.95, reason: "extracted correctly" },
      },
      cell: {
        caseId: "extract",
        inputIndex: 0,
        similarity: 0.6,
        drifted: true,
        broken: false,
        costDelta: -0.0002,
        costPct: -0.2,
        latencyDelta: -400,
        statuses: ["DRIFTED", "CHEAPER", "FASTER"],
      },
    },
  ],
  summary: {
    total: 1,
    ok: 0,
    drifted: 1,
    broken: 0,
    cheaper: 1,
    pricier: 0,
    faster: 1,
    slower: 0,
    totalCostA: 0.001,
    totalCostB: 0.0008,
  },
};

describe("renderReport", () => {
  const html = renderReport(report);

  it("produces a self-contained HTML document", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
  });

  it("inlines CSS and JS (no external network deps)", () => {
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/src=["']https?:/i);
  });

  it("includes both target labels", () => {
    expect(html).toContain("opus-4-7");
    expect(html).toContain("opus-4-8");
  });

  it("renders statuses and judge score", () => {
    expect(html).toContain("DRIFTED");
    expect(html).toContain("0.95");
    expect(html).toContain("extracted correctly");
  });

  it("escapes output content", () => {
    const evil: CompareReport = {
      ...report,
      pairs: [
        {
          ...report.pairs[0],
          a: { ...report.pairs[0].a!, output: "<script>alert(1)</script>" },
        },
      ],
    };
    const out = renderReport(evil);
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders a one-line headline verdict", () => {
    expect(html).toMatch(/<p class="verdict">[^<]+<\/p>/);
    expect(html).toContain("1 drifted");
  });
});

describe("renderReport headline verdict", () => {
  function verdictText(over: Partial<CompareReport["summary"]>): string {
    const r: CompareReport = { ...report, summary: { ...report.summary, ...over } };
    const html = renderReport(r);
    const m = html.match(/<p class="verdict">([^<]*)<\/p>/);
    return m ? m[1] : "";
  }

  it('uses a multiplier for big cost gaps ("~17× pricier")', () => {
    expect(verdictText({ totalCostA: 0.0001, totalCostB: 0.0017, drifted: 0, broken: 0 }))
      .toMatch(/~17× pricier/);
  });

  it('uses a multiplier for big savings ("~10× cheaper")', () => {
    expect(verdictText({ totalCostA: 0.01, totalCostB: 0.001, drifted: 0, broken: 0 }))
      .toMatch(/~10× cheaper/);
  });

  it("uses a percentage for small cost differences", () => {
    expect(verdictText({ totalCostA: 0.001, totalCostB: 0.0012, drifted: 0, broken: 0 }))
      .toMatch(/~20% pricier/);
  });

  it("says nothing broke / no drift when clean", () => {
    expect(verdictText({ drifted: 0, broken: 0, totalCostA: 0.001, totalCostB: 0.001 }))
      .toContain("no drift, nothing broke");
  });

  it("reports the broken count", () => {
    expect(verdictText({ drifted: 1, broken: 2, totalCostA: 0.001, totalCostB: 0.001 }))
      .toContain("2 broke");
  });
});

describe("renderReport panels & per-case verdict", () => {
  type CR = NonNullable<CompareReport["pairs"][number]["a"]>;
  const res = (over: Partial<CR>): CR => ({
    caseId: "c", inputIndex: 0, targetId: "t", model: "m", provider: "mock",
    prompt: "p", status: "OK", output: "hello world", tokensIn: 5, tokensOut: 5,
    cost: 0.001, priced: true, latencyMs: 500, assertionsPass: true, ...over,
  });
  const base = (pairs: CompareReport["pairs"]): CompareReport => ({
    ...report, pairs,
    summary: { ...report.summary, total: pairs.length },
  });

  it("emits word-diff add/rm spans for two differing OK outputs", () => {
    const html = renderReport(base([{
      caseId: "c", inputIndex: 0,
      a: res({ output: "the quick brown fox" }),
      b: res({ output: "the slow brown dog" }),
      cell: { caseId: "c", inputIndex: 0, similarity: 0.5, drifted: true, broken: false,
        costDelta: 0, costPct: 0, latencyDelta: 0, statuses: ["DRIFTED"] },
    }]));
    expect(html).toContain('class="rm"');   // tokens only in A
    expect(html).toContain('class="add"');  // tokens only in B
  });

  it("renders a BROKEN panel with the error and a 'B broke' verdict", () => {
    const html = renderReport(base([{
      caseId: "c", inputIndex: 0,
      a: res({}),
      b: res({ status: "BROKEN", output: "", error: "429 rate limited", assertionsPass: undefined }),
      cell: { caseId: "c", inputIndex: 0, similarity: 0, drifted: false, broken: true,
        costDelta: 0, costPct: null, latencyDelta: 0, statuses: ["BROKEN"] },
    }]));
    expect(html).toContain("badge-broken");
    expect(html).toContain("429 rate limited");
    expect(html).toContain("A (B broke)");
  });

  it("handles a one-sided (missing) pair", () => {
    const html = renderReport(base([{
      caseId: "c", inputIndex: 0, a: res({}), b: undefined, cell: undefined,
    }]));
    expect(html).toContain("A (B missing)");
    expect(html).toContain("missing");
  });

  it("breaks a non-broken tie by judge score", () => {
    const html = renderReport(base([{
      caseId: "c", inputIndex: 0,
      a: res({ judge: { score: 0.6, reason: "ok" } }),
      b: res({ output: "hello world", judge: { score: 0.9, reason: "better" } }),
      cell: { caseId: "c", inputIndex: 0, similarity: 1, drifted: false, broken: false,
        costDelta: 0, costPct: null, latencyDelta: 0, statuses: ["OK"] },
    }]));
    expect(html).toContain("B (better)");
  });
});
