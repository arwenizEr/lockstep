import { describe, it, expect } from "vitest";
import { MockProvider } from "../core/providers/mock.js";
import { createProvider } from "../core/providers/registry.js";
import type { RunRequest } from "../core/providers/types.js";

const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  model: "mock-1",
  messages: [{ role: "user", content: "hello there world" }],
  ...over,
});

describe("MockProvider", () => {
  it("echoes the last user message by default", async () => {
    const r = await new MockProvider().run(req());
    expect(r.text).toBe("hello there world");
  });

  it("is deterministic across calls", async () => {
    const p = new MockProvider();
    const a = await p.run(req());
    const b = await p.run(req());
    expect(a).toEqual(b);
  });

  it("counts tokens from prompt and output", async () => {
    const r = await new MockProvider().run(
      req({ system: "be terse", messages: [{ role: "user", content: "one two three" }] })
    );
    expect(r.tokensOut).toBe(3); // "one two three"
    expect(r.tokensIn).toBe(5); // "be terse" + "one two three"
  });

  it("honors a custom reply", async () => {
    const p = new MockProvider({ reply: (q) => `seen:${q.model}` });
    const r = await p.run(req({ model: "x" }));
    expect(r.text).toBe("seen:x");
  });

  it("produces stable but varied latency", async () => {
    const p = new MockProvider();
    const a = await p.run(req({ messages: [{ role: "user", content: "aaa" }] }));
    const b = await p.run(req({ messages: [{ role: "user", content: "zzzzzz" }] }));
    expect(a.latencyMs).toBeGreaterThanOrEqual(10);
    expect(a.latencyMs).toBeLessThan(100);
    expect(a.latencyMs).not.toBe(b.latencyMs);
  });

  it("is creatable from the registry with no API key", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const p = createProvider("mock");
    expect(p.id).toBe("mock");
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });
});
