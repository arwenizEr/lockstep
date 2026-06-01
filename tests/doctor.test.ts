import { describe, it, expect } from "vitest";
import { diagnose, PROVIDER_KEYS } from "../core/doctor.js";
import type { Config } from "../core/config.js";

function cfg(targets: Config["targets"]): Pick<Config, "targets"> {
  return { targets };
}

describe("diagnose", () => {
  it("marks a target runnable when its provider key is present", () => {
    const dx = diagnose(cfg([{ id: "a", provider: "anthropic", model: "m" }]), {
      ANTHROPIC_API_KEY: "sk-x",
    });
    expect(dx.providers[0].ready).toBe(true);
    expect(dx.targets[0].runnable).toBe(true);
    expect(dx.allRunnable).toBe(true);
  });

  it("flags a missing key with the env var to set", () => {
    const dx = diagnose(cfg([{ id: "o", provider: "openai", model: "m" }]), {});
    expect(dx.targets[0].runnable).toBe(false);
    expect(dx.targets[0].reason).toContain("OPENAI_API_KEY");
    expect(dx.allRunnable).toBe(false);
  });

  it("accepts either env var for gemini", () => {
    const dx = diagnose(cfg([{ id: "g", provider: "gemini", model: "m" }]), {
      GOOGLE_API_KEY: "k",
    });
    expect(dx.targets[0].runnable).toBe(true);
  });

  it("treats ollama and mock as keyless / always ready", () => {
    const dx = diagnose(
      cfg([
        { id: "l", provider: "ollama", model: "llama3.2" },
        { id: "m", provider: "mock", model: "mock-a" },
      ]),
      {}
    );
    expect(dx.providers.every((p) => p.keyless)).toBe(true);
    expect(dx.allRunnable).toBe(true);
  });

  it("treats blank-string env vars as missing", () => {
    const dx = diagnose(cfg([{ id: "o", provider: "openai", model: "m" }]), {
      OPENAI_API_KEY: "   ",
    });
    expect(dx.targets[0].runnable).toBe(false);
  });

  it("dedupes providers across targets", () => {
    const dx = diagnose(
      cfg([
        { id: "a1", provider: "anthropic", model: "m1" },
        { id: "a2", provider: "anthropic", model: "m2" },
      ]),
      { ANTHROPIC_API_KEY: "k" }
    );
    expect(dx.providers).toHaveLength(1);
    expect(dx.targets).toHaveLength(2);
  });

  it("covers every registered provider id in PROVIDER_KEYS", () => {
    for (const id of ["anthropic", "openai", "gemini", "openrouter", "ollama", "mock"]) {
      expect(id in PROVIDER_KEYS).toBe(true);
    }
  });
});
