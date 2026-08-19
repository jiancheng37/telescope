/**
 * The deck's two jobs: refuse to make a card out of noise, and file each of the
 * model's readings next to the number it came from.
 *
 * The gating tests matter more than they look. `buildDeck` is the only thing
 * standing between a flat metric and a confident sentence on a full-screen card, and
 * the failure is silent — a chat where reply speed is identical still produces a
 * perfectly grammatical "one of you waits longer" if nothing checks.
 */
import { describe, expect, it } from "vitest";
import { analyze } from "../src/domain";
import type { Analysis } from "../src/domain/types";
import { assignEvidence, buildDeck, displayNames, interleaveFindings } from "../src/ui/cards";
import type { Cited } from "../src/ui/wire";
import { DAY, at, call, makeExport, msg, resetIds } from "./fixture";

/**
 * A chat with `n` alternating messages a minute apart, six per day, so no metric
 * comes out asymmetric.
 *
 * The `+ day` in the speaker choice is load-bearing: with plain `i % 2` Alice opens
 * every single session and closes none, which makes opens/closes 10–0 and is the
 * opposite of an even chat. Offsetting by the day flips who goes first each day.
 */
function evenChat(n = 60): Analysis {
  resetIds();
  const messages = Array.from({ length: n }, (_, i) => {
    const day = Math.floor(i / 6);
    return msg({
      at: at(day, 14, i % 6),
      from: (i + day) % 2 === 0 ? "alice" : "bob",
      text: `line ${i}`,
    });
  });
  return analyze(makeExport(messages)).analysis;
}

const ids = (a: Analysis) => buildDeck(a).map((c) => c.id);

describe("buildDeck", () => {
  it("always produces the scale card, whatever the chat looks like", () => {
    // Volume is context, not a finding, so it is not gated on anything.
    expect(ids(evenChat())).toContain("scale");
  });

  it("makes no asymmetry cards out of a perfectly even chat", () => {
    const got = ids(evenChat());
    for (const gated of ["turn-taking", "reactions", "register", "quote-replies", "revival", "names"]) {
      expect(got).not.toContain(gated);
    }
  });

  it("lists the flat metrics rather than dropping them", () => {
    const deck = buildDeck(evenChat());
    const flat = deck.find((c) => c.kind === "flat");
    expect(flat).toBeDefined();
    // Reply speed, questions, late night, opens/closes — all four came out even.
    expect(flat?.kind === "flat" && flat.items).toHaveLength(4);
  });

  it("cards turn-taking once one side actually runs on", () => {
    resetIds();
    const messages = [msg({ at: at(0, 14), from: "bob", text: "hey" })];
    // Alice sends eight in a row, then Bob answers once. Repeated so the means part.
    for (let d = 0; d < 6; d++) {
      for (let i = 0; i < 8; i++) {
        messages.push({ ...msg({ at: at(d, 15, i), from: "alice", text: `run ${i}` }) });
      }
      messages.push(msg({ at: at(d, 16), from: "bob", text: "ok" }));
    }
    const deck = buildDeck(analyze(makeExport(messages)).analysis);
    const card = deck.find((c) => c.id === "turn-taking");
    expect(card).toBeDefined();
    expect(card?.headline).toContain("Alice");
  });

  it("never shows a card the brief would have called flat", () => {
    // The two files share CARD_FLOORS precisely so this can't drift. If reply speed
    // is in the flat list it must not also be a headline anywhere in the deck.
    const deck = buildDeck(evenChat());
    const flat = deck.find((c) => c.kind === "flat");
    expect(flat?.kind === "flat" && flat.items.some((t) => t.startsWith("Reply speed"))).toBe(true);
    expect(deck.some((c) => c.id === "reply-speed")).toBe(false);
  });

  it("gives the concentration card no per-person split", () => {
    // Part-vs-rest in the two people's colours would claim something false, and the
    // colours mean one specific thing everywhere else in the deck.
    resetIds();
    const messages: ReturnType<typeof msg>[] = [];
    // One enormous burst plus a scattering, so the top-ten share clears the floor.
    for (let i = 0; i < 200; i++) {
      messages.push(msg({ at: at(0, 14, i % 60) + Math.floor(i / 60) * 3600, from: i % 2 ? "alice" : "bob", text: "x" }));
    }
    for (let d = 1; d < 30; d++) messages.push(msg({ at: at(d * 5, 10), from: d % 2 ? "alice" : "bob", text: "y" }));
    const card = buildDeck(analyze(makeExport(messages)).analysis).find((c) => c.id === "concentration");
    expect(card?.kind === "stat" && card.splits).toEqual([]);
  });

  it("keeps every card's id unique, since the deck keys on it", () => {
    resetIds();
    const messages = [
      msg({ at: at(0, 14), from: "bob", text: "hi" }),
      msg({ at: at(0, 14, 1), from: "alice", text: "hi", media: "video_message", duration: 5 }),
    ];
    for (let i = 0; i < 30; i++) {
      messages.push(msg({ at: at(1, 10, i), from: "alice", text: "a", media: "video_message", duration: 3 }));
    }
    // A long gap, so silence chapters and a revival card come into play too.
    messages.push(msg({ at: at(1, 10) + 200 * DAY, from: "bob", text: "still here" }));
    messages.push(msg({ at: at(1, 10) + 200 * DAY + 60, from: "alice", text: "yeah" }));
    const got = buildDeck(analyze(makeExport(messages)).analysis).map((c) => c.id);
    expect(new Set(got).size).toBe(got.length);
  });
});

