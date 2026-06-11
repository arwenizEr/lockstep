import type { Config, Price } from "./config.js";

/**
 * Seed price table ($/million tokens). USER-EDITABLE in lockstep.yaml; these are
 * fallbacks only. Every number is "verify before relying on it" — prices change
 * every release. Config pricing always overrides these.
 */
export const DEFAULT_PRICING: Record<string, Price> = {
  // verify: Anthropic
  "claude-fable-5": { in: 10, out: 50 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-8-fast": { in: 10, out: 50 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  // verify: OpenAI (placeholders)
  "gpt-5": { in: 5, out: 20 },
  // verify: Google (placeholders)
  "gemini-2.5-pro": { in: 2.5, out: 10 },
};

export function priceFor(
  config: Pick<Config, "pricing">,
  model: string
): Price | undefined {
  return config.pricing[model] ?? DEFAULT_PRICING[model];
}

/**
 * Default prompt-cache multipliers on the input price (Anthropic): reads bill
 * at ~0.1x, writes (5-minute TTL) at ~1.25x. OpenAI bills cached prompt tokens
 * at 0.5x — adapters override via readRate. In both cases `tokensIn` must hold
 * the uncached remainder only (the OpenAI adapter subtracts cached_tokens).
 */
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

export interface CacheTokens {
  read?: number;
  write?: number;
  /** Cache-read price as a fraction of the input price. Defaults to 0.1 (Anthropic). */
  readRate?: number;
}

/**
 * Cost in USD = (tokensIn/1e6)*priceIn + (tokensOut/1e6)*priceOut
 *             + cache reads at readRate x in + cache writes at 1.25x in.
 */
export function computeCost(
  price: Price | undefined,
  tokensIn: number,
  tokensOut: number,
  cache: CacheTokens = {}
): number {
  if (!price) return 0;
  return (
    (tokensIn / 1e6) * price.in +
    (tokensOut / 1e6) * price.out +
    ((cache.read ?? 0) / 1e6) * price.in * (cache.readRate ?? CACHE_READ_MULT) +
    ((cache.write ?? 0) / 1e6) * price.in * CACHE_WRITE_MULT
  );
}

export function costForModel(
  config: Pick<Config, "pricing">,
  model: string,
  tokensIn: number,
  tokensOut: number,
  cache: CacheTokens = {}
): { cost: number; priced: boolean } {
  const price = priceFor(config, model);
  return { cost: computeCost(price, tokensIn, tokensOut, cache), priced: !!price };
}
