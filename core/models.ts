import type { Config, Target } from "./config.js";

/**
 * Built-in roster of current Anthropic + OpenAI models, used by `ask --all` so a
 * prompt can be compared across the whole field with no lockstep.yaml. Mirrors
 * examples/all-models.yaml. Parameters are set per model the way each provider
 * accepts them: adaptive `effort` for the Opus 4.6+/Sonnet 4.6 line and the
 * OpenAI reasoning models, `temperature` for the OpenAI chat models.
 *
 * Verified against vendor docs and a live run on 2026-06-01. gpt-5.5-pro is
 * intentionally excluded — it is Responses-API only and 404s on Chat Completions.
 */
export const ALL_MODELS: Target[] = [
  // Anthropic — adaptive thinking (fable-5: thinking always on; new tokenizer,
  // ~30% more tokens than Opus-tier for the same content — costs don't transfer)
  { id: "fable-5", provider: "anthropic", model: "claude-fable-5", effort: "high" },
  { id: "opus-4-8", provider: "anthropic", model: "claude-opus-4-8", effort: "high" },
  { id: "opus-4-7", provider: "anthropic", model: "claude-opus-4-7", effort: "high" },
  { id: "opus-4-6", provider: "anthropic", model: "claude-opus-4-6", effort: "high" },
  { id: "sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6", effort: "high" },
  // Anthropic — extended-thinking line (plain)
  { id: "opus-4-5", provider: "anthropic", model: "claude-opus-4-5" },
  { id: "sonnet-4-5", provider: "anthropic", model: "claude-sonnet-4-5" },
  { id: "haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5" },
  // OpenAI — reasoning models
  { id: "gpt-5.5", provider: "openai", model: "gpt-5.5", effort: "high" },
  { id: "gpt-5.4", provider: "openai", model: "gpt-5.4", effort: "high" },
  { id: "gpt-5.4-mini", provider: "openai", model: "gpt-5.4-mini", effort: "high" },
  { id: "o3", provider: "openai", model: "o3", effort: "high" },
  { id: "o4-mini", provider: "openai", model: "o4-mini", effort: "high" },
  // OpenAI — chat models
  { id: "gpt-4.1", provider: "openai", model: "gpt-4.1", temperature: 0 },
  { id: "gpt-4o", provider: "openai", model: "gpt-4o", temperature: 0 },
  { id: "gpt-4o-mini", provider: "openai", model: "gpt-4o-mini", temperature: 0 },
];

/** $/M tokens for the built-in roster. Untrusted defaults — verify before relying. */
export const ALL_PRICING: Config["pricing"] = {
  "claude-fable-5": { in: 10, out: 50 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-opus-4-5": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "gpt-5.5": { in: 5, out: 30 },
  "gpt-5.4": { in: 2.5, out: 15 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
  o3: { in: 2, out: 8 },
  "o4-mini": { in: 1.1, out: 4.4 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

/** A full Config backed by the built-in roster (for `ask --all`). */
export function allModelsConfig(): Config {
  return {
    targets: ALL_MODELS,
    cases_dir: "./cases",
    pricing: ALL_PRICING,
    diff: { similarity_threshold: 0.9 },
    redact: [],
  };
}
