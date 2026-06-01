import { describe, it, expect } from "vitest";
import { buildTurns } from "../core/runner.js";
import type { Case } from "../core/cases.js";

const single: Case = { id: "c", prompt: "say {{input}}", inputs: ["x"], assert: [] };
const multi: Case = {
  id: "c",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "echo {{input}}" },
  ],
  inputs: ["x"],
  assert: [],
};

describe("buildTurns", () => {
  it("single-turn: one user message with {{input}} substituted", () => {
    const t = buildTurns(single, "hi");
    expect(t.messages).toEqual([{ role: "user", content: "say hi" }]);
    expect(t.displayPrompt).toBe("say hi");
  });

  it("multi-turn: passes the conversation through, substituting every turn", () => {
    const t = buildTurns(multi, "boo");
    expect(t.messages).toHaveLength(3);
    expect(t.messages[2]).toEqual({ role: "user", content: "echo boo" });
    // display prompt is the last user turn
    expect(t.displayPrompt).toBe("echo boo");
  });
});
