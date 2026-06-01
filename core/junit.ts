import type { RunFile, CaseResult } from "./runner.js";

/** XML-escape text/attribute content. */
function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Failed assertions on a result, as a human message (empty if all passed). */
function assertionFailures(r: CaseResult): string {
  if (!r.assertions) return "";
  return r.assertions
    .filter((a) => !a.pass)
    .map((a) => `${a.type}${a.detail ? `: ${a.detail}` : ""}`)
    .join("; ");
}

const SYSTEM_OUT_LIMIT = 2000;

/**
 * A <system-out> block carrying what the model actually returned (truncated) plus
 * cost/latency and any judge score — so a CI test viewer shows the output next to
 * a pass/fail, not just the verdict. Empty for BROKEN cells (the <error> already
 * carries the message).
 */
function systemOut(r: CaseResult): string {
  if (r.status === "BROKEN") return "";
  const meta = [
    `${r.tokensIn}/${r.tokensOut} tok`,
    `${r.latencyMs}ms`,
    `$${r.cost.toFixed(5)}${r.priced ? "" : "~"}`,
    r.judge ? `judge ${r.judge.score.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const out = r.output.length > SYSTEM_OUT_LIMIT
    ? r.output.slice(0, SYSTEM_OUT_LIMIT) + "…"
    : r.output;
  return `      <system-out>${xml(`[${meta}]\n${out}`)}</system-out>`;
}

/**
 * Render a run as a JUnit XML report. Each cell (case × input × target) becomes
 * one <testcase>. A BROKEN cell is an <error> (the request itself failed); a
 * cell whose assertions failed is a <failure>. Consumable by GitHub Actions,
 * GitLab, Jenkins, and most CI test-report viewers.
 */
export function renderJUnit(run: RunFile): string {
  const results = run.results;
  const errors = results.filter((r) => r.status === "BROKEN").length;
  const failures = results.filter(
    (r) => r.status === "OK" && r.assertionsPass === false
  ).length;
  const totalTimeS = results.reduce((n, r) => n + r.latencyMs, 0) / 1000;

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<testsuites name="lockstep" tests="${results.length}" failures="${failures}" errors="${errors}" time="${totalTimeS.toFixed(3)}">`
  );
  lines.push(
    `  <testsuite name="lockstep" tests="${results.length}" failures="${failures}" errors="${errors}" timestamp="${xml(run.startedAt)}" time="${totalTimeS.toFixed(3)}">`
  );

  for (const r of results) {
    const name = `${r.caseId}#${r.inputIndex}`;
    const time = (r.latencyMs / 1000).toFixed(3);
    const open = `    <testcase name="${xml(name)}" classname="${xml(r.targetId)}" time="${time}">`;

    if (r.status === "BROKEN") {
      lines.push(open);
      lines.push(
        `      <error message="${xml(r.error ?? "request failed")}" type="ProviderError"/>`
      );
      lines.push(`    </testcase>`);
    } else if (r.assertionsPass === false) {
      const msg = assertionFailures(r) || "assertion failed";
      lines.push(open);
      lines.push(`      <failure message="${xml(msg)}" type="AssertionError"/>`);
      lines.push(systemOut(r));
      lines.push(`    </testcase>`);
    } else {
      lines.push(open);
      lines.push(systemOut(r));
      lines.push(`    </testcase>`);
    }
  }

  lines.push(`  </testsuite>`);
  lines.push(`</testsuites>`);
  lines.push("");
  return lines.join("\n");
}
