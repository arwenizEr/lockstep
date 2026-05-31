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

// Exposed for unit testing the parser without a network call.
export const __test = { parseVerdict, buildJudgePrompt };
