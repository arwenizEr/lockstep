import { describe, it, expect } from "vitest";
import { OpenAIProvider } from "../core/providers/openai.js";

function okResp(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function errResp(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

const req = {
  model: "gpt-test",
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("OpenAIProvider", () => {
  it("parses a successful response and token usage", async () => {
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () =>
        okResp({
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
    });
    const r = await p.run(req);
    expect(r.text).toBe("hello");
    expect(r.tokensIn).toBe(7);
    expect(r.tokensOut).toBe(3);
  });

  it("maps an AbortError to a timeout error (retryable, no status)", async () => {
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    });
    await expect(p.run(req)).rejects.toThrow(/timed out after \d+ms/);
  });

  it("throws with .status on a non-ok response", async () => {
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () => errResp(429, "rate limited"),
    });
    await expect(p.run(req)).rejects.toMatchObject({ status: 429 });
  });

  it("defaults missing usage to zero tokens", async () => {
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () => okResp({ choices: [{ message: { content: "x" } }] }),
    });
    const r = await p.run(req);
    expect(r.tokensIn).toBe(0);
    expect(r.tokensOut).toBe(0);
  });

  it("honors LOCKSTEP_HTTP_TIMEOUT_MS in the timeout message", async () => {
    const prev = process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
    process.env.LOCKSTEP_HTTP_TIMEOUT_MS = "1234";
    try {
      const p = new OpenAIProvider("sk-test", {
        fetchImpl: async () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        },
      });
      await expect(p.run(req)).rejects.toThrow(/1234ms/);
    } finally {
      if (prev === undefined) delete process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
      else process.env.LOCKSTEP_HTTP_TIMEOUT_MS = prev;
    }
  });
});
