import { describe, expect, it } from "vitest";
import { logOddsZ, median, quantile, ratio, segment, share } from "../src/domain/stats";

describe("quantile", () => {
  it("interpolates between neighbours", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
  });

  it("does not need sorted input", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("returns 0 for an empty series rather than NaN", () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(median([])).toBe(0);
  });

  it("hits the endpoints exactly", () => {
    expect(quantile([3, 7, 11], 0)).toBe(3);
    expect(quantile([3, 7, 11], 1)).toBe(11);
  });
});

describe("ratio and share", () => {
  it("treats 0/0 as parity, not NaN", () => {
    expect(ratio(0, 0)).toBe(1);
  });

  it("returns Infinity when only the denominator is zero", () => {
    expect(ratio(5, 0)).toBe(Infinity);
  });

  it("guards share against a zero whole", () => {
    expect(share(3, 0)).toBe(0);
  });
});

describe("logOddsZ", () => {
  const counts = (o: Record<string, number>) => new Map(Object.entries(o));

  it("signs positive for words characteristic of A", () => {
    const a = counts({ bc: 100, the: 200, gna: 60 });
    const b = counts({ okay: 100, the: 200, yeah: 40 });
    const scored = logOddsZ(a, b);
    const byWord = new Map(scored.map((s) => [s.word, s.z]));
    expect(byWord.get("bc")).toBeGreaterThan(0);
    expect(byWord.get("gna")).toBeGreaterThan(0);
    expect(byWord.get("okay")).toBeLessThan(0);
    expect(byWord.get("yeah")).toBeLessThan(0);
  });

  it("scores a word both use about equally near zero", () => {
    const scored = logOddsZ(counts({ the: 200, x: 50 }), counts({ the: 200, y: 50 }));
    const the = scored.find((s) => s.word === "the")!;
    expect(Math.abs(the.z)).toBeLessThan(Math.abs(scored[0].z));
  });

  it("drops words below minTotal", () => {
    const scored = logOddsZ(counts({ rare: 5, common: 50 }), counts({ common: 50 }), { minTotal: 20 });
    expect(scored.map((s) => s.word)).toEqual(["common"]);
  });

  it("reports raw counts alongside the score", () => {
    const scored = logOddsZ(counts({ bc: 115 }), counts({ bc: 0, other: 200 }));
    const bc = scored.find((s) => s.word === "bc")!;
    expect(bc).toMatchObject({ countA: 115, countB: 0 });
  });

  it("returns sorted descending by z", () => {
    const scored = logOddsZ(counts({ mine: 90, shared: 60 }), counts({ theirs: 90, shared: 60 }));
    const zs = scored.map((s) => s.z);
    expect([...zs].sort((x, y) => y - x)).toEqual(zs);
  });

  it("returns nothing for empty input", () => {
    expect(logOddsZ(new Map(), new Map())).toEqual([]);
  });
});

describe("segment", () => {
  it("finds a single step change", () => {
    const bounds = segment([1, 1, 1, 1, 9, 9, 9, 9], { maxSplits: 1 });
    expect(bounds).toEqual([0, 4, 8]);
  });

  it("finds a low stretch between two high ones", () => {
    const bounds = segment([9, 9, 1, 1, 9, 9], { minSegmentLength: 2, maxSplits: 4, minGainShare: 0.05 });
    expect(bounds).toEqual([0, 2, 4, 6]);
  });

  it("refuses to split a series shorter than two segments", () => {
    expect(segment([1, 2, 3], { minSegmentLength: 2 })).toEqual([0, 3]);
  });

  it("refuses to split a perfectly flat series", () => {
    // Total SSE is zero here, so a naive `gain < minGainShare * total` check
    // passes trivially and invents boundaries that separate nothing.
    expect(segment([5, 5, 5, 5, 5, 5, 5, 5])).toEqual([0, 8]);
  });

  it("refuses to split noise that buys less than minGainShare", () => {
    expect(segment([5, 5.01, 4.99, 5, 5.01, 4.99], { minGainShare: 0.9 })).toEqual([0, 6]);
  });

  it("honours minSegmentLength", () => {
    const bounds = segment([1, 9, 9, 9, 9, 9, 9, 1], { minSegmentLength: 3, maxSplits: 8 });
    for (let i = 0; i < bounds.length - 1; i++) {
      expect(bounds[i + 1] - bounds[i]).toBeGreaterThanOrEqual(3);
    }
  });

  it("always returns bounds that cover the series exactly once, ascending", () => {
    const bounds = segment([1, 1, 5, 5, 20, 20, 3, 3, 40, 40]);
    expect(bounds[0]).toBe(0);
    expect(bounds[bounds.length - 1]).toBe(10);
    expect([...bounds].sort((x, y) => x - y)).toEqual(bounds);
    expect(new Set(bounds).size).toBe(bounds.length);
  });
});
