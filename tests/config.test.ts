import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../core/config.js";

const dir = mkdtempSync(join(tmpdir(), "lockstep-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
};

const VALID = `targets:
  - id: m
    provider: mock
    model: mock-1
cases_dir: ./suite
`;

describe("loadConfig", () => {
  it("parses a valid config and resolves casesDir against the config dir", () => {
    const p = write("ok.yaml", VALID);
    const loaded = loadConfig(p);
    expect(loaded.config.targets[0].id).toBe("m");
    expect(loaded.baseDir).toBe(dir);
    expect(loaded.casesDir).toBe(resolve(dir, "suite"));
  });

  it("applies defaults for cases_dir, pricing, and diff", () => {
    const p = write("defaults.yaml", `targets:\n  - id: m\n    provider: mock\n    model: mock-1\n`);
    const loaded = loadConfig(p);
    expect(loaded.config.cases_dir).toBe("./cases");
    expect(loaded.config.pricing).toEqual({});
    expect(loaded.config.diff.similarity_threshold).toBe(0.9);
  });

  it("parses a case `defaults:` block (system/rubric/assert)", () => {
    const p = write(
      "with-defaults.yaml",
      `targets:\n  - { id: m, provider: mock, model: mock-1 }\ndefaults:\n  system: "Output only JSON."\n  assert:\n    - { type: json_valid }\n`
    );
    const loaded = loadConfig(p);
    expect(loaded.config.defaults?.system).toBe("Output only JSON.");
    expect(loaded.config.defaults?.assert).toEqual([{ type: "json_valid" }]);
  });

  it("rejects an invalid default assertion", () => {
    const p = write(
      "bad-defaults.yaml",
      `targets:\n  - { id: m, provider: mock, model: mock-1 }\ndefaults:\n  assert:\n    - { type: not_a_real_assertion }\n`
    );
    expect(() => loadConfig(p)).toThrow(/Invalid lockstep\.yaml/);
  });

  it("throws a helpful error when the file is missing", () => {
    expect(() => loadConfig(join(dir, "nope.yaml"))).toThrow(/Config not found/);
  });

  it("throws on malformed YAML", () => {
    const p = write("bad.yaml", "targets: [unterminated");
    expect(() => loadConfig(p)).toThrow(/Failed to parse/);
  });

  it("rejects an unknown provider via the registry refinement", () => {
    const p = write("badprov.yaml", `targets:\n  - id: m\n    provider: google\n    model: g\n`);
    expect(() => loadConfig(p)).toThrow(/Invalid lockstep\.yaml/);
  });

  it("rejects an empty targets list", () => {
    const p = write("empty.yaml", `targets: []\n`);
    expect(() => loadConfig(p)).toThrow(/Invalid lockstep\.yaml/);
  });

  it("rejects an out-of-range similarity_threshold", () => {
    const p = write("badthresh.yaml", `targets:\n  - id: m\n    provider: mock\n    model: mock-1\ndiff:\n  similarity_threshold: 2\n`);
    expect(() => loadConfig(p)).toThrow(/Invalid lockstep\.yaml/);
  });
});
