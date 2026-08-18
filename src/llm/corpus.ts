/**
 * The message payload handed to the model.
 *
 * Two things drive the format. First, metadata is the expensive part — raw ids
 * and per-message timestamps were ~60% of a JSON payload, so messages get a
 * sequential number instead of their real id and the clock is carried by session
 * headers rather than repeated on every line. Second, every claim the model
 * makes has to be checkable, which means each line needs a stable handle the
 * model can cite and we can look up afterwards. That handle is `seq`.
 */
import { SESSION_GAP_MIN } from "../domain/sessions";
import type { Parsed } from "../domain/parse";
import type { Call, Message, Side } from "../domain/types";

const DAY = 86400;

export type LineKind = "text" | "sticker" | "photo" | "voice" | "video" | "media" | "call";

export interface Line {
  /** 1-based, and the only id the model ever sees. What it cites. */
  seq: number;
  /** the real Telegram message id, so a citation can be traced back to the export */
  messageId: number | null;
  ts: number;
  who: Side;
  kind: LineKind;
  /** rendered single-line body, exactly as the model sees it */
  body: string;
}

/**
 * Characters per token in a payload of this shape.
 *
 * Measured, not assumed. The usual ~3.6 is calibrated on prose and was 41% low
 * here: a 286,619-character payload billed as ~110,000 input tokens, a real ratio
 * of 2.60. This format is the reason — most lines are `#4380 harper: yes`, so the
 * `#seq label:` scaffolding and its digits are a large share of every line, and
 * digits tokenise far worse than words. Non-ASCII was only 0.3% of the payload, so
 * it isn't emoji or Chinese doing it.
 *
 * Erring low is the harmful direction for the one thing this number is for —
 * knowing how big a request is before sending it — so a ratio taken from a
 * short-message chat is the right one to keep. A corpus of longer messages carries
 * less scaffolding per character and will come in under this estimate.
 */
const CHARS_PER_TOKEN = 2.6;

export interface Corpus {
  /** the payload itself */
  text: string;
  lines: Line[];
  bySeq: Map<number, Line>;
  /** short labels used in the payload, in side order */
  labels: [string, string];
  /** rough token count; see CHARS_PER_TOKEN */
  approxTokens: number;
  /** present when this corpus is a representative subset of a larger one */
  sample?: { originalLines: number; originalTokens: number };
  /** first seq at or after a timestamp, for pointing the model at an era */
  seqAt(ts: number): number;
}

/**
 * A short, stable, single-token-ish label per side. Display names carry emoji and
 * trailing surnames that cost tokens on every line and add nothing.
 */
export function shortLabels(participants: [string, string]): [string, string] {
  const clean = (name: string, fallback: string) => {
    const first = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/)[0] ?? "";
    return first.length >= 2 ? first : fallback;
  };
  const a = clean(participants[0], "them");
  const b = clean(participants[1], "you");
  return a === b ? [`${a}1`, `${b}2`] : [a, b];
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m${s ? `${String(s).padStart(2, "0")}s` : ""}` : `${s}s`;
}

/** One line of body text: whatever the model should see in place of the message. */
function renderBody(m: Message): { kind: LineKind; body: string } {
  // Newlines would break the one-line-per-message contract the seq ids rest on.
  const text = m.text.replace(/\s*\n+\s*/g, " / ").trim();

  switch (m.mediaType) {
    case "sticker":
      // The emoji is optional, and `.trim()` can't reach inside the brackets —
      // it has to be left out rather than trimmed off.
      return {
        kind: "sticker",
        body: `[sticker${m.stickerEmoji ? ` ${m.stickerEmoji}` : ""}]${text ? ` ${text}` : ""}`,
      };
    case "voice_message":
      return { kind: "voice", body: `[voice note ${fmtDuration(m.durationSeconds ?? 0)}]` };
    case "video_message":
      return { kind: "video", body: `[telebubble ${fmtDuration(m.durationSeconds ?? 0)}]` };
    case "animation":
      return { kind: "media", body: `[gif]${text ? ` ${text}` : ""}`.trim() };
    default:
      break;
  }
  // A caption belongs to the thing it captions. Rendering it as bare text would
  // read to the model as an ordinary message, with the picture silently gone.
  if (m.attachment === "photo") return { kind: "photo", body: `[photo]${text ? ` ${text}` : ""}` };
  if (m.attachment === "file") return { kind: "media", body: `[attachment]${text ? ` ${text}` : ""}` };
  if (!text) return { kind: "media", body: "[attachment]" };
  return { kind: "text", body: text };
}

function renderCall(c: Call): string {
  if (c.durationSeconds > 0) return `[call ${fmtDuration(c.durationSeconds)}]`;
  return `[call not answered${c.discardReason ? `: ${c.discardReason}` : ""}]`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function header(ts: number): string {
  const d = new Date(ts * 1000);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${WEEKDAYS[d.getDay()]} ${time}`;
}

