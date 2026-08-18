/**
 * Citation checking.
 *
 * This is the file that decides whether a card is a finding or a confident
 * sentence, so the tests are about the two ways it can fail: letting through a
 * quote that isn't in the message it points at, and throwing away a real card
 * over a formatting difference nobody cares about.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/parse";
import { buildCorpus, type Corpus } from "../src/llm/corpus";
import type { Card, Evidence, ReadingOutput } from "../src/llm/schema";
import { citableIds, normalize, validateReading } from "../src/llm/validate";
import { makeExport, msg, resetIds, T0 } from "./fixture";

beforeEach(resetIds);

function corpus(): Corpus {
  return buildCorpus(
    parseExport(
      makeExport([
        msg({ at: T0, from: "alice", text: "i'm not saying it again" }),
        msg({ at: T0 + 10, from: "bob", text: "okay" }),
        msg({ at: T0 + 20, from: "alice", text: "you always do this" }),
        msg({ at: T0 + 30, from: "bob", media: "sticker", sticker: "😭" }),
      ]),
    ),
  );
}

/** A reading with nothing in it, so each test can fill in only what it's about. */
function reading(over: Partial<ReadingOutput> = {}): ReadingOutput {
  return {
    eras: [],
    silences: [],
    findings: [],
    motifs: [],
    topics: [],
    dynamics: [],
    roles: { a: [], b: [] },
    language: { a: [], b: [], shared: [] },
    wildSentences: [],
    naming: { aCallsB: "", bCallsA: "", evidence: [] },
    ...over,
  };
}

function finding(id: string, evidence: Evidence[]): Card {
  return { id, metric: "turn-taking", headline: "h", body: "b", about: "a", evidence };
}

describe("normalize", () => {
  it("forgives case, whitespace and quote marks", () => {
    expect(normalize("  I’m   Not  Saying “It” Again ")).toBe(`i'm not saying "it" again`);
  });

  it("does not forgive different words", () => {
    expect(normalize("i am not saying it")).not.toBe(normalize("i'm not saying it"));
  });
});

