import { beforeEach, describe, expect, it } from "vitest";
import { ParseError, flattenText, parseExport } from "../src/domain/parse";
import type { RawExport, RawMessage } from "../src/domain/types";
import { ALICE, BOB, DAY, T0, call, makeExport, msg, resetIds } from "./fixture";

beforeEach(resetIds);

describe("flattenText", () => {
  it("reads a plain string", () => {
    expect(flattenText(msg({ at: T0, from: "alice", text: "hello" }))).toBe("hello");
  });

  it("joins an array mixing bare strings and entity objects", () => {
    const m = msg({
      at: T0,
      from: "alice",
      text: ["look at ", { type: "link", text: "example.com" }, " ok"],
    });
    expect(flattenText(m)).toBe("look at example.com ok");
  });

  it("prefers text_entities over text when both are present", () => {
    const m = msg({ at: T0, from: "alice", text: "ignored", entities: [{ type: "plain", text: "used" }] });
    expect(flattenText(m)).toBe("used");
  });

  it("returns empty string for a message with no text at all", () => {
    const m: RawMessage = { id: 1, type: "message", date: "", date_unixtime: String(T0) };
    expect(flattenText(m)).toBe("");
  });

  it("survives entity objects with a missing text field", () => {
    const m = msg({ at: T0, from: "alice", text: ["a", { type: "mention" } as never, "b"] });
    expect(flattenText(m)).toBe("ab");
  });
});

describe("side assignment", () => {
  it("puts the counterpart (matching the top-level id) on side 0", () => {
    const p = parseExport(
      makeExport([
        msg({ at: T0, from: "alice", text: "hi" }),
        msg({ at: T0 + 60, from: "bob", text: "hey" }),
      ]),
    );
    expect(p.chat.participants).toEqual(["Alice", "Bob"]);
    expect(p.messages[0].who).toBe(0);
    expect(p.messages[1].who).toBe(1);
    expect(p.selfSide).toBe(1);
  });

  it("keeps the counterpart on side 0 even when they sent far fewer messages", () => {
    // Frequency ranking would put Bob first; the top-level id must override it.
    const messages = [msg({ at: T0, from: "alice", text: "hi" })];
    for (let i = 1; i <= 20; i++) messages.push(msg({ at: T0 + i * 60, from: "bob", text: "..." }));
    const p = parseExport(makeExport(messages));
    expect(p.chat.participants[0]).toBe("Alice");
    expect(p.selfSide).toBe(1);
    expect(p.messages.filter((m) => m.who === 0)).toHaveLength(1);
  });

  it("falls back to frequency and reports selfSide null when the id matches neither", () => {
    const ex: RawExport = {
      ...makeExport([
        msg({ at: T0, from: "alice", text: "hi" }),
        msg({ at: T0 + 60, from: "bob", text: "a" }),
        msg({ at: T0 + 120, from: "bob", text: "b" }),
      ]),
      id: 999999,
    };
    const p = parseExport(ex);
    expect(p.selfSide).toBeNull();
    expect(p.chat.participants[0]).toBe("Bob"); // most frequent
  });
});

