import { beforeEach, describe, expect, it } from "vitest";
import { analyzeParsed } from "../src/domain/analyze";
import { parseExport } from "../src/domain/parse";
import { buildCorpus } from "../src/llm/corpus";
import { sampleCorpus } from "../src/llm/sample";
import { makeExport, msg, resetIds, T0 } from "./fixture";

beforeEach(resetIds);

function largeConversation(count = 1_600) {
  const messages = Array.from({ length: count }, (_, index) =>
    msg({
      at: T0 + index * 75,
      from: index % 2 === 0 ? "alice" : "bob",
      text: `${index} ${index % 37 === 0 ? "chicken callback" : "ordinary exchange"} ${"detail ".repeat(12)}`,
    }),
  );
  const parsed = parseExport(makeExport(messages));
  return { parsed, analysis: analyzeParsed(parsed), corpus: buildCorpus(parsed) };
}

describe("intelligent corpus sampling", () => {
  it("leaves a corpus untouched when it fits the budget", () => {
    const { analysis, corpus } = largeConversation(30);
    const sampled = sampleCorpus(corpus, analysis, corpus.approxTokens + 100);
    expect(sampled.corpus).toBe(corpus);
    expect(sampled.stats.sampled).toBe(false);
  });

  it("keeps stable citation ids inside a bounded representative subset", () => {
    const { analysis, corpus } = largeConversation();
    const first = sampleCorpus(corpus, analysis, 8_000);
    const second = sampleCorpus(corpus, analysis, 8_000);

    expect(first.stats.sampled).toBe(true);
    expect(first.stats.selectedLines).toBeLessThan(first.stats.originalLines);
    expect(first.stats.selectedTokens).toBeLessThanOrEqual(8_000);
    expect(first.corpus.lines.map((line) => line.seq)).toEqual(second.corpus.lines.map((line) => line.seq));
    expect(first.corpus.lines[0].seq).toBe(1);
    expect(first.corpus.lines.at(-1)?.seq).toBe(corpus.lines.at(-1)?.seq);
    expect(first.corpus.text).toContain("representative sample:");

    for (const line of first.corpus.lines) {
      expect(corpus.bySeq.get(line.seq)?.body).toBe(line.body);
    }
  });

  it("spreads control excerpts across the timeline", () => {
    const { analysis, corpus } = largeConversation();
    const { corpus: sampled } = sampleCorpus(corpus, analysis, 6_000);
    const quarters = new Set(sampled.lines.map((line) => Math.min(3, Math.floor(((line.seq - 1) / corpus.lines.length) * 4))));
    expect(quarters).toEqual(new Set([0, 1, 2, 3]));
  });
});
