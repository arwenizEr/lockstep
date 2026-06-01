import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// End-to-end smoke test of the actual CLI binary against the keyless mock
// provider. Builds dist first so it tests the shipped artifact, not the source.
const repoRoot = process.cwd();
const cli = resolve(repoRoot, "dist", "cli", "index.js");

let dir: string;

function lockstep(args: string[]) {
  return spawnSync("node", [cli, ...args], { cwd: dir, encoding: "utf8" });
}

beforeAll(() => {
  execSync("npm run build", { cwd: repoRoot, stdio: "ignore" });
  dir = mkdtempSync(join(tmpdir(), "lockstep-cli-"));
  mkdirSync(join(dir, "cases"), { recursive: true });
  writeFileSync(
    join(dir, "lockstep.yaml"),
    [
      "targets:",
      "  - { id: m1, provider: mock, model: mock-a }",
      "  - { id: m2, provider: mock, model: mock-b }",
      "cases_dir: ./cases",
      "pricing: { mock-a: { in: 1, out: 2 } }",
      "diff: { similarity_threshold: 0.9 }",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(dir, "cases", "suite.yaml"),
    [
      "- id: greet",
      '  prompt: "hi {{input}}"',
      '  inputs: ["a"]',
      "  assert: [ { type: contains, value: hi } ]",
      "",
    ].join("\n")
  );
}, 60_000);

describe("CLI (built binary, mock provider)", () => {
  it("dry-run exits 0 and calls no provider", () => {
    const r = lockstep(["run", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Dry run");
    expect(existsSync(join(dir, ".lockstep"))).toBe(false);
  });

  it("run records a run file and writes JUnit when asked", () => {
    const r = lockstep(["run", "--junit", "results.xml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Saved run");
    expect(existsSync(join(dir, "results.xml"))).toBe(true);
    expect(readFileSync(join(dir, "results.xml"), "utf8")).toContain("<testcase");
  });

  it("a second run enables compare to auto-pick two runs", () => {
    expect(lockstep(["run"]).status).toBe(0);
    const r = lockstep(["compare"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ok|drifted|broken/);
  });

  it("compare --fail-on with an unknown status exits non-zero", () => {
    expect(lockstep(["compare", "--fail-on", "bogus"]).status).not.toBe(0);
  });

  it("report renders HTML and Markdown", () => {
    expect(lockstep(["report", "-o", "r.html"]).status).toBe(0);
    expect(readFileSync(join(dir, "r.html"), "utf8")).toContain("<!doctype html>");
    expect(lockstep(["report", "--format", "md", "-o", "r.md"]).status).toBe(0);
    expect(readFileSync(join(dir, "r.md"), "utf8")).toContain("# Lockstep report");
  });

  it("list shows the saved runs", () => {
    const r = lockstep(["list"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(".json");
  });

  it("--version prints the version", () => {
    const r = lockstep(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