function gapMarker(seconds: number): string | null {
  const days = seconds / DAY;
  if (days < 1) return null;
  if (days < 60) return `~~ ${Math.round(days)} days of silence ~~`;
  return `~~ ${(days / 30.44).toFixed(1)} months of silence ~~`;
}

/** Rebuild display text from selected lines without renumbering citations. */
export function corpusFromLines(
  lines: Line[],
  labels: [string, string],
  sample?: { originalLines: number; originalTokens: number },
): Corpus {
  const out: string[] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    const discontinuity = previous !== null && line.seq !== previous.seq + 1;
    const sessionBreak = previous === null || line.ts - previous.ts > SESSION_GAP_MIN * 60;
    if (discontinuity) out.push("", `~~ representative sample: #${previous!.seq + 1}–#${line.seq - 1} omitted ~~`);
    if (discontinuity || sessionBreak) {
      if (!discontinuity && previous) {
        const marker = gapMarker(line.ts - previous.ts);
        if (marker) out.push("", marker);
      }
      out.push("", `== ${header(line.ts)} ==`);
    }
    out.push(`#${line.seq} ${labels[line.who]}: ${line.body}`);
    previous = line;
  }
  const text = out.join("\n").trim();
  const bySeq = new Map(lines.map((line) => [line.seq, line]));
  return {
    text,
    lines,
    bySeq,
    labels,
    approxTokens: Math.round(text.length / CHARS_PER_TOKEN),
    sample,
    seqAt(ts: number) {
      let lo = 0;
      let hi = lines.length - 1;
      let found = lines.length ? lines[lines.length - 1].seq : 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].ts >= ts) {
          found = lines[mid].seq;
          hi = mid - 1;
        } else lo = mid + 1;
      }
      return found;
    },
  };
}

/**
 * Builds the payload. Calls are interleaved with messages rather than listed
 * separately: a 42-minute call in the middle of an argument is part of the
 * conversation, and the model can't read the shape of the evening without it.
 */
export function buildCorpus(parsed: Parsed): Corpus {
  const labels = shortLabels(parsed.chat.participants);

  type Event = { ts: number; who: Side; message: Message | null; call: Call | null };
  const events: Event[] = [
    ...parsed.messages.map((m) => ({ ts: m.ts, who: m.who, message: m, call: null })),
    ...parsed.calls.map((c) => ({ ts: c.ts, who: c.by, message: null, call: c })),
  ].sort((x, y) => x.ts - y.ts);

  const lines: Line[] = [];
  const out: string[] = [];
  let seq = 0;
  let prevTs: number | null = null;

  for (const e of events) {
    const gap = prevTs === null ? Infinity : e.ts - prevTs;
    if (gap > SESSION_GAP_MIN * 60) {
      const marker = prevTs === null ? null : gapMarker(gap);
      if (marker) out.push("", marker);
      out.push("", `== ${header(e.ts)} ==`);
    }
    prevTs = e.ts;

    seq++;
    const { kind, body } = e.message
      ? renderBody(e.message)
      : { kind: "call" as LineKind, body: renderCall(e.call!) };
    const line: Line = {
      seq,
      messageId: e.message?.id ?? null,
      ts: e.ts,
      who: e.who,
      kind,
      body,
    };
    lines.push(line);
    out.push(`#${seq} ${labels[e.who]}: ${body}`);
  }

  const text = out.join("\n").trim();
  const bySeq = new Map(lines.map((l) => [l.seq, l]));

  return {
    text,
    lines,
    bySeq,
    labels,
    approxTokens: Math.round(text.length / CHARS_PER_TOKEN),
    seqAt(ts: number) {
      // Binary search: the payload is large enough that a scan per era adds up.
      let lo = 0;
      let hi = lines.length - 1;
      let found = lines.length ? lines[lines.length - 1].seq : 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].ts >= ts) {
          found = lines[mid].seq;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      return found;
    },
  };
}
