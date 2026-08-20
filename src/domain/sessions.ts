import { mean, median } from "./stats";
import type { Chapter, Episode, EraChange, EraChangeChannel, Message, Session, Side } from "./types";

/** A silence this long ends a session. Bursts, not days. */
export const SESSION_GAP_MIN = 120;
/** A silence this long ends an episode of contact. */
export const EPISODE_GAP_DAYS = 14;
/** A silence this long is a chapter in its own right, not a gap inside one. */
export const SILENCE_MIN_DAYS = 30;
/**
 * A stretch of contact needs at least this many messages to count as an era.
 * Below it, it's a blip — someone sent a few messages into a dead chat and it
 * died again — and it belongs inside the surrounding silence, not beside it.
 */
export const MIN_ERA_MESSAGES = 20;
/**
 * An era holding less than this share of the whole conversation is a lull, not
 * a chapter. Expressed as a share rather than a count so it scales with the
 * corpus instead of needing a tuned constant per chat.
 */
export const QUIET_ERA_SHARE = 0.01;

const DAY = 86400;

export interface WeekSemantics {
  /** Monday 00:00 local, unix seconds. */
  weekTs: number;
  embedding: number[];
}

interface WeekWindow {
  startTs: number;
  endTs: number;
  messages: Message[];
  raw: number[];
  semantic?: number[];
}

const FEATURE_NAMES = [
  "messages/week", "words/message", "initiator share", "reply time A", "reply time B",
  "photos/week", "links/week", "stickers/week", "emoji rate", "late-night share",
];

const CHANNELS: Array<{ name: EraChangeChannel; indexes: number[]; weight: number }> = [
  { name: "activity", indexes: [0, 1], weight: 0.2 },
  { name: "reply", indexes: [2, 3, 4], weight: 0.15 },
  { name: "media", indexes: [5, 6, 7], weight: 0.1 },
  { name: "timing", indexes: [9], weight: 0.1 },
  { name: "language", indexes: [8], weight: 0.05 },
];

export function weekStart(ts: number): number {
  const d = new Date(ts * 1000);
  const mondayOffset = (d.getDay() + 6) % 7;
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset).getTime() / 1000);
}

function nextWeek(ts: number): number {
  const d = new Date(ts * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime() / 1000);
}

function medianFinite(values: number[]): number {
  return median(values.filter(Number.isFinite));
}

function rawWeekFeatures(messages: Message[]): number[] {
  const words = messages.reduce((n, m) => n + (m.text.trim() ? m.text.trim().split(/\s+/).length : 0), 0);
  let repliesA: number[] = [];
  let repliesB: number[] = [];
  let initiationsA = 0;
  let initiations = 0;
  for (let i = 0; i < messages.length; i++) {
    const previous = messages[i - 1];
    if (!previous || messages[i].ts - previous.ts > SESSION_GAP_MIN * 60) {
      initiations++;
      if (messages[i].who === 0) initiationsA++;
    } else if (messages[i].who !== previous.who) {
      const target = messages[i].who === 0 ? repliesA : repliesB;
      target.push(messages[i].ts - previous.ts);
    }
  }
  const photos = messages.filter((m) => m.attachment === "photo").length;
  const links = messages.filter((m) => /https?:\/\/|www\./i.test(m.text)).length;
  const stickers = messages.filter((m) => m.mediaType === "sticker").length;
  const emoji = messages.reduce((n, m) => n + (m.text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0), 0);
  const textChars = messages.reduce((n, m) => n + [...m.text].length, 0);
  const late = messages.filter((m) => { const h = new Date(m.ts * 1000).getHours(); return h < 5; }).length;
  return [
    Math.log1p(messages.length),
    messages.length ? words / messages.length : Number.NaN,
    initiations ? initiationsA / initiations : Number.NaN,
    repliesA.length ? Math.log1p(medianFinite(repliesA)) : Number.NaN,
    repliesB.length ? Math.log1p(medianFinite(repliesB)) : Number.NaN,
    Math.log1p(photos), Math.log1p(links), Math.log1p(stickers),
    textChars ? emoji / textChars : Number.NaN,
    messages.length ? late / messages.length : Number.NaN,
  ];
}

