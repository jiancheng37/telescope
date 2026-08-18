import type { Call, Chat, Message, RawExport, RawMessage, Side } from "./types";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export interface Parsed {
  chat: Chat;
  /** ascending by timestamp */
  messages: Message[];
  calls: Call[];
  /** which side is the person who ran the export, if we can tell */
  selfSide: Side | null;
  /** `from_id` → side, needed to attribute things the export names by id */
  idToSide: Map<string, Side>;
  /** things we silently dropped, surfaced so the UI can be honest about them */
  skipped: { serviceMessages: number; thirdParties: number; noTimestamp: number };
}

/**
 * The `text` field is either a plain string or an array mixing bare strings
 * with `{type, text}` entity objects. `text_entities` carries the same content
 * in a uniform shape and is present in every export we've seen, so prefer it.
 */
export function flattenText(m: RawMessage): string {
  if (m.text_entities?.length) {
    return m.text_entities.map((e) => e.text ?? "").join("");
  }
  const t = m.text;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    return t.map((x) => (typeof x === "string" ? x : (x.text ?? ""))).join("");
  }
  return "";
}

/**
 * What was attached, when `media_type` doesn't say. Photos are the case that
 * matters: the export marks them with a `photo` path and no `media_type`, so
 * they'd otherwise be lumped in with documents. Only consulted for messages
 * `media_type` didn't already classify — stickers are `image/webp` and would
 * otherwise be miscounted as photos.
 */
function attachmentOf(m: RawMessage): "photo" | "file" | undefined {
  if (m.media_type !== undefined) return undefined;
  if (m.photo !== undefined || m.mime_type?.startsWith("image/")) return "photo";
  return m.file !== undefined ? "file" : undefined;
}

export function parseExport(raw: unknown): Parsed {
  if (!raw || typeof raw !== "object") {
    throw new ParseError("That file isn't a Telegram export.");
  }
  const ex = raw as RawExport;
  if (!Array.isArray(ex.messages)) {
    throw new ParseError("No `messages` array in this file.", "Did you pick result.json?");
  }
  if (ex.messages.length === 0) {
    throw new ParseError("This export has no messages in it.");
  }
  if (ex.type && ex.type !== "personal_chat") {
    throw new ParseError(
      `This is a ${ex.type.replace(/_/g, " ")}, not a one-on-one chat.`,
      "Telescope only reads 1:1 chats for now.",
    );
  }

  // Identity comes from from_id — display names can repeat or be empty.
  const freq = new Map<string, { name: string; count: number }>();
  for (const m of ex.messages) {
    if (m.type !== "message" || !m.from_id) continue;
    const seen = freq.get(m.from_id);
    if (seen) seen.count++;
    else freq.set(m.from_id, { name: m.from ?? m.from_id, count: 1 });
  }
  const ranked = [...freq.entries()].sort((x, y) => y[1].count - x[1].count);
  if (ranked.length < 2) {
    throw new ParseError(
      "Only one person ever sent a message in this chat.",
      "Telescope compares two people, so there's nothing to compare here.",
    );
  }

  // In a personal_chat export the top-level `id` is the counterpart's user id,
  // which is how we tell "them" from "you". Side 0 is always the counterpart.
  const counterpartId = `user${ex.id}`;
  const top2 = ranked.slice(0, 2);
  const counterpartFirst =
    top2[1][0] === counterpartId ? [top2[1], top2[0]] : [top2[0], top2[1]];
  const [sideA, sideB] = counterpartFirst;

  const idToSide = new Map<string, Side>([
    [sideA[0], 0],
    [sideB[0], 1],
  ]);
  const selfSide: Side | null = sideA[0] === counterpartId ? 1 : null;

  const chat: Chat = {
    name: ex.name ?? "chat",
    id: ex.id,
    participants: [sideA[1].name, sideB[1].name],
  };

  const messages: Message[] = [];
  const calls: Call[] = [];
  const skipped = { serviceMessages: 0, thirdParties: 0, noTimestamp: 0 };

  for (const m of ex.messages) {
    const ts = Number(m.date_unixtime);
    if (!Number.isFinite(ts) || ts <= 0) {
      skipped.noTimestamp++;
      continue;
    }

    if (m.type === "service") {
      if (m.action === "phone_call") {
        const by = m.actor_id ? idToSide.get(m.actor_id) : undefined;
        if (by !== undefined) {
          calls.push({
            id: m.id,
            ts,
            by,
            durationSeconds: m.duration_seconds ?? 0,
            discardReason: m.discard_reason,
          });
        }
      }
      skipped.serviceMessages++;
      continue;
    }

    const who = m.from_id ? idToSide.get(m.from_id) : undefined;
    if (who === undefined) {
      // A third party appears in 1:1 exports only via odd legacy cases.
      skipped.thirdParties++;
      continue;
    }

    messages.push({
      id: m.id,
      ts,
      who,
      text: flattenText(m),
      mediaType: m.media_type,
      attachment: attachmentOf(m),
      stickerEmoji: m.sticker_emoji,
      assetPath: m.media_type === "sticker" && m.file && !m.file.startsWith("(") ? m.file : undefined,
      durationSeconds: m.duration_seconds,
      isReply: m.reply_to_message_id !== undefined,
      isForward: m.forwarded_from !== undefined,
      isEdited: m.edited !== undefined,
      reactions: m.reactions ?? [],
    });
  }

  if (messages.length === 0) {
    throw new ParseError("Nothing left after filtering — no real messages in this export.");
  }

  messages.sort((x, y) => x.ts - y.ts || x.id - y.id);
  calls.sort((x, y) => x.ts - y.ts);

  return { chat, messages, calls, selfSide, idToSide, skipped };
}