describe("message and call extraction", () => {
  it("pulls calls out of service messages and counts them as skipped", () => {
    const p = parseExport(
      makeExport([
        msg({ at: T0, from: "alice", text: "call me" }),
        call(T0 + 60, "bob", 300),
        call(T0 + 3600, "alice", 0, "missed"),
        msg({ at: T0 + 7200, from: "bob", text: "sorry" }),
      ]),
    );
    expect(p.messages).toHaveLength(2);
    expect(p.skipped.serviceMessages).toBe(2);
    expect(p.calls).toEqual([
      { id: 2, ts: T0 + 60, by: 1, durationSeconds: 300, discardReason: undefined },
      { id: 3, ts: T0 + 3600, by: 0, durationSeconds: 0, discardReason: "missed" },
    ]);
  });

  it("skips third parties rather than assigning them a side", () => {
    const stranger = msg({ at: T0 + 30, from: "alice", text: "who?" });
    stranger.from_id = "user7777";
    stranger.from = "Stranger";
    const p = parseExport(
      makeExport([
        msg({ at: T0, from: "alice", text: "hi" }),
        stranger,
        msg({ at: T0 + 60, from: "bob", text: "hey" }),
      ]),
    );
    expect(p.messages).toHaveLength(2);
    expect(p.skipped.thirdParties).toBe(1);
  });

  it("skips undated messages and sorts the rest ascending", () => {
    const undated = msg({ at: T0, from: "alice", text: "when?" });
    undated.date_unixtime = "not-a-number";
    const p = parseExport(
      makeExport([
        msg({ at: T0 + 2 * DAY, from: "bob", text: "third" }),
        undated,
        msg({ at: T0, from: "alice", text: "first" }),
        msg({ at: T0 + DAY, from: "bob", text: "second" }),
      ]),
    );
    expect(p.skipped.noTimestamp).toBe(1);
    expect(p.messages.map((m) => m.text)).toEqual(["first", "second", "third"]);
  });

  it("carries the behavioural flags through", () => {
    const first = msg({ at: T0, from: "alice", text: "a" });
    const p = parseExport(
      makeExport([
        first,
        msg({ at: T0 + 60, from: "bob", text: "b", replyTo: first.id, edited: true }),
        msg({ at: T0 + 120, from: "bob", text: "c", forwardedFrom: "Someone" }),
        msg({ at: T0 + 180, from: "alice", sticker: "😭", media: "sticker", file: "video_files/sticker.webm" }),
      ]),
    );
    expect(p.messages[1]).toMatchObject({ isReply: true, isEdited: true, isForward: false });
    expect(p.messages[2]).toMatchObject({ isForward: true, isReply: false });
    expect(p.messages[3]).toMatchObject({ stickerEmoji: "😭", mediaType: "sticker", assetPath: "video_files/sticker.webm" });
  });
});

describe("rejections", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["a non-object", "nope", /isn't a Telegram export/],
    ["a file with no messages array", { name: "x", type: "personal_chat", id: 1 }, /No `messages` array/],
    ["an empty export", makeExport([]), /no messages in it/],
    [
      "a group chat",
      { ...makeExport([msg({ at: T0, from: "alice", text: "hi" })]), type: "private_group" },
      /not a one-on-one chat/,
    ],
    [
      "a chat only one person spoke in",
      makeExport([
        msg({ at: T0, from: "alice", text: "hi" }),
        msg({ at: T0 + 60, from: "alice", text: "hello?" }),
      ]),
      /Only one person/,
    ],
  ];

  for (const [what, input, message] of cases) {
    it(`rejects ${what}`, () => {
      expect(() => parseExport(input)).toThrow(ParseError);
      expect(() => parseExport(input)).toThrow(message);
    });
  }

  it("rejects an export where every real message was filtered out", () => {
    const ex = makeExport([
      msg({ at: T0, from: "alice", text: "hi" }),
      msg({ at: T0 + 60, from: "bob", text: "hey" }),
    ]);
    for (const m of ex.messages) m.date_unixtime = "0";
    expect(() => parseExport(ex)).toThrow(/Nothing left after filtering/);
  });

  it("attaches a hint where one helps", () => {
    try {
      parseExport({ name: "x", type: "personal_chat", id: 1 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).hint).toMatch(/result\.json/);
    }
  });
});

describe("ids used for identity", () => {
  it("does not confuse two people who share a display name", () => {
    const twin = msg({ at: T0 + 60, from: "bob", text: "hey" });
    twin.from = "Alice"; // same display name, different id
    const p = parseExport(makeExport([msg({ at: T0, from: "alice", text: "hi" }), twin]));
    expect(p.messages[0].who).not.toBe(p.messages[1].who);
    expect(ALICE).not.toBe(BOB);
  });
});
