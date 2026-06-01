// ---------------------------------------------------------------------------
// Embedding-based (semantic) similarity — an OPT-IN upgrade over the default
// bag-of-words cosine. Bag-of-words flags "{a:1,b:2}" vs "{b:2,a:1}" as drift;
// embeddings see them as near-identical. Costs tokens, so it is never on the
// default `compare` path. The Embedder is injectable so the wiring is tested
// offline with a deterministic fake.
// ---------------------------------------------------------------------------

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** Cosine similarity of two equal-length vectors, clamped to [0,1]. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

export interface SemanticPair {
  key: string; // caseId#inputIndex
  a: string;
  b: string;
}

/**
 * Compute a semantic similarity per pair. Embeds every unique text in ONE batch
 * call, then cosines each pair. Returns a map keyed by pair key, ready to feed
 * `compareRuns({ similarityOverrides })`.
 */
export async function buildSemanticOverrides(
  embedder: Embedder,
  pairs: SemanticPair[]
): Promise<Map<string, number>> {
  const overrides = new Map<string, number>();
  const unique = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
  if (unique.length === 0) return overrides;
  const vectors = await embedder.embed(unique);
  const byText = new Map<string, number[]>();
  unique.forEach((t, i) => byText.set(t, vectors[i]));
  for (const p of pairs) {
    const va = byText.get(p.a);
    const vb = byText.get(p.b);
    if (va && vb) overrides.set(p.key, cosine(va, vb));
  }
  return overrides;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "text-embedding-3-small";

export interface OpenAIEmbedderOptions {
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** OpenAI embeddings adapter (fetch-based, injectable for tests). */
export class OpenAIEmbedder implements Embedder {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(apiKey = process.env.OPENAI_API_KEY, opts: OpenAIEmbedderOptions = {}) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Semantic similarity (--semantic) uses OpenAI embeddings."
      );
    }
    this.apiKey = apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        // OpenAI rejects empty strings — substitute a single space.
        body: JSON.stringify({ model: this.model, input: texts.map((t) => t || " ") }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const errText = await resp.text();
      const err = new Error(`OpenAI embeddings ${resp.status}: ${errText.slice(0, 300)}`) as Error & {
        status?: number;
      };
      err.status = resp.status;
      throw err;
    }
    const json = (await resp.json()) as { data?: { embedding: number[] }[] };
    const data = json.data ?? [];
    return data.map((d) => d.embedding);
  }
}
