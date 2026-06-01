import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, Target } from "./config.js";
import type { Case } from "./cases.js";
import type { Provider, RunResult, Msg } from "./providers/types.js";
import { createProvider } from "./providers/registry.js";
import { costForModel } from "./cost.js";
import { judgeOutput, type JudgeVerdict } from "./judge.js";
import { runAssertions, type AssertionResult } from "./diff.js";
import { cacheKey, type ProviderCache } from "./cache.js";

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
  /** True when this result was served from the response cache, not a live call. */
  cached?: boolean;
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
  /** Optional response cache. A hit skips the provider call (and its cost). */
  cache?: ProviderCache;
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

const substitute = (s: string, input: string): string =>
  s.replace(/\{\{\s*input\s*\}\}/g, input);

/**
 * Resolve a case + input into the message array sent to the provider and a
 * single display prompt (stored on the result, shown in the report). Single-turn
 * cases become one user turn; multi-turn cases pass their scripted conversation
 * through, with `{{input}}` substituted in every turn.
 */
export function buildTurns(
  case_: Case,
  input: string
): { messages: Msg[]; displayPrompt: string } {
  if (case_.messages) {
    const messages: Msg[] = case_.messages.map((m) => ({
      role: m.role,
      content: substitute(m.content, input),
    }));
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const displayPrompt =
      lastUser?.content ?? messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    return { messages, displayPrompt };
  }
  const content = substitute(case_.prompt ?? "", input);
  return { messages: [{ role: "user", content }], displayPrompt: content };
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
    const { messages, displayPrompt } = buildTurns(job.case_, job.input);
    const base: Omit<CaseResult, "status" | "output" | "tokensIn" | "tokensOut" | "cost" | "priced" | "latencyMs"> = {
      caseId: job.case_.id,
      inputIndex: job.inputIndex,
      targetId: job.target.id,
      model: job.target.model,
      provider: job.target.provider,
      effort: job.target.effort,
      mode: job.target.mode,
      prompt: displayPrompt,
      system: job.case_.system,
      rubric: job.case_.rubric,
    };

    const req = {
      model: job.target.model,
      system: job.case_.system,
      messages,
      effort: job.target.effort,
      mode: job.target.mode,
      temperature: job.target.temperature,
      topP: job.target.top_p,
      topK: job.target.top_k,
    };

    let result: CaseResult;
    try {
      const key = opts.cache ? cacheKey(job.target.provider, req) : null;
      const hit = key ? opts.cache!.get(key) : undefined;
      let cached = false;
      let r: RunResult;
      if (hit) {
        cached = true;
        r = { ...hit, raw: { cached: true } };
      } else {
        r = await withRetry(() => job.provider.run(req), maxRetries);
        if (key)
          opts.cache!.set(key, {
            text: r.text,
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            latencyMs: r.latencyMs,
          });
      }
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
        cached,
        assertions,
        assertionsPass,
      };

      // Tier-2 judge (opt-in). Only for cases that define a rubric.
      if (opts.judge && job.case_.rubric) {
        try {
          result.judge = await judgeOutput(
            { rubric: job.case_.rubric, prompt: displayPrompt, output: r.text },
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

export interface RunSummary {
  targets: string[];
  total: number;
  broken: number;
  totalCost: number;
}

/** One-line summary of a run, for `lockstep list`. */
export function describeRun(run: RunFile): RunSummary {
  return {
    targets: run.targets.map((t) => t.id),
    total: run.results.length,
    broken: run.results.filter((r) => r.status === "BROKEN").length,
    totalCost: run.results.reduce((n, r) => n + r.cost, 0),
  };
}

export interface RunPlan {
  perTarget: { id: string; model: string; cells: number; priced: boolean }[];
  totalCells: number;
}

/**
 * Compute what a run *would* do without calling any provider — the case×input×
 * target matrix and which target models have no price entry. Powers --dry-run.
 */
export function planRun(
  config: Config,
  cases: Case[],
  targetIds?: string[]
): RunPlan {
  let targets = config.targets;
  if (targetIds && targetIds.length > 0) {
    const set = new Set(targetIds);
    targets = targets.filter((t) => set.has(t.id));
  }
  const inputsTotal = cases.reduce((n, c) => n + c.inputs.length, 0);
  const perTarget = targets.map((t) => ({
    id: t.id,
    model: t.model,
    cells: inputsTotal,
    priced: config.pricing[t.model] !== undefined,
  }));
  return { perTarget, totalCells: inputsTotal * targets.length };
}
