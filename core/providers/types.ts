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
  /** Provider-specific mode (e.g. "fast"). */
  mode?: string;
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
  raw: unknown;
}

export interface Provider {
  id: string;
  run(req: RunRequest): Promise<RunResult>;
}
