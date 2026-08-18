/**
 * The payload builder.
 *
 * Worth testing carefully for one reason: `seq` is the contract between the model
 * and the citation checker. If a seq shifts, every quote in the reading points at
 * the wrong message and the checker either drops good cards or — worse — happens
 * to find the quote somewhere else and validates a claim about the wrong line.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { parseExport } from "../src/domain/parse";
import { buildCorpus, shortLabels } from "../src/llm/corpus";
import { at, call, DAY, makeExport, msg, resetIds, T0 } from "./fixture";

beforeEach(resetIds);

const corpusOf = (messages: Parameters<typeof makeExport>[0]) =>
  buildCorpus(parseExport(makeExport(messages)));

describe("shortLabels", () => {
  it("takes the first word and strips emoji and punctuation", () => {
    expect(shortLabels(["harper 🤗", "JC Tan"])).toEqual(["harper", "jc"]);
  });

  it("falls back when a name has no usable letters", () => {
    expect(shortLabels(["🤗", "🙂"])).toEqual(["them", "you"]);
  });

  it("falls back when the first word is a single character", () => {
    // "J Smith" would otherwise label a whole conversation "j".
    expect(shortLabels(["J Smith", "Bob"])).toEqual(["them", "bob"]);
  });

  it("disambiguates two people whose short labels collide", () => {
    // Without this the payload has two speakers with the same name and nothing
    // the model reads can be attributed.
    expect(shortLabels(["Alex Chen", "Alex Wong"])).toEqual(["alex1", "alex2"]);
  });
});

describe("buildCorpus line numbering", () => {
  it("numbers from 1, contiguously, in time order", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "one" }),
      msg({ at: T0 + 10, from: "bob", text: "two" }),
      msg({ at: T0 + 20, from: "alice", text: "three" }),
    ]);
    expect(c.lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(c.lines.map((l) => l.body)).toEqual(["one", "two", "three"]);
  });

  it("keeps the real message id alongside the seq", () => {
    // The seq is what the model cites; the message id is what lets a citation be
    // traced back to the export the user actually has.
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "one" }),
      msg({ at: T0 + 10, from: "bob", text: "two" }),
    ]);
    expect(c.lines.map((l) => l.messageId)).toEqual([1, 2]);
  });

  it("labels each line with the side that sent it", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "hi" }),
      msg({ at: T0 + 10, from: "bob", text: "hello" }),
    ]);
    expect(c.labels).toEqual(["alice", "bob"]);
    expect(c.text).toContain("#1 alice: hi");
    expect(c.text).toContain("#2 bob: hello");
  });

  it("interleaves calls with messages by timestamp and gives them a seq", () => {
    // A call is part of the conversation. Listing calls separately would make the
    // shape of an evening unreadable.
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "pick up" }),
      call(T0 + 30, "bob", 2520),
      msg({ at: T0 + 60, from: "bob", text: "that was long" }),
    ]);
    expect(c.lines.map((l) => l.kind)).toEqual(["text", "call", "text"]);
    expect(c.lines[1]).toMatchObject({ seq: 2, messageId: null, who: 1, body: "[call 42m]" });
  });
});

describe("buildCorpus body rendering", () => {
  /**
   * The message under test, with an anchor from the other side — `parseExport`
   * refuses an export where only one person ever spoke, and rightly so.
   */
  const bodyOf = (m: Parameters<typeof msg>[0]) =>
    corpusOf([msg({ at: T0 - 60, from: "bob", text: "anchor" }), msg(m)]).lines[1];

  it("renders a sticker with its emoji", () => {
    expect(bodyOf({ at: T0, from: "alice", media: "sticker", sticker: "😭" })).toMatchObject({
      kind: "sticker",
      body: "[sticker 😭]",
    });
  });

  it("renders a sticker with no emoji without a dangling space", () => {
    expect(bodyOf({ at: T0, from: "alice", media: "sticker" }).body).toBe("[sticker]");
  });

  it("renders voice notes and telebubbles with a human duration", () => {
    expect(bodyOf({ at: T0, from: "alice", media: "voice_message", duration: 80 }).body).toBe("[voice note 1m20s]");
    expect(bodyOf({ at: T0, from: "alice", media: "video_message", duration: 12 }).body).toBe("[telebubble 12s]");
    // A whole number of minutes should not read "3m00s".
    expect(bodyOf({ at: T0, from: "alice", media: "voice_message", duration: 180 }).body).toBe("[voice note 3m]");
  });

  it("renders a photo as a photo, not a generic attachment", () => {
    // Telegram gives a photo no `media_type` at all, so this is the case that
    // silently degrades: 47 photos reading as `[attachment]` loses the fact that
    // one of them communicates in pictures.
    expect(bodyOf({ at: T0, from: "alice", photo: "photos/photo_1@01.jpg" })).toMatchObject({
      kind: "photo",
      body: "[photo]",
    });
  });

  it("keeps a caption attached to the photo it captions", () => {
    // Rendered as bare text, the model reads this as an ordinary message and the
    // picture is gone without anything marking its absence.
    expect(bodyOf({ at: T0, from: "alice", photo: "photos/p.jpg", text: "look at this" }).body).toBe(
      "[photo] look at this",
    );
  });

  it("treats an image sent as a file as a photo", () => {
    expect(bodyOf({ at: T0, from: "alice", file: "files/x.jpeg", mime: "image/jpeg" }).body).toBe("[photo]");
  });

  it("does not mistake a sticker for a photo", () => {
    // Stickers carry `image/webp`, so a mime-type check that ignores `media_type`
    // would reclassify every sticker in the chat.
    expect(bodyOf({ at: T0, from: "alice", media: "sticker", sticker: "🙂", mime: "image/webp" }).body).toBe(
      "[sticker 🙂]",
    );
  });

  it("renders a non-image file as an attachment, caption and all", () => {
    expect(bodyOf({ at: T0, from: "alice", file: "files/x.pdf", mime: "application/pdf", text: "the form" }).body).toBe(
      "[attachment] the form",
    );
  });

  it("renders an empty message with no media as an attachment", () => {
    expect(bodyOf({ at: T0, from: "alice", text: "" }).body).toBe("[attachment]");
  });

  it("collapses newlines so one message stays one line", () => {
    // The whole seq scheme rests on line-per-message. A multi-line message would
    // shift every id after it out of alignment with the payload the model read.
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "first\n\nsecond\nthird" }),
      msg({ at: T0 + 10, from: "bob", text: "after" }),
    ]);
    expect(c.lines[0].body).toBe("first / second / third");
    expect(c.text.split("\n").filter((l) => l.startsWith("#"))).toHaveLength(2);
  });

  it("renders an unanswered call with its reason", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "hi" }),
      msg({ at: T0 + 10, from: "bob", text: "hello" }),
      call(T0 + 30, "alice", 0, "busy"),
    ]);
    expect(c.lines[2].body).toBe("[call not answered: busy]");
  });
});