describe("validateReading", () => {
  it("accepts a verbatim quote", () => {
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 1, quote: "i'm not saying it again" }])] }));
    expect(r.findings).toHaveLength(1);
    expect(r.totals).toMatchObject({ citations: 1, valid: 1, notFound: 0, outOfRange: 0 });
  });

  it("accepts a contiguous fragment", () => {
    // The model shouldn't have to quote a whole message to point at part of one.
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 3, quote: "always do this" }])] }));
    expect(r.findings).toHaveLength(1);
  });

  it("accepts a quote whose apostrophe is the wrong shape", () => {
    // Telegram exports curly quotes and models type straight ones. Dropping a
    // real card over this would be indefensible.
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 1, quote: "I'm not saying" }])] }));
    expect(r.findings).toHaveLength(1);
  });

  it("resolves a citation back to the real message id and side", () => {
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 3, quote: "you always" }])] }));
    expect(r.findings[0].evidence[0]).toMatchObject({ seq: 3, messageId: 3, who: 0, body: "you always do this" });
  });

  it("drops a card whose quote is not in the message it points at", () => {
    const r = validateReading(
      corpus(),
      reading({ findings: [finding("f1", [{ seq: 2, quote: "i'm not saying it again" }])] }),
    );
    expect(r.findings).toHaveLength(0);
    expect(r.dropped).toEqual([
      { what: "finding", id: "f1", failures: [{ kind: "quote-not-found", seq: 2, quote: "i'm not saying it again", body: "okay" }] },
    ]);
    expect(r.totals).toMatchObject({ citations: 1, valid: 0, notFound: 1 });
  });

  it("drops a card citing a seq that doesn't exist", () => {
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 99, quote: "okay" }])] }));
    expect(r.findings).toHaveLength(0);
    expect(r.dropped[0].failures[0]).toEqual({ kind: "out-of-range", seq: 99, quote: "okay" });
    expect(r.totals).toMatchObject({ outOfRange: 1 });
  });

  it("rejects an empty quote", () => {
    // Every string contains "", so without this a card cites nothing and passes.
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 1, quote: "" }])] }));
    expect(r.findings).toHaveLength(0);
  });

  it("keeps a card that has one good citation among bad ones", () => {
    // One quote is enough to stand a claim up. Discarding the card because its
    // second citation was sloppy throws away a real finding.
    const r = validateReading(
      corpus(),
      reading({
        findings: [finding("f1", [{ seq: 1, quote: "not saying it again" }, { seq: 2, quote: "never said that" }])],
      }),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence).toHaveLength(1);
    expect(r.findings[0].failures).toHaveLength(1);
    expect(r.totals).toMatchObject({ citations: 2, valid: 1, notFound: 1 });
  });

  it("lets a media placeholder be quoted by naming it", () => {
    // `[sticker 😭]` is what the model was shown, so it's what it can cite.
    const r = validateReading(corpus(), reading({ findings: [finding("f1", [{ seq: 4, quote: "[sticker 😭]" }])] }));
    expect(r.findings).toHaveLength(1);
  });

  it("checks eras, silences and motifs the same way", () => {
    const r = validateReading(
      corpus(),
      reading({
        eras: [{ chapterIndex: 1, name: "The Argument", body: "b", evidence: [{ seq: 3, quote: "you always do this" }] }],
        silences: [{ chapterIndex: 2, body: "b", evidence: [{ seq: 1, quote: "nope" }] }],
        motifs: [{ id: "m1", name: "n", body: "b", evidence: [{ seq: 2, quote: "okay" }] }],
      }),
    );
    expect(r.eras).toHaveLength(1);
    expect(r.motifs).toHaveLength(1);
    expect(r.silences).toHaveLength(0);
    expect(r.dropped.map((d) => d.what)).toEqual(["silence"]);
    expect(r.dropped[0].id).toBe("chapter 2");
  });

  it("validates topics, dynamics, and dynamic counter-evidence", () => {
    const r = validateReading(corpus(), reading({
      topics: [{ id: "work", category: "work-or-school", label: "Work", summary: "s", chapterIndexes: [1], evidence: [{ seq: 2, quote: "okay" }] }],
      dynamics: [{ id: "repair", category: "repair", headline: "They reset plainly", body: "b", roleA: "names the problem", roleB: "acknowledges it", evidence: [{ seq: 3, quote: "always do this" }], counterEvidence: [{ seq: 1, quote: "not saying" }] }],
    }));
    expect(r.topics).toHaveLength(1);
    expect(r.dynamics).toHaveLength(1);
    expect(r.dynamics[0].counterEvidence).toHaveLength(1);
    expect(citableIds(r).has("work")).toBe(true);
    expect(citableIds(r).has("repair")).toBe(true);
  });

  it("keeps only character roles backed by real citations", () => {
    const r = validateReading(corpus(), reading({
      roles: {
        a: [{ id: "plain-speaker", title: "The Plain Speaker", description: "Says the hard part directly.", evidence: [{ seq: 3, quote: "always do this" }] }],
        b: [{ id: "invented-role", title: "The Inventor", description: "Unsupported.", evidence: [{ seq: 2, quote: "not in the message" }] }],
      },
    }));
    expect(r.roles.a).toHaveLength(1);
    expect(r.roles.b).toHaveLength(0);
    expect(r.dropped).toContainEqual(expect.objectContaining({ what: "role", id: "invented-role" }));
    expect(citableIds(r).has("plain-speaker")).toBe(true);
  });

  it("rejects language choices that were not in the full-corpus dossier", () => {
    const r = validateReading(corpus(), reading({
      language: {
        a: [{ candidateId: "made-up", text: "invented phrase", category: "signature-phrase", explanation: "Not real.", evidence: [{ seq: 1, quote: "again" }] }],
        b: [],
        shared: [],
      },
    }));
    expect(r.language.a).toHaveLength(0);
    expect(r.dropped).toContainEqual(expect.objectContaining({ what: "language", id: "made-up" }));
  });

  it("accepts only a wild candidate's own verbatim message", () => {
    const r = validateReading(corpus(), reading({
      wildSentences: [{ candidateId: "wild-1", category: "suspiciously-specific", explanation: "A strangely formal refusal.", evidence: [{ seq: 1, quote: "i'm not saying it again" }] }],
    }));
    expect(r.wildSentences).toHaveLength(1);
    const rejected = validateReading(corpus(), reading({
      wildSentences: [{ candidateId: "wild-1", category: "suspiciously-specific", explanation: "Wrong quote.", evidence: [{ seq: 2, quote: "okay" }] }],
    }));
    expect(rejected.wildSentences).toHaveLength(0);
  });

  it("never drops naming, even when its evidence fails", () => {
    // "She never uses his name" is a real finding that is *supposed* to have
    // nothing to cite on one side.
    const r = validateReading(
      corpus(),
      reading({ naming: { aCallsB: "bobby", bCallsA: "", evidence: [{ seq: 1, quote: "bobby" }] } }),
    );
    expect(r.naming.card.aCallsB).toBe("bobby");
    expect(r.naming.evidence).toHaveLength(0);
    expect(r.naming.failures).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });
});

describe("citableIds", () => {
  it("offers finding ids, motif ids and era names, and nothing that was dropped", () => {
    const r = validateReading(
      corpus(),
      reading({
        eras: [{ chapterIndex: 1, name: "The Argument", body: "b", evidence: [{ seq: 3, quote: "you always" }] }],
        findings: [finding("kept", [{ seq: 1, quote: "again" }]), finding("dropped", [{ seq: 1, quote: "not here" }])],
        motifs: [{ id: "m1", name: "n", body: "b", evidence: [{ seq: 2, quote: "okay" }] }],
      }),
    );
    expect([...citableIds(r)].sort()).toEqual(["The Argument", "kept", "m1"]);
  });
});
