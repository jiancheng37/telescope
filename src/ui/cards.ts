/**
 * Turns an `Analysis` into the deck the reader scrolls through.
 *
 * This is the UI twin of `src/llm/brief.ts` and follows the same rule: a metric
 * with no per-person version is warm-up, and a difference that doesn't clear
 * `isAsymmetric` is not a card. Both files read the floors from
 * `CARD_FLOORS` so the deck can never show something the brief called flat.
 *
 * Pure — no React, no DOM, no network. It runs in the browser on a file the user
 * dropped, which is the point: the whole deterministic wrapped is available with
 * nothing leaving the machine.
 */
import type { MetricKey } from "@/domain/metrics";
import { CARD_FLOORS, isAsymmetric } from "@/domain/stats";
import type { Analysis, Chapter, Pair } from "@/domain/types";
import type { Cited } from "./wire";

// ------------------------------------------------------------------ formatting

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString();

/** Seconds at a human scale — a median of 3 seconds should not read "0.0h". */
export function dur(sec: number): string {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${Math.round(sec / 86400)} days`;
}

export function monthYear(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en", { month: "short", year: "numeric" });
}

/**
 * A short, human display name. The export carries emoji and surnames that make a
 * mess of a headline, but unlike the payload labels these are shown to the person
 * who was in the conversation, so they keep their capitals.
 */
export function displayNames(participants: [string, string]): [string, string] {
  const clean = (raw: string, fallback: string) => {
    const first = raw.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim().split(/\s+/)[0] ?? "";
    if (first.length < 2) return fallback;
    return first[0].toUpperCase() + first.slice(1);
  };
  const a = clean(participants[0], "Them");
  const b = clean(participants[1], "You");
  return a === b ? [`${a} (1)`, `${b} (2)`] : [a, b];
}

// ----------------------------------------------------------------- card model

/** Two numbers that are the same measurement taken twice, once per person. */
export interface Split {
  label: string;
  a: string;
  b: string;
  /** raw magnitudes, used for the bar. Equal values render as a half-and-half bar. */
  weights: [number, number];
}

interface Base {
  /**
   * Also the slot the model's reading is filed into, so it has to be a metric key
   * the brief actually showed the model. Typed rather than `string` because the
   * failure is silent: a card id of "emoji-stickers" would render perfectly and
   * just never receive its reading. `flat` is the one card with no metric behind it.
   */
  id: MetricKey | "flat";
  /** small label above the headline */
  kicker: string;
  headline: string;
  detail: string;
}

export type DeckCard =
  | (Base & { kind: "stat"; splits: Split[] })
  | (Base & { kind: "words"; words: Pair<Array<{ word: string; mine: number; theirs: number }>> })
  | (Base & { kind: "timeline"; chapters: Chapter[] })
  | (Base & { kind: "flat"; items: string[] });

const split = (label: string, a: number, b: number, fmt: (n: number) => string = num): Split => ({
  label,
  a: fmt(a),
  b: fmt(b),
  weights: [a, b],
});

// ------------------------------------------------------------------ the deck

export function buildDeck(analysis: Analysis): DeckCard[] {
  const [A, B] = displayNames(analysis.chat.participants);
  const cards: DeckCard[] = [];
  const v = analysis.volume;
  const bh = analysis.behaviour;
  const lang = analysis.language;

  // 1. Scale. Not a finding — the thing you need before any finding lands.
  cards.push({
    kind: "stat",
    id: "scale",
    kicker: "The shape of it",
    headline: `${num(v.total)} messages`,
    detail:
      `Across ${num(Math.round(analysis.span.days))} days — but only ${num(analysis.span.activeDays)} of them ` +
      `had any messages at all. ${pct(1 - analysis.span.activeShare)} of the calendar was silence.`,
    splits: [
      split("messages sent", v.messages.a, v.messages.b),
      split("characters per message", v.charsPerMessage.a, v.charsPerMessage.b, (n) => n.toFixed(0)),
    ],
  });

  // 2. Concentration. A bursty chat hides most of itself in a handful of nights.
  const top10 = analysis.concentration.topSessionShare.find((t) => t.n === 10);
  if (top10 && top10.share >= 0.15) {
    cards.push({
      kind: "stat",
      id: "concentration",
      kicker: "Where it actually happened",
      headline: `${pct(top10.share)} of it, in ten conversations`,
      detail:
        `There were ${num(analysis.sessionSummary.count)} separate bursts of talking — a burst ends after ` +
        `45 minutes of quiet — and the ten busiest hold ${num(top10.messages)} messages, ` +
        `${pct(top10.share)} of everything either of you ever sent. The median burst is ` +
        `${analysis.sessionSummary.medianMessages.toFixed(0)} messages long.`,
      // No splits. This is a fact about the corpus, not about either person, and a
      // part-vs-rest bar in the two people's colours would say something false.
      splits: [],
    });
  }

  // 3. Timeline. Silences are chapters here, not gaps in a chart.
  if (analysis.chapters.length > 1) {
    const silences = analysis.chapters.filter((c) => c.kind === "silence");
    cards.push({
      kind: "timeline",
      id: "timeline",
      kicker: "In chapters",
      headline: silences.length ? `${silences.length} times it went dark` : "One unbroken stretch",
      detail:
        `Split where the rate of conversation actually changed, not by calendar year. ` +
        `The silences are chapters too — they are the part a year-in-review usually leaves out.`,
      chapters: analysis.chapters,
    });
  }

  // 4. Turn-taking — usually the strongest asymmetry in a chat like this.
  const mono = analysis.rhythm.monologues;
  if (isAsymmetric({ a: mono.a.meanRunLength, b: mono.b.meanRunLength }, 1.2)) {
    const talker = mono.a.meanRunLength > mono.b.meanRunLength ? A : B;
    cards.push({
      kind: "stat",
      id: "turn-taking",
      kicker: "Turn-taking",
      headline: `${talker} keeps going`,
      detail:
        `Counting unbroken runs — messages sent before the other one says anything back. ` +
        `${talker} sends more of them, and sends more of their messages inside one.`,
      splits: [
        split("average run", mono.a.meanRunLength, mono.b.meanRunLength, (n) => n.toFixed(2)),
        split("own messages inside a run of 3+", mono.a.shareOfMessagesInRuns, mono.b.shareOfMessagesInRuns, (n) => pct(n)),
        split("longest run", mono.a.maxRunLength, mono.b.maxRunLength),
      ],
    });
  }

  // 5. Reactions. The interesting shape is when giving and receiving invert.
  if (isAsymmetric(bh.reactionsGiven) || isAsymmetric(bh.reactionsReceived)) {
    const inverts =
      (bh.reactionsGiven.a > bh.reactionsGiven.b) !== (bh.reactionsReceived.a > bh.reactionsReceived.b);
    cards.push({
      kind: "stat",
      id: "reactions",
      kicker: "Reactions",
      headline: inverts ? "One of you reacts. One of you gets reacted to." : "Reactions run one way",
      detail: inverts
        ? `The two numbers invert. Whoever taps the emoji is not the one whose messages get tapped, ` +
          `which is a fact about who is performing and who is responding.`
        : `Reactions are lopsided in the same direction whether given or received.`,
      splits: [
        split("reactions given", bh.reactionsGiven.a, bh.reactionsGiven.b),
        split("reactions received", bh.reactionsReceived.a, bh.reactionsReceived.b),
      ],
    });
  }

  // 6. Register: emoji and stickers are different dialects of the same thing.
  const em = lang.emoji;
  const st = lang.stickers;
  if (isAsymmetric(em.total) || isAsymmetric(st.total)) {
    // Each side's own emoji:sticker ratio. The card is only "two dialects" if the
    // two ratios point opposite ways — if both prefer stickers and one just sends
    // more of everything, that's the volume card again wearing a hat.
    const leanA = em.total.a / Math.max(1, st.total.a);
    const leanB = em.total.b / Math.max(1, st.total.b);
    const opposed = (leanA > 1) !== (leanB > 1);
    const emojiPerson = leanA >= leanB ? A : B;
    const stickerPerson = leanA >= leanB ? B : A;
    cards.push({
      kind: "stat",
      id: "register",
      kicker: "How you punctuate",
      headline: opposed ? "Two different dialects" : "Emoji and stickers",
      detail:
        `An emoji sits inside the sentence; a sticker replaces it. ` +
        `${emojiPerson} reaches for emoji, ${stickerPerson} for stickers. ` +
        (em.top.a.length ? `${A}'s most-used: ${em.top.a.slice(0, 5).map((e) => e.emoji).join(" ")}. ` : "") +
        (em.top.b.length ? `${B}'s: ${em.top.b.slice(0, 5).map((e) => e.emoji).join(" ")}.` : ""),
      splits: [split("emoji", em.total.a, em.total.b), split("stickers", st.total.a, st.total.b)],
    });
  }

  // Voice notes and telebubbles — only when there are enough to mean something.
  for (const [id, kicker, label, singular, data] of [
    ["video-notes", "On camera", "telebubbles", "telebubble", bh.videoNotes],
    ["voice-notes", "Out loud, but not a call", "voice notes", "voice note", bh.voiceNotes],
  ] as const) {
    const counts = { a: data.a.count, b: data.b.count };
    if (!isAsymmetric(counts)) continue;
    const sender = counts.a > counts.b ? A : B;
    const times = Math.max(counts.a, counts.b) / Math.max(1, Math.min(counts.a, counts.b));
    cards.push({
      kind: "stat",
      id,
      kicker,
      headline: `${sender} sends the ${label}`,
      detail:
        `A ${singular} is a decision to stop typing. ${sender} makes it ` +
        (Math.min(counts.a, counts.b) === 0 ? `almost exclusively.` : `${times.toFixed(0)}× as often.`),
      splits: [
        split(label, counts.a, counts.b),
        split("total time", data.a.totalSeconds, data.b.totalSeconds, dur),
      ],
    });
  }

  // 10. Who comes back. Shown at every threshold on purpose — a pattern that only
  // appears at one convenient cutoff is a pattern in the cutoff.
  const rev = analysis.rhythm.revival.filter((r) => r.n > 0);
  const main = rev.find((r) => r.thresholdDays === 14) ?? rev[0];
  if (main && isAsymmetric(main.revivedBy, 1.4)) {
    const reviver = main.revivedBy.a > main.revivedBy.b ? A : B;
    // Whether "who went quiet" is also lopsided is a fact about this chat, so it
    // has to be read off the numbers rather than asserted. On a corpus where both
    // are lopsided the same way, the finding is much weaker and should say so.
    const quietEven = !isAsymmetric(main.wentQuiet, 1.4);
    cards.push({
      kind: "stat",
      id: "revival",
      kicker: "After the silence",
      headline: `${reviver} is the one who comes back`,
      detail:
        `${main.n} silences of ${main.thresholdDays} days or more. ` +
        (quietEven
          ? `Who let it go quiet is close to even — it is who breaks it that isn't. `
          : `Who let it go quiet leans the same way, so read this as one pattern rather than two. `) +
        `Ended by ${A}–${B} at each cutoff — ` +
        rev.map((r) => `${r.thresholdDays}d: ${r.revivedBy.a}–${r.revivedBy.b}`).join(", ") +
        `. A pattern that only shows up at one cutoff is a pattern in the cutoff.`,
      splits: [
        split("ended the silence", main.revivedBy.a, main.revivedBy.b),
        split("went quiet first", main.wentQuiet.a, main.wentQuiet.b),
      ],
    });
  }

  // 11. Vocabulary, by log-odds rather than raw frequency — otherwise every list
  // is "the", "i", "you" for both people.
  const forA = lang.distinctive.filter((d) => d.z > 0).slice(0, 8);
  const forB = lang.distinctive.filter((d) => d.z < 0).slice(-8).reverse();
  if (forA.length && forB.length) {
    cards.push({
      kind: "words",
      id: "vocabulary",
      kicker: "Words that are yours",
      headline: "You don't type the same language",
      detail:
        // No markdown in these strings: nothing renders them, so an asterisk pair
        // reaches the screen as two asterisks.
        `Not the most used words — the most characteristic ones. These are the words each of you uses far ` +
        `more than the other does, weighted so common words don't dominate.`,
      words: {
        a: forA.map((d) => ({ word: d.word, mine: d.countA, theirs: d.countB })),
        b: forB.map((d) => ({ word: d.word, mine: d.countB, theirs: d.countA })),
      },
    });
  }

  const flat = flatItems(analysis, A, B);
  if (flat.length) {
    cards.push({
      kind: "flat",
      id: "flat",
      kicker: "Checked, came out even",
      headline: "Things that turned out not to be true",
      detail:
        `These were all measured. None of them showed a real difference between the two of you, so there is ` +
        `no card for them. A wrapped that only shows you the hits is lying by omission.`,
      items: flat,
    });
  }

  return cards;
}

