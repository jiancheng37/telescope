import { ParseError, flattenText } from "./parse";
import type { RawExport, RawMessage } from "./types";
import { extractEmoji } from "./language";

export const GROUP_EXPORT_TYPES = new Set(["private_group", "private_supergroup", "public_supergroup"]);

export function isGroupExport(raw: unknown): raw is RawExport {
  return Boolean(raw && typeof raw === "object" && GROUP_EXPORT_TYPES.has(String((raw as { type?: unknown }).type)));
}

export interface GroupMessage {
  id: number;
  ts: number;
  participantId: string;
  text: string;
  replyToMessageId?: number;
  media: boolean;
  mediaType?: string;
  stickerEmoji?: string;
  assetPath?: string;
  reactions: number;
  reactionBreakdown: Array<{ emoji: string; count: number }>;
}

export interface ParsedGroup {
  chat: { id: number; name: string; type: string };
  participants: Array<{ id: string; name: string }>;
  messages: GroupMessage[];
  skipped: { serviceMessages: number; noSender: number; noTimestamp: number };
}

export interface GroupParticipantStats {
  id: string;
  name: string;
  messages: number;
  share: number;
  words: number;
  chars: number;
  media: number;
  reactionsReceived: number;
  activeDays: number;
  firstTs: number;
  lastTs: number;
}

/** Stable identity for one selected set of Telegram group participants. */
export function groupParticipantSetKey(participants: ReadonlyArray<{ id: string }>): string {
  return JSON.stringify([...new Set(participants.map((participant) => participant.id))].sort());
}

export interface GroupAnalysis {
  kind: "group";
  chat: { id: number; name: string; type: string };
  totalMessages: number;
  span: { firstTs: number; lastTs: number; days: number; activeDays: number };
  participants: GroupParticipantStats[];
  hourly: number[];
  hourlyByParticipant: Array<{ id: string; name: string; counts: number[] }>;
  monthly: Array<{ month: string; ts: number; total: number }>;
  monthlyLeaders: Array<{ month: string; total: number; participantId: string | null; name: string | null; messages: number; share: number }>;
  starters: Array<{ id: string; name: string; count: number; share: number }>;
  restartCount: number;
  language: {
    topWords: Array<{ word: string; count: number }>;
    distinctive: Array<{ id: string; name: string; words: Array<{ word: string; count: number }> }>;
  };
  speech: {
    averageChars: number;
    mediaShare: number;
    consecutiveShare: number;
    topAverageChars: Array<{ id: string; name: string; value: number }>;
  };
  /** Optional so group reports saved before these metrics were introduced remain readable. */
  emoji?: Array<{ id: string; name: string; total: number; top: Array<{ emoji: string; count: number }> }>;
  stickers?: Array<{ id: string; name: string; total: number; top: Array<{ emoji: string; count: number }> }>;
  doubleTexting?: {
    frequency: Array<{ id: string; name: string; count: number }>;
    longest: { participantId: string; doubleTexts: number; messages: number; startTs: number; endTs: number; messageIds: number[] } | null;
  };
  extremes: {
    longestSilenceSec: number;
    busiestDay: { date: string; messages: number } | null;
    longestMessage: { messageId: number; participantId: string; chars: number; ts: number } | null;
    longestRun: { participantId: string; messages: number; messageIds: number[] } | null;
  };
  replyPairs: Array<{ fromId: string; toId: string; count: number }>;
  strongestPair: { firstId: string; firstName: string; secondId: string; secondName: string; replies: number } | null;
  reactionLeaders: Array<{ id: string; name: string; reactions: number; messages: number; topReactions?: Array<{ emoji: string; count: number }> }>;
  skipped: ParsedGroup["skipped"];
}

const STOP_WORDS = new Set("a an and are as at be been but by can did do for from had has have he her hers him his i if in is it its just me my no not of on or our ours she so that the their theirs them they this to too us was we were what when where which who will with would you your yours".split(" "));

