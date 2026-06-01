import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { isKnownProvider, PROVIDER_IDS } from "./providers/registry.js";
import { AssertSchema } from "./cases.js";

/**
 * Shared case defaults. Applied per case at load time: `system`/`rubric` fill in
 * only when a case omits them; `assert` entries are prepended to each case's own.
 * Lets a suite set "Output only JSON" + a json_valid assertion once.
 */
export const CaseDefaultsSchema = z.object({
  system: z.string().optional(),
  rubric: z.string().optional(),
  assert: z.array(AssertSchema).default([]),
});

export const TargetSchema = z.object({
  id: z.string().min(1),
  // Validated against the provider registry (the single source of truth), so
  // adding a provider never requires touching this schema.
  provider: z.string().min(1).refine(isKnownProvider, {
    message: `unknown provider (known: ${PROVIDER_IDS.join(", ")})`,
  }),
  model: z.string().min(1),
  effort: z.string().optional(),
  mode: z.string().optional(),
  /** Sampling params are optional + opt-in. Adapters drop them for models that 400. */
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
});

export const PriceSchema = z.object({
  in: z.number().nonnegative(),
  out: z.number().nonnegative(),
});

export const ConfigSchema = z.object({
  targets: z.array(TargetSchema).min(1),
  cases_dir: z.string().default("./cases"),
  /** $/million tokens. USER-EDITABLE, treated as untrusted defaults — verify before relying. */
  pricing: z.record(z.string(), PriceSchema).default({}),
  diff: z
    .object({
      similarity_threshold: z.number().min(0).max(1).default(0.9),
    })
    .default({ similarity_threshold: 0.9 }),
  /**
   * Extra regex strings to scrub from stored output/reports. Presence of any
   * pattern turns redaction on (built-ins included); see `core/redact.ts`.
   */
  redact: z.array(z.string()).default([]),
  /** Shared case defaults (system/rubric/assert) merged into every case at load. */
  defaults: CaseDefaultsSchema.optional(),
});

export type Target = z.infer<typeof TargetSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface LoadedConfig {
  config: Config;
  /** Absolute path to the config file's directory — used to resolve cases_dir. */
  baseDir: string;
  casesDir: string;
}

export function loadConfig(path = "lockstep.yaml"): LoadedConfig {
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    throw new Error(
      `Config not found at ${abs}. Run \`lockstep init\` to scaffold one.`
    );
  }
  const raw = readFileSync(abs, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new Error(`Failed to parse ${abs}: ${(e as Error).message}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid lockstep.yaml:\n${issues}`);
  }
  const baseDir = dirname(abs);
  const casesDir = isAbsolute(result.data.cases_dir)
    ? result.data.cases_dir
    : resolve(baseDir, result.data.cases_dir);
  return { config: result.data, baseDir, casesDir };
}
