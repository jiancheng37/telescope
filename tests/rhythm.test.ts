import { beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/parse";
import {
  dormancy,
  doubleTexting,
  hourHistogram,
  lateNightShare,
  monologues,
  replyLatency,
  revival,
  silences,
} from "../src/domain/rhythm";
import type { Message, RawMessage } from "../src/domain/types";
import { DAY, T0, at, makeExport, msg, resetIds } from "./fixture";

beforeEach(resetIds);

function normalize(messages: RawMessage[]): Message[] {
  return parseExport(makeExport(messages)).messages;
}

/** Alternating-free helper: a sequence of sides at fixed one-minute spacing. */
function sequence(sides: Array<"alice" | "bob">, spacingSec = 60): Message[] {
  return normalize(sides.map((from, i) => msg({ at: T0 + i * spacingSec, from, text: `m${i}` })));
}

describe("replyLatency", () => {
  it("attributes the gap to the person who replied", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 300, from: "bob", text: "b" }), // bob took 5 min
      msg({ at: T0 + 400, from: "alice", text: "c" }), // alice took 100s
    ]);
    const { latency } = replyLatency(messages);
    expect(latency.b).toMatchObject({ n: 1, medianSec: 300 });
    expect(latency.a).toMatchObject({ n: 1, medianSec: 100 });
  });

  it("ignores consecutive messages from the same person", () => {
    const { latency } = replyLatency(sequence(["alice", "alice", "alice", "bob"]));
    expect(latency.b.n).toBe(1);
    expect(latency.a.n).toBe(0);
  });

  it("separates in-session replies from ones that crossed a gap", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 60, from: "bob", text: "b" }), // in session
      msg({ at: T0 + 60 + 2 * DAY, from: "alice", text: "c" }), // days later
      msg({ at: T0 + 120 + 2 * DAY, from: "bob", text: "d" }), // in session
    ]);
    const { latency } = replyLatency(messages);
    expect(latency.b).toMatchObject({ n: 2, inSessionMedianSec: 60 });
    expect(latency.a.medianSec).toBe(2 * DAY);
    expect(latency.a.inSessionMedianSec).toBe(0); // no in-session replies to measure
  });

  it("reports parity as 1.0 when both sides reply equally fast", () => {
    const { asymmetry } = replyLatency(sequence(["alice", "bob", "alice", "bob"]));
    expect(asymmetry).toBe(1);
  });
});

describe("doubleTexting", () => {
  it("counts same-sender follow-ups at or beyond two minutes with no upper limit", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "one" }),
      msg({ at: T0 + 119, from: "alice", text: "same burst" }),
      msg({ at: T0 + 239, from: "alice", text: "counts at two minutes" }),
      msg({ at: T0 + 3 * DAY, from: "alice", text: "still counts" }),
      msg({ at: T0 + 3 * DAY + 30, from: "bob", text: "reply" }),
      msg({ at: T0 + 3 * DAY + 150, from: "bob", text: "bob double texts" }),
    ]);

    const result = doubleTexting(messages);
    expect(result.frequency).toEqual({ a: 2, b: 1 });
    expect(result.longest).toMatchObject({ who: 0, doubleTexts: 2, messages: 4 });
  });
});

describe("monologues", () => {
  it("counts the final run, not just the ones a reply closed", () => {
    // alice: [1, 2]  bob: [1, 3]
    const mono = monologues(sequence(["alice", "bob", "alice", "alice", "bob", "bob", "bob"]));
    expect(mono.a).toMatchObject({ runs: 2, maxRunLength: 2, meanRunLength: 1.5 });
    expect(mono.b).toMatchObject({ runs: 2, maxRunLength: 3, meanRunLength: 2 });
  });

  it("measures the share of a person's messages that sit inside a 3+ run", () => {
    // alice sends 4 in a row, then 1 alone: 4 of her 5 messages are in a long run.
    const mono = monologues(
      sequence(["alice", "alice", "alice", "alice", "bob", "alice", "bob"]),
    );
    expect(mono.a.shareOfMessagesInRuns).toBeCloseTo(4 / 5, 5);
    expect(mono.a.shareOfRunsOver3).toBeCloseTo(1 / 2, 5);
    expect(mono.b.shareOfMessagesInRuns).toBe(0);
  });

  it("counts runs of eight or more separately", () => {
    const mono = monologues(sequence([...Array(8).fill("alice"), "bob"] as Array<"alice" | "bob">));
    expect(mono.a).toMatchObject({ runsOver8: 1, maxRunLength: 8 });
    expect(mono.b.runsOver8).toBe(0);
  });

  it("returns zeroed stats for an empty conversation", () => {
    const mono = monologues([]);
    expect(mono.a).toMatchObject({ runs: 0, meanRunLength: 0, maxRunLength: 0, shareOfRunsOver3: 0 });
  });
});