function weeklyWindows(block: Message[], semantics: Map<number, number[]>): WeekWindow[] {
  const start = weekStart(block[0].ts);
  const end = weekStart(block[block.length - 1].ts);
  const grouped = new Map<number, Message[]>();
  for (const message of block) {
    const key = weekStart(message.ts);
    const found = grouped.get(key);
    if (found) found.push(message); else grouped.set(key, [message]);
  }
  const out: WeekWindow[] = [];
  for (let ts = start; ts <= end; ts = nextWeek(ts)) {
    const messages = grouped.get(ts) ?? [];
    out.push({ startTs: ts, endTs: ts + 7 * DAY, messages, raw: rawWeekFeatures(messages), semantic: semantics.get(ts) });
  }
  return out;
}

function standardized(windows: WeekWindow[]): number[][] {
  const dimensions = FEATURE_NAMES.length;
  const means = Array.from({ length: dimensions }, (_, d) => {
    const values = windows.map((w) => w.raw[d]).filter(Number.isFinite);
    return values.length ? mean(values) : 0;
  });
  const deviations = means.map((avg, d) => {
    const values = windows.map((w) => w.raw[d]).filter(Number.isFinite);
    return Math.sqrt(mean(values.map((v) => (v - avg) ** 2))) || 1;
  });
  return windows.map((w) => w.raw.map((v, d) => (Number.isFinite(v) ? (v - means[d]) / deviations[d] : 0)));
}

function average(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  return vectors[0].map((_, d) => mean(vectors.map((v) => v[d] ?? 0)));
}

function cosineDistance(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? 1 - dot / Math.sqrt(aa * bb) : 0;
}

function readableFeature(index: number, value: number): number {
  return [0, 3, 4, 5, 6, 7].includes(index) ? Math.expm1(value) : value;
}

interface BoundaryCandidate { at: number; total: number; channels: Record<string, number>; change: EraChange }

function boundaries(windows: WeekWindow[]): BoundaryCandidate[] {
  const minEra = 4;
  if (windows.length < minEra * 2) return [];
  const z = standardized(windows);
  const raw: BoundaryCandidate[] = [];
  for (let at = minEra; at <= windows.length - minEra; at++) {
    const leftFrom = Math.max(0, at - 4);
    const rightTo = Math.min(windows.length, at + 4);
    const before = average(z.slice(leftFrom, at));
    const after = average(z.slice(at, rightTo));
    const channels: Record<string, number> = {};
    for (const channel of CHANNELS) {
      channels[channel.name] = mean(channel.indexes.map((i) => Math.abs((after[i] ?? 0) - (before[i] ?? 0))));
    }
    const leftSemantic = windows.slice(leftFrom, at).map((w) => w.semantic).filter((v): v is number[] => Boolean(v));
    const rightSemantic = windows.slice(at, rightTo).map((w) => w.semantic).filter((v): v is number[] => Boolean(v));
    if (leftSemantic.length && rightSemantic.length) channels.semantic = cosineDistance(average(leftSemantic), average(rightSemantic));
    const strongest = FEATURE_NAMES.map((metric, i) => {
      const left = windows.slice(leftFrom, at).map((w) => w.raw[i]).filter(Number.isFinite);
      const right = windows.slice(at, rightTo).map((w) => w.raw[i]).filter(Number.isFinite);
      const a = left.length ? mean(left) : 0;
      const b = right.length ? mean(right) : 0;
      const readableBefore = readableFeature(i, a);
      const readableAfter = readableFeature(i, b);
      return {
        metric,
        before: readableBefore,
        after: readableAfter,
        delta: readableAfter - readableBefore,
        strength: Math.abs((after[i] ?? 0) - (before[i] ?? 0)),
      };
    })
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map(({ strength: _strength, ...item }) => item);
    raw.push({ at, total: 0, channels, change: { score: 0, contributors: {}, strongest } });
  }
  const channelNames: EraChangeChannel[] = ["semantic", ...CHANNELS.map((c) => c.name)];
  const scales = new Map(channelNames.map((name) => [name, Math.max(0.0001, ...raw.map((c) => c.channels[name] ?? 0))]));
  for (const candidate of raw) {
    let weighted = 0;
    let weight = 0;
    const contributors: Partial<Record<EraChangeChannel, number>> = {};
    for (const channel of [...CHANNELS, { name: "semantic" as const, indexes: [], weight: 0.4 }]) {
      if (!(channel.name in candidate.channels)) continue;
      const normalized = Math.min(1, candidate.channels[channel.name] / (scales.get(channel.name) ?? 1));
      contributors[channel.name] = normalized;
      weighted += normalized * channel.weight;
      weight += channel.weight;
    }
    candidate.total = weight ? weighted / weight : 0;
    candidate.change = { ...candidate.change, score: candidate.total, contributors };
  }
  const peaks = raw.filter((c, i) => c.total >= 0.32 && c.total >= (raw[i - 1]?.total ?? -1) && c.total >= (raw[i + 1]?.total ?? -1));
  const selected: BoundaryCandidate[] = [];
  for (const candidate of [...peaks].sort((a, b) => b.total - a.total)) {
    if (selected.length >= 5) break;
    if (selected.every((other) => Math.abs(other.at - candidate.at) >= minEra)) selected.push(candidate);
  }
  return selected.sort((a, b) => a.at - b.at);
}

