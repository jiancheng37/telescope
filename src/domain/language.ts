import { logOddsZ, maximum, quantile, share } from "./stats";
import type { EmojiUse, IdiolectMarker, Language, Message, Pair, Side } from "./types";

const WORD = /[a-z']{2,}/g;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/**
 * Function words can be statistically distinctive simply because one person
 * writes more complete sentences. That is real, but it is not the private
 * language a Wrapped screen promises. Register markers such as "okay", "bro"
 * and "lah" deliberately stay out of this list—their variants are often the
 * interesting part.
 */
const VOCABULARY_STOPWORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before",
  "being", "but", "can", "could", "did", "does", "doing", "don’t", "dont", "for",
  "from", "get", "got", "had", "has", "have", "her", "here", "him", "his", "how",
  "into", "its", "just", "like", "more", "not", "now", "of", "off", "on", "one",
  "only", "or", "our", "out", "really", "she", "should", "some", "still", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "to", "too", "up", "very", "was", "we", "well", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "would", "you", "your", "youre",
  "you're", "im", "i'm", "ive", "i've", "isnt", "isn't", "thats", "that's",
]);

/**
 * Chat-register markers worth counting explicitly. These are the words where
 * *which variant you use* is the signal — `okay` vs `ok` vs `oki` says more
 * about a person than any of them says on its own.
 */
export const IDIOLECT_MARKERS = [
  "lol", "lmao", "lmfao", "haha", "hahaha", "hehe", "hehehe",
  "omg", "wtf", "damn", "shit", "fuck",
  "ok", "okay", "oki", "okie", "kk",
  "ya", "yah", "yeah", "yea", "yup", "yes", "nah", "no",
  "wah", "lah", "leh", "lor", "meh", "sian", "shiok", "alamak",
  "pls", "please", "thanks", "thank you", "sorry", "my bad",
  "goodnight", "gn", "good morning", "gm",
  "love you", "ily", "miss you", "hbd",
  "bro", "bruh", "dude", "sis", "babe",
  "lowkey", "highkey", "deadass", "fr", "ngl", "tbh", "idk", "imo",
] as const;

function key(side: Side): "a" | "b" {
  return side === 0 ? "a" : "b";
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

/** Whole-grapheme emoji extraction, so 🤷‍♀️ and 👍🏽 count as one each. */
export function extractEmoji(text: string): string[] {
  const out: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(text)) {
    if (PICTOGRAPHIC.test(segment)) out.push(segment);
  }
  return out;
}

function countBy<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}

/**
 * Top `n` by `side`'s own usage, but reporting both people's counts — so a card
 * can say "her 😭 112 times, his 10". `counts.a` is always side 0's count
 * regardless of whose top list this is.
 */
function topN(
  countsA: Map<string, number>,
  countsB: Map<string, number>,
  side: Side,
  n: number,
): EmojiUse[] {
  const own = side === 0 ? countsA : countsB;
  return [...own.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([emoji]) => ({
      emoji,
      counts: { a: countsA.get(emoji) ?? 0, b: countsB.get(emoji) ?? 0 },
    }));
}

/**
 * Names each person might use for the other. Prefixes are included because
 * people shorten names, but this will miss any nickname that isn't a prefix of
 * the display name — so a zero here means "no name and no prefix", not
 * necessarily "never addressed them". Naming what they actually call each other
 * is a job for the LLM pass.
 */
export function nameAliases(displayName: string): string[] {
  const cleaned = displayName.toLowerCase().replace(/[^a-z\s]/g, " ").trim();
  const first = cleaned.split(/\s+/)[0] ?? "";
  if (first.length < 2) return [];
  const out = new Set<string>([first]);
  if (first.length > 4) {
    out.add(first.slice(0, 4));
    out.add(first.slice(0, 3));
  }
  return [...out];
}

