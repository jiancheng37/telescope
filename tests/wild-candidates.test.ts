import { beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/parse";
import { buildCorpus } from "../src/llm/corpus";
import { buildWildCandidates } from "../src/llm/wild-candidates";
import { makeExport, msg, resetIds, T0 } from "./fixture";

beforeEach(resetIds);

describe("wild sentence retrieval", () => {
  it("keeps a specific line and its immediate reaction context", () => {
    const corpus = buildCorpus(parseExport(makeExport([
      msg({ at: T0, from: "alice", text: "if this plan fails we buy exactly one hundred chickens" }),
      msg({ at: T0 + 20, from: "bob", text: "bro what" }),
      msg({ at: T0 + 40, from: "alice", text: "this is called diversification" }),
    ])));
    const candidate = buildWildCandidates(corpus).find((item) => item.text.includes("one hundred chickens"));
    expect(candidate).toBeDefined();
    expect(candidate?.context.map((line) => line.body)).toContain("bro what");
  });

  it("excludes contact details and serious disclosures before AI", () => {
    const corpus = buildCorpus(parseExport(makeExport([
      msg({ at: T0, from: "alice", text: "email me at private@example.com because this sentence is long" }),
      msg({ at: T0 + 60, from: "bob", text: "the hospital diagnosis was extremely serious today" }),
    ])));
    expect(buildWildCandidates(corpus)).toEqual([]);
  });
});
