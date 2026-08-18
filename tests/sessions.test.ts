import { beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/parse";
import {
  MIN_ERA_MESSAGES,
  SESSION_GAP_MIN,
  activeDates,
  buildChapters,
  buildEpisodes,
  buildSessions,
  summarizeSessions,
  weekStart,
} from "../src/domain/sessions";
import type { Chapter, Message, RawMessage } from "../src/domain/types";
import { DAY, T0, at, makeExport, msg, resetIds } from "./fixture";

beforeEach(resetIds);

/** Parse a list of raw messages down to the normalized form the builders take. */
function normalize(messages: RawMessage[]): Message[] {
  return parseExport(makeExport(messages)).messages;
}

describe("buildSessions", () => {
  it("splits on a gap longer than SESSION_GAP_MIN and not on a shorter one", () => {
    const gap = SESSION_GAP_MIN * 60;
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + gap, from: "bob", text: "b" }), // exactly the gap: same session
      msg({ at: T0 + gap * 2 + 1, from: "alice", text: "c" }), // one second over: new session
    ]);
    const sessions = buildSessions(messages);
    expect(sessions.map((s) => s.messageCount)).toEqual([2, 1]);
  });

  it("records who opened and who closed", () => {
    const sessions = buildSessions(
      normalize([
        msg({ at: T0, from: "bob", text: "a" }),
        msg({ at: T0 + 60, from: "alice", text: "b" }),
        msg({ at: T0 + 120, from: "bob", text: "c" }),
      ]),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ openedBy: 1, closedBy: 1, monologue: false, durationMin: 2 });
  });

  it("flags a session only one person spoke in", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 60, from: "alice", text: "b" }),
      // Bob exists elsewhere so the export parses, but not in this session.
      msg({ at: T0 + 10 * DAY, from: "bob", text: "c" }),
    ]);
    const sessions = buildSessions(messages);
    expect(sessions[0].monologue).toBe(true);
    expect(sessions[1].monologue).toBe(true);
  });

  it("summarizes opens and closes per side", () => {
    const summary = summarizeSessions(
      buildSessions(
        normalize([
          msg({ at: T0, from: "alice", text: "a" }),
          msg({ at: T0 + 60, from: "bob", text: "b" }),
          msg({ at: T0 + 5 * DAY, from: "bob", text: "c" }),
          msg({ at: T0 + 5 * DAY + 60, from: "bob", text: "d" }),
        ]),
      ),
    );
    expect(summary).toMatchObject({
      count: 2,
      maxMessages: 2,
      medianMessages: 2,
      monologueSessions: 1,
      opens: { a: 1, b: 1 },
      closes: { a: 0, b: 2 },
    });
  });

  it("handles an empty message list", () => {
    expect(buildSessions([])).toEqual([]);
    expect(summarizeSessions([])).toMatchObject({ count: 0, maxMessages: 0, medianMessages: 0 });
  });
});

describe("buildEpisodes", () => {
  it("ends an episode after 14 days of silence and attributes both ends", () => {
    const episodes = buildEpisodes(
      normalize([
        msg({ at: T0, from: "alice", text: "a" }),
        msg({ at: T0 + 60, from: "bob", text: "b" }), // bob has the last word
        msg({ at: T0 + 20 * DAY, from: "alice", text: "c" }), // alice revives
        msg({ at: T0 + 20 * DAY + 60, from: "bob", text: "d" }),
      ]),
    );
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({ revivedBy: null, wentQuiet: null, dormantBeforeDays: 0 });
    expect(episodes[0].dormantAfterDays).toBeCloseTo(20 - 60 / DAY, 3);
    expect(episodes[1]).toMatchObject({ revivedBy: 0, wentQuiet: 1, dormantAfterDays: null });
  });

  it("does not split on a 13-day gap", () => {
    const episodes = buildEpisodes(
      normalize([
        msg({ at: T0, from: "alice", text: "a" }),
        msg({ at: T0 + 13 * DAY, from: "bob", text: "b" }),
      ]),
    );
    expect(episodes).toHaveLength(1);
  });

  it("counts a same-day episode as one day rather than zero", () => {
    const episodes = buildEpisodes(
      normalize([
        msg({ at: T0, from: "alice", text: "a" }),
        msg({ at: T0 + 600, from: "bob", text: "b" }),
      ]),
    );
    expect(episodes[0].days).toBe(1);
    expect(episodes[0].messagesPerDay).toBe(2);
  });
});

