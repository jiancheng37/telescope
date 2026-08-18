import { beforeEach, describe, expect, it } from "vitest";
import { buildLanguage, extractEmoji, nameAliases, tokenize } from "../src/domain/language";
import { parseExport } from "../src/domain/parse";
import type { Message, RawMessage } from "../src/domain/types";
import { DAY, T0, makeExport, msg, resetIds } from "./fixture";

beforeEach(resetIds);

function normalize(messages: RawMessage[]): Message[] {
  return parseExport(makeExport(messages)).messages;
}

describe("tokenize", () => {
  it("lowercases and drops one-character tokens", () => {
    expect(tokenize("I Am OK a b")).toEqual(["am", "ok"]);
  });

  it("keeps apostrophes inside words", () => {
    expect(tokenize("don't you're")).toEqual(["don't", "you're"]);
  });

  it("splits on digits and punctuation without emitting them", () => {
    expect(tokenize("meet at 6pm, ok?!")).toEqual(["meet", "at", "pm", "ok"]);
  });

  it("returns an empty array for text with no words", () => {
    expect(tokenize("😭😭 !!! 123")).toEqual([]);
  });
});

describe("extractEmoji", () => {
  it("counts a ZWJ sequence as one emoji", () => {
    expect(extractEmoji("🤷‍♀️")).toEqual(["🤷‍♀️"]);
  });

  it("keeps a skin-tone modifier attached to its base", () => {
    expect(extractEmoji("👍🏽")).toEqual(["👍🏽"]);
  });

  it("finds every emoji in mixed text", () => {
    expect(extractEmoji("omg 😭 no 😭 way 💔")).toEqual(["😭", "😭", "💔"]);
  });

  it("does not treat plain text or digits as emoji", () => {
    expect(extractEmoji("hello 123 #1 *")).toEqual([]);
  });
});

describe("nameAliases", () => {
  it("returns the first name plus short prefixes", () => {
    expect(nameAliases("Harper 🤗").sort()).toEqual(["har", "harp", "harper"]);
  });

  it("does not add prefixes to a short name", () => {
    expect(nameAliases("jc")).toEqual(["jc"]);
  });

  it("returns nothing when there is no usable name", () => {
    expect(nameAliases("🤗")).toEqual([]);
    expect(nameAliases("")).toEqual([]);
  });
});