describe("hourHistogram and lateNightShare", () => {
  it("buckets messages by local hour per side", () => {
    const hist = hourHistogram(
      normalize([
        msg({ at: at(0, 2), from: "alice", text: "a" }),
        msg({ at: at(0, 2, 30), from: "alice", text: "b" }),
        msg({ at: at(0, 18), from: "bob", text: "c" }),
      ]),
    );
    expect(hist.a[2]).toBe(2);
    expect(hist.b[18]).toBe(1);
    expect(hist.a[18]).toBe(0);
  });

  it("counts midnight through 4am as late night", () => {
    const hist = hourHistogram(
      normalize([
        msg({ at: at(0, 0), from: "alice", text: "a" }),
        msg({ at: at(0, 4), from: "alice", text: "b" }),
        msg({ at: at(0, 5), from: "alice", text: "c" }), // 5am is not late night
        msg({ at: at(0, 13), from: "alice", text: "d" }),
        msg({ at: at(0, 13, 5), from: "bob", text: "e" }),
      ]),
    );
    const late = lateNightShare(hist);
    expect(late.a).toBeCloseTo(2 / 4, 5);
    expect(late.b).toBe(0);
  });

  it("returns 0 rather than NaN for a side that never spoke", () => {
    expect(lateNightShare({ a: new Array(24).fill(0), b: new Array(24).fill(0) })).toEqual({ a: 0, b: 0 });
  });
});

describe("silences", () => {
  it("returns gaps longest first with both ends attributed", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 3 * DAY, from: "bob", text: "b" }),
      msg({ at: T0 + 3 * DAY + 60, from: "bob", text: "c" }),
      msg({ at: T0 + 20 * DAY, from: "alice", text: "d" }),
    ]);
    const gaps = silences(messages);
    expect(gaps.map((g) => Math.round(g.days))).toEqual([17, 3]);
    expect(gaps[0]).toMatchObject({ wentQuiet: 1, revivedBy: 0 });
    expect(gaps[1]).toMatchObject({ wentQuiet: 0, revivedBy: 1 });
  });

  it("carries the message ids on either side of the gap so a quote can be pulled", () => {
    const before = msg({ at: T0, from: "alice", text: "a" });
    const after = msg({ at: T0 + 40 * DAY, from: "bob", text: "b" });
    const gaps = silences(normalize([before, after]));
    expect(gaps[0]).toMatchObject({ lastMessageId: before.id, firstMessageId: after.id });
  });

  it("respects the minimum-days floor", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 2 * DAY, from: "bob", text: "b" }),
    ]);
    expect(silences(messages, 1)).toHaveLength(1);
    expect(silences(messages, 3)).toHaveLength(0);
  });
});

describe("revival", () => {
  it("separates who came back from who let it go quiet", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      // alice went quiet, alice came back
      msg({ at: T0 + 40 * DAY, from: "alice", text: "b" }),
      // alice went quiet, bob came back
      msg({ at: T0 + 90 * DAY, from: "bob", text: "c" }),
    ]);
    const [r30] = revival(messages, [30]);
    expect(r30).toMatchObject({ thresholdDays: 30, n: 2, revivedBy: { a: 1, b: 1 }, wentQuiet: { a: 2, b: 0 } });
  });

  it("reports every threshold so a finding can be checked for robustness", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 10 * DAY, from: "bob", text: "b" }), // clears 7 only
      msg({ at: T0 + 60 * DAY, from: "bob", text: "c" }), // clears 7, 14, 30
    ]);
    const stats = revival(messages);
    expect(stats.map((s) => [s.thresholdDays, s.n])).toEqual([
      [2 / 24, 2],
      [7, 2],
      [14, 1],
      [30, 1],
      [60, 0],
    ]);
  });
});

describe("dormancy", () => {
  it("sums only the gaps that cross the threshold", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 5 * DAY, from: "bob", text: "b" }), // under 14 days, not dormant
      msg({ at: T0 + 45 * DAY, from: "alice", text: "c" }), // 40 dormant days
    ]);
    const { dormantDays, dormantShare } = dormancy(messages);
    expect(dormantDays).toBeCloseTo(40, 5);
    expect(dormantShare).toBeCloseTo(40 / 45, 5);
  });

  it("returns zero for a chat too short to have gaps", () => {
    expect(dormancy(sequence(["alice", "bob"]).slice(0, 1))).toEqual({ dormantDays: 0, dormantShare: 0 });
  });
});
