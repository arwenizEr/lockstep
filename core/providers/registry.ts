import type { Provider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OllamaProvider } from "./ollama.js";
import { MockProvider } from "./mock.js";

/**
 * The single source of truth for which providers exist. Adding a provider is:
 *   1. write `core/providers/<name>.ts` implementing the Provider interface,
 *   2. add one line here.
 * Nothing else in the codebase needs to change — config validation and the
 * runner both read from this map.
 *
 * Factories are lazy so a missing API key only fails for providers you actually
 * use (constructing a provider reads/validates its key).
 */
export const PROVIDER_FACTORIES: Record<string, () => Provider> = {
  anthropic: () => new AnthropicProvider(),
  openai: () => new OpenAIProvider(),
  gemini: () => new GeminiProvider(),
  openrouter: () => new OpenRouterProvider(),
  ollama: () => new OllamaProvider(),
  mock: () => new MockProvider(),
};

export const PROVIDER_IDS = Object.keys(PROVIDER_FACTORIES);

export function isKnownProvider(id: string): boolean {
  return id in PROVIDER_FACTORIES;
}

export function createProvider(id: string): Provider {
  const factory = PROVIDER_FACTORIES[id];
  if (!factory) {
    throw new Error(
      `Unknown provider "${id}". Known providers: ${PROVIDER_IDS.join(", ")}. ` +
        `Add one in core/providers/registry.ts.`
    );
  }
  return factory();
}
