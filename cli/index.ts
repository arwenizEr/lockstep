#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, isAbsolute, resolve, basename } from "node:path";
import { Command } from "commander";
import { loadDotenv } from "../core/env.js";
import { loadConfig } from "../core/config.js";

// Load .env (cwd) before anything reads API keys. Real env vars win.
loadDotenv();
import { loadCases } from "../core/cases.js";
import {
  run,
  writeRunFile,
  describeRun,
  planRun,
  type RunFile,
  type CaseResult,
} from "../core/runner.js";
import { loadRunFile, compareRuns, type CompareReport } from "../core/compare.js";
import { renderReport } from "../core/report.js";
import { renderMarkdown } from "../core/report-md.js";
import { renderJUnit } from "../core/junit.js";
import { evaluateGate } from "../core/gate.js";
import { resolvePrompt } from "../core/prompt.js";
import { allModelsConfig } from "../core/models.js";
import { redactRunFile, resolveRedactions } from "../core/redact.js";
import { evaluateBudget, parseBudget } from "../core/budget.js";
import { FileCache } from "../core/cache.js";
import { setBaseline, getBaseline, clearBaseline } from "../core/baseline.js";
import { computeTrend, sparkline } from "../core/trend.js";
import { OpenAIEmbedder, buildSemanticOverrides, type SemanticPair } from "../core/embed.js";
import { judgePairwise } from "../core/judge.js";
import { debounce, watchPaths } from "../core/watch.js";
import { diagnose } from "../core/doctor.js";

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
  .option("--junit <file>", "also write a JUnit XML report (for CI)")
  .option("--max-cost <usd>", "fail (exit 1) if the run's total cost exceeds this budget")
  .option("--cache", "reuse cached responses for unchanged cases (skips the call + cost)", false)
  .option("--redact", "scrub secrets/PII from the saved run + report (built-ins + config patterns)", false)
  .option("--plaintext", "force redaction off even if configured in lockstep.yaml", false)
  .option("--watch", "re-run automatically when cases or lockstep.yaml change", false)
  .option("--dry-run", "show the run matrix and exit without calling providers", false)
  .action(
    async (opts: {
      target: string[];
      concurrency: string;
      judge: boolean;
      judgeModel?: string;
      junit?: string;
      maxCost?: string;
      cache: boolean;
      redact: boolean;
      plaintext: boolean;
      watch: boolean;
      dryRun: boolean;
    }) => {
      if (opts.dryRun) {
        const loaded = loadConfig();
        const cases = loadCases(loaded.casesDir);
        const plan = planRun(loaded.config, cases, opts.target);
        console.log(`Dry run — ${plan.totalCells} cell(s), no providers called:\n`);
        printTable(
          ["target", "model", "cells", "priced"],
          plan.perTarget.map((t) => [t.id, t.model, String(t.cells), t.priced ? "yes" : "NO"])
        );
        if (plan.perTarget.some((t) => !t.priced)) {
          console.log(
            "\n  NO = no price entry; cost will show as ~ until you add it under `pricing:`."
          );
        }
        return;
      }

      // One full run pass. Re-reads config + cases each call so --watch picks up
      // edits. `watching` suppresses the budget exit code (the process lives on).
      const once = async (watching: boolean): Promise<void> => {
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
      if (opts.cache) console.log("Response cache: ON (unchanged cases reuse saved output)\n");

      const runFile = await run(
        loaded,
        cases,
        {
          targetIds: opts.target,
          concurrency,
          judge: opts.judge,
          judgeModel: opts.judgeModel,
          cache: opts.cache ? new FileCache(loaded.baseDir) : undefined,
        },
        {
          onResult: (r) => {
            done++;
            const tag = r.status === "OK" ? (r.cached ? "hit" : "ok ") : "ERR";
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

      // Redaction (opt-in): scrub the stored artifact, never the in-memory run
      // that assertions/judge already saw. Enabled by --redact or any config
      // pattern; --plaintext forces it off.
      const redactEnabled =
        !opts.plaintext && (opts.redact || loaded.config.redact.length > 0);
      const toWrite = redactEnabled
        ? redactRunFile(
            runFile,
            resolveRedactions({ builtins: true, patterns: loaded.config.redact })
          )
        : runFile;
      if (redactEnabled) console.log("Redaction: ON (saved output is scrubbed)\n");

      const path = writeRunFile(loaded.baseDir, toWrite);
      console.log(`\nSaved run -> ${path}\n`);
      if (opts.junit) {
        const junitPath = isAbsolute(opts.junit)
          ? opts.junit
          : resolve(process.cwd(), opts.junit);
        writeFileSync(junitPath, renderJUnit(toWrite), "utf8");
        console.log(`Wrote JUnit XML -> ${junitPath}\n`);
      }
      printSummary(runFile);

      if (opts.maxCost !== undefined) {
        const budget = evaluateBudget(runFile, parseBudget(opts.maxCost));
        if (budget.exceeded) {
          console.error(
            `\n  x budget exceeded (--max-cost ${fmtUsd(budget.limit)}): ` +
              `run cost ${fmtUsd(budget.total)}${budget.unpriced ? " (excludes unpriced models)" : ""}`
          );
          if (!watching) process.exitCode = 1;
        } else {
          console.log(
            `\n  ok within budget: ${fmtUsd(budget.total)} <= ${fmtUsd(budget.limit)}`
          );
        }
      }
      }; // end once()

      if (!opts.watch) {
        await once(false);
        return;
      }

      // Watch mode: initial run, then re-run (debounced) on any change to the
      // cases dir or lockstep.yaml. fs watchers keep the process alive.
      const loaded0 = loadConfig();
      const configPath = resolve(process.cwd(), "lockstep.yaml");
      const safeOnce = async () => {
        try {
          await once(true);
        } catch (e) {
          console.error(`\n  watch: run failed — ${(e as Error).message}`);
        }
        console.log(`\n  watching ${basename(loaded0.casesDir)}/ + lockstep.yaml — Ctrl-C to stop\n`);
      };
      await safeOnce();
      const trigger = debounce(() => {
        console.log("\n  change detected — re-running...\n");
        void safeOnce();
      }, 300);
      watchPaths([loaded0.casesDir, configPath], trigger);
    }
  );

// ---------------------------------------------------------------------------
// ask — one ad-hoc prompt across every target, no cases file
// ---------------------------------------------------------------------------
program
  .command("ask [prompt]")
  .description("Run one prompt against every target and compare — no cases file needed")
  .option("--file <path>", "read the prompt from a file (for long prompts)")
  .option("--system <text>", "optional system prompt")
  .option("-t, --target <id>", "limit to this target id (repeatable)", collect, [] as string[])
  .option("-c, --concurrency <n>", "max concurrent requests", "4")
  .option("--output", "also print each model's full output (default: table only)", false)
  .option("--all", "run against the full built-in model roster (no lockstep.yaml needed)", false)
  .action(
    async (
      prompt: string | undefined,
      opts: {
        file?: string;
        system?: string;
        target: string[];
        concurrency: string;
        output: boolean;
        all: boolean;
      }
    ) => {
      const fileText = opts.file
        ? readFileSync(isAbsolute(opts.file) ? opts.file : resolve(process.cwd(), opts.file), "utf8")
        : undefined;
      // Read piped stdin only when no arg/file and input is not an interactive TTY.
      let stdinText: string | undefined;
      if (!prompt && !fileText && !process.stdin.isTTY) {
        try {
          stdinText = readFileSync(0, "utf8");
        } catch {
          stdinText = undefined;
        }
      }
      const promptText = resolvePrompt({ arg: prompt, file: fileText, stdin: stdinText });

      // --all uses the built-in roster (every current model), so no lockstep.yaml
      // is required; otherwise read targets from the config in the cwd.
      const loaded = opts.all
        ? { config: allModelsConfig(), baseDir: process.cwd(), casesDir: resolve(process.cwd(), "cases") }
        : loadConfig();
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 4);
      const case_ = {
        id: "prompt",
        prompt: promptText,
        inputs: [""],
        system: opts.system,
        assert: [],
      };

      const nTargets =
        opts.target.length > 0
          ? loaded.config.targets.filter((t) => opts.target.includes(t.id)).length
          : loaded.config.targets.length;
      console.log(`Asking ${nTargets} target(s)...\n`);

      const runFile = await run(loaded, [case_], {
        targetIds: opts.target,
        concurrency,
      });
      writeRunFile(loaded.baseDir, runFile);
      printAsk(runFile, opts.output);
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
  .option("--json", "print the comparison as JSON to stdout (for scripting)", false)
  .option("--semantic", "use OpenAI embeddings for similarity instead of bag-of-words (costs tokens)", false)
  .option("--judge-pairwise", "ask an LLM which output (A/B) is better per case (costs tokens)", false)
  .option("--judge-model <model>", "judge model for --judge-pairwise (default claude-haiku-4-5)")
  .option(
    "--fail-on <statuses>",
    "exit non-zero if any pair has these statuses (comma-separated: drifted,broken,pricier,slower,cheaper,faster)"
  )
  .action(
    async (
      runA: string | undefined,
      runB: string | undefined,
      opts: {
        aTarget?: string;
        bTarget?: string;
        json: boolean;
        semantic: boolean;
        judgePairwise: boolean;
        judgeModel?: string;
        failOn?: string;
      }
    ) => {
      const { paths: [pa, pb], baselineTarget } = resolvePair(runA, runB);
      const a = loadRunFile(pa);
      const b = loadRunFile(pb);
      const targets = { aTargetId: opts.aTarget ?? baselineTarget, bTargetId: opts.bTarget };
      let report = compareRuns(a, b, targets);
      const overrides = await maybeSemantic(report, opts.semantic);
      if (overrides) report = compareRuns(a, b, { ...targets, similarityOverrides: overrides });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printCompare(report);
      }
      if (opts.judgePairwise) await runPairwise(report, opts.judgeModel, opts.json);
      applyGate(report, opts.failOn, opts.json);
    }
  );

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
program
  .command("report [runA] [runB]")
  .description("Generate a shareable report from two runs (HTML or Markdown)")
  .option("-o, --out <file>", "output path (default depends on --format)")
  .option("-f, --format <fmt>", "report format: html | md", "html")
  .option("--a-target <id>", "which target in run A to compare")
  .option("--b-target <id>", "which target in run B to compare")
  .option("--semantic", "use OpenAI embeddings for similarity instead of bag-of-words (costs tokens)", false)
  .option(
    "--fail-on <statuses>",
    "exit non-zero if any pair has these statuses (comma-separated: drifted,broken,pricier,slower,cheaper,faster)"
  )
  .action(
    async (
      runA: string | undefined,
      runB: string | undefined,
      opts: {
        out?: string;
        format: string;
        aTarget?: string;
        bTarget?: string;
        semantic: boolean;
        failOn?: string;
      }
    ) => {
      const format = opts.format.toLowerCase();
      if (format !== "html" && format !== "md") {
        throw new Error(`Unknown --format "${opts.format}". Use html or md.`);
      }
      const { paths: [pa, pb], baselineTarget } = resolvePair(runA, runB);
      const a = loadRunFile(pa);
      const b = loadRunFile(pb);
      const targets = { aTargetId: opts.aTarget ?? baselineTarget, bTargetId: opts.bTarget };
      let report = compareRuns(a, b, targets);
      const overrides = await maybeSemantic(report, opts.semantic);
      if (overrides) report = compareRuns(a, b, { ...targets, similarityOverrides: overrides });
      report.generatedAt = new Date().toISOString();
      const out =
        opts.out ?? (format === "md" ? "lockstep-report.md" : "lockstep-report.html");
      const content = format === "md" ? renderMarkdown(report) : renderReport(report);
      const outPath = isAbsolute(out) ? out : resolve(process.cwd(), out);
      writeFileSync(outPath, content, "utf8");
      console.log(`Wrote ${format} report -> ${outPath}`);
      console.log(
        `  ${report.aTargetId} vs ${report.bTargetId} · ${report.summary.total} cases · ` +
          `${report.summary.drifted} drifted · ${report.summary.broken} broken`
      );
      applyGate(report, opts.failOn);
    }
  );

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
program
  .command("list")
  .description("List saved runs in .lockstep/runs (newest first)")
  .action(() => {
    const runs = listRuns();
    if (runs.length === 0) {
      console.log("No runs yet. Run `lockstep run` first.");
      return;
    }
    const rows = runs.map((p) => {
      try {
        const d = describeRun(loadRunFile(p));
        return [
          basename(p),
          d.targets.join(","),
          String(d.total),
          String(d.broken),
          fmtUsd(d.totalCost),
        ];
      } catch {
        return [basename(p), "(unreadable)", "-", "-", "-"];
      }
    });
    printTable(["run", "targets", "results", "broken", "cost"], rows);
  });

// ---------------------------------------------------------------------------
// doctor — check which providers are configured and which targets are runnable
// ---------------------------------------------------------------------------
program
  .command("doctor")
  .description("Check provider credentials and which configured targets are runnable")
  .option("--strict", "exit non-zero if any configured target is not runnable", false)
  .action((opts: { strict: boolean }) => {
    let loaded;
    try {
      loaded = loadConfig();
    } catch (e) {
      console.log(`No usable config: ${(e as Error).message}`);
      console.log("Run `lockstep init` to scaffold one.");
      return;
    }
    const dx = diagnose(loaded.config, process.env);

    console.log("\n  providers:");
    printTable(
      ["provider", "credential", "status"],
      dx.providers.map((p) => [
        p.provider,
        p.keyless ? "(keyless)" : p.keyEnv.join(" / "),
        p.ready ? "ready" : "MISSING",
      ])
    );

    console.log("\n  targets:");
    printTable(
      ["target", "provider", "model", "runnable"],
      dx.targets.map((t) => [
        t.id,
        t.provider,
        t.model,
        t.runnable ? "yes" : `NO — ${t.reason ?? ""}`,
      ])
    );

    if (dx.allRunnable) {
      console.log("\n  ok all targets are runnable.\n");
    } else {
      console.log("\n  x some targets are not runnable (see above).\n");
      if (opts.strict) process.exitCode = 1;
    }
  });

// ---------------------------------------------------------------------------
// baseline — pin a golden run that compare/report diff against by default
// ---------------------------------------------------------------------------
const baseline = program
  .command("baseline")
  .description("Pin a golden run that `compare`/`report` diff against by default");

baseline
  .command("set [run]")
  .description("Pin a run as the baseline (default: the newest saved run)")
  .option("--target <id>", "which target in the baseline run to compare against")
  .action((runArg: string | undefined, opts: { target?: string }) => {
    let runPath: string;
    if (runArg) {
      runPath = absRun(runArg);
      if (!existsSync(runPath)) throw new Error(`Run not found: ${runPath}`);
    } else {
      const runs = listRuns();
      if (runs.length === 0) throw new Error("No runs to pin. Run `lockstep run` first.");
      runPath = runs[0];
    }
    const b = setBaseline(process.cwd(), runPath, opts.target, new Date().toISOString());
    console.log(`Pinned baseline -> ${basename(b.run)}${b.target ? ` (target ${b.target})` : ""}`);
  });

baseline
  .command("show")
  .description("Show the currently pinned baseline")
  .action(() => {
    const b = getBaseline(process.cwd());
    if (!b) {
      console.log("No baseline pinned. Use `lockstep baseline set`.");
      return;
    }
    const missing = !existsSync(b.run) ? "  (file missing!)" : "";
    console.log(
      `Baseline: ${basename(b.run)}${b.target ? ` · target ${b.target}` : ""} · pinned ${b.setAt}${missing}`
    );
  });

baseline
  .command("clear")
  .description("Remove the pinned baseline")
  .action(() => {
    console.log(clearBaseline(process.cwd()) ? "Baseline cleared." : "No baseline was set.");
  });

// ---------------------------------------------------------------------------
// trend — track a suite across many runs (similarity / cost / latency over time)
// ---------------------------------------------------------------------------
program
  .command("trend")
  .description("Show how a target's similarity, cost, and latency move across many runs")
  .option("--target <id>", "which target to track (default: first target in each run)")
  .option("--last <n>", "only the N most recent runs")
  .action((opts: { target?: string; last?: string }) => {
    const paths = listRuns(); // newest first
    if (paths.length < 2) {
      console.log("Need at least two runs to show a trend. Run `lockstep run` again.");
      return;
    }
    const n = opts.last ? Math.max(2, parseInt(opts.last, 10) || paths.length) : paths.length;
    const runs = paths
      .slice(0, n)
      .map((p) => {
        try {
          return loadRunFile(p);
        } catch {
          return null;
        }
      })
      .filter((r): r is RunFile => r !== null);

    const trend = computeTrend(runs, opts.target);
    if (trend.points.length < 2) {
      console.log(`Not enough comparable runs for target "${trend.target}".`);
      return;
    }

    console.log(`\n  trend for ${trend.target} · ${trend.points.length} runs (oldest → newest)\n`);

    const caseRows = trend.cases.map((c) => {
      const last = c.similarities[c.similarities.length - 1];
      const first = c.similarities[0];
      const delta =
        first !== null && last !== null ? `${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%` : "—";
      return [c.key, sparkline(c.similarities, 0, 1), delta];
    });
    printTable(["case", "similarity-to-first", "first → last"], caseRows);

    const costs = trend.points.map((p) => p.totalCost);
    const lats = trend.points.map((p) => p.avgLatencyMs);
    const brokenTotal = trend.points.reduce((n2, p) => n2 + p.broken, 0);
    console.log(
      `\n  cost     ${sparkline(costs)}  ${fmtUsd(costs[0])} → ${fmtUsd(costs[costs.length - 1])}`
    );
    console.log(
      `  latency  ${sparkline(lats)}  ${Math.round(lats[0])}ms → ${Math.round(lats[lats.length - 1])}ms`
    );
    if (brokenTotal > 0) console.log(`  broken cells across runs: ${brokenTotal}`);
    console.log("");
  });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

/**
 * Compute per-cell embedding similarities for a report when --semantic is set.
 * Only OK/OK pairs are embedded. Status messages go to stderr so --json stdout
 * stays machine-readable.
 */
async function maybeSemantic(
  report: CompareReport,
  enabled: boolean
): Promise<Map<string, number> | undefined> {
  if (!enabled) return undefined;
  const pairs: SemanticPair[] = report.pairs
    .filter((p) => p.a?.status === "OK" && p.b?.status === "OK")
    .map((p) => ({ key: `${p.caseId}#${p.inputIndex}`, a: p.a!.output, b: p.b!.output }));
  if (pairs.length === 0) return new Map();
  console.error("Computing semantic similarity via OpenAI embeddings...");
  return buildSemanticOverrides(new OpenAIEmbedder(), pairs);
}

/**
 * Run a pairwise LLM judge over every OK/OK pair that has a rubric and print the
 * A-vs-B winners. Terminal-only (does not alter the JSON/HTML report). Status
 * lines go to stderr so --json stdout stays clean.
 */
async function runPairwise(
  report: CompareReport,
  judgeModel: string | undefined,
  quiet: boolean
): Promise<void> {
  const candidates = report.pairs.filter(
    (p) =>
      p.a?.status === "OK" &&
      p.b?.status === "OK" &&
      (p.a?.rubric || p.b?.rubric)
  );
  if (candidates.length === 0) {
    console.error("\n  (pairwise judge: no OK/OK pairs with a rubric to judge)");
    return;
  }
  console.error(`\n  pairwise judge: scoring ${candidates.length} pair(s)...`);
  const verdicts = await Promise.all(
    candidates.map(async (p) => {
      const rubric = p.a?.rubric ?? p.b?.rubric ?? "";
      try {
        const v = await judgePairwise(
          { rubric, prompt: p.a!.prompt, a: p.a!.output, b: p.b!.output },
          { model: judgeModel }
        );
        return { p, v };
      } catch (e) {
        return { p, v: { winner: "tie" as const, reason: `judge error: ${(e as Error).message}` } };
      }
    })
  );
  let aw = 0;
  let bw = 0;
  let ties = 0;
  for (const { v } of verdicts) {
    if (v.winner === "A") aw++;
    else if (v.winner === "B") bw++;
    else ties++;
  }
  if (quiet) return; // counts still computed; just don't print the table
  const label = (w: string) =>
    w === "A" ? `A (${report.aTargetId})` : w === "B" ? `B (${report.bTargetId})` : "tie";
  printTable(
    ["case", "winner", "reason"],
    verdicts.map(({ p, v }) => [`${p.caseId}#${p.inputIndex}`, label(v.winner), v.reason])
  );
  console.log(
    `\n  pairwise: ${aw} ${report.aTargetId} · ${bw} ${report.bTargetId} · ${ties} tie\n`
  );
}

/**
 * CI gate: if --fail-on matched any status, report it and set a non-zero exit.
 * When `quiet` (e.g. --json mode) the pass line is suppressed and the fail line
 * goes to stderr so stdout stays machine-readable.
 */
function applyGate(report: CompareReport, failOn?: string, quiet = false): void {
  if (!failOn) return;
  const gate = evaluateGate(report, failOn.split(","));
  if (gate.failed) {
    const detail = gate.tripped.map((t) => `${t.count} ${t.status}`).join(", ");
    console.error(`\n  x gate failed (--fail-on ${failOn}): ${detail}`);
    process.exitCode = 1;
  } else if (!quiet) {
    console.log(`\n  ok gate passed (--fail-on ${failOn})`);
  }
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

/**
 * Resolve the A/B run paths (and a default A-target from a pinned baseline).
 * Precedence when both args are given: use them verbatim. When neither is given:
 * if a baseline is pinned, compare newest-vs-baseline; otherwise fall back to the
 * two most recent runs.
 */
function resolvePair(
  runA: string | undefined,
  runB: string | undefined
): { paths: [string, string]; baselineTarget?: string } {
  if (runA && runB) return { paths: [absRun(runA), absRun(runB)] };
  if (runA && !runB) {
    throw new Error("Provide both runA and runB, or neither (to auto-pick recent runs).");
  }
  const runs = listRuns();
  const base = getBaseline(process.cwd());
  if (base && existsSync(base.run)) {
    if (runs.length < 1) {
      throw new Error("A baseline is pinned but there are no runs yet. Run `lockstep run` first.");
    }
    const newest = runs[0];
    // Don't diff the baseline against itself when it is also the newest run.
    const b = absRun(newest) === absRun(base.run) && runs.length > 1 ? runs[1] : newest;
    return { paths: [absRun(base.run), b], baselineTarget: base.target };
  }
  if (runs.length < 2) {
    throw new Error(
      `Need two runs to compare; found ${runs.length} in .lockstep/runs/. ` +
        `Run \`lockstep run\` twice, pin a baseline, or pass explicit paths.`
    );
  }
  // runs[0] is newest. A = older, B = newer.
  return { paths: [runs[1], runs[0]] };
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

function printAsk(runFile: RunFile, showOutput: boolean): void {
  const rows = runFile.results.map((r) => [
    r.targetId,
    r.model,
    `${r.tokensIn}/${r.tokensOut}`,
    (r.priced ? "$" : "$~") + r.cost.toFixed(5),
    `${r.latencyMs}ms`,
    r.status,
  ]);
  printTable(["target", "model", "tok in/out", "cost", "latency", "status"], rows);

  for (const r of runFile.results) {
    if (r.status !== "OK") {
      // Always surface failures so a BROKEN target isn't silent.
      console.log(`\n-- ${r.targetId} BROKEN -- ${r.error ?? ""}`);
    } else if (showOutput) {
      console.log(`\n-- ${r.targetId} (${r.model}) ` + "-".repeat(8));
      console.log(r.output.trim());
    }
  }

  const ok = runFile.results.filter((r) => r.status === "OK");
  if (ok.length > 1) {
    const cheapest = ok.reduce((a, b) => (b.cost < a.cost ? b : a));
    const fastest = ok.reduce((a, b) => (b.latencyMs < a.latencyMs ? b : a));
    console.log(
      `\ncheapest: ${cheapest.targetId} (${fmtUsd(cheapest.cost)}) · ` +
        `fastest: ${fastest.targetId} (${fastest.latencyMs}ms)`
    );
  }
  if (!showOutput) {
    console.log("\noutputs saved — pass --output to print them, or use `lockstep report`.");
  }
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
# Docs: https://github.com/arwenizEr/lockstep

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

# Optional: regex patterns to scrub from saved output + reports (built-in
# patterns for API keys / emails are added automatically when any pattern is set,
# or with \`run --redact\`).
# redact:
#   - "ORDER-\\\\d+"
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
    # richer assertions also available: json_schema, numeric, regex, json_path, ...
    # - { type: json_schema, schema: { type: object, required: [vendor, total] } }
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
