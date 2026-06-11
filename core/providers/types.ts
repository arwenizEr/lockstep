export type Role = "user" | "assistant";

export interface Msg {
  role: Role;
  content: string;
}

export interface RunRequest {
  model: string;
  system?: string;
  messages: Msg[];
  /** Model-specific reasoning tier (e.g. medium/high/xhigh). Stored per target, not portable. */
  effort?: string;
  /** Provider-specific mode (e.g. "responses" routes OpenAI via the Responses API). */
  mode?: string;
  /** Output-token ceiling. Overrides the adapter's per-model default when set. */
  maxTokens?: number;
  /**
   * Optional sampling params. Provider/model-aware: adapters MUST drop these for
   * models that reject them (e.g. claude-opus-4-8 returns 400 on temperature/top_p/top_k).
   */
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface RunResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Provider's stop/finish reason, normalized to the provider's own vocabulary. */
  stopReason?: string;
  /** True when output was cut off by the token ceiling (stop_reason max_tokens / finish_reason length). */
  truncated?: boolean;
  /** Anthropic prompt-cache reads (billed ~0.1x input price). Not included in tokensIn. */
  tokensCacheRead?: number;
  /** Anthropic prompt-cache writes (billed ~1.25x input price). Not included in tokensIn. */
  tokensCacheWrite?: number;
  raw: unknown;
}

export interface Provider {
  id: string;
  run(req: RunRequest): Promise<RunResult>;
}
