import { describe, it, expect } from "vitest";
import {
  PROVIDER_IDS,
  isKnownProvider,
  createProvider,
} from "../core/providers/registry.js";

describe("provider registry", () => {
  it("knows the built-in providers", () => {
    expect(PROVIDER_IDS).toContain("anthropic");
    expect(PROVIDER_IDS).toContain("openai");
    expect(PROVIDER_IDS).toContain("gemini");
    expect(PROVIDER_IDS).toContain("openrouter");
    expect(PROVIDER_IDS).toContain("ollama");
    expect(PROVIDER_IDS).toContain("mock");
  });

  it("constructs the keyless ollama provider", () => {
    expect(createProvider("ollama").id).toBe("ollama");
  });

  it("surfaces a missing-key error for gemini and openrouter", () => {
    const env = {
      g: process.env.GEMINI_API_KEY,
      go: process.env.GOOGLE_API_KEY,
      or: process.env.OPENROUTER_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() => createProvider("gemini")).toThrow(/GEMINI_API_KEY/);
      expect(() => createProvider("openrouter")).toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (env.g !== undefined) process.env.GEMINI_API_KEY = env.g;
      if (env.go !== undefined) process.env.GOOGLE_API_KEY = env.go;
      if (env.or !== undefined) process.env.OPENROUTER_API_KEY = env.or;
    }
  });

  it("isKnownProvider is true for registered, false otherwise", () => {
    expect(isKnownProvider("anthropic")).toBe(true);
    expect(isKnownProvider("openai")).toBe(true);
    expect(isKnownProvider("google")).toBe(false);
    expect(isKnownProvider("")).toBe(false);
  });

  it("createProvider throws a helpful error for unknown provider", () => {
    expect(() => createProvider("nope")).toThrow(/Unknown provider "nope"/);
    expect(() => createProvider("nope")).toThrow(/anthropic, openai/);
  });

  it("createProvider constructs a known provider when its key is present", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    try {
      const p = createProvider("anthropic");
      expect(p.id).toBe("anthropic");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("createProvider surfaces a missing-key error for a known provider", () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => createProvider("openai")).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});
