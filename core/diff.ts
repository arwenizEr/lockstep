import type { Assertion } from "./cases.js";

// ---------------------------------------------------------------------------
// Text normalization + similarity (Tier-1, deterministic, offline)
// ---------------------------------------------------------------------------

/** Collapse whitespace, trim, lowercase. Stable normalization for diffing. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * Bag-of-words cosine similarity in [0,1]. Deterministic, no network — this is
 * the default Tier-1 similarity. (Embedding-based cosine is an optional upgrade
 * that costs tokens; kept out of the default path so `compare` stays offline.)
 */
export function cosineSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const fa = termFreq(tokenize(a));
  const fb = termFreq(tokenize(b));
  if (fa.size === 0 && fb.size === 0) return 1;
  if (fa.size === 0 || fb.size === 0) return 0;
  let dot = 0;
  for (const [term, va] of fa) {
    const vb = fb.get(term);
    if (vb) dot += va * vb;
  }
  let magA = 0;
  for (const v of fa.values()) magA += v * v;
  let magB = 0;
  for (const v of fb.values()) magB += v * v;
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** outLen - inLen, in characters. */
export function lengthDelta(a: string, b: string): number {
  return b.length - a.length;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export interface AssertionResult {
  type: string;
  pass: boolean;
  detail?: string;
}

/** Strip ```json fences and surrounding prose, return best-effort JSON string. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  // Otherwise grab from first { or [ to matching last } or ].
  const firstObj = trimmed.indexOf("{");
  const firstArr = trimmed.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) return trimmed;
  const start = Math.min(...starts);
  const openCh = trimmed[start];
  const closeCh = openCh === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(closeCh);
  if (end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(extractJson(text)) };
  } catch {
    return { ok: false };
  }
}

/** Resolve a dot/bracket JSON path like `a.b[0].c` against a parsed value. */
function resolvePath(root: unknown, path: string): { found: boolean; value: unknown } {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return { found: false, value: undefined };
  }
  return { found: true, value: cur };
}

export function runAssertion(assertion: Assertion, output: string): AssertionResult {
  switch (assertion.type) {
    case "json_valid": {
      const parsed = tryParseJson(output);
      return {
        type: "json_valid",
        pass: parsed.ok,
        detail: parsed.ok ? undefined : "output is not valid JSON",
      };
    }
    case "json_has_keys": {
      const parsed = tryParseJson(output);
      if (!parsed.ok) return { type: "json_has_keys", pass: false, detail: "invalid JSON" };
      if (parsed.value == null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
        return { type: "json_has_keys", pass: false, detail: "JSON is not an object" };
      }
      const obj = parsed.value as Record<string, unknown>;
      const missing = assertion.keys.filter((k) => !(k in obj));
      return {
        type: "json_has_keys",
        pass: missing.length === 0,
        detail: missing.length ? `missing keys: ${missing.join(", ")}` : undefined,
      };
    }
    case "contains": {
      const pass = output.includes(assertion.value);
      return {
        type: "contains",
        pass,
        detail: pass ? undefined : `does not contain "${assertion.value}"`,
      };
    }
    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(assertion.value);
      } catch (e) {
        return { type: "regex", pass: false, detail: `invalid regex: ${(e as Error).message}` };
      }
      const pass = re.test(output);
      return { type: "regex", pass, detail: pass ? undefined : `no match for /${assertion.value}/` };
    }
    case "json_path": {
      const parsed = tryParseJson(output);
      if (!parsed.ok) return { type: "json_path", pass: false, detail: "invalid JSON" };
      const { found, value } = resolvePath(parsed.value, assertion.path);
      if (!found) return { type: "json_path", pass: false, detail: `path not found: ${assertion.path}` };
      if (assertion.equals !== undefined) {
        const eq = JSON.stringify(value) === JSON.stringify(assertion.equals);
        return {
          type: "json_path",
          pass: eq,
          detail: eq ? undefined : `path ${assertion.path} = ${JSON.stringify(value)}, expected ${JSON.stringify(assertion.equals)}`,
        };
      }
      return { type: "json_path", pass: true };
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = assertion;
      return { type: (_never as { type: string }).type, pass: false, detail: "unknown assertion" };
    }
  }
}

export function runAssertions(assertions: Assertion[], output: string): AssertionResult[] {
  return assertions.map((a) => runAssertion(a, output));
}

// ---------------------------------------------------------------------------
// Compare two results for a single case+input cell
// ---------------------------------------------------------------------------

export type CompareStatus =
  | "OK"
  | "DRIFTED"
  | "BROKEN"
  | "CHEAPER"
  | "PRICIER"
  | "FASTER"
  | "SLOWER";

export interface CompareCell {
  caseId: string;
  inputIndex: number;
  similarity: number;
  drifted: boolean;
  broken: boolean;
  costDelta: number; // B - A
  costPct: number | null; // null if A cost is 0
  latencyDelta: number; // B - A (ms)
  statuses: CompareStatus[];
}

export interface CompareInput {
  caseId: string;
  inputIndex: number;
  aOutput: string;
  bOutput: string;
  aBroken: boolean;
  bBroken: boolean;
  aCost: number;
  bCost: number;
  aLatency: number;
  bLatency: number;
  /** Assertion failure on either side also counts as BROKEN. */
  aAssertFail?: boolean;
  bAssertFail?: boolean;
}

const COST_EPSILON = 1e-9;
const LATENCY_EPSILON_MS = 50;

export function compareCell(
  input: CompareInput,
  similarityThreshold: number
): CompareCell {
  const broken =
    input.aBroken ||
    input.bBroken ||
    !!input.aAssertFail ||
    !!input.bAssertFail;
  const similarity =
    input.aBroken || input.bBroken
      ? 0
      : cosineSimilarity(input.aOutput, input.bOutput);
  const drifted = !broken && similarity < similarityThreshold;

  const costDelta = input.bCost - input.aCost;
  const costPct = input.aCost > COST_EPSILON ? costDelta / input.aCost : null;
  const latencyDelta = input.bLatency - input.aLatency;

  const statuses: CompareStatus[] = [];
  if (broken) statuses.push("BROKEN");
  if (drifted) statuses.push("DRIFTED");
  if (costDelta < -COST_EPSILON) statuses.push("CHEAPER");
  else if (costDelta > COST_EPSILON) statuses.push("PRICIER");
  if (!broken) {
    if (latencyDelta < -LATENCY_EPSILON_MS) statuses.push("FASTER");
    else if (latencyDelta > LATENCY_EPSILON_MS) statuses.push("SLOWER");
  }
  if (statuses.length === 0) statuses.push("OK");

  return {
    caseId: input.caseId,
    inputIndex: input.inputIndex,
    similarity,
    drifted,
    broken,
    costDelta,
    costPct,
    latencyDelta,
    statuses,
  };
}