describe("displayNames", () => {
  it("keeps the full name and strips decoration around it", () => {
    expect(displayNames(["harper 🤗", "jc"])).toEqual(["Harper", "Jc"]);
  });

  it("falls back rather than returning a stub of a name", () => {
    // A display name that is only an emoji leaves nothing to print.
    expect(displayNames(["🌸", "jc"])).toEqual(["Them", "Jc"]);
  });

  it("disambiguates only genuinely identical full names", () => {
    expect(displayNames(["Alex Chen", "alex"])).toEqual(["Alex Chen", "Alex"]);
    expect(displayNames(["Alex Chen", "alex chen"])).toEqual(["Alex Chen (1)", "Alex chen (2)"]);
  });
});

describe("interleaveFindings", () => {
  const deck = buildDeck(evenChat());

  it("files a finding onto the card whose id it names", () => {
    const { slots, leftover } = interleaveFindings(deck, [{ metric: "scale", id: "f1" }]);
    expect(slots.get("scale")).toHaveLength(1);
    expect(leftover).toEqual([]);
  });

  it("matches a metric the model wrote loosely", () => {
    // The brief says "scale"; a model may well write "Scale of the chat".
    const { slots } = interleaveFindings(deck, [{ metric: "Scale of the chat", id: "f1" }]);
    expect(slots.get("scale")).toHaveLength(1);
  });

  it("keeps a finding that matches nothing instead of dropping it", () => {
    const { slots, leftover } = interleaveFindings(deck, [{ metric: "vibes", id: "f1" }]);
    expect(slots.size).toBe(0);
    expect(leftover.map((f) => f.id)).toEqual(["f1"]);
  });

  it("files the retained metric strings from the first live run", () => {
    // Calls and name-use were deliberately removed from the product. The retained
    // observed strings must still land next to their deterministic evidence.
    const observed = [
      "who comes back",
      "turn-taking",
      "message volume and length",
      "emoji vs stickers",
      "video-notes",
    ];
    // A deck rich enough that all retained metrics have a card to land on.
    resetIds();
    const messages = [msg({ at: at(0, 14), from: "bob", text: "hi Alice" })];
    for (let burst = 0; burst < 6; burst++) {
      const day = burst * 40;
      for (let i = 0; i < 8; i++) {
        messages.push(
          msg({
            at: at(day, 15, i),
            from: "alice",
            // Alice opens each burst — she is the one who revives — and names Bob.
            text: i === 0 ? "Bob you alive" : "more",
            ...(i === 7 ? { media: "video_message", duration: 4 } : {}),
            ...(i === 6 ? { media: "sticker", sticker: "😭" } : {}),
          }),
        );
      }
      messages.push(msg({ at: at(day, 16), from: "bob", text: "ok 😭😭😭", replyTo: 2 }));
      messages.push(call(at(day, 17), burst % 2 ? "alice" : "bob", 600));
    }
    const deck = buildDeck(analyze(makeExport(messages)).analysis);
    const deckIds = new Set<string>(deck.map((c) => c.id));
    // The fixture is only meaningful if it actually produced every retained card —
    // otherwise a metric could "land" by virtue of there being nowhere to land.
    for (const id of ["revival", "turn-taking", "scale", "register", "video-notes"]) {
      expect(deckIds, `fixture should produce a ${id} card`).toContain(id);
    }
    for (const removed of ["quote-replies", "calls", "names"]) expect(deckIds).not.toContain(removed);

    const { slots, leftover } = interleaveFindings(
      deck,
      observed.map((metric, i) => ({ metric, id: `f${i}` })),
    );
    // Nothing may fall through. A leftover here is a reading rendered on its own,
    // away from the number it is about — the one failure the design exists to avoid.
    expect(leftover).toEqual([]);
    expect(slots.size).toBe(5);
  });

  it("stacks several findings on one card in the order given", () => {
    const { slots } = interleaveFindings(deck, [
      { metric: "scale", id: "first" },
      { metric: "scale", id: "second" },
    ]);
    expect(slots.get("scale")?.map((f) => f.id)).toEqual(["first", "second"]);
  });
});

describe("assignEvidence", () => {
  const cited = (messageId: number, quote: string): Cited => ({
    quote,
    body: quote,
    who: 0,
    ts: 1_700_000_000 + messageId,
    messageId,
  });

  it("takes the front of each list and nothing else", () => {
    const got = assignEvidence([
      { key: "x", evidence: [cited(1, "a"), cited(2, "b"), cited(3, "c")], want: 2 },
    ]);
    expect(got.get("x")?.map((c) => c.quote)).toEqual(["a", "b"]);
  });

  it("does not reallocate a quote away from a card that already showed it", () => {
    // This is the test that would fail if the shown-once rule were reintroduced.
    // It looks like the wrong behaviour and is the right one: the second card cites
    // #1 and #2 because they are consecutive, and one of them alone shows no run.
    // See the comment on assignEvidence — the fix belongs in the reading prompt.
    const run = [cited(1, "wait"), cited(2, "no actually"), cited(3, "im here")];
    const got = assignEvidence([
      { key: "scale", evidence: [cited(1, "wait"), cited(2, "no actually"), cited(9, "filler")], want: 2 },
      { key: "turn-taking", evidence: run, want: 2 },
    ]);
    expect(got.get("turn-taking")?.map((c) => c.messageId)).toEqual([1, 2]);
  });

  it("gives a card fewer quotes than it asked for rather than padding", () => {
    const got = assignEvidence([{ key: "naming", evidence: [cited(1, "yy")], want: 3 }]);
    expect(got.get("naming")).toHaveLength(1);
  });
});
