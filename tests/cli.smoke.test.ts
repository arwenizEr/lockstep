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

  it("ask runs one prompt against every target", () => {
    const r = lockstep(["ask", "Name one primary color."]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Asking 2 target(s)");
    expect(r.stdout).toContain("m1");
    expect(r.stdout).toContain("m2");
    expect(r.stdout).toMatch(/cheapest:/);
  });

  it("ask with no prompt and no stdin exits non-zero", () => {
    const r = spawnSync("node", [cli, "ask"], { cwd: dir, encoding: "utf8", input: "" });
    expect(r.status).not.toBe(0);
  });

  it("--version prints the version", () => {
    const r = lockstep(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("run --max-cost fails when the budget is exceeded", () => {
    const over = lockstep(["run", "--max-cost", "0"]);
    expect(over.status).toBe(1);
    expect(over.stderr + over.stdout).toMatch(/budget exceeded/);
    const under = lockstep(["run", "--max-cost", "999"]);
    expect(under.status).toBe(0);
    expect(under.stdout).toMatch(/within budget/);
  });

  it("run --cache serves a hit on the second identical run", () => {
    expect(lockstep(["run", "--cache"]).status).toBe(0);
    const second = lockstep(["run", "--cache"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("hit");
    expect(existsSync(join(dir, ".lockstep", "cache"))).toBe(true);
  });

  it("run --redact announces redaction is on", () => {
    const r = lockstep(["run", "--redact"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Redaction: ON/);
  });

  it("trend shows movement across runs", () => {
    const r = lockstep(["trend"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("trend for");
  });

  it("baseline set / show / clear round-trips and pins compare", () => {
    const set = lockstep(["baseline", "set"]);
    expect(set.status).toBe(0);
    expect(set.stdout).toContain("Pinned baseline");
    expect(lockstep(["baseline", "show"]).stdout).toContain("Baseline:");
    // compare with no args now uses the baseline as A
    expect(lockstep(["compare"]).status).toBe(0);
    const cleared = lockstep(["baseline", "clear"]);
    expect(cleared.stdout).toContain("cleared");
  });

  it("loads a multi-turn + dataset case end to end", () => {
    writeFileSync(join(dir, "cases", "data.jsonl"), '"alpha"\n"beta"\n');
    writeFileSync(
      join(dir, "cases", "chat.yaml"),
      [
        "- id: chat",
        "  messages:",
        '    - { role: user, content: "echo {{input}}" }',
        "  inputs_file: data.jsonl",
        "",
      ].join("\n")
    );
    const r = lockstep(["run", "--dry-run"]);
    expect(r.status).toBe(0);
    // greet(1 input) + chat(2 dataset inputs) = 3 cells/target
    expect(r.stdout).toMatch(/\b3\b/);
  });
});
