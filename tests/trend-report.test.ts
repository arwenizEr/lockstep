import { describe, it, expect } from "vitest";
import { renderTrendReport, svgLine } from "../core/trend-report.js";
import type { Trend } from "../core/trend.js";

const trend: Trend = {
  target: "opus-4-8",
  startedAts: ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
  points: [
    { startedAt: "2026-01-01T00:00:00.000Z", totalCost: 0.001, avgLatencyMs: 100, broken: 0, meanSimilarityToFirst: 1 },
    { startedAt: "2026-01-02T00:00:00.000Z", totalCost: 0.0015, avgLatencyMs: 140, broken: 0, meanSimilarityToFirst: 0.9 },
    { startedAt: "2026-01-03T00:00:00.000Z", totalCost: 0.002, avgLatencyMs: 180, broken: 1, meanSimilarityToFirst: 0.7 },
  ],
  cases: [
    { key: "extract#0", similarities: [1, 0.9, 0.6] },
    { key: "summarize#0", similarities: [1, 1, 1] },
  ],
};

describe("svgLine", () => {
  it("produces an svg with a polyline for a normal series", () => {
    const s = svgLine([0, 0.5, 1], { fixedZeroOne: true });
    expect(s).toContain("<svg");
    expect(s).toContain("<polyline");
    expect(s).toContain("points=");
  });

  it("breaks the line into segments around null gaps", () => {
    const s = svgLine([1, null, 1]);
    expect((s.match(/<polyline/g) ?? []).length).toBe(2);
  });

  it("handles an all-null / empty series without crashing", () => {
    expect(svgLine([null, null])).toContain("<svg");
    expect(svgLine([])).toContain("<svg");
  });
});

describe("renderTrendReport", () => {
  const html = renderTrendReport(trend, "2026-01-03T00:00:00.000Z");

  it("is a self-contained HTML document with no external resources", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/src=["']https?:/i);
  });

  it("renders the target, each case, and inline SVG charts", () => {
    expect(html).toContain("opus-4-8");
    expect(html).toContain("extract#0");
    expect(html).toContain("summarize#0");
    expect(html).toContain("<svg");
    expect(html).toContain("100% <span class=\"arrow\">→</span>");
  });

  it("marks a dropped case (last < first) with the drop class", () => {
    expect(html).toContain('class="drop"'); // extract#0 fell 100% -> 60%
  });

  it("escapes the target name", () => {
    const evil = renderTrendReport({ ...trend, target: "<b>x</b>" });
    expect(evil).not.toContain("<b>x</b>");
    expect(evil).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
