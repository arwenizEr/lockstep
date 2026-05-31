#!/usr/bin/env node
import { writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { Command } from "commander";
import { loadDotenv } from "../core/env.js";
import { loadConfig } from "../core/config.js";

// Load .env (cwd) before anything reads API keys. Real env vars win.
loadDotenv();
import { loadCases } from "../core/cases.js";
import { run, writeRunFile, type RunFile, type CaseResult } from "../core/runner.js";
import { loadRunFile, compareRuns, type CompareReport } from "../core/compare.js";
import { renderReport } from "../core/report.js";

const program = new Command();

program
  .name("lockstep")
  .description(
    "Prompt-CI: replay prompts across model/effort tiers, diff output + cost + latency."
  )
  .version("0.1.0");

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
program
  .command("init")
  .description("Scaffold lockstep.yaml + cases/example.yaml")
  .option("-f, --force", "overwrite existing files", false)
  .action((opts: { force: boolean }) => {
    const cwd = process.cwd();
    const configPath = join(cwd, "lockstep.yaml");
    const casesDir = join(cwd, "cases");
    const examplePath = join(casesDir, "example.yaml");

    if (existsSync(configPath) && !opts.force) {
      console.error("lockstep.yaml already exists. Use --force to overwrite.");
      process.exitCode = 1;
      return;
    }

    writeFileSync(configPath, CONFIG_TEMPLATE, "utf8");
    mkdirSync(casesDir, { recursive: true });
    if (!existsSync(examplePath) || opts.force) {
      writeFileSync(examplePath, CASES_TEMPLATE, "utf8");
    }

    console.log("Created:");
    console.log("  lockstep.yaml");
    console.log("  cases/example.yaml");
    console.log("\nNext:");
    console.log("  export ANTHROPIC_API_KEY=sk-...");
    console.log("  lockstep run");
  });

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
program
  .command("run")
  .description("Run every case x every target; record to .lockstep/runs/")
  .option(
    "-t, --target <id>",
    "only run this target id (repeatable)",
    collect,
    [] as string[]
  )
  .option("-c, --concurrency <n>", "max concurrent requests", "4")
  .option("--judge", "enable tier-2 LLM-as-judge (opt-in, costs tokens)", false)
  .option("--judge-model <model>", "judge model (default claude-haiku-4-5)")
  .action(
    async (opts: {
      target: string[];
      concurrency: string;
      judge: boolean;
      judgeModel?: string;
    }) => {
      const loaded = loadConfig();
      const cases = loadCases(loaded.casesDir);
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 4);

      const total =
        cases.reduce((n, c) => n + c.inputs.length, 0) *
        (opts.target.length > 0
          ? loaded.config.targets.filter((t) => opts.target.includes(t.id)).length
          : loaded.config.targets.length);

      let done = 0;
      console.log(`Running ${total} job(s) (concurrency ${concurrency})...\n`);

      if (opts.judge) console.log("Tier-2 judge: ON (scores cases with a rubric)\n");

      const runFile = await run(
        loaded,
        cases,
        {
          targetIds: opts.target,
          concurrency,
          judge: opts.judge,
          judgeModel: opts.judgeModel,
        },
        {
          onResult: (r) => {
            done++;
            const tag = r.status === "OK" ? "ok " : "ERR";
            const extra =
              r.status === "OK"
                ? `${r.latencyMs}ms  $${r.cost.toFixed(5)}`
                : (r.error ?? "");
            console.log(
              `  [${done}/${total}] ${tag} ${r.targetId} :: ${r.caseId}#${r.inputIndex}  ${extra}`
            );
          },
        }
      );

      const path = writeRunFile(loaded.baseDir, runFile);
      console.log(`\nSaved run -> ${path}\n`);
      printSummary(runFile);
    }
  );

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------
program
  .command("compare [runA] [runB]")
  .description("Diff two runs per case: similarity, cost/latency delta, status")
  .option("--a-target <id>", "which target in run A to compare")
  .option("--b-target <id>", "which target in run B to compare")
  .action(
    (
      runA: string | undefined,
      runB: string | undefined,
      opts: { aTarget?: string; bTarget?: string }
    ) => {
      const [pa, pb] = resolveRunPair(runA, runB);
      const report = compareRuns(loadRunFile(pa), loadRunFile(pb), {
        aTargetId: opts.aTarget,
        bTargetId: opts.bTarget,
      });
      printCompare(report);
    }
  );

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
program
  .command("report [runA] [runB]")
  .description("Generate a self-contained shareable HTML report from two runs")
  .option("-o, --out <file>", "output html path", "lockstep-report.html")
  .option("--a-target <id>", "which target in run A to compare")
  .option("--b-target <id>", "which target in run B to compare")
  .action(
    (
      runA: string | undefined,
      runB: string | undefined,
      opts: { out: string; aTarget?: string; bTarget?: string }
    ) => {
      const [pa, pb] = resolveRunPair(runA, runB);
      const report = compareRuns(loadRunFile(pa), loadRunFile(pb), {
        aTargetId: opts.aTarget,
        bTargetId: opts.bTarget,
      });
      report.generatedAt = new Date().toISOString();
      const html = renderReport(report);
      const outPath = isAbsolute(opts.out)
        ? opts.out
        : resolve(process.cwd(), opts.out);
      writeFileSync(outPath, html, "utf8");
      console.log(`Wrote report -> ${outPath}`);
      console.log(
        `  ${report.aTargetId} vs ${report.bTargetId} · ${report.summary.total} cases · ` +
          `${report.summary.drifted} drifted · ${report.summary.broken} broken`
      );
    }
  );

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

