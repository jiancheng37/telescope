import { describe, expect, it } from "vitest";
import { analyzeGroup, groupParticipantSetKey, isGroupExport, parseGroupExport, selectGroupParticipants } from "../src/domain/group";
import type { RawExport, RawMessage } from "../src/domain/types";

function groupExport(): RawExport {
  const senders = [["user1", "Alice"], ["user2", "Bob"], ["user3", "Carla"]] as const;
  const messages: RawMessage[] = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    type: "message",
    date: new Date((1_700_000_000 + index * 60) * 1000).toISOString(),
    date_unixtime: String(1_700_000_000 + index * 60),
    from_id: senders[index % senders.length][0],
    from: senders[index % senders.length][1],
    text: index % 2 ? "two words" : "hello",
    ...(index > 0 ? { reply_to_message_id: index } : {}),
  }));
  return { name: "The Group", type: "private_group", id: 77, messages };
}

describe("group exports", () => {
  it("identifies a participant set independently of ordering", () => {
    expect(groupParticipantSetKey([{ id: "user3" }, { id: "user1" }, { id: "user2" }])).toBe('["user1","user2","user3"]');
    expect(groupParticipantSetKey([{ id: "user1" }, { id: "user2" }, { id: "user3" }])).toBe('["user1","user2","user3"]');
    expect(groupParticipantSetKey([{ id: "user1" }, { id: "user2" }, { id: "user4" }])).not.toBe('["user1","user2","user3"]');
  });

  it("detects supported Telegram group types without treating direct chats as groups", () => {
    expect(isGroupExport(groupExport())).toBe(true);
    expect(isGroupExport({ ...groupExport(), type: "personal_chat" })).toBe(false);
  });

  it("keeps stable participant ids and calculates participation", () => {
    const parsed = parseGroupExport(groupExport());
    const analysis = analyzeGroup(parsed);
    expect(parsed.participants).toHaveLength(3);
    expect(analysis.totalMessages).toBe(12);
    expect(analysis.participants.map((person) => person.messages)).toEqual([4, 4, 4]);
    expect(analysis.participants.reduce((sum, person) => sum + person.share, 0)).toBeCloseTo(1);
    expect(analysis.replyPairs.reduce((sum, pair) => sum + pair.count, 0)).toBe(11);
    expect(analysis.monthly).toHaveLength(1);
    expect(analysis.monthly[0].total).toBe(12);
    expect(analysis.hourly.reduce((sum, count) => sum + count, 0)).toBe(12);
    expect(analysis.language.topWords[0]).toEqual({ word: "hello", count: 6 });
    expect(analysis.extremes.longestRun?.messages).toBe(1);
    expect(analysis.extremes.longestRun?.messageIds).toHaveLength(1);
    expect(analysis.extremes.longestMessage).toHaveProperty("messageId");
    expect(analysis.extremes.longestMessage).not.toHaveProperty("text");
    expect(analysis.speech.averageChars).toBeGreaterThan(0);
    expect(analysis.strongestPair?.replies).toBeGreaterThan(0);
    expect(analysis.monthlyLeaders[0]).toMatchObject({ month: analysis.monthly[0].month, total: 12, messages: 4 });
  });

  it("credits the first sender after a two-hour silence with restarting the group", () => {
    const raw = groupExport();
    raw.messages[6].date_unixtime = String(1_700_000_000 + 4 * 60 * 60);
    for (let index = 7; index < raw.messages.length; index++) raw.messages[index].date_unixtime = String(1_700_000_000 + 4 * 60 * 60 + (index - 6) * 60);
    const analysis = analyzeGroup(parseGroupExport(raw));
    expect(analysis.restartCount).toBe(1);
    expect(analysis.starters[0]).toMatchObject({ id: "user1", name: "Alice", count: 1, share: 1 });
    expect(analysis.extremes.longestSilenceSec).toBeGreaterThan(2 * 60 * 60);
  });

  it("counts reactions received on each participant's messages", () => {
    const raw = groupExport();
    raw.messages[0].reactions = [{ type: "emoji", emoji: "❤", count: 7 }];
    raw.messages[1].reactions = [{ type: "emoji", emoji: "👍", count: 2 }];
    const analysis = analyzeGroup(parseGroupExport(raw));
    expect(analysis.reactionLeaders[0]).toMatchObject({ id: "user1", name: "Alice", reactions: 7 });
    expect(analysis.reactionLeaders[0].topReactions).toEqual([{ emoji: "❤", count: 7 }]);
    expect(analysis.participants.find((person) => person.id === "user2")?.reactionsReceived).toBe(2);
  });

  it("counts participant emoji, stickers, and double texts locally", () => {
    const raw = groupExport();
    raw.messages[0].text = "😭😭 hello";
    raw.messages[0].media_type = "sticker";
    raw.messages[0].sticker_emoji = "🫡";
    raw.messages[0].file = "stickers/sticker.webp";
    raw.messages[1].from_id = "user1";
    raw.messages[1].from = "Alice";
    raw.messages[2].from_id = "user1";
    raw.messages[2].from = "Alice";
    raw.messages[1].date_unixtime = String(1_700_000_000 + 180);
    raw.messages[2].date_unixtime = String(1_700_000_000 + 360);
    for (let index = 3; index < raw.messages.length; index++) raw.messages[index].date_unixtime = String(1_700_000_000 + 1_000 + index * 60);
    const analysis = analyzeGroup(parseGroupExport(raw));
    expect(analysis.emoji?.find((person) => person.id === "user1")?.top[0]).toEqual({ emoji: "😭", count: 2 });
    expect(analysis.stickers?.find((person) => person.id === "user1")?.top[0]).toEqual({ emoji: "🫡", count: 1 });
    expect(analysis.doubleTexting?.longest).toMatchObject({ participantId: "user1", doubleTexts: 3, messages: 4 });
  });

  it("requires at least three active senders", () => {
    const raw = groupExport();
    raw.messages = raw.messages.filter((message) => message.from_id !== "user3");
    expect(() => parseGroupExport(raw)).toThrow(/at least three people/i);
  });

  it("removes excluded participants and all of their messages before analysis", () => {
    const raw = groupExport();
    raw.messages.push({ id: 13, type: "message", date: new Date(1_700_001_000 * 1000).toISOString(), date_unixtime: "1700001000", from_id: "user4", from: "Bot", text: "automated" });
    const selected = selectGroupParticipants(parseGroupExport(raw), new Set(["user1", "user2", "user3"]));
    expect(selected.participants.map((person) => person.name)).toEqual(["Alice", "Bob", "Carla"]);
    expect(selected.messages).toHaveLength(12);
    expect(analyzeGroup(selected).participants.some((person) => person.name === "Bot")).toBe(false);
  });

  it("uses reviewed display names without changing participant identity", () => {
    const parsed = parseGroupExport(groupExport());
    const selected = selectGroupParticipants(parsed, new Set(["user1", "user2", "user3"]), new Map([["user1", "Alicia"], ["user2", "Robert"]]));
    expect(selected.participants).toEqual([
      { id: "user1", name: "Alicia" },
      { id: "user2", name: "Robert" },
      { id: "user3", name: "Carla" },
    ]);
    expect(selected.messages[0].participantId).toBe("user1");
  });

  it("does not allow a group report with fewer than three selected people", () => {
    expect(() => selectGroupParticipants(parseGroupExport(groupExport()), new Set(["user1", "user2"]))).toThrow(/at least three/i);
  });
});
