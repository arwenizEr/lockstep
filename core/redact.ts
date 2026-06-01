import type { RunFile, CaseResult } from "./runner.js";

/**
 * Redaction scrubs secrets/PII from a run's text fields *before it is written to
 * disk*, so the shared artifact (run JSON, HTML/Markdown report) is safe to email
 * or host. Assertions and similarity are computed at run time on the real output;
 * only the stored copy is masked.
 *
 * Off by default — redaction can mangle legitimate output (an API response that
 * legitimately contains an email), so it is opt-in via `--redact` / config.
 */
export interface Redaction {
  name: string;
  re: RegExp;
  replacement: string;
}

/** Conservative built-ins: high-precision patterns only, to avoid false hits. */
export const BUILTIN_REDACTIONS: Redaction[] = [
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, replacement: "[redacted-key]" },
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, replacement: "[redacted-key]" },
  { name: "generic-key", re: /\b(?:pk|rk)-[A-Za-z0-9_-]{16,}\b/g, replacement: "[redacted-key]" },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, replacement: "Bearer [redacted-token]" },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[redacted-aws-key]" },
  { name: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: "[redacted-email]" },
];

/**
 * Compile user-supplied regex strings into redactions. Throws on an invalid
 * pattern so a bad config fails loudly rather than silently not redacting.
 */
export function compileUserPatterns(patterns: string[]): Redaction[] {
  return patterns.map((p, i) => {
    let re: RegExp;
    try {
      re = new RegExp(p, "g");
    } catch (e) {
      throw new Error(`Invalid redact pattern #${i + 1} (${p}): ${(e as Error).message}`);
    }
    return { name: `custom-${i + 1}`, re, replacement: "[redacted]" };
  });
}

/** Apply every redaction to a string. Order is built-ins then custom. */
export function redactText(text: string, redactions: Redaction[]): string {
  let out = text;
  for (const r of redactions) {
    // Reset lastIndex — these are reused module-level /g regexes.
    r.re.lastIndex = 0;
    out = out.replace(r.re, r.replacement);
  }
  return out;
}

export interface RedactOptions {
  /** Apply the high-precision built-in patterns. */
  builtins?: boolean;
  /** Extra user regex strings (from config `redact:`). */
  patterns?: string[];
}

/** Resolve the full redaction set for the given options. */
export function resolveRedactions(opts: RedactOptions): Redaction[] {
  const set: Redaction[] = [];
  if (opts.builtins !== false) set.push(...BUILTIN_REDACTIONS);
  if (opts.patterns?.length) set.push(...compileUserPatterns(opts.patterns));
  return set;
}

/**
 * Return a copy of the run with `output`, `error`, and `prompt` scrubbed on every
 * result. Pure — does not mutate the input run.
 */
export function redactRunFile(run: RunFile, redactions: Redaction[]): RunFile {
  if (redactions.length === 0) return run;
  const scrub = (s: string | undefined) =>
    s === undefined ? undefined : redactText(s, redactions);
  const results: CaseResult[] = run.results.map((r) => ({
    ...r,
    prompt: redactText(r.prompt, redactions),
    output: redactText(r.output, redactions),
    error: scrub(r.error),
  }));
  return { ...run, results };
}
