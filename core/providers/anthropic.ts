import Anthropic from "@anthropic-ai/sdk";
import type { Provider, RunRequest, RunResult } from "./types.js";

/**
 * Models that reject sampling params (temperature/top_p/top_k) with a 400 and
 * use the effort-based extended-thinking API instead of a token budget.
 * Prefix-matched.
 */
// Models that use adaptive thinking + `output_config.effort` (and reject
// temperature/top_p/top_k when thinking is on) rather than a token budget.
// Per Anthropic docs: Fable 5 / Mythos 5, the Opus 4.6+ line and Sonnet 4.6 are
// adaptive; older 4.x models (opus-4-5, sonnet-4-5, haiku-4-5) use
// extended-thinking budgets.
const EFFORT_THINKING_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
];

// Fable 5 / Mythos 5: thinking is always on and cannot be configured — an
// explicit `thinking` of any type other than "adaptive" returns a 400, so we
// omit the parameter entirely. Sampling params are rejected unconditionally.
const ALWAYS_THINKING_PREFIXES = ["claude-fable-5", "claude-mythos-5"];

function usesEffortThinking(model: string): boolean {
  return EFFORT_THINKING_PREFIXES.some((p) => model.startsWith(p));
}

function isAlwaysThinking(model: string): boolean {
  return ALWAYS_THINKING_PREFIXES.some((p) => model.startsWith(p));
}

/**
 * Older 4.x models control thinking with a token budget. We map an effort tier
 * to `thinking.budget_tokens` for those.
 */
const EFFORT_BUDGET: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
};

/** Effort tiers the opus-4-8-style `output_config.effort` API accepts. */
const EFFORT_TIERS = new Set(["low", "medium", "high", "xhigh", "max"]);

const DEFAULT_MAX_OUTPUT = 4096;
const EFFORT_MAX_OUTPUT = 16384; // room for thinking + answer at high/xhigh

function thinkingOff(effort?: string): boolean {
  if (!effort) return true;
  const e = effort.toLowerCase();
  return e === "none" || e === "off";
}

/** Minimal shape of the Anthropic client we depend on (injectable for tests). */
export interface AnthropicLike {
  messages: {
    create: (params: unknown) => Promise<Anthropic.Message>;
    /**
     * Streaming entry point. Preferred when present: Fable 5 / high-effort turns
     * can run minutes, and non-streaming requests at 16K+ max_tokens risk SDK
     * HTTP timeouts. Mocks without it fall back to create().
     */
    stream?: (params: unknown) => { finalMessage: () => Promise<Anthropic.Message> };
  };
}

export interface AnthropicOptions {
  /** Injectable client — defaults to a real Anthropic SDK client. Used by tests. */
  client?: AnthropicLike;
}

