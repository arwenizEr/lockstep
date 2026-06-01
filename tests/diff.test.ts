import { describe, it, expect } from "vitest";
import {
  normalizeText,
  cosineSimilarity,
  tier1Similarity,
  lengthDelta,
  runAssertion,
  runAssertions,
  compareCell,
} from "../core/diff.js";
import type { Assertion } from "../core/cases.js";

describe("tier1Similarity (JSON-aware)", () => {
  it("scores reordered-but-equivalent JSON as 1.0", () => {
    expect(tier1Similarity('{"a":1,"b":2}', '{ "b": 2, "a": 1 }')).toBe(1);
  });

  it("ignores whitespace/formatting differences in equivalent JSON", () => {
    expect(tier1Similarity('{"x":[1,2,3]}', '{\n  "x": [1, 2, 3]\n}')).toBe(1);
  });

  it("treats nested key reordering as equivalent", () => {
    expect(tier1Similarity('{"o":{"a":1,"b":2}}', '{"o":{"b":2,"a":1}}')).toBe(1);
  });

  it("still flags genuinely different JSON below 1.0", () => {
    expect(tier1Similarity('{"a":1}', '{"a":999}')).toBeLessThan(1);
  });

  it("falls back to cosine for non-JSON text", () => {
    expect(tier1Similarity("the quick brown fox", "the quick brown fox")).toBe(1);
    expect(tier1Similarity("hello world", "completely different")).toBeLessThan(1);
  });

  it("does not treat one-JSON-one-text as structural", () => {
    // only one side parses → plain cosine, not a spurious 1.0
    expect(tier1Similarity('{"a":1}', "just prose here")).toBeLessThan(1);
  });
});

