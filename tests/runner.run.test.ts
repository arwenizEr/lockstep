import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run, writeRunFile } from "../core/runner.js";
import { PROVIDER_FACTORIES } from "../core/providers/registry.js";
import type { Config } from "../core/config.js";
import type { Case } from "../core/cases.js";
import type { Provider } from "../core/providers/types.js";

function cfg(targets: Config["targets"], pricing: Config["pricing"] = {}): Config {
  return { targets, cases_dir: "./cases", pricing, diff: { similarity_threshold: 0.9 } };
}
const loaded = (config: Config) => ({ config, casesDir: "./cases" });

// Register throwaway providers for the duration of a test, then remove them.
const temp: string[] = [];
function register(id: string, provider: Provider) {
  PROVIDER_FACTORIES[id] = () => provider;
  temp.push(id);
}
afterEach(() => {
  for (const id of temp.splice(0)) delete PROVIDER_FACTORIES[id];
});

describe("run()", () => {
  it("runs the full matrix, substitutes {{input}}, scores assertions, prices", async () => {
    const cases: Case[] = [
      {
        id: "greet",
        prompt: "hello {{input}}",
        inputs: ["world", "mars"],
        assert: [{ type: "contains", value: "hello" }],
      },
    ];
    const config = cfg(
      [{ id: "m", provider: "mock", model: "mock-1" }],
      { "mock-1": { in: 1, out: 2 } }
    );
    const rf = await run(loaded(config), cases, { concurrency: 2 });
    expect(rf.results).toHaveLength(2); // 2 inputs × 1 target
    expect(rf.results.every((r) => r.status === "OK")).toBe(true);
    expect(rf.results.map((r) => r.prompt).sort()).toEqual(["hello mars", "hello world"]);
    expect(rf.results.every((r) => r.assertionsPass === true)).toBe(true);
    expect(rf.results.every((r) => r.priced && r.cost > 0)).toBe(true);
  });

  it("marks assertionsPass false but keeps status OK when an assertion fails", async () => {
    const cases: Case[] = [
      { id: "c", prompt: "{{input}}", inputs: ["abc"], assert: [{ type: "contains", value: "zzz" }] },
    ];
    const config = cfg([{ id: "m", provider: "mock", model: "mock-1" }]);
    const rf = await run(loaded(config), cases);
    expect(rf.results[0].status).toBe("OK");
    expect(rf.results[0].assertionsPass).toBe(false);
  });

  it("isolates a BROKEN cell without killing other cells", async () => {
    register("boom", {
      id: "boom",
      run: async () => {
        throw Object.assign(new Error("provider exploded"), { status: 400 });
      },
    });
    const cases: Case[] = [{ id: "c", prompt: "{{input}}", inputs: ["x"], assert: [] }];
    const config = cfg([
      { id: "ok", provider: "mock", model: "mock-1" },
      { id: "bad", provider: "boom", model: "boom-1" },
    ]);
    const rf = await run(loaded(config), cases);
    const ok = rf.results.find((r) => r.targetId === "ok")!;
    const bad = rf.results.find((r) => r.targetId === "bad")!;
    expect(ok.status).toBe("OK");
    expect(bad.status).toBe("BROKEN");
    expect(bad.error).toMatch(/provider exploded/);
    expect(bad.cost).toBe(0);
  });

  it("retries a retryable (429) failure then succeeds", async () => {
    let calls = 0;
    register("flaky", {
      id: "flaky",
      run: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
        return { text: "ok", tokensIn: 1, tokensOut: 1, latencyMs: 1, raw: {} };
      },
    });
    const cases: Case[] = [{ id: "c", prompt: "p", inputs: [""], assert: [] }];
    const config = cfg([{ id: "f", provider: "flaky", model: "flaky-1" }]);
    const rf = await run(loaded(config), cases, { maxRetries: 2 });
    expect(calls).toBe(2);
    expect(rf.results[0].status).toBe("OK");
  });

  it("does not retry a non-retryable (400) failure", async () => {
    let calls = 0;
    register("hard", {
      id: "hard",
      run: async () => {
        calls++;
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    });
    const cases: Case[] = [{ id: "c", prompt: "p", inputs: [""], assert: [] }];
    const config = cfg([{ id: "h", provider: "hard", model: "hard-1" }]);
    const rf = await run(loaded(config), cases, { maxRetries: 3 });
    expect(calls).toBe(1); // no retries
    expect(rf.results[0].status).toBe("BROKEN");
  });

  it("throws on an unknown target id filter", async () => {
    const cases: Case[] = [{ id: "c", prompt: "p", inputs: [""], assert: [] }];
    const config = cfg([{ id: "m", provider: "mock", model: "mock-1" }]);
    await expect(
      run(loaded(config), cases, { targetIds: ["nope"] })
    ).rejects.toThrow(/Unknown target id/);
  });

  it("invokes the onResult hook for every cell", async () => {
    const seen: string[] = [];
    const cases: Case[] = [
      { id: "a", prompt: "p", inputs: ["1", "2"], assert: [] },
    ];
    const config = cfg([{ id: "m", provider: "mock", model: "mock-1" }]);
    await run(loaded(config), cases, {}, { onResult: (r) => seen.push(`${r.caseId}#${r.inputIndex}`) });
    expect(seen.sort()).toEqual(["a#0", "a#1"]);
  });

  it("writeRunFile writes a timestamped json and returns its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lockstep-runner-"));
    const cases: Case[] = [{ id: "c", prompt: "p", inputs: [""], assert: [] }];
    const config = cfg([{ id: "m", provider: "mock", model: "mock-1" }]);
    const rf = await run(loaded(config), cases);
    const p = writeRunFile(dir, rf);
    expect(existsSync(p)).toBe(true);
    expect(p).toMatch(/\.lockstep[\\/]runs[\\/].*\.json$/);
    rmSync(dir, { recursive: true, force: true });
  });
});
