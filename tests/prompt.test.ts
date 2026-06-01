import { describe, it, expect } from "vitest";
import { resolvePrompt } from "../core/prompt.js";

describe("resolvePrompt", () => {
  it("prefers the positional argument", () => {
    expect(resolvePrompt({ arg: "from arg", file: "from file", stdin: "from stdin" })).toBe("from arg");
  });

  it("falls back to file, then stdin", () => {
    expect(resolvePrompt({ file: "from file", stdin: "from stdin" })).toBe("from file");
    expect(resolvePrompt({ stdin: "from stdin" })).toBe("from stdin");
  });

  it("trims surrounding whitespace", () => {
    expect(resolvePrompt({ arg: "  hello  \n" })).toBe("hello");
  });

  it("throws when every source is empty or blank", () => {
    expect(() => resolvePrompt({})).toThrow(/No prompt provided/);
    expect(() => resolvePrompt({ arg: "   ", stdin: "\n" })).toThrow(/No prompt provided/);
  });
});
