import type { Provider, RunRequest, RunResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/** Per-request timeout (ms). Env override, else 60s. Guards against hung sockets. */
function timeoutMs(): number {
  const raw = process.env.LOCKSTEP_HTTP_TIMEOUT_MS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Reasoning models (o1/o3/o4/gpt-5 families) reject temperature/top_p with a 400
 * and instead take reasoning_effort. Plain chat models are the inverse: they
 * reject reasoning_effort. We must drop the wrong params per model, mirroring the
 * Anthropic adapter's discipline (the Provider contract requires it).
 */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model);
}

let warnedTopK = false;

/** OpenAI bills cached prompt tokens at 50% of the input price. */
const OPENAI_CACHE_READ_RATE = 0.5;

/**
 * OpenAI reports cached tokens INSIDE the prompt total (unlike Anthropic, where
 * cache categories are separate). Split them so RunResult.tokensIn holds the
 * uncached remainder and tokensCacheRead the discounted portion — never both.
 */
function splitCachedTokens(
  promptTotal: number,
  cached: number | undefined
): { uncached: number; cached?: number } {
  if (!cached || cached <= 0) return { uncached: promptTotal };
  return { uncached: Math.max(0, promptTotal - cached), cached };
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
    // mode: "responses" routes through the Responses API — required for models
    // that aren't served on Chat Completions (e.g. gpt-5.5-pro).
    if (req.mode === "responses") return this.runResponses(req);

    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
    };
    // Drop the params each model class rejects (both return 400 otherwise).
    if (isReasoningModel(req.model)) {
      if (req.effort) body.reasoning_effort = req.effort;
      if (req.maxTokens !== undefined) body.max_completion_tokens = req.maxTokens;
    } else {
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.topP !== undefined) body.top_p = req.topP;
      if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    }
    // OpenAI Chat Completions has no top_k. Dropping it silently would make an
    // anthropic-vs-openai compare use different sampling — warn once instead.
    if (req.topK !== undefined && !warnedTopK) {
      warnedTopK = true;
      console.warn(
        "lockstep: top_k is not supported by OpenAI Chat Completions and is ignored for openai targets."
      );
    }

    const json = (await this.post("/chat/completions", body)) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      _latencyMs: number;
    };

    const choice = json.choices?.[0];
    const cache = splitCachedTokens(
      json.usage?.prompt_tokens ?? 0,
      json.usage?.prompt_tokens_details?.cached_tokens
    );
    return {
      text: choice?.message?.content ?? "",
      tokensIn: cache.uncached,
      tokensOut: json.usage?.completion_tokens ?? 0,
      latencyMs: json._latencyMs,
      stopReason: choice?.finish_reason ?? undefined,
      truncated: choice?.finish_reason === "length" || undefined,
      tokensCacheRead: cache.cached,
      cacheReadRate: cache.cached !== undefined ? OPENAI_CACHE_READ_RATE : undefined,
      raw: json,
    };
  }

  /** Responses API path. Same Provider contract; different wire shape. */
  private async runResponses(req: RunRequest): Promise<RunResult> {
    const input: { role: string; content: string }[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      input,
    };
    if (req.system) body.instructions = req.system;
    if (isReasoningModel(req.model)) {
      if (req.effort) body.reasoning = { effort: req.effort };
    } else {
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.topP !== undefined) body.top_p = req.topP;
    }
    if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens;

    const json = (await this.post("/responses", body)) as {
      output?: { type: string; content?: { type: string; text?: string }[] }[];
      status?: string;
      incomplete_details?: { reason?: string };
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
      _latencyMs: number;
    };

    // Concatenate output_text parts across message items (reasoning items carry none).
    const text = (json.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");

    const incompleteReason = json.incomplete_details?.reason;
    const cache = splitCachedTokens(
      json.usage?.input_tokens ?? 0,
      json.usage?.input_tokens_details?.cached_tokens
    );
    return {
      text,
      tokensIn: cache.uncached,
      tokensOut: json.usage?.output_tokens ?? 0,
      latencyMs: json._latencyMs,
      stopReason: json.status === "incomplete" ? (incompleteReason ?? "incomplete") : json.status,
      truncated: incompleteReason === "max_output_tokens" || undefined,
      tokensCacheRead: cache.cached,
      cacheReadRate: cache.cached !== undefined ? OPENAI_CACHE_READ_RATE : undefined,
      raw: json,
    };
  }

  /** POST helper shared by both API paths: timeout, error bounding, latency. */
  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const start = Date.now();
    const ms = timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
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

    const json = (await resp.json()) as Record<string, unknown>;
    return { ...json, _latencyMs: latencyMs };
  }
}