/** List run files newest-first. */
function listRuns(): string[] {
  const dir = join(process.cwd(), ".lockstep", "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .map((f) => join(dir, f));
}

/** Resolve two run paths. If omitted, auto-pick the two most recent runs (B=newest, A=previous). */
function resolveRunPair(
  runA: string | undefined,
  runB: string | undefined
): [string, string] {
  if (runA && runB) {
    return [absRun(runA), absRun(runB)];
  }
  if (runA && !runB) {
    throw new Error("Provide both runA and runB, or neither (to auto-pick recent runs).");
  }
  const runs = listRuns();
  if (runs.length < 2) {
    throw new Error(
      `Need two runs to compare; found ${runs.length} in .lockstep/runs/. ` +
        `Run \`lockstep run\` twice (or pass explicit paths).`
    );
  }
  // runs[0] is newest. A = older, B = newer.
  return [runs[1], runs[0]];
}

function absRun(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function printCompare(report: CompareReport): void {
  console.log(
    `\n  A: ${report.aTargetId} (${report.aModel})   B: ${report.bTargetId} (${report.bModel})`
  );
  console.log(`  drift threshold: ${(report.similarityThreshold * 100).toFixed(0)}% similarity\n`);

  const rows = report.pairs.map((p) => {
    const sim = p.cell ? (p.cell.similarity * 100).toFixed(0) + "%" : "—";
    const dCost = p.cell ? fmtSigned(p.cell.costDelta, 5, "$") : "—";
    const dLat = p.cell ? fmtSigned(p.cell.latencyDelta, 0, "", "ms") : "—";
    const status = p.cell ? p.cell.statuses.join(",") : "BROKEN";
    return [`${p.caseId}#${p.inputIndex}`, sim, dCost, dLat, status];
  });

  printTable(["case", "sim", "Δ cost", "Δ lat", "status"], rows);

  const s = report.summary;
  console.log(
    `\n  ${s.ok} ok · ${s.drifted} drifted · ${s.broken} broken · ` +
      `${s.cheaper} cheaper · ${s.pricier} pricier · ${s.faster} faster · ${s.slower} slower`
  );
  console.log(
    `  total cost: ${fmtUsd(s.totalCostA)} (A) -> ${fmtUsd(s.totalCostB)} (B)\n`
  );
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return (n < 0 ? "-$" : "$") + abs.toFixed(digits);
}

function fmtSigned(n: number, digits: number, prefix = "", suffix = ""): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${prefix}${Math.abs(n).toFixed(digits)}${suffix}`;
}

function printSummary(runFile: RunFile): void {
  const byTarget = new Map<
    string,
    { n: number; cost: number; tokens: number; latency: number; broken: number; priced: boolean }
  >();

  for (const r of runFile.results) {
    const agg =
      byTarget.get(r.targetId) ??
      { n: 0, cost: 0, tokens: 0, latency: 0, broken: 0, priced: true };
    agg.n++;
    agg.cost += r.cost;
    agg.tokens += r.tokensIn + r.tokensOut;
    agg.latency += r.latencyMs;
    if (r.status === "BROKEN") agg.broken++;
    if (r.status === "OK" && !r.priced) agg.priced = false;
    byTarget.set(r.targetId, agg);
  }

  const rows = [...byTarget.entries()].map(([target, a]) => ({
    target,
    cases: String(a.n),
    broken: String(a.broken),
    cost: (a.priced ? "$" : "$~") + a.cost.toFixed(4),
    tokens: String(a.tokens),
    avgMs: a.n ? String(Math.round(a.latency / Math.max(1, a.n - a.broken)) || 0) : "0",
  }));

  printTable(
    ["target", "cases", "broken", "cost", "tokens", "avg ms"],
    rows.map((r) => [r.target, r.cases, r.broken, r.cost, r.tokens, r.avgMs])
  );

  const anyUnpriced = rows.some((r) => r.cost.includes("~"));
  if (anyUnpriced) {
    console.log(
      "\n  ~ = no price entry for some model(s); add them under `pricing:` in lockstep.yaml."
    );
  }
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const fmt = (cols: string[]) =>
    "  " + cols.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  console.log(fmt(headers));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(fmt(r));
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------
const CONFIG_TEMPLATE = `# lockstep.yaml — prompt-CI config
# Docs: https://github.com/yourname/lockstep

targets:
  - id: opus-4-8
    provider: anthropic
    model: claude-opus-4-8
    effort: high
  - id: opus-4-7
    provider: anthropic
    model: claude-opus-4-7
    effort: high

cases_dir: ./cases

# $/million tokens. USER-EDITABLE. Treat as untrusted defaults — verify before
# relying on them; provider prices change every release.
pricing:
  claude-opus-4-8: { in: 5, out: 25 }
  claude-opus-4-7: { in: 5, out: 25 }

diff:
  similarity_threshold: 0.9   # below this => flag DRIFTED
`;

const CASES_TEMPLATE = `# cases/example.yaml — one or many cases per file.
# {{input}} is substituted per entry in \`inputs\`.

- id: extract-invoice
  prompt: "Extract vendor, total, and date as JSON from: {{input}}"
  system: "You are a precise extraction engine. Output only JSON."
  inputs:
    - "Invoice from Acme Corp. Total: 1240.00 USD. Date: 2026-05-01."
    - "ACME LLC billed 89.99 USD on 2026-04-18 for hosting."
  assert:
    - { type: json_valid }
    - { type: json_has_keys, keys: [vendor, total, date] }
    - { type: contains, value: "USD" }
  rubric: "Did it extract all three fields correctly without hallucinating?"

- id: summarize-one-line
  prompt: "Summarize this in exactly one sentence: {{input}}"
  inputs:
    - "The mitochondrion is the powerhouse of the cell, generating ATP via oxidative phosphorylation."
  rubric: "Is it one accurate sentence?"
`;

// re-export for typing convenience in tests
export type { CaseResult };

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(`\nError: ${(e as Error).message}`);
  process.exitCode = 1;
});
