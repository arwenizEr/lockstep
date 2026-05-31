import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

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
]);

export const CaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  inputs: z.array(z.string()).default([""]),
  system: z.string().optional(),
  assert: z.array(AssertSchema).default([]),
  rubric: z.string().optional(),
});

export type Assertion = z.infer<typeof AssertSchema>;
export type Case = z.infer<typeof CaseSchema>;

/** A case file holds one case or an array of cases. */
export function loadCases(casesDir: string): Case[] {
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
      cases.push(result.data);
    }
  }
  if (cases.length === 0) {
    throw new Error(`No cases found in ${casesDir}`);
  }
  return cases;
}
