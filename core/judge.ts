import { AnthropicProvider } from "./providers/anthropic.js";
import type { Provider } from "./providers/types.js";

export interface JudgeVerdict {
  score: number; // 0..1
  reason: string;
}

export interface JudgeInput {
  rubric: string;
  prompt: string;
  output: string;
}

const JUDGE_SYSTEM =
  "You are a strict evaluation judge. You are given a task prompt, a model's " +
  "output, and a rubric. Score how well the output satisfies the rubric from " +
  "0.0 (total failure) to 1.0 (perfect). Respond with ONLY a JSON object: " +
  '{"score": <number 0..1>, "reason": "<one short sentence>"}. No prose, no fences.';

function buildJudgePrompt(input: JudgeInput): string {
  return [
    `RUBRIC:\n${input.rubric}`,
    `\nTASK PROMPT:\n${input.prompt}`,
    `\nMODEL OUTPUT:\n${input.output}`,
    `\nScore the output against the rubric.`,
  ].join("\n");
}

function parseVerdict(text: string): JudgeVerdict {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonStr = objMatch ? objMatch[0] : candidate;
  try {
    const parsed = JSON.parse(jsonStr) as { score?: unknown; reason?: unknown };
    let score = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(0, Math.min(1, score));
    const reason = typeof parsed.reason === "string" ? parsed.reason : "no reason given";
    return { score, reason };
  } catch {
    return { score: 0, reason: `judge returned unparseable output: ${text.slice(0, 120)}` };
  }
}

export interface JudgeOptions {
  model?: string;
  provider?: Provider;
}

// ---------------------------------------------------------------------------
// Pairwise judge: instead of scoring each output alone (which is noisy at the
// margin), ask the judge to PICK the better of A vs B for the rubric. A direct
// preference is a stronger eval signal than two independent absolute scores.
// ---------------------------------------------------------------------------

export type PairwiseWinner = "A" | "B" | "tie";

export interface PairwiseVerdict {
  winner: PairwiseWinner;
  reason: string;
}

export interface PairwiseInput {
  rubric: string;
  prompt: string;
  a: string;
  b: string;
}

const PAIRWISE_SYSTEM =
  "You are a strict evaluation judge. Given a task prompt, a rubric, and two " +
  "candidate outputs A and B, decide which better satisfies the rubric. Judge " +
  "only on the rubric; ignore length and style unless the rubric asks. Respond " +
  'with ONLY a JSON object: {"winner": "A" | "B" | "tie", "reason": "<one short ' +
  'sentence>"}. No prose, no fences.';

function buildPairwisePrompt(input: PairwiseInput): string {
  return [
    `RUBRIC:\n${input.rubric}`,
    `\nTASK PROMPT:\n${input.prompt}`,
    `\nOUTPUT A:\n${input.a}`,
    `\nOUTPUT B:\n${input.b}`,
    `\nWhich output better satisfies the rubric?`,
  ].join("\n");
}

function parsePairwise(text: string): PairwiseVerdict {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonStr = objMatch ? objMatch[0] : candidate;
  try {
    const parsed = JSON.parse(jsonStr) as { winner?: unknown; reason?: unknown };
    const raw = String(parsed.winner ?? "").trim().toUpperCase();
    const winner: PairwiseWinner = raw === "A" ? "A" : raw === "B" ? "B" : "tie";
    const reason = typeof parsed.reason === "string" ? parsed.reason : "no reason given";
    return { winner, reason };
  } catch {
    return { winner: "tie", reason: `judge returned unparseable output: ${text.slice(0, 120)}` };
  }
}

/** Tier-2 pairwise judge (opt-in). Picks the better of two outputs for a rubric. */
export async function judgePairwise(
  input: PairwiseInput,
  opts: JudgeOptions = {}
): Promise<PairwiseVerdict> {
  const provider = opts.provider ?? new AnthropicProvider();
  const model = opts.model ?? "claude-haiku-4-5";
  const r = await provider.run({
    model,
    system: PAIRWISE_SYSTEM,
    messages: [{ role: "user", content: buildPairwisePrompt(input) }],
  });
  return parsePairwise(r.text);
}

/**
 * Tier-2 LLM-as-judge (opt-in). Costs tokens. Scores one output against its
 * rubric. Default judge model is a small Anthropic model to keep cost low.
 */
export async function judgeOutput(
  input: JudgeInput,
  opts: JudgeOptions = {}
): Promise<JudgeVerdict> {
  const provider = opts.provider ?? new AnthropicProvider();
  const model = opts.model ?? "claude-haiku-4-5";
  const r = await provider.run({
    model,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: buildJudgePrompt(input) }],
  });
  return parseVerdict(r.text);
}

// Exposed for unit testing the parsers without a network call.
export const __test = { parseVerdict, buildJudgePrompt, parsePairwise, buildPairwisePrompt };