function monthKey(ts: number): string {
  const date = new Date(ts * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function wordsIn(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) ?? [];
}

function dateKey(ts: number): string {
  const date = new Date(ts * 1000);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function hasMedia(message: RawMessage): boolean {
  return Boolean(message.media_type || message.file || message.photo || message.sticker_emoji);
}

function reactionCount(message: RawMessage): number {
  return (message.reactions ?? []).reduce((sum, reaction) => sum + Math.max(0, Number(reaction.count) || 0), 0);
}

function reactionBreakdown(message: RawMessage): Array<{ emoji: string; count: number }> {
  return (message.reactions ?? []).flatMap((reaction) => {
    const emoji = reaction.emoji?.trim();
    const count = Math.max(0, Number(reaction.count) || 0);
    return emoji && count ? [{ emoji, count }] : [];
  });
}

export function parseGroupExport(raw: unknown): ParsedGroup {
  if (!isGroupExport(raw)) throw new ParseError("That file is not a supported Telegram group export.");
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) throw new ParseError("This group export has no messages in it.");

  const names = new Map<string, string>();
  const messages: GroupMessage[] = [];
  const skipped = { serviceMessages: 0, noSender: 0, noTimestamp: 0 };
  for (const message of raw.messages) {
    const ts = Number(message.date_unixtime);
    if (!Number.isFinite(ts) || ts <= 0) {
      skipped.noTimestamp++;
      continue;
    }
    if (message.type !== "message") {
      skipped.serviceMessages++;
      continue;
    }
    if (!message.from_id) {
      skipped.noSender++;
      continue;
    }
    names.set(message.from_id, message.from?.trim() || names.get(message.from_id) || "Deleted account");
    messages.push({
      id: message.id,
      ts,
      participantId: message.from_id,
      text: flattenText(message),
      replyToMessageId: message.reply_to_message_id,
      media: hasMedia(message),
      mediaType: message.media_type,
      stickerEmoji: message.sticker_emoji,
      assetPath: message.media_type === "sticker" && message.file && !message.file.startsWith("(") ? message.file : undefined,
      reactions: reactionCount(message),
      reactionBreakdown: reactionBreakdown(message),
    });
  }
  if (messages.length === 0) throw new ParseError("Nothing left after filtering—no real messages were found in this group export.");
  const activeIds = new Set(messages.map((message) => message.participantId));
  if (activeIds.size < 3) throw new ParseError("This group needs messages from at least three people.", "Use the direct-chat report for a two-person conversation.");
  messages.sort((a, b) => a.ts - b.ts || a.id - b.id);
  return {
    chat: { id: raw.id, name: raw.name || "Group chat", type: raw.type },
    participants: [...activeIds].map((id) => ({ id, name: names.get(id) ?? "Deleted account" })),
    messages,
    skipped,
  };
}

export function selectGroupParticipants(parsed: ParsedGroup, includedIds: ReadonlySet<string>, displayNames?: ReadonlyMap<string, string>): ParsedGroup {
  const participants = parsed.participants
    .filter((participant) => includedIds.has(participant.id))
    .map((participant) => ({ ...participant, name: displayNames?.get(participant.id)?.trim() || participant.name }));
  if (participants.length < 3) throw new ParseError("Keep at least three people in a group report.");
  const messages = parsed.messages.filter((message) => includedIds.has(message.participantId));
  if (!messages.length) throw new ParseError("The selected people have no messages in this export.");
  return { ...parsed, participants, messages };
}

export function analyzeGroup(parsed: ParsedGroup): GroupAnalysis {
  const totals = new Map<string, Omit<GroupParticipantStats, "share"> & { dates: Set<string> }>();
  for (const participant of parsed.participants) {
    totals.set(participant.id, { ...participant, messages: 0, words: 0, chars: 0, media: 0, reactionsReceived: 0, activeDays: 0, firstTs: Infinity, lastTs: 0, dates: new Set() });
  }
  const hourly = new Array<number>(24).fill(0);
  const hourlyById = new Map(parsed.participants.map((participant) => [participant.id, new Array<number>(24).fill(0)]));
  const monthTotals = new Map<string, number>();
  const monthById = new Map<string, Map<string, number>>();
  const starterTotals = new Map<string, number>();
  const dayTotals = new Map<string, number>();
  const wordTotals = new Map<string, number>();
  const wordsById = new Map(parsed.participants.map((participant) => [participant.id, new Map<string, number>()]));
  const byMessageId = new Map<number, string>();
  const replies = new Map<string, number>();
  const reactionsById = new Map(parsed.participants.map((participant) => [participant.id, new Map<string, number>()]));
  const emojiById = new Map(parsed.participants.map((participant) => [participant.id, new Map<string, number>()]));
  const stickersById = new Map(parsed.participants.map((participant) => [participant.id, new Map<string, number>()]));
  let longestSilenceSec = 0;
  let longestMessage: GroupAnalysis["extremes"]["longestMessage"] = null;
  let longestRunId = "";
  let longestRun = 0;
  let currentRunId = "";
  let currentRun = 0;
  let currentRunIds: number[] = [];
  let longestRunIds: number[] = [];
  let consecutiveMessages = 0;
  for (const message of parsed.messages) {
    const stats = totals.get(message.participantId)!;
    stats.messages++;
    stats.chars += [...message.text].length;
    stats.words += message.text.trim() ? message.text.trim().split(/\s+/).length : 0;
    stats.media += Number(message.media);
    stats.reactionsReceived += message.reactions;
    const personalReactions = reactionsById.get(message.participantId)!;
    for (const reaction of message.reactionBreakdown) personalReactions.set(reaction.emoji, (personalReactions.get(reaction.emoji) ?? 0) + reaction.count);
    const personalEmoji = emojiById.get(message.participantId)!;
    for (const emoji of extractEmoji(message.text)) personalEmoji.set(emoji, (personalEmoji.get(emoji) ?? 0) + 1);
    if (message.mediaType === "sticker") {
      const emoji = message.stickerEmoji?.trim() || "Sticker";
      const personalStickers = stickersById.get(message.participantId)!;
      personalStickers.set(emoji, (personalStickers.get(emoji) ?? 0) + 1);
    }
    stats.firstTs = Math.min(stats.firstTs, message.ts);
    stats.lastTs = Math.max(stats.lastTs, message.ts);
    stats.dates.add(dateKey(message.ts));
    const hour = new Date(message.ts * 1000).getHours();
    hourly[hour]++;
    hourlyById.get(message.participantId)![hour]++;
    monthTotals.set(monthKey(message.ts), (monthTotals.get(monthKey(message.ts)) ?? 0) + 1);
    const perMonth = monthById.get(monthKey(message.ts)) ?? new Map<string, number>();
    perMonth.set(message.participantId, (perMonth.get(message.participantId) ?? 0) + 1);
    monthById.set(monthKey(message.ts), perMonth);
    dayTotals.set(dateKey(message.ts), (dayTotals.get(dateKey(message.ts)) ?? 0) + 1);
    for (const word of wordsIn(message.text)) {
      wordTotals.set(word, (wordTotals.get(word) ?? 0) + 1);
      const personal = wordsById.get(message.participantId)!;
      personal.set(word, (personal.get(word) ?? 0) + 1);
    }
    const chars = [...message.text].length;
    if (!longestMessage || chars > longestMessage.chars) longestMessage = { messageId: message.id, participantId: message.participantId, chars, ts: message.ts };
    if (currentRunId === message.participantId) { currentRun++; currentRunIds.push(message.id); consecutiveMessages++; } else { currentRunId = message.participantId; currentRun = 1; currentRunIds = [message.id]; }
    if (currentRun > longestRun) { longestRun = currentRun; longestRunId = message.participantId; longestRunIds = [...currentRunIds]; }
    if (message.replyToMessageId !== undefined) {
      const targetId = byMessageId.get(message.replyToMessageId);
      if (targetId && targetId !== message.participantId) {
        const key = `${message.participantId}\u0000${targetId}`;
        replies.set(key, (replies.get(key) ?? 0) + 1);
      }
    }
    byMessageId.set(message.id, message.participantId);
  }
  for (let index = 1; index < parsed.messages.length; index++) {
    const gap = parsed.messages[index].ts - parsed.messages[index - 1].ts;
    longestSilenceSec = Math.max(longestSilenceSec, gap);
    if (gap > 2 * 60 * 60) starterTotals.set(parsed.messages[index].participantId, (starterTotals.get(parsed.messages[index].participantId) ?? 0) + 1);
  }
  const firstTs = parsed.messages[0].ts;
  const lastTs = parsed.messages[parsed.messages.length - 1].ts;
  const participants = [...totals.values()]
    .map(({ dates, ...stats }) => ({ ...stats, activeDays: dates.size, share: stats.messages / parsed.messages.length }))
    .sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name));
  const restartCount = [...starterTotals.values()].reduce((sum, count) => sum + count, 0);
  const namesById = new Map(participants.map((participant) => [participant.id, participant.name]));
  const firstMonth = new Date(firstTs * 1000);
  const lastMonth = new Date(lastTs * 1000);
  const monthly: GroupAnalysis["monthly"] = [];
  const cursor = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), 1);
  const end = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
  while (cursor <= end) {
    const ts = Math.floor(cursor.getTime() / 1000);
    const month = monthKey(ts);
    monthly.push({ month, ts, total: monthTotals.get(month) ?? 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const monthlyLeaders = monthly.map((month) => {
    const leader = [...(monthById.get(month.month)?.entries() ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { month: month.month, total: month.total, participantId: leader?.[0] ?? null, name: leader ? namesById.get(leader[0]) ?? null : null, messages: leader?.[1] ?? 0, share: month.total && leader ? leader[1] / month.total : 0 };
  });
  const topWords = [...wordTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([word, count]) => ({ word, count }));
  const distinctive = participants.slice(0, 6).map((participant) => {
    const personal = wordsById.get(participant.id)!;
    const words = [...personal.entries()]
      .filter(([, count]) => count >= 2)
      .map(([word, count]) => ({ word, count, score: count / Math.max(1, wordTotals.get(word) ?? count) }))
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, 3)
      .map(({ word, count }) => ({ word, count }));
    return { id: participant.id, name: participant.name, words };
  });
  const busiestDayEntry = [...dayTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const replyPairs = [...replies.entries()]
    .map(([key, count]) => { const [fromId, toId] = key.split("\u0000"); return { fromId, toId, count }; })
    .sort((a, b) => b.count - a.count);
  const undirected = new Map<string, number>();
  for (const pair of replyPairs) {
    const ids = [pair.fromId, pair.toId].sort();
    const key = `${ids[0]}\u0000${ids[1]}`;
    undirected.set(key, (undirected.get(key) ?? 0) + pair.count);
  }
  const strongestEntry = [...undirected.entries()].sort((a, b) => b[1] - a[1])[0];
  const strongestIds = strongestEntry?.[0].split("\u0000");
  const doubleFrequency = new Map(parsed.participants.map((participant) => [participant.id, 0]));
  let longestDouble: NonNullable<GroupAnalysis["doubleTexting"]>["longest"] = null;
  for (let start = 0; start < parsed.messages.length;) {
    let end = start + 1;
    while (end < parsed.messages.length && parsed.messages[end].participantId === parsed.messages[start].participantId) end++;
    let qualifying = 0;
    for (let index = start + 1; index < end; index++) if (parsed.messages[index].ts - parsed.messages[index - 1].ts >= 120) qualifying++;
    if (qualifying) {
      const id = parsed.messages[start].participantId;
      doubleFrequency.set(id, (doubleFrequency.get(id) ?? 0) + qualifying);
      const candidate = { participantId: id, doubleTexts: qualifying, messages: end - start, startTs: parsed.messages[start].ts, endTs: parsed.messages[end - 1].ts, messageIds: parsed.messages.slice(start, end).map((message) => message.id) };
      if (!longestDouble || candidate.doubleTexts > longestDouble.doubleTexts || (candidate.doubleTexts === longestDouble.doubleTexts && candidate.endTs - candidate.startTs > longestDouble.endTs - longestDouble.startTs)) longestDouble = candidate;
    }
    start = end;
  }
  const rankedUses = (source: Map<string, Map<string, number>>) => participants.map((participant) => { const counts = source.get(participant.id) ?? new Map(); return { id: participant.id, name: participant.name, total: [...counts.values()].reduce((sum, count) => sum + count, 0), top: [...counts.entries()].map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)).slice(0, 5) }; }).filter((participant) => participant.total > 0).sort((a, b) => b.total - a.total);
  return {
    kind: "group",
    chat: parsed.chat,
    totalMessages: parsed.messages.length,
    span: {
      firstTs,
      lastTs,
      days: Math.max(1, (lastTs - firstTs) / 86400),
      activeDays: new Set(parsed.messages.map((message) => dateKey(message.ts))).size,
    },
    participants,
    hourly,
    hourlyByParticipant: participants.slice(0, 4).map((participant) => ({ id: participant.id, name: participant.name, counts: hourlyById.get(participant.id)! })),
    monthly,
    monthlyLeaders,
    restartCount,
    starters: participants.map((participant) => ({ id: participant.id, name: participant.name, count: starterTotals.get(participant.id) ?? 0, share: restartCount ? (starterTotals.get(participant.id) ?? 0) / restartCount : 0 })).filter((participant) => participant.count > 0).sort((a, b) => b.count - a.count),
    language: { topWords, distinctive },
    speech: {
      averageChars: parsed.messages.reduce((sum, message) => sum + [...message.text].length, 0) / parsed.messages.length,
      mediaShare: parsed.messages.filter((message) => message.media).length / parsed.messages.length,
      consecutiveShare: consecutiveMessages / parsed.messages.length,
      topAverageChars: participants.map((participant) => ({ id: participant.id, name: participant.name, value: participant.chars / participant.messages })).sort((a, b) => b.value - a.value).slice(0, 5),
    },
    emoji: rankedUses(emojiById),
    stickers: rankedUses(stickersById),
    doubleTexting: { frequency: participants.map((participant) => ({ id: participant.id, name: participant.name, count: doubleFrequency.get(participant.id) ?? 0 })).sort((a, b) => b.count - a.count), longest: longestDouble },
    extremes: {
      longestSilenceSec,
      busiestDay: busiestDayEntry ? { date: busiestDayEntry[0], messages: busiestDayEntry[1] } : null,
      longestMessage,
      longestRun: longestRunId ? { participantId: longestRunId, messages: longestRun, messageIds: longestRunIds } : null,
    },
    replyPairs,
    strongestPair: strongestEntry && strongestIds ? { firstId: strongestIds[0], firstName: namesById.get(strongestIds[0]) ?? "Unknown", secondId: strongestIds[1], secondName: namesById.get(strongestIds[1]) ?? "Unknown", replies: strongestEntry[1] } : null,
    reactionLeaders: participants.filter((participant) => participant.reactionsReceived > 0).map((participant) => ({ id: participant.id, name: participant.name, reactions: participant.reactionsReceived, messages: participant.messages, topReactions: [...(reactionsById.get(participant.id)?.entries() ?? [])].map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)).slice(0, 5) })).sort((a, b) => b.reactions - a.reactions).slice(0, 8),
    skipped: parsed.skipped,
  };
}
