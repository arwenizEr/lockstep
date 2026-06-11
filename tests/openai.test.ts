import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider, isReasoningModel } from "../core/providers/openai.js";

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

  it("classifies reasoning vs chat models", () => {
    expect(isReasoningModel("o3-mini")).toBe(true);
    expect(isReasoningModel("o1")).toBe(true);
    expect(isReasoningModel("gpt-5.1")).toBe(true);
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);
  });

  it("drops temperature/top_p for reasoning models, keeps reasoning_effort", async () => {
    let sent: any;
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async (_url, init: any) => {
        sent = JSON.parse(init.body);
        return okResp({ choices: [{ message: { content: "x" } }] });
      },
    });
    await p.run({ ...req, model: "o3-mini", temperature: 0.5, topP: 0.9, effort: "high" });
    expect(sent.reasoning_effort).toBe("high");
    expect(sent.temperature).toBeUndefined();
    expect(sent.top_p).toBeUndefined();
  });

  it("drops reasoning_effort for chat models, keeps temperature/top_p", async () => {
    let sent: any;
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async (_url, init: any) => {
        sent = JSON.parse(init.body);
        return okResp({ choices: [{ message: { content: "x" } }] });
      },
    });
    await p.run({ ...req, model: "gpt-4o-mini", temperature: 0.5, topP: 0.9, effort: "high" });
    expect(sent.temperature).toBe(0.5);
    expect(sent.top_p).toBe(0.9);
    expect(sent.reasoning_effort).toBeUndefined();
  });

  it("warns when top_k is set on an openai target", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () => okResp({ choices: [{ message: { content: "x" } }] }),
    });
    await p.run({ ...req, model: "gpt-4o-mini", topK: 40 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("top_k"));
    warn.mockRestore();
  });

  it("sends max_completion_tokens (reasoning) vs max_tokens (chat) for maxTokens", async () => {
    let sent: any;
    const fetchImpl = async (_url: any, init: any) => {
      sent = JSON.parse(init.body);
      return okResp({ choices: [{ message: { content: "x" } }] });
    };
    const p = new OpenAIProvider("sk-test", { fetchImpl });
    await p.run({ ...req, model: "o3-mini", maxTokens: 5000 });
    expect(sent.max_completion_tokens).toBe(5000);
    expect(sent.max_tokens).toBeUndefined();
    await p.run({ ...req, model: "gpt-4o-mini", maxTokens: 5000 });
    expect(sent.max_tokens).toBe(5000);
    expect(sent.max_completion_tokens).toBeUndefined();
  });

  it("marks finish_reason length as truncated", async () => {
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () =>
        okResp({ choices: [{ message: { content: "cut" }, finish_reason: "length" }] }),
    });
    const r = await p.run(req);
    expect(r.truncated).toBe(true);
    expect(r.stopReason).toBe("length");
  });

  it("routes mode:responses through the Responses API and parses output_text", async () => {
    let url = "";
    let sent: any;
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async (u: any, init: any) => {
        url = String(u);
        sent = JSON.parse(init.body);
        return okResp({
          status: "completed",
          output: [
            { type: "reasoning" },
            { type: "message", content: [{ type: "output_text", text: "from responses" }] },
          ],
          usage: { input_tokens: 9, output_tokens: 5 },
        });
      },
    });
    const r = await p.run({
      ...req,
      model: "gpt-5.5-pro",
      mode: "responses",
      system: "be terse",
      effort: "high",
      maxTokens: 8000,
    });
    expect(url).toContain("/responses");
    expect(sent.input).toEqual([{ role: "user", content: "hi" }]);
    expect(sent.instructions).toBe("be terse");
    expect(sent.reasoning).toEqual({ effort: "high" });
    expect(sent.max_output_tokens).toBe(8000);
    expect(r.text).toBe("from responses");
    expect(r.tokensIn).toBe(9);
    expect(r.tokensOut).toBe(5);
  });

  it("marks an incomplete Responses result (max_output_tokens) as truncated", async () => {
    const p = new OpenAIProvider("sk-test", {
      fetchImpl: async () =>
        okResp({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
        }),
    });
    const r = await p.run({ ...req, model: "gpt-5.5-pro", mode: "responses" });
    expect(r.truncated).toBe(true);
    expect(r.stopReason).toBe("max_output_tokens");
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