/**
 * Files each model finding next to the deterministic card it is about.
 *
 * The pairing is the whole thesis made visible: the number and the quote that
 * shows it, on the same screen. A finding whose `metric` matches nothing comes back
 * as leftover rather than being dropped — the model saw the brief and may have
 * found something across two metrics, and silently discarding that would be worse
 * than showing it on its own.
 */
export function interleaveFindings<T extends { metric: string }>(
  deck: DeckCard[],
  findings: T[],
): { slots: Map<string, T[]>; leftover: T[] } {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ids = new Map(deck.map((c) => [slug(c.id), c.id]));
  const slots = new Map<string, T[]>();
  const leftover: T[] = [];

  for (const f of findings) {
    const key = slug(ALIASES[slug(f.metric)] ?? f.metric);
    // Exact key, then either direction of containment. The brief now hands the
    // model the exact key, so exact match is the normal path and the rest is for a
    // response that paraphrased it anyway.
    const hit =
      ids.get(key) ??
      [...ids.entries()].find(([id]) => key.includes(id) || id.includes(key))?.[1];
    if (!hit) {
      leftover.push(f);
      continue;
    }
    const bucket = slots.get(hit);
    if (bucket) bucket.push(f);
    else slots.set(hit, [f]);
  }
  return { slots, leftover };
}

