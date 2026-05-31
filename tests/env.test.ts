import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotenv } from "../core/env.js";

describe("loadDotenv", () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lockstep-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    // restore env keys we may have touched
    for (const k of ["LS_TEST_A", "LS_TEST_B", "LS_TEST_C", "LS_TEST_QUOTED", "LS_TEST_EXPORT"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("loads KEY=VALUE pairs", () => {
    writeFileSync(join(dir, ".env"), "LS_TEST_A=hello\nLS_TEST_B=world\n");
    loadDotenv(dir);
    expect(process.env.LS_TEST_A).toBe("hello");
    expect(process.env.LS_TEST_B).toBe("world");
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(join(dir, ".env"), "# a comment\n\nLS_TEST_C=value\n");
    loadDotenv(dir);
    expect(process.env.LS_TEST_C).toBe("value");
  });

  it("strips surrounding quotes", () => {
    writeFileSync(join(dir, ".env"), `LS_TEST_QUOTED="quoted value"\n`);
    loadDotenv(dir);
    expect(process.env.LS_TEST_QUOTED).toBe("quoted value");
  });

  it("supports the export prefix", () => {
    writeFileSync(join(dir, ".env"), "export LS_TEST_EXPORT=exported\n");
    loadDotenv(dir);
    expect(process.env.LS_TEST_EXPORT).toBe("exported");
  });

  it("does not overwrite already-set vars", () => {
    process.env.LS_TEST_A = "preset";
    writeFileSync(join(dir, ".env"), "LS_TEST_A=fromfile\n");
    loadDotenv(dir);
    expect(process.env.LS_TEST_A).toBe("preset");
  });

  it("walks up to find a parent .env", () => {
    writeFileSync(join(dir, ".env"), "LS_TEST_A=parent\n");
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    loadDotenv(sub);
    expect(process.env.LS_TEST_A).toBe("parent");
  });

  it("is a no-op when no .env exists", () => {
    expect(() => loadDotenv(dir)).not.toThrow();
  });
});
