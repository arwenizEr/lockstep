import { describe, it, expect } from "vitest";
import { ALL_MODELS, ALL_PRICING, allModelsConfig } from "../core/models.js";
import { ConfigSchema } from "../core/config.js";
import { isKnownProvider } from "../core/providers/registry.js";

describe("built-in model roster", () => {
  it("is a non-trivial set of targets with unique ids", () => {
    expect(ALL_MODELS.length).toBeGreaterThanOrEqual(15);
    const ids = ALL_MODELS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only registered providers", () => {
    for (const t of ALL_MODELS) expect(isKnownProvider(t.provider)).toBe(true);
  });

  it("has a price entry for every model", () => {
    for (const t of ALL_MODELS) expect(ALL_PRICING[t.model]).toBeDefined();
  });

  it("sets parameters per provider rule (no temperature on reasoning/adaptive)", () => {
    for (const t of ALL_MODELS) {
      if (t.effort) expect(t.temperature).toBeUndefined();
    }
  });

  it("excludes gpt-5.5-pro (Responses-API only)", () => {
    expect(ALL_MODELS.find((t) => t.model === "gpt-5.5-pro")).toBeUndefined();
  });

  it("produces a config that passes schema validation", () => {
    expect(() => ConfigSchema.parse(allModelsConfig())).not.toThrow();
  });
});