export class AnthropicProvider implements Provider {
  id = "anthropic";
  private client: AnthropicLike;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, opts: AnthropicOptions = {}) {
    if (opts.client) {
      this.client = opts.client;
      return;
    }
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Export it (or put it in a .env file) before running anthropic targets."
      );
    }
    this.client = new Anthropic({ apiKey }) as unknown as AnthropicLike;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const off = thinkingOff(req.effort);
    const effortStyle = usesEffortThinking(req.model);
    const alwaysThinking = isAlwaysThinking(req.model);

    if (alwaysThinking && req.effort && off) {
      throw new Error(
        `Thinking cannot be disabled on ${req.model} (it is always on). ` +
          `Set an effort tier (${[...EFFORT_TIERS].join(", ")}) or omit effort.`
      );
    }

    const params: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.system) params.system = req.system;

    if (!off && effortStyle) {
      // Verified live against claude-opus-4-8 (2026-05-31): effort is controlled
      // by `thinking.type:"adaptive"` + `output_config.effort` (low|medium|high|
      // xhigh|max). Sending `budget_tokens`, top-level `effort`, or
      // `thinking.type:"enabled"` all 400 on this model.
      const tier = req.effort!.toLowerCase();
      if (!EFFORT_TIERS.has(tier)) {
        throw new Error(
          `Unsupported effort "${req.effort}" for ${req.model}. ` +
            `Use one of: ${[...EFFORT_TIERS].join(", ")} (or omit effort).`
        );
      }
      params.max_tokens = req.maxTokens ?? EFFORT_MAX_OUTPUT;
      // Fable/Mythos 5: thinking is always on — omit the param (any explicit
      // config other than {type:"adaptive"} 400s). Opus/Sonnet line: opt in.
      if (!alwaysThinking) params.thinking = { type: "adaptive" };
      params.output_config = { effort: tier };
      // Sampling params must be omitted when thinking is on (and opus-4-8 rejects
      // them outright).
    } else if (off && alwaysThinking) {
      // No effort requested, but the model thinks regardless — give the response
      // room for thinking + answer and never forward sampling params.
      params.max_tokens = req.maxTokens ?? EFFORT_MAX_OUTPUT;
    } else if (!off && !effortStyle) {
      // Older 4.x family: token-budget thinking.
      const budget = EFFORT_BUDGET[req.effort!.toLowerCase()] ?? 0;
      if (budget > 0) {
        params.max_tokens = req.maxTokens ?? budget + DEFAULT_MAX_OUTPUT;
        params.thinking = { type: "enabled", budget_tokens: budget };
      } else {
        params.max_tokens = req.maxTokens ?? DEFAULT_MAX_OUTPUT;
      }
    } else {
      // Thinking off. Forward sampling params only when the model accepts them.
      params.max_tokens = req.maxTokens ?? DEFAULT_MAX_OUTPUT;
      if (!effortStyle) {
        if (req.temperature !== undefined) params.temperature = req.temperature;
        if (req.topP !== undefined) params.top_p = req.topP;
        if (req.topK !== undefined) params.top_k = req.topK;
      }
    }
    // NOTE: `mode` (e.g. "fast") is not a Messages API field; retained on the
    // target for labeling only — sending it raw would 400.

    const start = Date.now();
    let resp: Anthropic.Message;
    try {
      // Stream when the client supports it (the real SDK does): long thinking
      // turns and 16K+ max_tokens hit HTTP timeouts on non-streaming requests.
      resp = this.client.messages.stream
        ? await this.client.messages.stream(params).finalMessage()
        : await this.client.messages.create(params);
    } catch (e) {
      // Normalize + length-bound the error so it matches the OpenAI adapter and
      // doesn't bloat the persisted run file. Preserve .status for retry logic.
      const err = e as Error & { status?: number };
      const bounded = new Error(
        `Anthropic${err.status ? ` ${err.status}` : ""}: ${(err.message ?? "request failed").slice(0, 500)}`
      ) as Error & { status?: number };
      bounded.status = err.status;
      throw bounded;
    }
    const latencyMs = Date.now() - start;

    // Fable 5 (and Claude 4+ generally) can return HTTP 200 with
    // stop_reason:"refusal" and empty/partial content. Surface it as an error so
    // the run records a failure with a reason instead of a silently empty output.
    if (resp.stop_reason === ("refusal" as Anthropic.Message["stop_reason"])) {
      const details = (resp as { stop_details?: { category?: string | null } }).stop_details;
      throw new Error(
        `Anthropic refusal: ${req.model} declined the request` +
          (details?.category ? ` (category: ${details.category})` : "") +
          `. Pre-output refusals are not billed.`
      );
    }

    // Concatenate text blocks; thinking blocks are excluded from output text.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Cache fields are absent from this SDK version's Usage type but present on
    // the wire for cache-enabled requests.
    const usage = resp.usage as
      | (Anthropic.Usage & {
          cache_read_input_tokens?: number | null;
          cache_creation_input_tokens?: number | null;
        })
      | undefined;

    return {
      text,
      tokensIn: usage?.input_tokens ?? 0,
      tokensOut: usage?.output_tokens ?? 0,
      latencyMs,
      stopReason: resp.stop_reason ?? undefined,
      truncated: resp.stop_reason === "max_tokens" || undefined,
      tokensCacheRead: usage?.cache_read_input_tokens ?? undefined,
      tokensCacheWrite: usage?.cache_creation_input_tokens ?? undefined,
      raw: resp,
    };
  }
}
