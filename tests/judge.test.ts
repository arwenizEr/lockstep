import { describe, it, expect } from "vitest";
import { __test } from "../core/judge.js";

const { parseVerdict } = __test;

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