describe("normalizeText", () => {
  it("collapses whitespace, trims, lowercases", () => {
    expect(normalizeText("  Hello   WORLD\n\t! ")).toBe("hello world !");
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical text", () => {
    expect(cosineSimilarity("the cat sat", "the cat sat")).toBe(1);
  });

  it("returns 1 for whitespace/case-only differences", () => {
    expect(cosineSimilarity("Hello World", "  hello   world ")).toBe(1);
  });

  it("returns 0 for empty vs non-empty", () => {
    expect(cosineSimilarity("", "something")).toBe(0);
  });

  it("returns between 0 and 1 for partial overlap", () => {
    const s = cosineSimilarity("the cat sat on the mat", "the dog sat on the rug");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("is higher for more similar text", () => {
    const close = cosineSimilarity("alpha beta gamma delta", "alpha beta gamma epsilon");
    const far = cosineSimilarity("alpha beta gamma delta", "one two three four");
    expect(close).toBeGreaterThan(far);
  });
});

describe("lengthDelta", () => {
  it("computes char delta B-A", () => {
    expect(lengthDelta("abc", "abcde")).toBe(2);
    expect(lengthDelta("abcde", "abc")).toBe(-2);
  });
});

describe("runAssertion", () => {
  it("json_valid passes on valid JSON", () => {
    expect(runAssertion({ type: "json_valid" }, '{"a":1}').pass).toBe(true);
  });

  it("json_valid passes on fenced JSON", () => {
    expect(runAssertion({ type: "json_valid" }, '```json\n{"a":1}\n```').pass).toBe(true);
  });

  it("json_valid passes on JSON with surrounding prose", () => {
    expect(
      runAssertion({ type: "json_valid" }, 'Here you go: {"a":1} hope that helps').pass
    ).toBe(true);
  });

  it("json_valid fails on garbage", () => {
    expect(runAssertion({ type: "json_valid" }, "not json at all").pass).toBe(false);
  });

  it("json_has_keys passes when all keys present", () => {
    const a: Assertion = { type: "json_has_keys", keys: ["vendor", "total"] };
    expect(runAssertion(a, '{"vendor":"Acme","total":10,"date":"x"}').pass).toBe(true);
  });

  it("json_has_keys fails and reports missing", () => {
    const a: Assertion = { type: "json_has_keys", keys: ["vendor", "missing"] };
    const r = runAssertion(a, '{"vendor":"Acme"}');
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("missing");
  });

  it("contains is case-sensitive substring", () => {
    expect(runAssertion({ type: "contains", value: "USD" }, "Total 10 USD").pass).toBe(true);
    expect(runAssertion({ type: "contains", value: "USD" }, "Total 10 usd").pass).toBe(false);
  });

  it("regex matches", () => {
    expect(runAssertion({ type: "regex", value: "\\d{4}-\\d{2}-\\d{2}" }, "on 2026-05-01").pass).toBe(true);
    expect(runAssertion({ type: "regex", value: "^\\d+$" }, "abc").pass).toBe(false);
  });

  it("regex reports invalid pattern", () => {
    const r = runAssertion({ type: "regex", value: "(" }, "x");
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("invalid regex");
  });

  it("json_path resolves nested path", () => {
    const a: Assertion = { type: "json_path", path: "a.b[0].c" };
    expect(runAssertion(a, '{"a":{"b":[{"c":42}]}}').pass).toBe(true);
  });

  it("json_path with equals compares value", () => {
    const a: Assertion = { type: "json_path", path: "total", equals: 10 };
    expect(runAssertion(a, '{"total":10}').pass).toBe(true);
    expect(runAssertion({ type: "json_path", path: "total", equals: 11 }, '{"total":10}').pass).toBe(false);
  });

  it("json_path fails on missing path", () => {
    expect(runAssertion({ type: "json_path", path: "x.y" }, '{"a":1}').pass).toBe(false);
  });
});

describe("runAssertions", () => {
  it("evaluates all", () => {
    const results = runAssertions(
      [{ type: "json_valid" }, { type: "contains", value: "USD" }],
      '{"x":1} USD'
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});

describe("compareCell", () => {
  const base = {
    caseId: "c",
    inputIndex: 0,
    aOutput: "the cat sat on the mat",
    bOutput: "the cat sat on the mat",
    aBroken: false,
    bBroken: false,
    aCost: 0.001,
    bCost: 0.001,
    aLatency: 1000,
    bLatency: 1000,
  };

  it("flags OK for identical, same cost/latency", () => {
    const c = compareCell(base, 0.9);
    expect(c.statuses).toEqual(["OK"]);
    expect(c.drifted).toBe(false);
  });

  it("flags DRIFTED below threshold", () => {
    const c = compareCell({ ...base, bOutput: "completely different words here now" }, 0.9);
    expect(c.drifted).toBe(true);
    expect(c.statuses).toContain("DRIFTED");
  });

  it("flags CHEAPER when B costs less", () => {
    const c = compareCell({ ...base, bCost: 0.0005 }, 0.9);
    expect(c.statuses).toContain("CHEAPER");
    expect(c.costDelta).toBeCloseTo(-0.0005, 9);
  });

  it("flags PRICIER when B costs more", () => {
    const c = compareCell({ ...base, bCost: 0.002 }, 0.9);
    expect(c.statuses).toContain("PRICIER");
  });

  it("flags FASTER / SLOWER beyond epsilon", () => {
    expect(compareCell({ ...base, bLatency: 500 }, 0.9).statuses).toContain("FASTER");
    expect(compareCell({ ...base, bLatency: 2000 }, 0.9).statuses).toContain("SLOWER");
  });

  it("ignores tiny latency jitter under epsilon", () => {
    const c = compareCell({ ...base, bLatency: 1020 }, 0.9);
    expect(c.statuses).not.toContain("SLOWER");
  });

  it("flags BROKEN when a side errored", () => {
    const c = compareCell({ ...base, bBroken: true }, 0.9);
    expect(c.broken).toBe(true);
    expect(c.statuses).toContain("BROKEN");
  });

  it("flags BROKEN when assertions failed", () => {
    const c = compareCell({ ...base, bAssertFail: true }, 0.9);
    expect(c.broken).toBe(true);
    expect(c.statuses).toContain("BROKEN");
  });

  it("computes costPct null when A is free", () => {
    const c = compareCell({ ...base, aCost: 0, bCost: 0.001 }, 0.9);
    expect(c.costPct).toBeNull();
  });
});
