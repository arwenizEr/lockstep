import { describe, it, expect } from "vitest";
import { GeminiProvider } from "../core/providers/gemini.js";

function okResp(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function errResp(status: number, text: string): Response {
  return { ok: false, status, json: async () => ({}), text: async () => text } as unknown as Response;
}

const req = { model: "gemini-2.5-pro", messages: [{ role: "user" as const, content: "hi" }] };

describe("GeminiProvider", () => {
  it("parses candidates text and usageMetadata", async () => {
    const p = new GeminiProvider("key", {
      fetchImpl: async () =>
        okResp({
          candidates: [{ content: { parts: [{ text: "he" }, { text: "llo" }] } }],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
        }),
    });
    const r = await p.run(req);
    expect(r.text).toBe("hello");
    expect(r.tokensIn).toBe(9);
    expect(r.tokensOut).toBe(4);
  });

  it("maps assistant→model, system→systemInstruction, sampling→generationConfig", async () => {
    let sent: any;
    let url = "";
    const p = new GeminiProvider("key", {
      fetchImpl: async (u: any, init: any) => {
        url = String(u);
        sent = JSON.parse(init.body);
        return okResp({ candidates: [{ content: { parts: [{ text: "x" }] } }] });
      },
    });
    await p.run({
      model: "gemini-2.5-pro",
      system: "be terse",
      messages: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
      ],
      temperature: 0.3,
      topK: 40,
    });
    expect(url).toContain("gemini-2.5-pro:generateContent");
    expect(sent.contents[1].role).toBe("model");
    expect(sent.systemInstruction.parts[0].text).toBe("be terse");
    expect(sent.generationConfig).toEqual({ temperature: 0.3, topK: 40 });
  });

  it("throws with .status on a non-ok response", async () => {
    const p = new GeminiProvider("key", { fetchImpl: async () => errResp(429, "quota") });
    await expect(p.run(req)).rejects.toMatchObject({ status: 429 });
  });

  it("requires an API key", () => {
    const prev = { g: process.env.GEMINI_API_KEY, go: process.env.GOOGLE_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      expect(() => new GeminiProvider(undefined)).toThrow(/GEMINI_API_KEY/);
    } finally {
      if (prev.g !== undefined) process.env.GEMINI_API_KEY = prev.g;
      if (prev.go !== undefined) process.env.GOOGLE_API_KEY = prev.go;
    }
  });
});
