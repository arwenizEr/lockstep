import { describe, it, expect } from "vitest";
import { AnthropicProvider, type AnthropicLike } from "../core/providers/anthropic.js";

function clientThatRecords(reply?: unknown) {
  const calls: any[] = [];
  const client: AnthropicLike = {
    messages: {
      create: async (params: unknown) => {
        calls.push(params);
        return (reply ?? {
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 5, output_tokens: 3 },
        }) as any;
      },
    },
  };
  return { client, calls };
}

const baseReq = { model: "claude-3-5-sonnet", messages: [{ role: "user" as const, content: "hi" }] };

describe("AnthropicProvider.run", () => {
  it("uses adaptive thinking + output_config.effort for opus-4-8 and drops sampling", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ model: "claude-opus-4-8", messages: baseReq.messages, effort: "high", temperature: 0.7, topP: 0.9 });
    const params = calls[0];
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
  });

  it("accepts the max effort tier on the adaptive line", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ model: "claude-opus-4-8", messages: baseReq.messages, effort: "max" });
    expect(calls[0].output_config).toEqual({ effort: "max" });
  });

  it("omits the thinking param entirely for fable-5 (always-on thinking)", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ model: "claude-fable-5", messages: baseReq.messages, effort: "high", temperature: 0.7 });
    const params = calls[0];
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.temperature).toBeUndefined();
  });

  it("never forwards sampling params to fable-5, even with no effort set", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ model: "claude-fable-5", messages: baseReq.messages, temperature: 0.3, topP: 0.8, topK: 5 });
    const params = calls[0];
    expect(params.thinking).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.top_k).toBeUndefined();
    expect(params.max_tokens).toBe(16384); // room for always-on thinking + answer
  });

  it("rejects effort none/off on fable-5 (thinking cannot be disabled)", async () => {
    const { client } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await expect(
      p.run({ model: "claude-fable-5", messages: baseReq.messages, effort: "none" })
    ).rejects.toThrow(/cannot be disabled/);
  });

  it("surfaces stop_reason refusal as an error with the category", async () => {
    const { client } = clientThatRecords({
      content: [],
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const p = new AnthropicProvider("sk-test", { client });
    await expect(
      p.run({ model: "claude-fable-5", messages: baseReq.messages, effort: "high" })
    ).rejects.toThrow(/refusal.*cyber/);
  });

  it("throws on an unsupported effort tier for opus-4-8", async () => {
    const { client } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await expect(
      p.run({ model: "claude-opus-4-8", messages: baseReq.messages, effort: "ultra" })
    ).rejects.toThrow(/Unsupported effort/);
  });

  it("uses budget thinking for older models with an effort tier", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ model: "claude-3-5-sonnet", messages: baseReq.messages, effort: "high" });
    expect(calls[0].thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });

  it("forwards sampling params when thinking is off and the model accepts them", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ ...baseReq, temperature: 0.3, topP: 0.8 });
    expect(calls[0].temperature).toBe(0.3);
    expect(calls[0].top_p).toBe(0.8);
    expect(calls[0].thinking).toBeUndefined();
  });

  it("concatenates only text blocks and reads usage", async () => {
    const { client } = clientThatRecords({
      content: [
        { type: "thinking", thinking: "reasoning..." },
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ],
      usage: { input_tokens: 11, output_tokens: 4 },
    });
    const p = new AnthropicProvider("sk-test", { client });
    const r = await p.run(baseReq);
    expect(r.text).toBe("AB");
    expect(r.tokensIn).toBe(11);
    expect(r.tokensOut).toBe(4);
  });

  it("prefers messages.stream + finalMessage when the client supports it", async () => {
    const calls: any[] = [];
    const client: AnthropicLike = {
      messages: {
        create: async () => {
          throw new Error("should not use create when stream exists");
        },
        stream: (params: unknown) => {
          calls.push(params);
          return {
            finalMessage: async () =>
              ({
                content: [{ type: "text", text: "streamed" }],
                usage: { input_tokens: 2, output_tokens: 1 },
              }) as any,
          };
        },
      },
    };
    const p = new AnthropicProvider("sk-test", { client });
    const r = await p.run(baseReq);
    expect(r.text).toBe("streamed");
    expect(calls).toHaveLength(1);
  });

  it("honors a per-target maxTokens override", async () => {
    const { client, calls } = clientThatRecords();
    const p = new AnthropicProvider("sk-test", { client });
    await p.run({ model: "claude-opus-4-8", messages: baseReq.messages, effort: "high", maxTokens: 32000 });
    expect(calls[0].max_tokens).toBe(32000);
  });

  it("marks truncated output and reads cache token usage", async () => {
    const { client } = clientThatRecords({
      content: [{ type: "text", text: "cut off" }],
      stop_reason: "max_tokens",
      usage: {
        input_tokens: 10,
        output_tokens: 4096,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 500,
      },
    });
    const p = new AnthropicProvider("sk-test", { client });
    const r = await p.run(baseReq);
    expect(r.truncated).toBe(true);
    expect(r.stopReason).toBe("max_tokens");
    expect(r.tokensCacheRead).toBe(2000);
    expect(r.tokensCacheWrite).toBe(500);
  });

  it("normalizes and length-bounds a thrown error while preserving status", async () => {
    const client: AnthropicLike = {
      messages: {
        create: async () => {
          throw Object.assign(new Error("x".repeat(2000)), { status: 500 });
        },
      },
    };
    const p = new AnthropicProvider("sk-test", { client });
    await p.run(baseReq).then(
      () => { throw new Error("should have thrown"); },
      (e: Error & { status?: number }) => {
        expect(e.status).toBe(500);
        expect(e.message.startsWith("Anthropic 500:")).toBe(true);
        expect(e.message.length).toBeLessThan(600);
      }
    );
  });
});
