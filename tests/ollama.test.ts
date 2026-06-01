import { describe, it, expect } from "vitest";
import { OllamaProvider } from "../core/providers/ollama.js";

function okResp(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function errResp(status: number, text: string): Response {
  return { ok: false, status, json: async () => ({}), text: async () => text } as unknown as Response;
}

const req = { model: "llama3.2", messages: [{ role: "user" as const, content: "hi" }] };

describe("OllamaProvider", () => {
  it("constructs with no API key (local) and parses /api/chat", async () => {
    let url = "";
    const p = new OllamaProvider({
      fetchImpl: async (u: any) => {
        url = String(u);
        return okResp({ message: { content: "hello" }, prompt_eval_count: 11, eval_count: 6 });
      },
    });
    const r = await p.run(req);
    expect(url).toContain("/api/chat");
    expect(r.text).toBe("hello");
    expect(r.tokensIn).toBe(11);
    expect(r.tokensOut).toBe(6);
  });

  it("prepends the system message, sets stream:false, maps sampling to options", async () => {
    let sent: any;
    const p = new OllamaProvider({
      fetchImpl: async (_u: any, init: any) => {
        sent = JSON.parse(init.body);
        return okResp({ message: { content: "x" } });
      },
    });
    await p.run({ ...req, system: "be brief", temperature: 0.1, topK: 20 });
    expect(sent.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(sent.stream).toBe(false);
    expect(sent.options).toEqual({ temperature: 0.1, top_k: 20 });
  });

  it("honors a custom baseUrl", async () => {
    let url = "";
    const p = new OllamaProvider({
      baseUrl: "http://gpu-box:11434",
      fetchImpl: async (u: any) => {
        url = String(u);
        return okResp({ message: { content: "x" } });
      },
    });
    await p.run(req);
    expect(url).toBe("http://gpu-box:11434/api/chat");
  });

  it("throws with .status on a non-ok response", async () => {
    const p = new OllamaProvider({ fetchImpl: async () => errResp(404, "model not found") });
    await expect(p.run(req)).rejects.toMatchObject({ status: 404 });
  });
});
