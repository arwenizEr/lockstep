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

/** Recursively sort object keys so equivalent JSON serializes identically. */
function canonicalizeJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalizeJson);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalizeJson((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/**
 * Tier-1 similarity used by `compare`. When BOTH outputs parse as JSON it
 * compares them structurally — key order and whitespace are normalized, so
 * `{"a":1,"b":2}` and `{ "b": 2, "a": 1 }` score 1.0 instead of false-flagging
 * DRIFT. Otherwise (and as the fallback for non-equal JSON) it is the
 * deterministic, offline bag-of-words cosine. No network, no tokens.
 */
export function tier1Similarity(a: string, b: string): number {
  const pa = tryParseJson(a);
  const pb = tryParseJson(b);
  if (pa.ok && pb.ok) {
    const ca = JSON.stringify(canonicalizeJson(pa.value));
    const cb = JSON.stringify(canonicalizeJson(pb.value));
    if (ca === cb) return 1;
    return cosineSimilarity(ca, cb);
  }
  return cosineSimilarity(a, b);
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

/** First numeric literal in the text (handles signs, decimals, thousands). */
function firstNumber(text: string): number | null {
  const m = text.replace(/,(?=\d{3}\b)/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

const jsType = (v: unknown): string => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v; // object | number | string | boolean
};

/**
 * Validate `value` against a small JSON-Schema subset, collecting human paths to
 * the first failures. Supports: type (incl. "integer"), required, properties,
 * items, enum. Unknown keywords are ignored (lenient by design).
 */
function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$",
  errors: string[] = []
): string[] {
  const t = schema.type as string | string[] | undefined;
  if (t !== undefined) {
    const allowed = Array.isArray(t) ? t : [t];
    const actual = jsType(value);
    // "integer" satisfies "number"; an integer value also satisfies "integer".
    const ok = allowed.some(
      (a) => a === actual || (a === "number" && actual === "integer")
    );
    if (!ok) errors.push(`${path}: expected ${allowed.join("|")}, got ${actual}`);
  }
  if (Array.isArray(schema.enum)) {
    const set = schema.enum.map((e) => JSON.stringify(e));
    if (!set.includes(JSON.stringify(value))) {
      errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
    }
  }
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) errors.push(`${path}.${key}: required`);
      }
    }
    const props = schema.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, sub] of Object.entries(props)) {
        if (key in obj && sub && typeof sub === "object") {
          validateJsonSchema(obj[key], sub as Record<string, unknown>, `${path}.${key}`, errors);
        }
      }
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((el, i) =>
      validateJsonSchema(el, schema.items as Record<string, unknown>, `${path}[${i}]`, errors)
    );
  }
  return errors;
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
    case "not_contains": {
      const pass = !output.includes(assertion.value);
      return {
        type: "not_contains",
        pass,
        detail: pass ? undefined : `should not contain "${assertion.value}"`,
      };
    }
    case "icontains": {
      const pass = output.toLowerCase().includes(assertion.value.toLowerCase());
      return {
        type: "icontains",
        pass,
        detail: pass ? undefined : `does not contain (case-insensitive) "${assertion.value}"`,
      };
    }
    case "equals": {
      const pass = output.trim() === assertion.value.trim();
      return {
        type: "equals",
        pass,
        detail: pass ? undefined : "output does not equal expected value",
      };
    }
    case "max_length": {
      const pass = output.length <= assertion.value;
      return {
        type: "max_length",
        pass,
        detail: pass ? undefined : `length ${output.length} > max ${assertion.value}`,
      };
    }
    case "min_length": {
      const pass = output.length >= assertion.value;
      return {
        type: "min_length",
        pass,
        detail: pass ? undefined : `length ${output.length} < min ${assertion.value}`,
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
    case "numeric": {
      const n = firstNumber(output);
      if (n === null) return { type: "numeric", pass: false, detail: "no number found in output" };
      const fails: string[] = [];
      if (assertion.equals !== undefined) {
        const tol = assertion.tolerance ?? 0;
        if (Math.abs(n - assertion.equals) > tol) {
          fails.push(`${n} != ${assertion.equals}${tol ? ` (±${tol})` : ""}`);
        }
      }
      if (assertion.min !== undefined && n < assertion.min) fails.push(`${n} < min ${assertion.min}`);
      if (assertion.max !== undefined && n > assertion.max) fails.push(`${n} > max ${assertion.max}`);
      return { type: "numeric", pass: fails.length === 0, detail: fails.length ? fails.join("; ") : undefined };
    }
    case "json_schema": {
      const parsed = tryParseJson(output);
      if (!parsed.ok) return { type: "json_schema", pass: false, detail: "invalid JSON" };
      const errors = validateJsonSchema(parsed.value, assertion.schema);
      return {
        type: "json_schema",
        pass: errors.length === 0,
        detail: errors.length ? errors.slice(0, 4).join("; ") : undefined,
      };
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
  /** Precomputed similarity (e.g. embeddings) used instead of bag-of-words cosine. */
  similarityOverride?: number;
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
      : input.similarityOverride !== undefined
        ? input.similarityOverride
        : tier1Similarity(input.aOutput, input.bOutput);
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
