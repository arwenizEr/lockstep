import { extname } from "node:path";

/**
 * Parse a dataset file's raw contents into a list of input strings. Lets a case
 * pull its `{{input}}` values from a real dataset instead of an inline list.
 *
 * Supported by extension:
 *   .jsonl / .ndjson — one JSON value per line. A string is used verbatim; an
 *                      object uses its `input` field if present, else the whole
 *                      object re-serialized.
 *   .json            — a JSON array (of strings or {input} objects).
 *   .csv             — header row required; uses the `input` column if present,
 *                      else the first column. Minimal RFC-4180 quote handling.
 *   .txt / other     — one input per non-empty line.
 *
 * Pure: takes the already-read contents so it is trivially unit-tested.
 */
export function parseDataset(filename: string, content: string): string[] {
  const ext = extname(filename).toLowerCase();
  if (ext === ".jsonl" || ext === ".ndjson") return parseJsonLines(content);
  if (ext === ".json") return parseJsonArray(content);
  if (ext === ".csv") return parseCsv(content);
  return parseLines(content);
}

function coerce(value: unknown): string {
  if (typeof value === "string") return value;
  if (value != null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.input === "string") return obj.input;
  }
  return JSON.stringify(value);
}

function parseJsonLines(content: string): string[] {
  const out: string[] = [];
  content.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      out.push(coerce(JSON.parse(t)));
    } catch (e) {
      throw new Error(`dataset: invalid JSON on line ${i + 1}: ${(e as Error).message}`);
    }
  });
  return out;
}

function parseJsonArray(content: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`dataset: invalid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("dataset: .json must contain an array");
  return parsed.map(coerce);
}

/** Split one CSV line into fields, honoring double-quoted fields with "" escapes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function parseCsv(content: string): string[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = header.indexOf("input");
  const idx = col >= 0 ? col : 0;
  return lines.slice(1).map((l) => (splitCsvLine(l)[idx] ?? "").trim());
}

function parseLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