describe("buildCorpus structure markers", () => {
  it("opens with a session header and no silence marker", () => {
    const c = corpusOf([
      msg({ at: at(0, 12), from: "alice", text: "hi" }),
      msg({ at: at(0, 12, 1), from: "bob", text: "hello" }),
    ]);
    expect(c.text.split("\n")[0]).toBe("== 2025-01-01 Wed 12:00 ==");
    expect(c.text).not.toContain("silence");
  });

  it("starts a new session after the gap threshold and not before", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 44 * 60, from: "bob", text: "b" }),
      msg({ at: T0 + 44 * 60 + 46 * 60, from: "alice", text: "c" }),
    ]);
    expect(c.text.match(/^== /gm)).toHaveLength(2);
  });

  it("marks a gap of days in days", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 9 * DAY, from: "bob", text: "b" }),
    ]);
    expect(c.text).toContain("~~ 9 days of silence ~~");
  });

  it("switches to months once days stop being legible", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 400 * DAY, from: "bob", text: "b" }),
    ]);
    expect(c.text).toContain("~~ 13.1 months of silence ~~");
  });

  it("does not mark a gap under a day, even across a session boundary", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 3 * 3600, from: "bob", text: "b" }),
    ]);
    expect(c.text).not.toContain("silence");
    expect(c.text.match(/^== /gm)).toHaveLength(2);
  });
});

describe("seqAt", () => {
  const c = corpusOf([
    msg({ at: T0, from: "alice", text: "a" }),
    msg({ at: T0 + 100, from: "bob", text: "b" }),
    msg({ at: T0 + 200, from: "alice", text: "c" }),
    msg({ at: T0 + 300, from: "bob", text: "d" }),
  ]);

  it("returns the first seq at or after a timestamp", () => {
    expect(c.seqAt(T0)).toBe(1);
    expect(c.seqAt(T0 + 100)).toBe(2);
    expect(c.seqAt(T0 + 150)).toBe(3);
  });

  it("clamps before the start and after the end", () => {
    // An era boundary can sit outside the message range; returning something in
    // range keeps the brief's #from–#to citable rather than nonsense.
    expect(c.seqAt(T0 - 10_000)).toBe(1);
    expect(c.seqAt(T0 + 10_000)).toBe(4);
  });
});

describe("bySeq", () => {
  it("indexes every line and nothing else", () => {
    const c = corpusOf([
      msg({ at: T0, from: "alice", text: "a" }),
      msg({ at: T0 + 10, from: "bob", text: "b" }),
    ]);
    expect(c.bySeq.size).toBe(2);
    expect(c.bySeq.get(1)?.body).toBe("a");
    expect(c.bySeq.get(3)).toBeUndefined();
    expect(c.bySeq.get(0)).toBeUndefined();
  });
});
