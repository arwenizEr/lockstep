import type { Provider, RunRequest, RunResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutMs(): number {
  const raw = process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Google Gemini adapter (Generative Language API, v1beta `generateContent`).
 * Same Provider interface as the others — one file, one registry line.
 *
 * Quirks owned here: assistant turns are role "model"; the system prompt goes in
 * `systemInstruction`; sampling lives under `generationConfig`. `effort` has no
 * portable Gemini equivalent (thinking budgets are model-specific) so it is kept
 * for labeling only and not sent.
 */
export interface GeminiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GeminiProvider implements Provider {
  id = "gemini";
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(
    apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    opts: GeminiOptions = {}
  ) {
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Export it before running gemini targets."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl =
      opts.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.topP !== undefined) generationConfig.topP = req.topP;
    if (req.topK !== undefined) generationConfig.topK = req.topK;

    const body: Record<string, unknown> = { contents };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const ms = timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const start = Date.now();
    let resp: Response;
    try {
      resp = await this.fetchImpl(
        `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`Gemini request timed out after ${ms}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(`Gemini ${resp.status}: ${errText.slice(0, 500)}`) as Error & {
        status?: number;
      };
      err.status = resp.status;
      throw err;
    }

    const json = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    return {
      text,
      tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs,
      raw: json,
    };
  }
}
