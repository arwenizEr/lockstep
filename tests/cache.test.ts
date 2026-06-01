import { describe, it, expect, afterEach } from "vitest";
import { cacheKey, MemoryCache } from "../core/cache.js";
import { run } from "../core/runner.js";
import { PROVIDER_FACTORIES } from "../core/providers/registry.js";
import type { Config } from "../core/config.js";
import type { Case } from "../core/cases.js";
import type { Provider, RunRequest } from "../core/providers/types.js";

const baseReq: RunRequest = {
  model: "m",
  system: "s",
  messages: [{ role: "user", content: "hi" }],
};

describe("cacheKey", () => {
  it("is stable for identical requests", () => {
    expect(cacheKey("mock", baseReq)).toBe(cacheKey("mock", baseReq));
  });
  it("changes with provider, model, message content, and effort", () => {
    const k = cacheKey("mock", baseReq);
    expect(cacheKey("openai", baseReq)).not.toBe(k);
    expect(cacheKey("mock", { ...baseReq, model: "m2" })).not.toBe(k);
    expect(cacheKey("mock", { ...baseReq, messages: [{ role: "user", content: "bye" }] })).not.toBe(k);
    expect(cacheKey("mock", { ...baseReq, effort: "high" })).not.toBe(k);
  });
});

describe("MemoryCache", () => {
  it("stores and returns entries", () => {
    const c = new MemoryCache();
    expect(c.get("k")).toBeUndefined();
    c.set("k", { text: "t", tokensIn: 1, tokensOut: 2, latencyMs: 3 });
    expect(c.get("k")?.text).toBe("t");
  });
});

const temp: string[] = [];
afterEach(() => {
  for (const id of temp.splice(0)) delete PROVIDER_FACTORIES[id];
});

describe("run() with a cache", () => {
  it("calls the provider once, then serves a hit on the second run", async () => {
    let calls = 0;
    const provider: Provider = {
      id: "counter",
      run: async (req) => {
        calls++;
        return { text: req.messages[0].content, tokensIn: 1, tokensOut: 1, latencyMs: 7, raw: {} };
      },
    };
    PROVIDER_FACTORIES["counter"] = () => provider;
    temp.push("counter");

    const config: Config = {
      targets: [{ id: "t", provider: "counter", model: "m" }],
      cases_dir: "./cases",
      pricing: {},
      diff: { similarity_threshold: 0.9 },
      redact: [],
    };
    const cases: Case[] = [{ id: "c", prompt: "{{input}}", inputs: ["x"], assert: [] }];
    const cache = new MemoryCache();

    const r1 = await run({ config, casesDir: "./cases" }, cases, { cache });
    expect(calls).toBe(1);
    expect(r1.results[0].cached).toBe(false);

    const r2 = await run({ config, casesDir: "./cases" }, cases, { cache });
    expect(calls).toBe(1); // no new call
    expect(r2.results[0].cached).toBe(true);
    expect(r2.results[0].output).toBe("x");
    expect(r2.results[0].latencyMs).toBe(7); // replays original latency
  });
});
