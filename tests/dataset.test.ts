import { describe, it, expect } from "vitest";
import { parseDataset } from "../core/dataset.js";

describe("parseDataset", () => {
  it("parses .jsonl strings and {input} objects", () => {
    const c = '"first line"\n{"input":"second"}\n{"foo":1}\n';
    expect(parseDataset("d.jsonl", c)).toEqual(["first line", "second", '{"foo":1}']);
  });

  it("throws with the line number on bad jsonl", () => {
    expect(() => parseDataset("d.jsonl", '"ok"\n{bad}\n')).toThrow(/line 2/);
  });

  it("parses a .json array of strings and objects", () => {
    expect(parseDataset("d.json", '["a", {"input":"b"}]')).toEqual(["a", "b"]);
  });

  it("rejects a non-array .json", () => {
    expect(() => parseDataset("d.json", '{"a":1}')).toThrow(/must contain an array/);
  });

  it("parses .csv using the input column when present", () => {
    const c = "id,input\n1,hello\n2,\"has, comma\"\n";
    expect(parseDataset("d.csv", c)).toEqual(["hello", "has, comma"]);
  });

  it("parses .csv using the first column when there is no input header", () => {
    expect(parseDataset("d.csv", "q,note\nfoo,x\nbar,y\n")).toEqual(["foo", "bar"]);
  });

  it("handles quoted CSV with escaped quotes", () => {
    expect(parseDataset("d.csv", 'input\n"she said ""hi"""\n')).toEqual(['she said "hi"']);
  });

  it("parses .txt as one input per non-empty line", () => {
    expect(parseDataset("d.txt", "one\n\n  two  \nthree\n")).toEqual(["one", "two", "three"]);
  });
});
