import { beforeEach, describe, expect, it } from "vitest";
import { analyze } from "../src/domain/analyze";
import { ALICE, BOB, DAY, T0, at, call, makeExport, msg, resetIds } from "./fixture";

beforeEach(resetIds);

describe("volume", () => {
  it("pads partial first and last years to full calendar years", () => {
    const sep2023 = Math.floor(new Date(2023, 8, 15, 12).getTime() / 1000);
    const mar2024 = Math.floor(new Date(2024, 2, 10, 12).getTime() / 1000);
    const { analysis } = analyze(
      makeExport([
        msg({ at: sep2023, from: "alice", text: "hello" }),
        msg({ at: mar2024, from: "bob", text: "hello back" }),
      ]),
    );

    expect(analysis.volume.monthly).toHaveLength(24);
    expect(analysis.volume.monthly[0]).toMatchObject({ month: "2023-01", counts: { a: 0, b: 0 } });
    expect(analysis.volume.monthly[8]).toMatchObject({ month: "2023-09", counts: { a: 1, b: 0 } });
    expect(analysis.volume.monthly[14]).toMatchObject({ month: "2024-03", counts: { a: 0, b: 1 } });
    expect(analysis.volume.monthly[23]).toMatchObject({ month: "2024-12", counts: { a: 0, b: 0 } });
  });

  it("counts characters by code point so emoji don't double", () => {
    const { analysis } = analyze(
      makeExport([
        msg({ at: T0, from: "alice", text: "😭😭" }), // 2 code points, 4 UTF-16 units
        msg({ at: T0 + 60, from: "bob", text: "ok" }),
      ]),
    );
    expect(analysis.volume.chars).toEqual({ a: 2, b: 2 });
  });

  it("counts words by whitespace and ignores empty messages", () => {
    const { analysis } = analyze(
      makeExport([
        msg({ at: T0, from: "alice", text: "three little words" }),
        msg({ at: T0 + 60, from: "alice", media: "sticker", sticker: "😭" }), // no text
        msg({ at: T0 + 120, from: "bob", text: "  spaced   out  " }),
      ]),
    );
    expect(analysis.volume.words).toEqual({ a: 3, b: 2 });
    expect(analysis.volume.messages).toEqual({ a: 2, b: 1 });
  });

  it("reports the message ratio and per-active-day rate", () => {
    const { analysis } = analyze(
      makeExport([
        msg({ at: at(0, 12), from: "alice", text: "a" }),
        msg({ at: at(0, 13), from: "alice", text: "b" }),
        msg({ at: at(1, 12), from: "bob", text: "c" }),
      ]),
    );
    expect(analysis.volume.messageRatio).toBe(2);
    expect(analysis.span.activeDays).toBe(2);
    expect(analysis.volume.perActiveDay).toBe(1.5);
  });
});

describe("behaviour", () => {
  it("counts quote-replies, edits, forwards and stickers per side", () => {
    const first = msg({ at: T0, from: "alice", text: "a" });
    const { analysis } = analyze(
      makeExport([
        first,
        msg({ at: T0 + 60, from: "bob", text: "b", replyTo: first.id }),
        msg({ at: T0 + 120, from: "bob", text: "c", replyTo: first.id, edited: true }),
        msg({ at: T0 + 180, from: "alice", text: "d", forwardedFrom: "Channel" }),
        msg({ at: T0 + 240, from: "alice", media: "sticker", sticker: "😧" }),
      ]),
    );
    expect(analysis.behaviour.quoteReplies).toEqual({ a: 0, b: 2 });
    expect(analysis.behaviour.edits).toEqual({ a: 0, b: 1 });
    expect(analysis.behaviour.forwards).toEqual({ a: 1, b: 0 });
    expect(analysis.behaviour.stickers).toEqual({ a: 1, b: 0 });
  });

  it("totals voice and video note seconds separately", () => {
    const { analysis } = analyze(
      makeExport([
        msg({ at: T0, from: "alice", media: "video_message", duration: 30 }),
        msg({ at: T0 + 60, from: "alice", media: "video_message", duration: 12 }),
        msg({ at: T0 + 120, from: "bob", media: "voice_message", duration: 45 }),
      ]),
    );
    expect(analysis.behaviour.videoNotes.a).toEqual({ count: 2, totalSeconds: 42 });
    expect(analysis.behaviour.videoNotes.b).toEqual({ count: 0, totalSeconds: 0 });
    expect(analysis.behaviour.voiceNotes.b).toEqual({ count: 1, totalSeconds: 45 });
  });

  it("credits a reaction to whoever the export says gave it", () => {
    const { analysis } = analyze(
      makeExport([
        msg({
          at: T0,
          from: "alice",
          text: "a",
          reactions: [{ type: "emoji", emoji: "❤️", count: 1, recent: [{ from_id: BOB }] }],
        }),
        // A reaction on your own message: the "must be the other person" guess
        // would credit this to Alice.
        msg({
          at: T0 + 60,
          from: "bob",
          text: "b",
          reactions: [{ type: "emoji", emoji: "😭", count: 1, recent: [{ from_id: BOB }] }],
        }),
      ]),
    );
    expect(analysis.behaviour.reactionsReceived).toEqual({ a: 1, b: 1 });
    expect(analysis.behaviour.reactionsGiven).toEqual({ a: 0, b: 2 });
  });

  it("falls back to the other side when an old export omits who reacted", () => {
    const { analysis } = analyze(
      makeExport([
        msg({ at: T0, from: "alice", text: "a", reactions: [{ emoji: "❤️", count: 1, recent: [{}] }] }),
        msg({ at: T0 + 60, from: "bob", text: "b" }),
      ]),
    );
    expect(analysis.behaviour.reactionsGiven).toEqual({ a: 0, b: 1 });
    expect(ALICE).toBeTruthy();
  });

  it("splits call minutes and tallies discard reasons", () => {
    const { analysis } = analyze(
      makeExport([
        msg({ at: T0, from: "alice", text: "pick up" }),
        call(T0 + 60, "bob", 600, "hangup"),
        call(T0 + 3600, "bob", 0, "busy"),
        call(T0 + 7200, "alice", 120, "hangup"),
        msg({ at: T0 + 8000, from: "bob", text: "later" }),
      ]),
    );
    const { calls } = analysis.behaviour;
    expect(calls.total).toBe(3);
    expect(calls.initiated).toEqual({ a: 1, b: 2 });
    expect(calls.minutes.a).toBeCloseTo(2, 5);
    expect(calls.minutes.b).toBeCloseTo(10, 5);
    expect(calls.totalMinutes).toBeCloseTo(12, 5);
    expect(calls.discardReasons).toEqual({ hangup: 2, busy: 1 });
  });
});

