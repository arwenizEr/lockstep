import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCases } from "../core/cases.js";

const dir = mkdtempSync(join(tmpdir(), "lockstep-cases-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const valid = `- id: c1
  prompt: "hello {{input}}"
  inputs: ["a", "b"]
`;

describe("loadCases", () => {
  it("loads a valid case file", () => {
    const d = mkdtempSync(join(tmpdir(), "lockstep-cases-ok-"));
    writeFileSync(join(d, "suite.yaml"), valid, "utf8");
    const cases = loadCases(d);
    expect(cases).toHaveLength(1);
    expect(cases[0].inputs).toEqual(["a", "b"]);
    rmSync(d, { recursive: true, force: true });
  });

  it("names the offending file on malformed YAML", () => {
    const d = mkdtempSync(join(tmpdir(), "lockstep-cases-bad-"));
    writeFileSync(join(d, "broken.yaml"), "foo: [unterminated", "utf8");
    expect(() => loadCases(d)).toThrow(/broken\.yaml/);
    rmSync(d, { recursive: true, force: true });
  });

  it("skips a blank case file instead of throwing", () => {
    const d = mkdtempSync(join(tmpdir(), "lockstep-cases-blank-"));
    writeFileSync(join(d, "empty.yaml"), "\n# just a comment\n", "utf8");
    writeFileSync(join(d, "real.yaml"), valid, "utf8");
    const cases = loadCases(d);
    expect(cases.map((c) => c.id)).toEqual(["c1"]);
    rmSync(d, { recursive: true, force: true });
  });

  it("throws when the directory has no usable cases", () => {
    const d = mkdtempSync(join(tmpdir(), "lockstep-cases-none-"));
    writeFileSync(join(d, "blank.yaml"), "\n", "utf8");
    expect(() => loadCases(d)).toThrow(/No cases found/);
    rmSync(d, { recursive: true, force: true });
  });

  it("throws on a missing directory", () => {
    expect(() => loadCases(join(dir, "nope"))).toThrow(/cases_dir not found/);
  });
});
