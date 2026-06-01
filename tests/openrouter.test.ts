import { describe, it, expect } from "vitest";
import { OpenRouterProvider } from "../core/providers/openrouter.js";

function okResp(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function errResp(status: number, text: string): Response {
  return { ok: false, status, json: async () => ({}), text: async () => text } as unknown as Response;
}

const req = { model: "anthropic/claude-opus-4", messages: [{ role: "user" as const, content: "hi" }] };

describe("OpenRouterProvider", () => {
  it("parses OpenAI-shaped responses", async () => {
    const p = new OpenRouterProvider("or-key", {
      fetchImpl: async () =>
        okResp({ choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
    });
    const r = await p.run(req);
    expect(r.text).toBe("hello");
    expect(r.tokensIn).toBe(5);
    expect(r.tokensOut).toBe(2);
  });

  it("forwards sampling and maps effort to reasoning.effort", async () => {
    let sent: any;
    const p = new OpenRouterProvider("or-key", {
      fetchImpl: async (_u: any, init: any) => {
        sent = JSON.parse(init.body);
        return okResp({ choices: [{ message: { content: "x" } }] });
      },
    });
    await p.run({ ...req, temperature: 0.2, topP: 0.8, topK: 5, effort: "high", system: "sys" });
    expect(sent.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(sent.temperature).toBe(0.2);
    expect(sent.top_p).toBe(0.8);
    expect(sent.top_k).toBe(5);
    expect(sent.reasoning).toEqual({ effort: "high" });
  });

  it("throws with .status on a non-ok response", async () => {
    const p = new OpenRouterProvider("or-key", { fetchImpl: async () => errResp(402, "insufficient credits") });
    await expect(p.run(req)).rejects.toMatchObject({ status: 402 });
  });

  it("requires an API key", () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(() => new OpenRouterProvider(undefined)).toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
    }
  });
});
