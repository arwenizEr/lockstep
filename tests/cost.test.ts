import { describe, it, expect } from "vitest";
import { computeCost, costForModel, priceFor, DEFAULT_PRICING } from "../core/cost.js";

describe("computeCost", () => {
  it("computes $/M token cost", () => {
    // 1M in @ $5, 1M out @ $25 = $30
    expect(computeCost({ in: 5, out: 25 }, 1_000_000, 1_000_000)).toBeCloseTo(30, 9);
  });

  it("scales sub-million linearly", () => {
    // 500k in @ $5 = $2.5; 200k out @ $25 = $5 ; total 7.5
    expect(computeCost({ in: 5, out: 25 }, 500_000, 200_000)).toBeCloseTo(7.5, 9);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeCost({ in: 5, out: 25 }, 0, 0)).toBe(0);
  });

  it("returns 0 when price is missing", () => {
    expect(computeCost(undefined, 1000, 1000)).toBe(0);
  });

  it("handles free models (zero price)", () => {
    expect(computeCost({ in: 0, out: 0 }, 9999, 9999)).toBe(0);
  });
});

describe("priceFor", () => {
  it("prefers config pricing over defaults", () => {
    const cfg = { pricing: { "claude-opus-4-8": { in: 99, out: 199 } } };
    expect(priceFor(cfg, "claude-opus-4-8")).toEqual({ in: 99, out: 199 });
  });

  it("falls back to default table", () => {
    expect(priceFor({ pricing: {} }, "claude-opus-4-8")).toEqual(
      DEFAULT_PRICING["claude-opus-4-8"]
    );
  });

  it("returns undefined for unknown model", () => {
    expect(priceFor({ pricing: {} }, "nonexistent-model")).toBeUndefined();
  });
});

describe("costForModel", () => {
  it("flags priced=false for unknown model", () => {
    const { cost, priced } = costForModel({ pricing: {} }, "mystery", 1000, 1000);
    expect(cost).toBe(0);
    expect(priced).toBe(false);
  });

  it("flags priced=true and computes for known model", () => {
    const { cost, priced } = costForModel(
      { pricing: { m: { in: 10, out: 20 } } },
      "m",
      1_000_000,
      1_000_000
    );
    expect(priced).toBe(true);
    expect(cost).toBeCloseTo(30, 9);
  });
});
