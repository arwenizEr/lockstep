import { describe, it, expect } from "vitest";
import { __test, judgePairwise } from "../core/judge.js";
import type { Provider } from "../core/providers/types.js";

const { parseVerdict, parsePairwise } = __test;

describe("judge parseVerdict", () => {
  it("parses clean JSON", () => {
    const v = parseVerdict('{"score":0.8,"reason":"good"}');
    expect(v.score).toBe(0.8);
    expect(v.reason).toBe("good");
  });

  it("parses fenced JSON", () => {
    const v = parseVerdict('```json\n{"score":1,"reason":"perfect"}\n```');
    expect(v.score).toBe(1);
  });

  it("extracts JSON object from surrounding prose", () => {
    const v = parseVerdict('Sure: {"score":0.5,"reason":"meh"} done');
    expect(v.score).toBe(0.5);
    expect(v.reason).toBe("meh");
  });

  it("clamps score above 1", () => {
    expect(parseVerdict('{"score":5,"reason":"x"}').score).toBe(1);
  });

  it("clamps score below 0", () => {
    expect(parseVerdict('{"score":-3,"reason":"x"}').score).toBe(0);
  });

  it("coerces string score", () => {
    expect(parseVerdict('{"score":"0.7","reason":"x"}').score).toBeCloseTo(0.7, 9);
  });

  it("returns score 0 on unparseable output", () => {
    const v = parseVerdict("the model rambled with no json");
    expect(v.score).toBe(0);
    expect(v.reason).toContain("unparseable");
  });

  it("handles missing reason", () => {
    const v = parseVerdict('{"score":0.9}');
    expect(v.score).toBe(0.9);
    expect(v.reason).toBe("no reason given");
  });
});

describe("judge parsePairwise", () => {
  it("parses a clean A/B/tie winner", () => {
    expect(parsePairwise('{"winner":"A","reason":"clearer"}')).toEqual({ winner: "A", reason: "clearer" });
    expect(parsePairwise('{"winner":"b","reason":"x"}').winner).toBe("B");
    expect(parsePairwise('{"winner":"tie","reason":"same"}').winner).toBe("tie");
  });

  it("defaults unknown winners to tie", () => {
    expect(parsePairwise('{"winner":"neither","reason":"?"}').winner).toBe("tie");
  });

  it("falls back to tie on unparseable output", () => {
    const v = parsePairwise("no json here");
    expect(v.winner).toBe("tie");
    expect(v.reason).toContain("unparseable");
  });
});

describe("judgePairwise with an injected provider", () => {
  it("sends both outputs and returns the parsed winner", async () => {
    let seen = "";
    const provider: Provider = {
      id: "fake",
      run: async (req) => {
        seen = req.messages[0].content;
        return { text: '{"winner":"B","reason":"more complete"}', tokensIn: 1, tokensOut: 1, latencyMs: 1, raw: {} };
      },
    };
    const v = await judgePairwise(
      { rubric: "correctness", prompt: "p", a: "alpha-out", b: "beta-out" },
      { provider }
    );
    expect(v.winner).toBe("B");
    expect(seen).toContain("alpha-out");
    expect(seen).toContain("beta-out");
  });
});