describe("buildLanguage", () => {
  it("reports each person's top emoji with both people's counts on the same axes", () => {
    // The bug this guards: reporting side 1's top list with side 1's counts in
    // `counts.a`, so a card claims she used 😭 112 times when he did.
    const messages = normalize([
      ...Array.from({ length: 10 }, (_, i) => msg({ at: T0 + i * 60, from: "bob", text: "😭" })),
      msg({ at: T0 + 3600, from: "alice", text: "😭" }),
      ...Array.from({ length: 4 }, (_, i) => msg({ at: T0 + 7200 + i * 60, from: "alice", text: "💔" })),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);

    expect(lang.emoji.total).toEqual({ a: 5, b: 10 });
    // Bob's (side 1's) top list still reports side 0's count under `a`.
    expect(lang.emoji.top.b[0]).toEqual({ emoji: "😭", counts: { a: 1, b: 10 } });
    expect(lang.emoji.top.a[0]).toEqual({ emoji: "💔", counts: { a: 4, b: 0 } });
  });

  it("lists emoji used 5+ times by one person only as exclusive", () => {
    const messages = normalize([
      ...Array.from({ length: 6 }, (_, i) => msg({ at: T0 + i * 60, from: "alice", text: "🥰" })),
      ...Array.from({ length: 4 }, (_, i) => msg({ at: T0 + 3600 + i * 60, from: "alice", text: "❌" })),
      ...Array.from({ length: 6 }, (_, i) => msg({ at: T0 + 7200 + i * 60, from: "bob", text: "🤣" })),
      msg({ at: T0 + 10800, from: "bob", text: "🥰" }),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    // 🥰 is shared, ❌ is under the threshold, 🤣 qualifies.
    expect(lang.emoji.exclusive.a).toEqual([]);
    expect(lang.emoji.exclusive.b).toEqual(["🤣"]);
  });

  it("counts stickers by their emoji separately from emoji in text", () => {
    const messages = normalize([
      ...Array.from({ length: 3 }, (_, i) =>
        msg({ at: T0 + i * 60, from: "alice", media: "sticker", sticker: "😧" }),
      ),
      msg({ at: T0 + 3600, from: "bob", media: "sticker", sticker: "😊" }),
      msg({ at: T0 + 7200, from: "bob", text: "😧 lol" }),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    expect(lang.stickers.total).toEqual({ a: 3, b: 1 });
    expect(lang.stickers.top.a[0]).toEqual({ emoji: "😧", counts: { a: 3, b: 0 } });
    expect(lang.emoji.total).toEqual({ a: 0, b: 1 });
  });

  it("counts questions and the ones that went unanswered for six hours", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "you free?" }), // answered in a minute
      msg({ at: T0 + 60, from: "bob", text: "yeah" }),
      msg({ at: T0 + 120, from: "alice", text: "tonight?" }), // next reply is 2 days later
      msg({ at: T0 + 2 * DAY, from: "bob", text: "sorry just saw this" }),
      msg({ at: T0 + 2 * DAY + 60, from: "bob", text: "still on?" }), // never answered
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    expect(lang.questions.count).toEqual({ a: 2, b: 1 });
    expect(lang.questions.unansweredIn6h).toEqual({ a: 1, b: 1 });
    expect(lang.questions.rate.a).toBe(1); // both of Alice's two messages
    expect(lang.questions.rate.b).toBeCloseTo(1 / 3, 5);
  });

  it("attributes name use to the person who wrote the other's name", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "bob you there" }),
      msg({ at: T0 + 60, from: "alice", text: "BOB" }),
      msg({ at: T0 + 120, from: "bob", text: "here" }),
      // Saying your own name doesn't count as addressing the other person.
      msg({ at: T0 + 180, from: "bob", text: "bob is busy" }),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    expect(lang.addressesByName).toEqual({ a: 2, b: 0 });
  });

  it("does not match a name inside a longer word", () => {
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "bobbing along" }),
      msg({ at: T0 + 60, from: "bob", text: "ok" }),
    ]);
    expect(buildLanguage(messages, ["Alice", "Bob"]).addressesByName.a).toBe(0);
  });

  it("measures message length by code point, not UTF-16 unit", () => {
    // "😭" is a surrogate pair; counting `.length` would call this 2 characters.
    const messages = normalize([
      msg({ at: T0, from: "alice", text: "😭" }),
      msg({ at: T0 + 60, from: "bob", text: "ok" }),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    expect(lang.messageLengthPercentiles.a.max).toBe(1);
    expect(lang.messageLengthPercentiles.b.max).toBe(2);
  });

  it("scores distinctive vocabulary in the documented direction", () => {
    const messages = normalize([
      ...Array.from({ length: 40 }, (_, i) => msg({ at: T0 + i * 60, from: "alice", text: "bc gna ure" })),
      ...Array.from({ length: 40 }, (_, i) =>
        msg({ at: T0 + 7200 + i * 60, from: "bob", text: "okay yeah because" }),
      ),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    const z = new Map(lang.distinctive.map((d) => [d.word, d.z]));
    expect(z.get("bc")).toBeGreaterThan(0); // side 0 = Alice
    expect(z.get("okay")).toBeLessThan(0);
  });

  it("drops the contraction fragments a split leaves behind", () => {
    // Exports sometimes break "that's" into "that" + "'s", and "'s" clears the
    // tokenizer's two-character floor, so it has to be filtered by shape.
    const messages = normalize([
      ...Array.from({ length: 30 }, (_, i) =>
        msg({ at: T0 + i * 60, from: "alice", text: "that 's fine" }),
      ),
      ...Array.from({ length: 30 }, (_, i) => msg({ at: T0 + 7200 + i * 60, from: "bob", text: "ok" })),
    ]);
    expect(tokenize("that 's fine")).toContain("'s");
    for (const d of buildLanguage(messages, ["Alice", "Bob"]).distinctive) {
      expect(d.word.length).toBeGreaterThanOrEqual(2);
      expect(d.word.startsWith("'")).toBe(false);
    }
  });

  it("only reports idiolect markers with enough total use", () => {
    const messages = normalize([
      ...Array.from({ length: 12 }, (_, i) => msg({ at: T0 + i * 60, from: "alice", text: "bruh" })),
      ...Array.from({ length: 2 }, (_, i) => msg({ at: T0 + 3600 + i * 60, from: "bob", text: "lmfao" })),
    ]);
    const lang = buildLanguage(messages, ["Alice", "Bob"]);
    const tokens = lang.idiolect.map((m) => m.token);
    expect(tokens).toContain("bruh");
    expect(tokens).not.toContain("lmfao");
    const bruh = lang.idiolect.find((m) => m.token === "bruh")!;
    expect(bruh.counts).toEqual({ a: 12, b: 0 });
    expect(bruh.per1k.a).toBeCloseTo(1000, 5); // every one of Alice's 12 messages
    expect(bruh.per1k.b).toBe(0);
  });
});
