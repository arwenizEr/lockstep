import type { Config, Price } from "./config.js";

/**
 * Seed price table ($/million tokens). USER-EDITABLE in lockstep.yaml; these are
 * fallbacks only. Every number is "verify before relying on it" — prices change
 * every release. Config pricing always overrides these.
 */
export const DEFAULT_PRICING: Record<string, Price> = {
  // verify: Anthropic
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

/** Cost in USD = (tokensIn/1e6)*priceIn + (tokensOut/1e6)*priceOut. */
export function computeCost(
  price: Price | undefined,
  tokensIn: number,
  tokensOut: number
): number {
  if (!price) return 0;
  return (tokensIn / 1e6) * price.in + (tokensOut / 1e6) * price.out;
}

export function costForModel(
  config: Pick<Config, "pricing">,
  model: string,
  tokensIn: number,
  tokensOut: number
): { cost: number; priced: boolean } {
  const price = priceFor(config, model);
  return { cost: computeCost(price, tokensIn, tokensOut), priced: !!price };
}