/** Split messages wherever there's a gap larger than `gapSeconds`. */
function splitOnGap(messages: Message[], gapSeconds: number): Message[][] {
  if (messages.length === 0) return [];
  const groups: Message[][] = [];
  let current: Message[] = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].ts - messages[i - 1].ts > gapSeconds) {
      groups.push(current);
      current = [messages[i]];
    } else {
      current.push(messages[i]);
    }
  }
  groups.push(current);
  return groups;
}

export function buildSessions(messages: Message[]): Session[] {
  return splitOnGap(messages, SESSION_GAP_MIN * 60).map((group, index) => {
    const sides = new Set(group.map((m) => m.who));
    return {
      index,
      startTs: group[0].ts,
      endTs: group[group.length - 1].ts,
      messageCount: group.length,
      durationMin: (group[group.length - 1].ts - group[0].ts) / 60,
      openedBy: group[0].who,
      closedBy: group[group.length - 1].who,
      monologue: sides.size === 1,
      firstMessageId: group[0].id,
      lastMessageId: group[group.length - 1].id,
    };
  });
}

export function summarizeSessions(sessions: Session[]) {
  const sizes = sessions.map((s) => s.messageCount);
  const opens = { a: 0, b: 0 };
  const closes = { a: 0, b: 0 };
  for (const s of sessions) {
    if (s.openedBy === 0) opens.a++;
    else opens.b++;
    if (s.closedBy === 0) closes.a++;
    else closes.b++;
  }
  return {
    count: sessions.length,
    medianMessages: median(sizes),
    meanMessages: mean(sizes),
    maxMessages: sizes.length ? Math.max(...sizes) : 0,
    medianDurationMin: median(sessions.map((s) => s.durationMin)),
    monologueSessions: sessions.filter((s) => s.monologue).length,
    opens,
    closes,
  };
}

export function buildEpisodes(messages: Message[]): Episode[] {
  const groups = splitOnGap(messages, EPISODE_GAP_DAYS * DAY);
  return groups.map((group, index) => {
    const startTs = group[0].ts;
    const endTs = group[group.length - 1].ts;
    // A single-day episode still counts as one day of contact, not zero.
    const days = Math.max(1, (endTs - startTs) / DAY);
    const prev = index > 0 ? groups[index - 1] : null;
    const next = index + 1 < groups.length ? groups[index + 1] : null;
    return {
      index,
      startTs,
      endTs,
      days,
      messageCount: group.length,
      messagesPerDay: group.length / days,
      revivedBy: prev ? group[0].who : null,
      wentQuiet: prev ? prev[prev.length - 1].who : null,
      dormantBeforeDays: prev ? (startTs - prev[prev.length - 1].ts) / DAY : 0,
      dormantAfterDays: next ? (next[0].ts - endTs) / DAY : null,
    };
  });
}

function monthKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Eras, with silences as first-class chapters.
 *
 * Running change-point detection across the whole timeline doesn't work when
 * most of it is dormant — the detector spends its splits separating silence
 * from silence. So: cut the timeline at the long silences first, then look for
 * eras *within* each stretch of contact.
 */
export function buildChapters(messages: Message[], weekSemantics: WeekSemantics[] = []): Chapter[] {
  const total = messages.length;
  if (total === 0) return [];

  const allBlocks = splitOnGap(messages, SILENCE_MIN_DAYS * DAY);

  // Blocks too small to be an era get folded into the silence around them,
  // tracked as blips so the silence chapter can say "251 days dark, and the
  // seven messages in the middle didn't restart anything".
  const blocks: Message[][] = [];
  let pendingBlips: Message[][] = [];
  const blipsBefore = new Map<number, Message[][]>();
  for (const block of allBlocks) {
    if (block.length < MIN_ERA_MESSAGES) {
      pendingBlips.push(block);
      continue;
    }
    blipsBefore.set(blocks.length, pendingBlips);
    pendingBlips = [];
    blocks.push(block);
  }
  // Anything trailing at the end has nothing to attach to; keep it as an era so
  // no messages disappear from the timeline entirely.
  if (blocks.length === 0) blocks.push(...allBlocks);
  else if (pendingBlips.length) blocks.push(pendingBlips.flat());

  const chapters: Chapter[] = [];
  const semanticMap = new Map(weekSemantics.map((week) => [week.weekTs, week.embedding]));

  blocks.forEach((block, bi) => {
    if (bi > 0) {
      const prev = blocks[bi - 1];
      const last = prev[prev.length - 1];
      const first = block[0];
      const blips = blipsBefore.get(bi) ?? [];
      chapters.push({
        kind: "silence",
        startTs: last.ts,
        endTs: first.ts,
        days: (first.ts - last.ts) / DAY,
        wentQuiet: last.who,
        revivedBy: first.who,
        blipMessages: blips.reduce((n, b) => n + b.length, 0),
        blipCount: blips.length,
      });
    }

    const weeks = weeklyWindows(block, semanticMap);
    const detected = boundaries(weeks);
    const bounds = [0, ...detected.map((boundary) => boundary.at), weeks.length];
    const byAt = new Map(detected.map((boundary) => [boundary.at, boundary]));

    for (let i = 0; i < bounds.length - 1; i++) {
      const slice = weeks.slice(bounds[i], bounds[i + 1]);
      const msgs = slice.flatMap((week) => week.messages);
      if (msgs.length === 0) continue;
      const representedMonths = new Set(msgs.map((message) => monthKey(message.ts))).size;
      const eraShare = msgs.length / total;
      chapters.push({
        kind: "era",
        startTs: msgs[0].ts,
        endTs: msgs[msgs.length - 1].ts,
        months: Math.max(1, representedMonths),
        weeks: slice.length,
        messageCount: msgs.length,
        messagesPerMonth: msgs.length / Math.max(1, representedMonths),
        share: eraShare,
        quiet: eraShare < QUIET_ERA_SHARE,
        ...(i > 0 && byAt.get(bounds[i]) ? { change: byAt.get(bounds[i])!.change } : {}),
      });
    }
  });

  return chapters;
}

/** Distinct local dates that carry at least one message, ascending. */
export function activeDates(messages: Message[]): string[] {
  const set = new Set<string>();
  for (const m of messages) {
    const d = new Date(m.ts * 1000);
    set.add(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return [...set].sort();
}

export function sideOf(m: Message): Side {
  return m.who;
}
