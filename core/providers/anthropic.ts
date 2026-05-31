import Anthropic from "@anthropic-ai/sdk";
import type { Provider, RunRequest, RunResult } from "./types.js";

/**
 * Models that reject sampling params (temperature/top_p/top_k) with a 400 and
 * use the effort-based extended-thinking API instead of a token budget.
 * Prefix-matched.
 */
const EFFORT_THINKING_PREFIXES = ["claude-opus-4-8"];

function usesEffortThinking(model: string): boolean {
  return EFFORT_THINKING_PREFIXES.some((p) => model.startsWith(p));
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
const EFFORT_TIERS = new Set(["low", "medium", "high", "xhigh"]);

const DEFAULT_MAX_OUTPUT = 4096;
const EFFORT_MAX_OUTPUT = 16384; // room for thinking + answer at high/xhigh

function thinkingOff(effort?: string): boolean {
  if (!effort) return true;
  const e = effort.toLowerCase();
  return e === "none" || e === "off";
}

/** Minimal shape of the Anthropic client we depend on (injectable for tests). */
export interface AnthropicLike {
  messages: { create: (params: unknown) => Promise<Anthropic.Message> };
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

    const params: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.system) params.system = req.system;

    if (!off && effortStyle) {
      // Verified live against claude-opus-4-8 (2026-05-31): effort is controlled
      // by `thinking.type:"adaptive"` + `output_config.effort` (low|medium|high|
      // xhigh). Sending `budget_tokens`, top-level `effort`, or
      // `thinking.type:"enabled"` all 400 on this model.
      const tier = req.effort!.toLowerCase();
      if (!EFFORT_TIERS.has(tier)) {
        throw new Error(
          `Unsupported effort "${req.effort}" for ${req.model}. ` +
            `Use one of: ${[...EFFORT_TIERS].join(", ")} (or omit effort).`
        );
      }
      params.max_tokens = EFFORT_MAX_OUTPUT;
      params.thinking = { type: "adaptive" };
      params.output_config = { effort: tier };
      // Sampling params must be omitted when thinking is on (and opus-4-8 rejects
      // them outright).
    } else if (!off && !effortStyle) {
      // Older 4.x family: token-budget thinking.
      const budget = EFFORT_BUDGET[req.effort!.toLowerCase()] ?? 0;
      if (budget > 0) {
        params.max_tokens = budget + DEFAULT_MAX_OUTPUT;
        params.thinking = { type: "enabled", budget_tokens: budget };
      } else {
        params.max_tokens = DEFAULT_MAX_OUTPUT;
      }
    } else {
      // Thinking off. Forward sampling params only when the model accepts them.
      params.max_tokens = DEFAULT_MAX_OUTPUT;
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
      resp = await this.client.messages.create(params);
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

    // Concatenate text blocks; thinking blocks are excluded from output text.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      text,
      tokensIn: resp.usage?.input_tokens ?? 0,
      tokensOut: resp.usage?.output_tokens ?? 0,
      latencyMs,
      raw: resp,
    };
  }
}