/** One surface that shows quotes, and how many it has room for. */
export interface EvidenceSlot {
  /** caller's handle for this surface; the returned map is keyed by it */
  key: string;
  evidence: Cited[];
  want: number;
}

/**
 * Picks the quotes each card shows: the first `want`, in the order the model gave.
 *
 * It is worth being explicit about what this deliberately does *not* do. On the
 * first live run four messages were quoted on two cards each — the volume card and
 * the turn-taking card cited the identical pair — which makes the deck look like it
 * ran out of conversation. The obvious fix is to give the second card the quotes the
 * first didn't use. Rendering that showed why it's wrong: the turn-taking card cited
 * #100–#102, three *consecutive* messages, and it's the consecutiveness that makes
 * them evidence of a run at all. Handed the leftover, the card cited "im A308"
 * alone, which demonstrates nothing. The tail of an evidence list is also its
 * weakest part — the third citation on the names card was the single word "yes".
 *
 * So the order is meaning, and the right place to stop a card being cited twice is
 * the prompt that produces the citations, not here. This function exists so that
 * decision is written down at the point where someone would otherwise undo it.
 */
export function assignEvidence(slots: EvidenceSlot[]): Map<string, Cited[]> {
  return new Map(slots.map((s) => [s.key, s.evidence.slice(0, s.want)]));
}

