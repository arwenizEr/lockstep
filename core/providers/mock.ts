import type { Provider, RunRequest, RunResult } from "./types.js";

/**
 * Deterministic, offline, keyless provider. No network, no API key. Same output
 * for the same input every time, so it's safe in tests, in CI, and as a
 * zero-cost way to try the CLI end-to-end (`provider: mock` in lockstep.yaml).
 *
 * Default behavior echoes the last user message, which keeps `compare` stable
 * (a run against itself is all-OK). Override `reply` to script other outputs.
 */
export interface MockOptions {
  /** Custom response generator. Defaults to echoing the last user message. */
  reply?: (req: RunRequest) => string;
}

const countTokens = (s: string): number =>
  s.trim() === "" ? 0 : s.trim().split(/\s+/).length;

/** Stable pseudo-latency derived from the text so runs are reproducible. */
const fauxLatency = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 10 + (h % 90); // 10..99 ms
};

export class MockProvider implements Provider {
  id = "mock";
  private reply: (req: RunRequest) => string;

  constructor(opts: MockOptions = {}) {
    this.reply =
      opts.reply ??
      ((req) => {
        const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
        return lastUser?.content ?? "";
      });
  }

  async run(req: RunRequest): Promise<RunResult> {
    const text = this.reply(req);
    const promptText =
      (req.system ?? "") + " " + req.messages.map((m) => m.content).join(" ");
    return {
      text,
      tokensIn: countTokens(promptText),
      tokensOut: countTokens(text),
      latencyMs: fauxLatency(text),
      raw: { provider: "mock", model: req.model, effort: req.effort },
    };
  }
}
