import { beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/parse";
import { buildCorpus } from "../src/llm/corpus";
import { buildLanguageCandidates } from "../src/llm/language-candidates";
import { makeExport, msg, resetIds, T0 } from "./fixture";

beforeEach(resetIds);

describe("full-corpus language candidates", () => {
  it("finds repeated phrases across separate sessions", () => {
    const messages = Array.from({ length: 8 }, (_, i) => [
      msg({ at: T0 + i * 86400, from: "alice", text: `academic weapon day ${i}` }),
      msg({ at: T0 + i * 86400 + 60, from: "bob", text: "good luck" }),
    ]).flat();
    const candidates = buildLanguageCandidates(buildCorpus(parseExport(makeExport(messages))));
    const phrase = candidates.find((candidate) => candidate.text === "academic weapon");
    expect(phrase?.side).toBe("a");
    expect(phrase?.sessions).toBe(8);
    expect(phrase?.examples[0].quote).toContain("academic weapon");
  });

  it("recognises expressions used substantially by both people as shared", () => {
    const messages = Array.from({ length: 7 }, (_, i) => [
      msg({ at: T0 + i * 86400, from: "alice", text: "buy one hundred chickens" }),
      msg({ at: T0 + i * 86400 + 60, from: "bob", text: "fine buy one hundred chickens" }),
    ]).flat();
    const candidates = buildLanguageCandidates(buildCorpus(parseExport(makeExport(messages))));
    expect(candidates.find((candidate) => candidate.text === "one hundred chickens")?.side).toBe("shared");
  });
});
