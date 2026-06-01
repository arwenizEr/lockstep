import type { Provider, RunRequest, RunResult } from "./types.js";

// Local models are slower to first token than hosted APIs; allow a longer
// default and the same env override as the other adapters.
const DEFAULT_TIMEOUT_MS = 120_000;

function timeoutMs(): number {
  const raw = process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Ollama adapter — local, KEYLESS models via the `/api/chat` endpoint. Lets you
 * regression-test prompts against local llama/qwen/mistral builds with no API
 * key and no network egress, and run a real (non-mock) provider in CI.
 *
 * Quirks owned here: the system prompt is a leading `system` message; sampling
 * lives under `options`; `stream` is forced false so we get one JSON object.
 * Token counts come from `prompt_eval_count` / `eval_count`.
 */
export interface OllamaOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements Provider {
  id = "ollama";
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(opts: OllamaOptions = {}) {
    // No API key — Ollama is local. Honor OLLAMA_HOST like the official client.
    this.baseUrl = opts.baseUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const options: Record<string, unknown> = {};
    if (req.temperature !== undefined) options.temperature = req.temperature;
    if (req.topP !== undefined) options.top_p = req.topP;
    if (req.topK !== undefined) options.top_k = req.topK;

    const body: Record<string, unknown> = { model: req.model, messages, stream: false };
    if (Object.keys(options).length > 0) body.options = options;

    const ms = timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const start = Date.now();
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new Error(`Ollama request timed out after ${ms}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(`Ollama ${resp.status}: ${errText.slice(0, 500)}`) as Error & {
        status?: number;
      };
      err.status = resp.status;
      throw err;
    }

    const json = (await resp.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text: json.message?.content ?? "",
      tokensIn: json.prompt_eval_count ?? 0,
      tokensOut: json.eval_count ?? 0,
      latencyMs,
      raw: json,
    };
  }
}
