import type { Provider, RunRequest, RunResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutMs(): number {
  const raw = process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * OpenRouter adapter — one key, hundreds of models behind an OpenAI-compatible
 * Chat Completions API. Model ids are namespaced (e.g. "anthropic/claude-opus-4",
 * "google/gemini-2.5-pro"), which makes `ask --all`-style fan-out cheap to wire.
 *
 * Quirks owned here: OpenRouter accepts temperature/top_p/top_k for chat models;
 * reasoning models take a `reasoning: { effort }` object. We forward sampling
 * params as-is and map `effort` onto `reasoning.effort` when present. The
 * optional HTTP-Referer / X-Title headers (used for OpenRouter's leaderboard) are
 * sent when configured via env.
 */
export interface OpenRouterOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenRouterProvider implements Provider {
  id = "openrouter";
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(apiKey = process.env.OPENROUTER_API_KEY, opts: OpenRouterOptions = {}) {
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. Export it before running openrouter targets."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = opts.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = { model: req.model, messages };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.topK !== undefined) body.top_k = req.topK;
    if (req.effort) body.reasoning = { effort: req.effort };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    if (process.env.OPENROUTER_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER;
    if (process.env.OPENROUTER_TITLE) headers["X-Title"] = process.env.OPENROUTER_TITLE;

    const ms = timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const start = Date.now();
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`OpenRouter request timed out after ${ms}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(`OpenRouter ${resp.status}: ${errText.slice(0, 500)}`) as Error & {
        status?: number;
      };
      err.status = resp.status;
      throw err;
    }

    const json = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      latencyMs,
      raw: json,
    };
  }
}
