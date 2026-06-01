import { describe, it, expect } from "vitest";
import { cosine, buildSemanticOverrides, OpenAIEmbedder, type Embedder } from "../core/embed.js";
import { compareCell } from "../core/diff.js";

describe("cosine", () => {
  it("is 1 for identical vectors, 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("clamps and handles mismatched lengths", () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });
});

// Deterministic fake: maps known texts to fixed vectors.
const fake: Embedder = {
  embed: async (texts) =>
    texts.map((t) => {
      if (t === "cat") return [1, 0, 0];
      if (t === "kitten") return [0.9, 0.1, 0];
      if (t === "airplane") return [0, 0, 1];
      return [0, 1, 0];
    }),
};

describe("buildSemanticOverrides", () => {
  it("computes a similarity per pair, deduping texts into one batch", async () => {
    const overrides = await buildSemanticOverrides(fake, [
      { key: "c#0", a: "cat", b: "kitten" },
      { key: "c#1", a: "cat", b: "airplane" },
    ]);
    expect(overrides.get("c#0")!).toBeGreaterThan(0.9); // near-synonyms
    expect(overrides.get("c#1")!).toBe(0); // unrelated
  });

  it("returns an empty map for no pairs", async () => {
    expect((await buildSemanticOverrides(fake, [])).size).toBe(0);
  });
});

describe("compareCell with a similarity override", () => {
  it("uses the override instead of bag-of-words cosine", () => {
    const cell = compareCell(
      {
        caseId: "c",
        inputIndex: 0,
        aOutput: '{"a":1,"b":2}',
        bOutput: '{"b":2,"a":1}', // bag-of-words would call this drift-ish
        aBroken: false,
        bBroken: false,
        aCost: 0,
        bCost: 0,
        aLatency: 0,
        bLatency: 0,
        similarityOverride: 0.99,
      },
      0.9
    );
    expect(cell.similarity).toBe(0.99);
    expect(cell.drifted).toBe(false);
  });
});

describe("OpenAIEmbedder (injected fetch)", () => {
  it("posts to /embeddings and returns vectors", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
      } as Response;
    }) as unknown as typeof fetch;
    const e = new OpenAIEmbedder("test-key", { fetchImpl });
    const vecs = await e.embed(["one", ""]);
    expect(vecs).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(captured.input).toEqual(["one", " "]); // empty string substituted
  });

  it("throws a status-tagged error on a non-ok response", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 401, text: async () => "no key" }) as Response) as unknown as typeof fetch;
    const e = new OpenAIEmbedder("k", { fetchImpl });
    await expect(e.embed(["x"])).rejects.toThrow(/401/);
  });
});
