/**
 * The two pure gatekeepers.
 *
 * `isAsymmetric` decides what becomes a card at all; `pickVerdict` decides which
 * line goes on the shareable one. Both are places where the answer has to be
 * re-derived from rules rather than taken on trust — the judge is a model, and a
 * model that flags a red line and then nominates that candidate anyway is a thing
 * that happens.
 */
import { describe, expect, it } from "vitest";
import { isAsymmetric } from "../src/domain/stats";
import { pickVerdict } from "../src/llm/run";
import type { Judgement, VerdictCandidate } from "../src/llm/schema";

describe("isAsymmetric", () => {
  it("accepts a difference past the ratio floor and rejects one under it", () => {
    expect(isAsymmetric({ a: 100, b: 70 })).toBe(true);
    expect(isAsymmetric({ a: 100, b: 80 })).toBe(false);
  });

  it("is symmetric in its arguments", () => {
    // Which of the two is bigger is a fact about the pair, not about the card.
    expect(isAsymmetric({ a: 4, b: 28 })).toBe(isAsymmetric({ a: 28, b: 4 }));
  });

  it("requires a real count when one side is zero", () => {
    // 2 vs 0 is a ratio of infinity and a difference of two messages.
    expect(isAsymmetric({ a: 2, b: 0 })).toBe(false);
    expect(isAsymmetric({ a: 5, b: 0 })).toBe(true);
  });

  it("refuses a pair where nothing happened at all", () => {
    expect(isAsymmetric({ a: 0, b: 0 })).toBe(false);
  });

  it("takes a stricter floor when asked", () => {
    expect(isAsymmetric({ a: 100, b: 70 }, 1.5)).toBe(false);
  });
});

// ---------------------------------------------------------------- pickVerdict

const candidate = (text: string): VerdictCandidate => ({ text, derivedFrom: ["f1"], rationale: "r" });

/** A judgement that passes every check. Tests override only what they're about. */
const clean = (index: number, sharpness: number, over: Partial<Judgement> = {}): Judgement => ({
  index,
  transferable: false,
  aimedAtPerson: false,
  redemptiveClause: false,
  therapyVocabulary: false,
  crossesRedLine: false,
  unsupported: false,
  sharpness,
  note: "",
  ...over,
});

describe("pickVerdict", () => {
  it("takes the judge's winner when it passes every check", () => {
    const cs = [candidate("first"), candidate("second")];
    const v = pickVerdict(cs, [clean(0, 3), clean(1, 5)], 1);
    expect(v?.text).toBe("second");
    expect(v?.compromised).toBe(false);
  });

  it("refuses a red-line candidate even when the judge nominates it", () => {
    // The red line is not a preference, so it is not the judge's call.
    const cs = [candidate("about the breakup"), candidate("safe line")];
    const v = pickVerdict(cs, [clean(0, 5, { crossesRedLine: true }), clean(1, 2)], 0);
    expect(v?.text).toBe("safe line");
  });

  it("returns null when every candidate crosses a red line", () => {
    // Better no card than that card.
    const cs = [candidate("one"), candidate("two")];
    const v = pickVerdict(cs, [clean(0, 5, { crossesRedLine: true }), clean(1, 5, { crossesRedLine: true })], 0);
    expect(v).toBeNull();
  });

  it("ignores a winner index that failed a non-red-line check", () => {
    // A horoscope with a high sharpness score is still a horoscope.
    const cs = [candidate("could be anyone"), candidate("only these two")];
    const v = pickVerdict(cs, [clean(0, 5, { transferable: true }), clean(1, 3)], 0);
    expect(v?.text).toBe("only these two");
    expect(v?.compromised).toBe(false);
  });

  it("falls back to the sharpest clean candidate when the winner index is bogus", () => {
    const cs = [candidate("a"), candidate("b"), candidate("c")];
    const v = pickVerdict(cs, [clean(0, 2), clean(1, 4), clean(2, 3)], 99);
    expect(v?.text).toBe("b");
  });

  it("marks the result compromised when nothing passed cleanly", () => {
    const cs = [candidate("aimed at her"), candidate("generic")];
    const v = pickVerdict(cs, [clean(0, 4, { aimedAtPerson: true }), clean(1, 2, { transferable: true })], 0);
    expect(v?.text).toBe("aimed at her");
    expect(v?.compromised).toBe(true);
  });

  it("breaks a sharpness tie on failure count, then on brevity", () => {
    const cs = [candidate("a longer line that says it"), candidate("short line"), candidate("also"), candidate("x")];
    const judgements = [
      clean(0, 4, { transferable: true }),
      clean(1, 4, { transferable: true, unsupported: true }),
      clean(2, 4, { transferable: true }),
      clean(3, 3, { transferable: true }),
    ];
    // 0 and 2 tie on sharpness and failure count; 2 is shorter. 1 has more
    // failures despite being short, and 3 is simply less sharp.
    expect(pickVerdict(cs, judgements, -1)?.text).toBe("also");
  });

  it("survives a candidate the judge never scored", () => {
    // A judge that returns nine judgements for ten candidates should not take the
    // whole run down.
    const cs = [candidate("judged"), candidate("unjudged")];
    const v = pickVerdict(cs, [clean(0, 4)], -1);
    expect(v?.text).toBe("judged");
  });

  it("still picks something when the judge returned no judgements at all", () => {
    // A judge response that fails to parse costs us the scoring, not the card.
    const cs = [candidate("a longer line here"), candidate("shorter")];
    const v = pickVerdict(cs, [], -1);
    expect(v?.text).toBe("shorter");
    expect(v?.judgement).toBeNull();
    expect(v?.compromised).toBe(true);
  });

  it("returns null when there is nothing to pick from", () => {
    expect(pickVerdict([], [], 0)).toBeNull();
  });
});
