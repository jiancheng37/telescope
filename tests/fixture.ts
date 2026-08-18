import type { RawExport, RawMessage } from "../src/domain/types";

const DAY = 86400;
/** 2025-01-01T12:00:00 local. Fixed so tests never depend on the clock. */
export const T0 = Math.floor(new Date(2025, 0, 1, 12, 0, 0).getTime() / 1000);

export const ALICE = "user1000";
export const BOB = "user2000";

let nextId = 1;

/** Call in `beforeEach` when a test needs message ids to start from 1 again. */
export function resetIds(): void {
  nextId = 1;
}

/**
 * A timestamp at a specific *local* hour, so hour-of-day assertions don't depend
 * on the machine's timezone. January so no DST transition can move it.
 */
export function at(dayOffset: number, hour: number, minute = 0): number {
  return Math.floor(new Date(2025, 0, 1 + dayOffset, hour, minute, 0).getTime() / 1000);
}

interface MsgOpts {
  at: number;
  from: "alice" | "bob";
  text?: string | Array<string | { type: string; text: string }>;
  entities?: Array<{ type: string; text: string }>;
  media?: string;
  /** the `photo` path a real export carries; no `media_type` accompanies it */
  photo?: string;
  file?: string;
  mime?: string;
  sticker?: string;
  duration?: number;
  replyTo?: number;
  forwardedFrom?: string;
  edited?: boolean;
  reactions?: RawMessage["reactions"];
}

export function msg(o: MsgOpts): RawMessage {
  const isAlice = o.from === "alice";
  const m: RawMessage = {
    id: nextId++,
    type: "message",
    date: new Date(o.at * 1000).toISOString(),
    date_unixtime: String(o.at),
    from: isAlice ? "Alice" : "Bob",
    from_id: isAlice ? ALICE : BOB,
  };
  if (o.text !== undefined) m.text = o.text;
  else m.text = "";
  if (o.entities) m.text_entities = o.entities;
  if (o.media) m.media_type = o.media;
  if (o.photo) m.photo = o.photo;
  if (o.file) m.file = o.file;
  if (o.mime) m.mime_type = o.mime;
  if (o.sticker) m.sticker_emoji = o.sticker;
  if (o.duration !== undefined) m.duration_seconds = o.duration;
  if (o.replyTo !== undefined) m.reply_to_message_id = o.replyTo;
  if (o.forwardedFrom) m.forwarded_from = o.forwardedFrom;
  if (o.edited) m.edited = new Date((o.at + 60) * 1000).toISOString();
  if (o.reactions) m.reactions = o.reactions;
  return m;
}

export function call(at: number, by: "alice" | "bob", duration: number, discard?: string): RawMessage {
  return {
    id: nextId++,
    type: "service",
    date: new Date(at * 1000).toISOString(),
    date_unixtime: String(at),
    actor: by === "alice" ? "Alice" : "Bob",
    actor_id: by === "alice" ? ALICE : BOB,
    action: "phone_call",
    duration_seconds: duration,
    discard_reason: discard,
  };
}

/**
 * Alice is side 0 (the chat's counterpart, matching the top-level id); Bob is
 * side 1 (the person who ran the export).
 */
export function makeExport(messages: RawMessage[]): RawExport {
  return { name: "Alice", type: "personal_chat", id: 1000, messages };
}

export { DAY };
