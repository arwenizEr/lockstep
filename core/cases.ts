import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { parseDataset } from "./dataset.js";

export const AssertSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("json_valid") }),
  z.object({ type: z.literal("json_has_keys"), keys: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("contains"), value: z.string() }),
  z.object({ type: z.literal("not_contains"), value: z.string() }),
  z.object({ type: z.literal("icontains"), value: z.string() }),
  z.object({ type: z.literal("equals"), value: z.string() }),
  z.object({ type: z.literal("regex"), value: z.string() }),
  z.object({ type: z.literal("max_length"), value: z.number().int().nonnegative() }),
  z.object({ type: z.literal("min_length"), value: z.number().int().nonnegative() }),
  z.object({ type: z.literal("json_path"), path: z.string(), equals: z.unknown().optional() }),
  z.object({
    type: z.literal("numeric"),
    // Extracts the first number in the output and checks it. At least one bound
    // must be given; `tolerance` widens an `equals` into a band.
    min: z.number().optional(),
    max: z.number().optional(),
    equals: z.number().optional(),
    tolerance: z.number().nonnegative().optional(),
  }),
  z.object({
    // Validate the output's JSON against a small JSON-Schema subset
    // (type, required, properties, items, enum). Offline, no extra dep.
    type: z.literal("json_schema"),
    schema: z.record(z.string(), z.unknown()),
  }),
]);

/** A scripted conversation turn for multi-turn cases. System goes in `system`. */
export const CaseMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

export const CaseSchema = z
  .object({
    id: z.string().min(1),
    /** Single-turn prompt. Mutually exclusive with `messages`. */
    prompt: z.string().min(1).optional(),
    /** Multi-turn conversation. Mutually exclusive with `prompt`. */
    messages: z.array(CaseMessageSchema).min(1).optional(),
    inputs: z.array(z.string()).default([""]),
    /** Load `{{input}}` values from a dataset file (path relative to the case file's dir). */
    inputs_file: z.string().optional(),
    system: z.string().optional(),
    assert: z.array(AssertSchema).default([]),
    rubric: z.string().optional(),
  })
  .refine((c) => !!c.prompt !== !!c.messages, {
    message: "provide exactly one of `prompt` or `messages`",
    path: ["prompt"],
  });

export type Assertion = z.infer<typeof AssertSchema>;
export type CaseMessage = z.infer<typeof CaseMessageSchema>;
export type Case = z.infer<typeof CaseSchema>;

/** Suite-wide defaults merged into each case (see config `defaults:`). */
export interface CaseDefaults {
  system?: string;
  rubric?: string;
  assert?: Assertion[];
}

/**
 * Merge suite defaults into one case: `system`/`rubric` fill in only when the
 * case omits them; default assertions are prepended to the case's own (so a
 * shared `json_valid` runs before case-specific checks). Pure.
 */
export function applyDefaults(case_: Case, defaults?: CaseDefaults): Case {
  if (!defaults) return case_;
  return {
    ...case_,
    system: case_.system ?? defaults.system,
    rubric: case_.rubric ?? defaults.rubric,
    assert: [...(defaults.assert ?? []), ...case_.assert],
  };
}

/** A case file holds one case or an array of cases. */
export function loadCases(casesDir: string, defaults?: CaseDefaults): Case[] {
  if (!existsSync(casesDir) || !statSync(casesDir).isDirectory()) {
    throw new Error(`cases_dir not found: ${casesDir}`);
  }
  const files = readdirSync(casesDir)
    .filter((f) => [".yaml", ".yml"].includes(extname(f).toLowerCase()))
    .sort();

  const cases: Case[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = readFileSync(join(casesDir, file), "utf8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (e) {
      throw new Error(`Failed to parse ${file}: ${(e as Error).message}`);
    }
    // A blank file parses to null/undefined — skip it rather than reporting a
    // confusing "Invalid case" on a non-existent entry.
    const arr = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (e) => e != null
    );
    for (const entry of arr) {
      const result = CaseSchema.safeParse(entry);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
        throw new Error(`Invalid case in ${file}:\n${issues}`);
      }
      if (seen.has(result.data.id)) {
        throw new Error(`Duplicate case id "${result.data.id}" (in ${file})`);
      }
      seen.add(result.data.id);

      const case_ = result.data;
      if (case_.inputs_file) {
        const dsPath = isAbsolute(case_.inputs_file)
          ? case_.inputs_file
          : resolve(casesDir, case_.inputs_file);
        if (!existsSync(dsPath)) {
          throw new Error(`inputs_file not found for case "${case_.id}" (in ${file}): ${dsPath}`);
        }
        let fileInputs: string[];
        try {
          fileInputs = parseDataset(dsPath, readFileSync(dsPath, "utf8"));
        } catch (e) {
          throw new Error(`Failed to load inputs_file for case "${case_.id}": ${(e as Error).message}`);
        }
        // Drop the lone default "" placeholder; keep any explicit inline inputs first.
        const inline = case_.inputs.filter((i) => i !== "");
        const merged = [...inline, ...fileInputs];
        case_.inputs = merged.length > 0 ? merged : [""];
      }

      cases.push(applyDefaults(case_, defaults));
    }
  }
  if (cases.length === 0) {
    throw new Error(`No cases found in ${casesDir}`);
  }
  return cases;
}
