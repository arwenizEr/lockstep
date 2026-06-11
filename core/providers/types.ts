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
  /**
   * Prompt-cache reads, billed at cacheReadRate x input price. NOT included in
   * tokensIn — adapters whose API reports cache tokens inside the prompt total
   * (OpenAI) must subtract them so the two fields never double-count.
   */
  tokensCacheRead?: number;
  /** Anthropic prompt-cache writes (billed ~1.25x input price). Not included in tokensIn. */
  tokensCacheWrite?: number;
  /** Cache-read price as a fraction of the input price. Anthropic ~0.1, OpenAI 0.5. Defaults to 0.1. */
  cacheReadRate?: number;
  raw: unknown;
}

export interface Provider {
  id: string;
  run(req: RunRequest): Promise<RunResult>;
}
