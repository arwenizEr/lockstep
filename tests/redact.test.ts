import { describe, it, expect } from "vitest";
import {
  redactText,
  resolveRedactions,
  compileUserPatterns,
  redactRunFile,
  BUILTIN_REDACTIONS,
} from "../core/redact.js";
import type { RunFile, CaseResult } from "../core/runner.js";
import type { Config } from "../core/config.js";

const cfg: Config = {
  targets: [],
  cases_dir: "./cases",
  pricing: {},
  diff: { similarity_threshold: 0.9 },
  redact: [],
};

describe("built-in redactions", () => {
  const set = resolveRedactions({ builtins: true });

  it("masks emails", () => {
    expect(redactText("reach me at jane.doe@example.com today", set)).toBe(
      "reach me at [redacted-email] today"
    );
  });

  it("masks anthropic and openai keys", () => {
    expect(redactText("key sk-ant-abcdef0123456789ABCD here", set)).toContain("[redacted-key]");
    expect(redactText("sk-proj-abcdefghij0123456789KLMNOP", set)).toContain("[redacted-key]");
  });

  it("masks bearer tokens and AWS keys", () => {
    expect(redactText("Authorization: Bearer abc123def456", set)).toContain("[redacted-token]");
    expect(redactText("AKIAIOSFODNN7EXAMPLE", set)).toBe("[redacted-aws-key]");
  });

  it("leaves clean text untouched", () => {
    expect(redactText("the total is 42 dollars", set)).toBe("the total is 42 dollars");
  });

  it("is reusable across calls (resets regex lastIndex)", () => {
    expect(redactText("a@b.com", set)).toBe("[redacted-email]");
    expect(redactText("a@b.com", set)).toBe("[redacted-email]");
  });
});

describe("user patterns", () => {
  it("compiles and applies custom regex", () => {
    const set = compileUserPatterns(["ACME-\\d+"]);
    expect(redactText("order ACME-9001 shipped", set)).toBe("order [redacted] shipped");
  });
  it("throws on an invalid pattern", () => {
    expect(() => compileUserPatterns(["("])).toThrow(/Invalid redact pattern/);
  });
  it("resolveRedactions can drop built-ins", () => {
    const set = resolveRedactions({ builtins: false, patterns: ["secret"] });
    expect(set.length).toBe(1);
    expect(redactText("my secret and a@b.com", set)).toBe("my [redacted] and a@b.com");
  });
});

describe("redactRunFile", () => {
  const base: CaseResult = {
    caseId: "c1",
    inputIndex: 0,
    targetId: "t",
    model: "m",
    provider: "mock",
    prompt: "email user@host.com",
    status: "OK",
    output: "contact admin@host.com",
    tokensIn: 1,
    tokensOut: 1,
    cost: 0,
    priced: true,
    latencyMs: 1,
  };
  const run: RunFile = {
    schema: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    config: cfg,
    targets: [{ id: "t", provider: "mock", model: "m" }],
    results: [base, { ...base, status: "BROKEN", output: "", error: "failed for x@y.com" }],
  };

  it("scrubs prompt, output, and error without mutating the input", () => {
    const out = redactRunFile(run, BUILTIN_REDACTIONS);
    expect(out.results[0].output).toBe("contact [redacted-email]");
    expect(out.results[0].prompt).toBe("email [redacted-email]");
    expect(out.results[1].error).toBe("failed for [redacted-email]");
    // original untouched
    expect(run.results[0].output).toBe("contact admin@host.com");
  });

  it("returns the same run when there are no redactions", () => {
    expect(redactRunFile(run, [])).toBe(run);
  });
});
