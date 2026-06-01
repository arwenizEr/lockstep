import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setBaseline, getBaseline, clearBaseline } from "../core/baseline.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "lockstep-baseline-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("baseline pointer", () => {
  it("set then get round-trips run + target", () => {
    const d = tmp();
    setBaseline(d, "/runs/golden.json", "opus-4-8", "2026-06-01T00:00:00.000Z");
    const b = getBaseline(d);
    expect(b?.run).toBe("/runs/golden.json");
    expect(b?.target).toBe("opus-4-8");
    expect(existsSync(join(d, ".lockstep", "baseline.json"))).toBe(true);
  });

  it("returns undefined when no baseline is set", () => {
    expect(getBaseline(tmp())).toBeUndefined();
  });

  it("returns undefined on a corrupt pointer", () => {
    const d = tmp();
    setBaseline(d, "/x.json", undefined, "t");
    writeFileSync(join(d, ".lockstep", "baseline.json"), "{not json", "utf8");
    expect(getBaseline(d)).toBeUndefined();
  });

  it("clear removes the pointer and reports whether one existed", () => {
    const d = tmp();
    expect(clearBaseline(d)).toBe(false);
    setBaseline(d, "/x.json", undefined, "t");
    expect(clearBaseline(d)).toBe(true);
    expect(getBaseline(d)).toBeUndefined();
  });
});
