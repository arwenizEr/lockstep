import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, Target } from "./config.js";
import type { Case } from "./cases.js";
import type { Provider, RunResult } from "./providers/types.js";
import { createProvider } from "./providers/registry.js";
import { costForModel } from "./cost.js";
import { judgeOutput, type JudgeVerdict } from "./judge.js";
import { runAssertions, type AssertionResult } from "./diff.js";

export interface CaseResult {
  caseId: string;
  inputIndex: number;
  targetId: string;
  model: string;
  provider: string;
  effort?: string;
  mode?: string;
  /** Resolved prompt sent to the model ({{input}} substituted). */
  prompt: string;
  system?: string;
  status: "OK" | "BROKEN";
  output: string;
  error?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  priced: boolean;
  latencyMs: number;
  rubric?: string;
  assertions?: AssertionResult[];
  /** Set to false if any assertion failed. */
  assertionsPass?: boolean;
  /** Tier-2 judge verdict, present only when --judge was used. */
  judge?: JudgeVerdict;
}

export interface RunFile {
  schema: 1;
  startedAt: string;
  finishedAt: string;
  config: Config;
  targets: Target[];
  results: CaseResult[];
}

export interface RunOptions {
  targetIds?: string[];
  concurrency?: number;
  maxRetries?: number;
  /** Enable Tier-2 LLM-as-judge for cases that define a rubric. Costs tokens. */
  judge?: boolean;
  /** Override judge model (default claude-haiku-4-5). */
  judgeModel?: string;
}

function makeProvider(target: Target): Provider {
  try {
    return createProvider(target.provider);
  } catch (e) {
    throw new Error(`${(e as Error).message} (target ${target.id})`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number
): Promise<T> {
  let attempt = 0;
  // Exponential backoff. Don't retry 4xx (client errors) except 429.
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      const retryable =
        status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= maxRetries) throw e;
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      attempt++;
      await sleep(backoff);
    }
  }
}

/** Minimal concurrency limiter — no external dep. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

interface Job {
  target: Target;
  provider: Provider;
  case_: Case;
  inputIndex: number;
  input: string;
}

export interface RunHooks {
  onResult?: (r: CaseResult) => void;
}

export async function run(
  loaded: { config: Config; casesDir: string },
  cases: Case[],
  opts: RunOptions = {},
  hooks: RunHooks = {}
): Promise<RunFile> {
  const { config } = loaded;
  const concurrency = opts.concurrency ?? 4;
  const maxRetries = opts.maxRetries ?? 3;

  let targets = config.targets;
  if (opts.targetIds && opts.targetIds.length > 0) {
    const set = new Set(opts.targetIds);
    targets = targets.filter((t) => set.has(t.id));
    const missing = opts.targetIds.filter(
      (id) => !config.targets.some((t) => t.id === id)
    );
    if (missing.length > 0) {
      throw new Error(`Unknown target id(s): ${missing.join(", ")}`);
    }
  }
  if (targets.length === 0) throw new Error("No targets selected.");

  // Instantiate providers once per target (fail fast on missing keys).
  const providerByTarget = new Map<string, Provider>();
  for (const t of targets) providerByTarget.set(t.id, makeProvider(t));

  // Build the full job matrix: case x input x target.
  const jobs: Job[] = [];
  for (const case_ of cases) {
    case_.inputs.forEach((input, inputIndex) => {
      for (const target of targets) {
        jobs.push({
          target,
          provider: providerByTarget.get(target.id)!,
          case_,
          inputIndex,
          input,
        });
      }
    });
  }

  const startedAt = new Date().toISOString();

  const results = await mapLimit(jobs, concurrency, async (job) => {
    const prompt = job.case_.prompt.replace(/\{\{\s*input\s*\}\}/g, job.input);
    const base: Omit<CaseResult, "status" | "output" | "tokensIn" | "tokensOut" | "cost" | "priced" | "latencyMs"> = {
      caseId: job.case_.id,
      inputIndex: job.inputIndex,
      targetId: job.target.id,
      model: job.target.model,
      provider: job.target.provider,
      effort: job.target.effort,
      mode: job.target.mode,
      prompt,
      system: job.case_.system,
      rubric: job.case_.rubric,
    };

    let result: CaseResult;
    try {
      const r: RunResult = await withRetry(
        () =>
          job.provider.run({
            model: job.target.model,
            system: job.case_.system,
            messages: [{ role: "user", content: prompt }],
            effort: job.target.effort,
            mode: job.target.mode,
            temperature: job.target.temperature,
            topP: job.target.top_p,
            topK: job.target.top_k,
          }),
        maxRetries
      );
      const { cost, priced } = costForModel(
        config,
        job.target.model,
        r.tokensIn,
        r.tokensOut
      );
      const assertions = runAssertions(job.case_.assert, r.text);
      const assertionsPass = assertions.every((a) => a.pass);
      result = {
        ...base,
        status: "OK",
        output: r.text,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        cost,
        priced,
        latencyMs: r.latencyMs,
        assertions,
        assertionsPass,
      };

      // Tier-2 judge (opt-in). Only for cases that define a rubric.
      if (opts.judge && job.case_.rubric) {
        try {
          result.judge = await judgeOutput(
            { rubric: job.case_.rubric, prompt: prompt, output: r.text },
            { model: opts.judgeModel }
          );
        } catch (e) {
          result.judge = { score: 0, reason: `judge error: ${(e as Error).message}` };
        }
      }
    } catch (e) {
      result = {
        ...base,
        status: "BROKEN",
        output: "",
        error: (e as Error).message,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        priced: false,
        latencyMs: 0,
      };
    }
    hooks.onResult?.(result);
    return result;
  });

  const finishedAt = new Date().toISOString();

  return {
    schema: 1,
    startedAt,
    finishedAt,
    config,
    targets,
    results,
  };
}

export function writeRunFile(baseDir: string, runFile: RunFile): string {
  const dir = join(baseDir, ".lockstep", "runs");
  mkdirSync(dir, { recursive: true });
  // Filename-safe ISO timestamp.
  const stamp = runFile.startedAt.replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}.json`);
  writeFileSync(path, JSON.stringify(runFile, null, 2), "utf8");
  return path;
}
