import type { Config } from "./config.js";

// ---------------------------------------------------------------------------
// `lockstep doctor` — answer "will my run actually work?" before spending money
// or time. Maps each configured target to whether its provider's credentials are
// present. Pure: takes an env snapshot so it is fully unit-testable.
// ---------------------------------------------------------------------------

/** Env var(s) that authenticate each provider. Empty array = keyless. */
export const PROVIDER_KEYS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  ollama: [], // local daemon, no key
  mock: [], // keyless
};

export interface ProviderHealth {
  provider: string;
  /** Accepted env var names (any one satisfies it). */
  keyEnv: string[];
  keyless: boolean;
  ready: boolean;
}

export interface TargetHealth {
  id: string;
  provider: string;
  model: string;
  runnable: boolean;
  reason?: string;
}

export interface Diagnosis {
  providers: ProviderHealth[];
  targets: TargetHealth[];
  allRunnable: boolean;
}

function hasKey(envNames: string[], env: Record<string, string | undefined>): boolean {
  return envNames.some((n) => {
    const v = env[n];
    return typeof v === "string" && v.trim() !== "";
  });
}

/**
 * Diagnose a config against an environment snapshot: per-provider key readiness
 * and per-target runnability. Unknown providers (not in PROVIDER_KEYS) are
 * reported as not runnable with a clear reason rather than assumed-keyless.
 */
export function diagnose(
  config: Pick<Config, "targets">,
  env: Record<string, string | undefined>
): Diagnosis {
  const used = [...new Set(config.targets.map((t) => t.provider))];

  const providers: ProviderHealth[] = used.map((provider) => {
    const known = provider in PROVIDER_KEYS;
    const keyEnv = PROVIDER_KEYS[provider] ?? [];
    const keyless = known && keyEnv.length === 0;
    const ready = !known ? false : keyless || hasKey(keyEnv, env);
    return { provider, keyEnv, keyless, ready };
  });
  const readyByProvider = new Map(providers.map((p) => [p.provider, p]));

  const targets: TargetHealth[] = config.targets.map((t) => {
    const ph = readyByProvider.get(t.provider);
    if (!ph) {
      return { id: t.id, provider: t.provider, model: t.model, runnable: false, reason: "unknown provider" };
    }
    if (ph.ready) {
      return { id: t.id, provider: t.provider, model: t.model, runnable: true };
    }
    const reason = ph.keyEnv.length
      ? `set ${ph.keyEnv.join(" or ")}`
      : "provider not ready";
    return { id: t.id, provider: t.provider, model: t.model, runnable: false, reason };
  });

  return { providers, targets, allRunnable: targets.every((t) => t.runnable) };
}
