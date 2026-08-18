import { buildLanguage } from "./language";
import { parseExport, type Parsed } from "./parse";
import { buildRhythm } from "./rhythm";
import { activeDates, buildChapters, buildEpisodes, buildSessions, summarizeSessions } from "./sessions";
import { ratio, share } from "./stats";
import type {
  Analysis,
  Behaviour,
  Call,
  Concentration,
  Message,
  MonthBucket,
  Pair,
  Side,
  Volume,
} from "./types";

const DAY = 86400;

function key(side: Side): "a" | "b" {
  return side === 0 ? "a" : "b";
}

function emptyPairNum(): Pair<number> {
  return { a: 0, b: 0 };
}

function localDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every month in each calendar year represented by the chat, empty ones included. */
function buildMonthly(messages: Message[]): MonthBucket[] {
  const counts = new Map<string, Pair<number>>();
  for (const m of messages) {
    const k = monthKey(m.ts);
    const entry = counts.get(k) ?? emptyPairNum();
    entry[key(m.who)]++;
    counts.set(k, entry);
  }

  const first = new Date(messages[0].ts * 1000);
  const last = new Date(messages[messages.length - 1].ts * 1000);
  const end = last.getFullYear() * 12 + 11;
  const out: MonthBucket[] = [];
  for (let year = first.getFullYear(), month = 0; year * 12 + month <= end; ) {
    const k = `${year}-${String(month + 1).padStart(2, "0")}`;
    out.push({
      month: k,
      ts: Math.floor(new Date(year, month, 1).getTime() / 1000),
      counts: counts.get(k) ?? emptyPairNum(),
    });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

function buildVolume(messages: Message[], activeDayCount: number): Volume {
  const count = emptyPairNum();
  const chars = emptyPairNum();
  const words = emptyPairNum();
  for (const m of messages) {
    const k = key(m.who);
    count[k]++;
    // Code points, not UTF-16 units — otherwise every emoji counts as two
    // characters and inflates the length of whoever uses more of them.
    chars[k] += [...m.text].length;
    words[k] += m.text.trim() ? m.text.trim().split(/\s+/).length : 0;
  }
  return {
    total: messages.length,
    messages: count,
    chars,
    words,
    charsPerMessage: {
      a: count.a ? chars.a / count.a : 0,
      b: count.b ? chars.b / count.b : 0,
    },
    messageRatio: ratio(count.a, count.b),
    perActiveDay: activeDayCount ? messages.length / activeDayCount : 0,
    monthly: buildMonthly(messages),
  };
}

function buildBehaviour(messages: Message[], calls: Call[], idToSide: Map<string, Side>): Behaviour {
  const quoteReplies = emptyPairNum();
  const edits = emptyPairNum();
  const forwards = emptyPairNum();
  const stickers = emptyPairNum();
  const videoNotes = { a: { count: 0, totalSeconds: 0 }, b: { count: 0, totalSeconds: 0 } };
  const voiceNotes = { a: { count: 0, totalSeconds: 0 }, b: { count: 0, totalSeconds: 0 } };
  const reactionsGiven = emptyPairNum();
  const reactionsReceived = emptyPairNum();

  for (const m of messages) {
    const k = key(m.who);
    if (m.isReply) quoteReplies[k]++;
    if (m.isEdited) edits[k]++;
    if (m.isForward) forwards[k]++;
    if (m.mediaType === "sticker") stickers[k]++;
    if (m.mediaType === "video_message") {
      videoNotes[k].count++;
      videoNotes[k].totalSeconds += m.durationSeconds ?? 0;
    }
    if (m.mediaType === "voice_message") {
      voiceNotes[k].count++;
      voiceNotes[k].totalSeconds += m.durationSeconds ?? 0;
    }
    for (const r of m.reactions) {
      reactionsReceived[k] += r.count ?? 0;
      // `reactions[].recent` names who reacted. Prefer the id, since a person
      // can react to their own message and assuming otherwise would credit it
      // to the wrong side; fall back to "the other one" only when the export is
      // too old to say.
      for (const who of r.recent ?? []) {
        const side = who.from_id ? idToSide.get(who.from_id) : undefined;
        reactionsGiven[key(side ?? (m.who === 0 ? 1 : 0))]++;
      }
    }
  }

  const initiated = emptyPairNum();
  const minutes = emptyPairNum();
  const discardReasons: Record<string, number> = {};
  for (const c of calls) {
    const k = key(c.by);
    initiated[k]++;
    minutes[k] += c.durationSeconds / 60;
    const reason = c.discardReason ?? "unknown";
    discardReasons[reason] = (discardReasons[reason] ?? 0) + 1;
  }

  return {
    quoteReplies,
    edits,
    forwards,
    stickers,
    videoNotes,
    voiceNotes,
    reactionsGiven,
    reactionsReceived,
    calls: {
      total: calls.length,
      totalMinutes: minutes.a + minutes.b,
      initiated,
      minutes,
      discardReasons,
    },
  };
}

function buildConcentration(messages: Message[], sessionSizes: number[]): Concentration {
  const total = messages.length;
  const sizes = [...sessionSizes].sort((x, y) => y - x);

  const byDay = new Map<string, { total: number; counts: Pair<number> }>();
  for (const m of messages) {
    const d = localDate(m.ts);
    const entry = byDay.get(d) ?? { total: 0, counts: emptyPairNum() };
    entry.total++;
    entry.counts[key(m.who)]++;
    byDay.set(d, entry);
  }
  const dayTotals = [...byDay.values()].map((v) => v.total).sort((x, y) => y - x);

  const cumulative = (arr: number[], ns: number[]) =>
    ns.map((n) => {
      const messagesInTop = arr.slice(0, n).reduce((x, y) => x + y, 0);
      return { n, messages: messagesInTop, share: share(messagesInTop, total) };
    });

  return {
    sessions: sessionSizes.length,
    topSessionShare: cumulative(sizes, [1, 5, 10, 25, 50]),
    topDayShare: cumulative(dayTotals, [1, 5, 10, 25]),
    busiestDays: [...byDay.entries()]
      .sort((x, y) => y[1].total - x[1].total)
      .slice(0, 10)
      .map(([date, v]) => ({ date, total: v.total, counts: v.counts })),
  };
}

/** Everything deterministic, in one pass over an already-parsed export. */
export function analyzeParsed(parsed: Parsed): Analysis {
  const { chat, messages, calls, idToSide } = parsed;
  const dates = activeDates(messages);
  const firstTs = messages[0].ts;
  const lastTs = messages[messages.length - 1].ts;
  const spanDays = (lastTs - firstTs) / DAY;

  const sessions = buildSessions(messages);

  return {
    chat,
    span: {
      firstTs,
      lastTs,
      days: spanDays,
      activeDays: dates.length,
      activeShare: share(dates.length, spanDays),
    },
    volume: buildVolume(messages, dates.length),
    sessions,
    sessionSummary: summarizeSessions(sessions),
    episodes: buildEpisodes(messages),
    chapters: buildChapters(messages),
    rhythm: buildRhythm(messages),
    language: buildLanguage(messages, chat.participants),
    behaviour: buildBehaviour(messages, calls, idToSide),
    concentration: buildConcentration(
      messages,
      sessions.map((s) => s.messageCount),
    ),
  };
}

/** Parse + analyze in one call. Takes the already-JSON.parsed export object. */
export function analyze(raw: unknown): { analysis: Analysis; parsed: Parsed } {
  const parsed = parseExport(raw);
  return { analysis: analyzeParsed(parsed), parsed };
}
