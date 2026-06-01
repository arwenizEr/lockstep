import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/** Find the nearest .env walking up from `dir` to the filesystem root. */
function findDotenv(dir: string): string | undefined {
  let cur = resolve(dir);
  for (;;) {
    const candidate = resolve(cur, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

/**
 * Minimal .env loader — no dependency. Loads KEY=VALUE lines from the nearest
 * .env file (searching cwd upward) into process.env, without overwriting
 * already-set vars. Supports # comments, optional `export ` prefix, and
 * single/double quotes.
 */
export function loadDotenv(dir = process.cwd()): void {
  const path = findDotenv(dir);
  if (!path) return;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted: strip a trailing inline comment (` #...`). A '#' with no
      // preceding whitespace is kept (e.g. it may be part of the value).
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    // Don't overwrite vars already in the real environment.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
