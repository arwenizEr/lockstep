import { describe, it, expect } from "vitest";
import { runAssertion } from "../core/diff.js";
import type { Assertion } from "../core/cases.js";

const run = (a: Assertion, out: string) => runAssertion(a, out);

describe("assertion types (new)", () => {
  it("not_contains passes when absent, fails when present", () => {
    expect(run({ type: "not_contains", value: "error" }, "all good").pass).toBe(true);
    expect(run({ type: "not_contains", value: "error" }, "an error occurred").pass).toBe(false);
  });

  it("icontains is case-insensitive", () => {
    expect(run({ type: "icontains", value: "HELLO" }, "well hello there").pass).toBe(true);
    expect(run({ type: "icontains", value: "bye" }, "well hello there").pass).toBe(false);
  });

  it("equals trims and matches exactly", () => {
    expect(run({ type: "equals", value: "yes" }, "  yes\n").pass).toBe(true);
    expect(run({ type: "equals", value: "yes" }, "yes please").pass).toBe(false);
  });

  it("numeric checks min/max/equals with tolerance", () => {
    expect(run({ type: "numeric", min: 0, max: 100 }, "the score is 42%").pass).toBe(true);
    expect(run({ type: "numeric", max: 10 }, "value: 11").pass).toBe(false);
    expect(run({ type: "numeric", equals: 3.14, tolerance: 0.01 }, "pi ~ 3.141").pass).toBe(true);
    expect(run({ type: "numeric", equals: 3.14 }, "pi ~ 3.99").pass).toBe(false);
    expect(run({ type: "numeric", min: 1000 }, "1,240 dollars").pass).toBe(true);
    expect(run({ type: "numeric", min: 0 }, "no digits here").pass).toBe(false);
  });

  it("json_schema validates type, required, properties, items, enum", () => {
    const schema = {
      type: "object",
      required: ["vendor", "total"],
      properties: {
        vendor: { type: "string" },
        total: { type: "number" },
        currency: { enum: ["USD", "EUR"] },
        tags: { type: "array", items: { type: "string" } },
      },
    };
    expect(
      run({ type: "json_schema", schema }, '{"vendor":"Acme","total":12.5,"currency":"USD","tags":["a"]}').pass
    ).toBe(true);
    // missing required + wrong type + bad enum + bad item type
    const bad = run(
      { type: "json_schema", schema },
      '{"total":"oops","currency":"GBP","tags":[1]}'
    );
    expect(bad.pass).toBe(false);
    expect(bad.detail).toContain("required");
  });

  it("json_schema fails on non-JSON output", () => {
    expect(run({ type: "json_schema", schema: { type: "object" } }, "not json").pass).toBe(false);
  });

  it("max_length enforces an upper bound", () => {
    expect(run({ type: "max_length", value: 5 }, "abc").pass).toBe(true);
    expect(run({ type: "max_length", value: 5 }, "abcdef").pass).toBe(false);
  });

  it("min_length enforces a lower bound", () => {
    expect(run({ type: "min_length", value: 3 }, "abc").pass).toBe(true);
    expect(run({ type: "min_length", value: 3 }, "ab").pass).toBe(false);
  });

  it("reports detail on failure", () => {
    const r = run({ type: "max_length", value: 2 }, "abcd");
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("max 2");
  });
});