function countsFor(messages: Message[], side: Side): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.who !== side) continue;
    for (const w of tokenize(m.text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

/** Index of the next message from the other side, or -1. Precomputed in one pass. */
function nextFromOtherSide(messages: Message[]): number[] {
  const next = new Array<number>(messages.length).fill(-1);
  const lastSeen: [number, number] = [-1, -1];
  for (let i = messages.length - 1; i >= 0; i--) {
    const other = messages[i].who === 0 ? 1 : 0;
    next[i] = lastSeen[other];
    lastSeen[messages[i].who] = i;
  }
  return next;
}

export function buildLanguage(
  messages: Message[],
  participants: [string, string],
): Language {
  const countsA = countsFor(messages, 0);
  const countsB = countsFor(messages, 1);
  const totals = { a: 0, b: 0 };
  for (const m of messages) totals[key(m.who)]++;

  // ------------------------------------------------------------- distinctive
  const participantWords = new Set(participants.flatMap((name) => nameAliases(name)));
  const scored = logOddsZ(countsA, countsB, { minTotal: 20 })
    // Single letters are export artifacts (split contractions, initials), not vocabulary.
    .filter((w) =>
      w.word.length >= 2 &&
      !w.word.startsWith("'") &&
      !VOCABULARY_STOPWORDS.has(w.word) &&
      !participantWords.has(w.word)
    );
  const distinctive = [...scored.slice(0, 25), ...scored.slice(-25)];

  // ---------------------------------------------------------------- idiolect
  const idiolect: IdiolectMarker[] = [];
  for (const token of IDIOLECT_MARKERS) {
    const counts = { a: 0, b: 0 };
    const needle = token.toLowerCase();
    for (const m of messages) {
      if (m.text.toLowerCase().includes(needle)) counts[key(m.who)]++;
    }
    if (counts.a + counts.b < 10) continue;
    idiolect.push({
      token,
      counts,
      per1k: {
        a: share(counts.a, totals.a) * 1000,
        b: share(counts.b, totals.b) * 1000,
      },
    });
  }
  idiolect.sort((x, y) => y.counts.a + y.counts.b - (x.counts.a + x.counts.b));

  // ------------------------------------------------------------------- emoji
  const emojiA = countBy(messages.filter((m) => m.who === 0).flatMap((m) => extractEmoji(m.text)));
  const emojiB = countBy(messages.filter((m) => m.who === 1).flatMap((m) => extractEmoji(m.text)));
  const exclusive = (mine: Map<string, number>, theirs: Map<string, number>) =>
    [...mine.entries()]
      .filter(([e, c]) => c >= 5 && !theirs.has(e))
      .sort((x, y) => y[1] - x[1])
      .map(([e]) => e);

  // ---------------------------------------------------------------- stickers
  const stickerA = countBy(
    messages.filter((m) => m.who === 0 && m.stickerEmoji).map((m) => m.stickerEmoji!),
  );
  const stickerB = countBy(
    messages.filter((m) => m.who === 1 && m.stickerEmoji).map((m) => m.stickerEmoji!),
  );

  // --------------------------------------------------------------- questions
  const next = nextFromOtherSide(messages);
  const qCount = { a: 0, b: 0 };
  const qUnanswered = { a: 0, b: 0 };
  const SIX_HOURS = 6 * 3600;
  messages.forEach((m, i) => {
    if (!m.text.includes("?")) return;
    qCount[key(m.who)]++;
    const j = next[i];
    if (j === -1 || messages[j].ts - m.ts > SIX_HOURS) qUnanswered[key(m.who)]++;
  });

  // ------------------------------------------------------------------ naming
  const aliasesFor = [nameAliases(participants[0]), nameAliases(participants[1])] as const;
  const addressesByName = { a: 0, b: 0 };
  for (const m of messages) {
    const targetAliases = aliasesFor[m.who === 0 ? 1 : 0];
    if (targetAliases.length === 0) continue;
    const lower = m.text.toLowerCase();
    if (targetAliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(lower))) {
      addressesByName[key(m.who)]++;
    }
  }

  // ------------------------------------------------------------ msg lengths
  const lengths = { a: [] as number[], b: [] as number[] };
  for (const m of messages) if (m.text) lengths[key(m.who)].push([...m.text].length);
  const longestMessages = ([0, 1] as const).map((side) => {
    const longest = messages
      .filter((message) => message.who === side && message.text)
      .map((message) => ({ message, chars: [...message.text].length }))
      .sort((a, b) => b.chars - a.chars || a.message.ts - b.message.ts)[0];
    return longest
      ? { messageId: longest.message.id, ts: longest.message.ts, chars: longest.chars }
      : { messageId: null, ts: null, chars: 0 };
  }) as [
    { messageId: number | null; ts: number | null; chars: number },
    { messageId: number | null; ts: number | null; chars: number },
  ];
  const pct = (xs: number[]) => ({
    p25: quantile(xs, 0.25),
    p50: quantile(xs, 0.5),
    p75: quantile(xs, 0.75),
    p90: quantile(xs, 0.9),
    p99: quantile(xs, 0.99),
    max: maximum(xs),
  });

  return {
    distinctive,
    idiolect,
    emoji: {
      total: { a: [...emojiA.values()].reduce((x, y) => x + y, 0), b: [...emojiB.values()].reduce((x, y) => x + y, 0) },
      top: { a: topN(emojiA, emojiB, 0, 12), b: topN(emojiA, emojiB, 1, 12) },
      exclusive: { a: exclusive(emojiA, emojiB), b: exclusive(emojiB, emojiA) },
    },
    stickers: {
      total: { a: [...stickerA.values()].reduce((x, y) => x + y, 0), b: [...stickerB.values()].reduce((x, y) => x + y, 0) },
      top: { a: topN(stickerA, stickerB, 0, 8), b: topN(stickerA, stickerB, 1, 8) },
    },
    questions: {
      count: qCount,
      rate: { a: share(qCount.a, totals.a), b: share(qCount.b, totals.b) },
      unansweredIn6h: qUnanswered,
    },
    addressesByName,
    messageLengthPercentiles: { a: pct(lengths.a), b: pct(lengths.b) },
    longestMessages: { a: longestMessages[0], b: longestMessages[1] },
  } satisfies Language;
}

export type { Pair };