describe("concentration", () => {
  it("reports how much of the chat lives in its busiest sessions and days", () => {
    // Two sessions on one day (90 messages) and one message on another day.
    const messages = [
      ...Array.from({ length: 60 }, (_, i) => msg({ at: at(0, 9) + i * 60, from: i % 2 ? "bob" : "alice", text: "x" })),
      ...Array.from({ length: 30 }, (_, i) => msg({ at: at(0, 20) + i * 60, from: i % 2 ? "bob" : "alice", text: "y" })),
      msg({ at: at(5, 12), from: "alice", text: "z" }),
    ];
    const { analysis } = analyze(makeExport(messages));
    expect(analysis.concentration.sessions).toBe(3);
    const top1 = analysis.concentration.topSessionShare.find((t) => t.n === 1)!;
    expect(top1).toMatchObject({ messages: 60 });
    expect(top1.share).toBeCloseTo(60 / 91, 5);
    // Asking for more sessions than exist saturates at the whole corpus.
    expect(analysis.concentration.topSessionShare.find((t) => t.n === 50)!.share).toBe(1);
    expect(analysis.concentration.busiestDays[0]).toMatchObject({ date: "2025-01-01", total: 90 });
    expect(analysis.concentration.busiestDays[0].counts).toEqual({ a: 45, b: 45 });
  });
});

describe("analyze end to end", () => {
  it("produces a self-consistent analysis of a small chat", () => {
    const messages = [
      ...Array.from({ length: 40 }, (_, i) =>
        msg({ at: T0 + i * 3600, from: i % 3 === 0 ? "bob" : "alice", text: `early ${i}` }),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        msg({ at: T0 + 200 * DAY + i * 3600, from: i % 2 ? "bob" : "alice", text: `late ${i}` }),
      ),
    ];
    const { analysis, parsed } = analyze(makeExport(messages));

    expect(analysis.volume.total).toBe(80);
    expect(analysis.volume.messages.a + analysis.volume.messages.b).toBe(80);
    expect(parsed.selfSide).toBe(1);
    expect(analysis.chat.participants).toEqual(["Alice", "Bob"]);

    // Every message lands in exactly one chapter or one absorbed blip.
    const accounted = analysis.chapters.reduce(
      (n, c) => n + (c.kind === "era" ? c.messageCount : c.blipMessages),
      0,
    );
    expect(accounted).toBe(80);

    // Every message lands in exactly one session and one episode.
    expect(analysis.sessions.reduce((n, s) => n + s.messageCount, 0)).toBe(80);
    expect(analysis.episodes.reduce((n, e) => n + e.messageCount, 0)).toBe(80);
    expect(analysis.episodes).toHaveLength(2);

    // Shares are shares.
    for (const c of analysis.chapters) {
      if (c.kind === "era") expect(c.share).toBeGreaterThan(0);
    }
    expect(analysis.rhythm.dormantShare).toBeGreaterThan(0);
    expect(analysis.rhythm.dormantShare).toBeLessThanOrEqual(1);
  });
});
