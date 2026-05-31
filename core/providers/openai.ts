import type { Provider, RunRequest, RunResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/** Per-request timeout (ms). Env override, else 60s. Guards against hung sockets. */
function timeoutMs(): number {
  const raw = process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * OpenAI adapter. Implemented against the Chat Completions API via fetch so we
 * don't pull in the SDK just for one call path. Same Provider interface as
 * Anthropic — adding a provider is ~one file.
 */
export interface OpenAIOptions {
  baseUrl?: string;
  /** Injectable fetch — defaults to global fetch. Used by tests. */
  fetchImpl?: typeof fetch;
}

export class OpenAIProvider implements Provider {
  id = "openai";
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(apiKey = process.env.OPENAI_API_KEY, opts: OpenAIOptions = {}) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Export it before running openai targets."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl =
      opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
    };
    // Sampling params: OpenAI accepts these (unlike opus-4-8). Pass when set.
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    // effort -> reasoning_effort for reasoning models.
    if (req.effort) body.reasoning_effort = req.effort;

    const start = Date.now();
    const ms = timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      // Abort (timeout) has no HTTP status, so withRetry treats it as retryable.
      if ((e as Error).name === "AbortError") {
        throw new Error(`OpenAI request timed out after ${ms}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(
        `OpenAI ${resp.status}: ${errText.slice(0, 500)}`
      ) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }

    const json = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      latencyMs,
      raw: json,
    };
  }
}
