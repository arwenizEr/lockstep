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