/**
 * Descriptions the model has actually written instead of the key, mapped back.
 *
 * Every entry here is a real observed response, not a guess. The brief asks for the
 * key now, so these should stop appearing — but a finding that lands nowhere is
 * invisible in the UI rather than loud, so it's worth catching the known ones.
 */
const ALIASES: Record<string, MetricKey> = {
  "who-comes-back": "revival",
  "message-volume-and-length": "scale",
  "volume-and-length": "scale",
  "emoji-vs-stickers": "register",
  "using-the-other-s-name": "names",
  "using-the-others-name": "names",
  bursts: "concentration",
};

/**
 * The metrics that came out flat, stated plainly.
 *
 * Showing these is the honest half of the thesis: "nobody here is ever waiting on
 * a reply" is a real finding about a chat, and a deck that silently dropped the
 * measurements that failed would let the reader assume everything was checked and
 * everything was interesting.
 */
function flatItems(analysis: Analysis, A: string, B: string): string[] {
  const out: string[] = [];
  const r = analysis.rhythm;

  if (Math.abs(r.latencyAsymmetry - 1) < CARD_FLOORS.latencyBand) {
    out.push(
      `Reply speed. Median ${dur(r.latency.a.medianSec)} for ${A}, ${dur(r.latency.b.medianSec)} for ${B} — ` +
        `the same number. Nobody here leaves anybody on read.`,
    );
  }
  const q = analysis.language.questions;
  if (!isAsymmetric(q.rate, CARD_FLOORS.questionRatio)) {
    out.push(
      `Questions. ${pct(q.rate.a, 1)} of ${A}'s messages, ${pct(q.rate.b, 1)} of ${B}'s. ` +
        `Neither of you is interviewing the other.`,
    );
  }
  const late = r.lateNightShare;
  if (!(isAsymmetric(late, CARD_FLOORS.lateNightRatio) && Math.max(late.a, late.b) > CARD_FLOORS.lateNightFloor)) {
    out.push(
      `Late night, midnight to 5am. ${pct(late.a, 1)} versus ${pct(late.b, 1)}. ` +
        `Neither of you is the one who's up.`,
    );
  }
  const s = analysis.sessionSummary;
  const n = Math.max(1, s.count);
  if (!(isAsymmetric(s.opens, CARD_FLOORS.openCloseRatio) || isAsymmetric(s.closes, CARD_FLOORS.openCloseRatio))) {
    out.push(
      `Who starts and who ends a conversation. Opens ${pct(s.opens.a / n)}/${pct(s.opens.b / n)}, ` +
        `closes ${pct(s.closes.a / n)}/${pct(s.closes.b / n)}. Close enough to even that the split is noise.`,
    );
  }
  return out;
}