describe("buildChapters", () => {
  /** `n` messages one hour apart starting at `start`, alternating sides. */
  function burst(start: number, n: number, from: "alice" | "bob" = "alice"): RawMessage[] {
    return Array.from({ length: n }, (_, i) =>
      msg({
        at: start + i * 3600,
        from: i === 0 ? from : i % 2 === 0 ? "alice" : "bob",
        text: `m${i}`,
      }),
    );
  }

  it("absorbs a sub-era blip into the surrounding silence", () => {
    const chapters = buildChapters(
      normalize([
        ...burst(T0, 30),
        ...burst(T0 + 100 * DAY, 3, "bob"), // too small to be an era
        ...burst(T0 + 200 * DAY, 30),
      ]),
    );
    expect(chapters.map((c) => c.kind)).toEqual(["era", "silence", "era"]);
    const silence = chapters[1] as Extract<Chapter, { kind: "silence" }>;
    expect(silence).toMatchObject({ blipMessages: 3, blipCount: 1 });
    // The silence spans the whole dark stretch, not just up to the blip.
    expect(silence.days).toBeGreaterThan(190);
    // Every message is still accounted for somewhere in the timeline.
    const inEras = chapters
      .filter((c) => c.kind === "era")
      .reduce((n, c) => n + (c.kind === "era" ? c.messageCount : 0), 0);
    expect(inEras + silence.blipMessages).toBe(63);
  });

  it("attributes who went quiet and who came back across a silence", () => {
    const chapters = buildChapters(
      normalize([
        ...burst(T0, 21, "alice"), // odd count alternating from alice, so alice has the last word
        ...burst(T0 + 200 * DAY, 20, "bob"),
      ]),
    );
    const silence = chapters.find((c) => c.kind === "silence") as Extract<Chapter, { kind: "silence" }>;
    expect(silence.wentQuiet).toBe(0);
    expect(silence.revivedBy).toBe(1);
    expect(silence).toMatchObject({ blipMessages: 0, blipCount: 0 });
  });

  it("does not split a stretch of contact shorter than four months", () => {
    const chapters = buildChapters(normalize(burst(T0, 60)));
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ kind: "era", messageCount: 60, quiet: false });
  });

  it("flags a low-volume stretch between two eras as quiet rather than hiding it", () => {
    // Six months inside one stretch of contact: busy, busy, near-dead, near-dead,
    // busy, busy. The middle must survive in the timeline but not claim to be an era.
    const messages: RawMessage[] = [];
    const monthlyCounts = [300, 300, 5, 5, 300, 300];
    monthlyCounts.forEach((count, monthIndex) => {
      for (let i = 0; i < count; i++) {
        // Spread within the month, well inside SILENCE_MIN_DAYS of each other.
        const ts = Math.floor(new Date(2025, monthIndex, 1 + (i % 25), 12, i % 60, 0).getTime() / 1000);
        messages.push(msg({ at: ts, from: i % 2 === 0 ? "alice" : "bob", text: `m${i}` }));
      }
    });
    messages.sort((x, y) => Number(x.date_unixtime) - Number(y.date_unixtime));

    const chapters = buildChapters(normalize(messages));
    const eras = chapters.filter((c) => c.kind === "era") as Extract<Chapter, { kind: "era" }>[];
    expect(chapters.some((c) => c.kind === "silence")).toBe(false);
    expect(eras).toHaveLength(3);
    expect(eras.map((e) => e.quiet)).toEqual([false, true, false]);
    // Weekly boundaries can cut through a calendar month; the quiet messages
    // must remain present even though the old monthly detector returned exactly 10.
    expect(eras[1].messageCount).toBeGreaterThan(0);
    expect(eras[1].share).toBeLessThan(0.01);
    expect(eras.reduce((n, e) => n + e.messageCount, 0)).toBe(1210);
  });

  it("finds a semantic era change even when two people talk every day at the same rate", () => {
    const start = weekStart(T0);
    const messages: RawMessage[] = [];
    for (let week = 0; week < 16; week++) {
      for (let day = 0; day < 7; day++) {
        messages.push(msg({ at: start + (week * 7 + day) * DAY + 12 * 3600, from: "alice", text: "same volume" }));
        messages.push(msg({ at: start + (week * 7 + day) * DAY + 13 * 3600, from: "bob", text: "same reply" }));
      }
    }
    const semantics = Array.from({ length: 16 }, (_, week) => ({
      weekTs: start + week * 7 * DAY,
      embedding: week < 8 ? [1, 0] : [0, 1],
    }));

    const eras = buildChapters(normalize(messages), semantics).filter(
      (chapter): chapter is Extract<Chapter, { kind: "era" }> => chapter.kind === "era",
    );
    expect(eras).toHaveLength(2);
    expect(eras[0].messageCount).toBe(112);
    expect(eras[1].messageCount).toBe(112);
    expect(eras[1].change?.contributors.semantic).toBeGreaterThan(0.9);
  });

  it("keeps a corpus made entirely of blips rather than dropping it", () => {
    // Nothing clears MIN_ERA_MESSAGES, so there is no era to attach silences to.
    const messages = normalize([
      ...burst(T0, 3),
      ...burst(T0 + 100 * DAY, 3, "bob"),
    ]);
    expect(messages.length).toBeLessThan(MIN_ERA_MESSAGES);
    const chapters = buildChapters(messages);
    const counted = chapters.reduce(
      (n, c) => n + (c.kind === "era" ? c.messageCount : c.blipMessages),
      0,
    );
    expect(counted).toBe(6);
  });

  it("returns nothing for no messages", () => {
    expect(buildChapters([])).toEqual([]);
  });
});

describe("activeDates", () => {
  it("counts distinct local dates, not messages", () => {
    const dates = activeDates(
      normalize([
        msg({ at: at(0, 9), from: "alice", text: "a" }),
        msg({ at: at(0, 23), from: "bob", text: "b" }),
        msg({ at: at(2, 9), from: "alice", text: "c" }),
      ]),
    );
    expect(dates).toEqual(["2025-01-01", "2025-01-03"]);
  });

  it("keeps a late-evening message on its own local day", () => {
    // Under UTC formatting an 11pm message in a UTC+8 zone lands on the next day.
    expect(activeDates(normalize([
      msg({ at: at(0, 23, 30), from: "alice", text: "a" }),
      msg({ at: at(1, 1, 0), from: "bob", text: "b" }),
    ]))).toEqual(["2025-01-01", "2025-01-02"]);
  });
});
