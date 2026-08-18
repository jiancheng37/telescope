/**
 * Telegram Desktop JSON export ("result.json") + the normalized shapes we derive.
 *
 * The raw export is polymorphic in annoying ways, all of which are handled in
 * parse.ts. Notably: `text` is either a string or an array mixing bare strings
 * with entity objects, and service messages (calls, pins) live in the same
 * `messages` array as real messages.
 */

// ---------------------------------------------------------------- raw export

export interface RawEntity {
  type: string;
  text: string;
  [k: string]: unknown;
}

export interface RawReaction {
  type?: string;
  count?: number;
  emoji?: string;
  recent?: Array<{ from?: string; from_id?: string; date?: string }>;
}

export interface RawMessage {
  id: number;
  type: "message" | "service";
  date: string;
  date_unixtime: string;

  // messages
  from?: string;
  from_id?: string;
  text?: string | Array<string | RawEntity>;
  text_entities?: RawEntity[];
  media_type?: "sticker" | "voice_message" | "video_message" | "animation" | "audio_file" | string;
  sticker_emoji?: string;
  duration_seconds?: number;
  file?: string;
  file_name?: string;
  mime_type?: string;
  photo?: string;
  reply_to_message_id?: number;
  forwarded_from?: string;
  edited?: string;
  reactions?: RawReaction[];

  // service messages
  actor?: string;
  actor_id?: string;
  action?: string;
  discard_reason?: "hangup" | "missed" | "busy" | "declined" | string;
}

export interface RawExport {
  name: string;
  type: string;
  id: number;
  messages: RawMessage[];
}

// ---------------------------------------------------------------- normalized

/** Which participant. Index into `Analysis.chat.participants`. */
export type Side = 0 | 1;

export interface Message {
  id: number;
  /** unix seconds */
  ts: number;
  who: Side;
  /** flattened plain text, entities concatenated */
  text: string;
  mediaType?: string;
  /**
   * Set when something was attached but `media_type` didn't say what. A Telegram
   * photo has no `media_type` at all, so without this a photo is indistinguishable
   * from a PDF — and "she sent 47 photos" is a fact about how two people talk.
   */
  attachment?: "photo" | "file";
  stickerEmoji?: string;
  /** Relative path inside a Telegram export, used only to match local sticker assets. */
  assetPath?: string;
  durationSeconds?: number;
  isReply: boolean;
  isForward: boolean;
  isEdited: boolean;
  reactions: RawReaction[];
}

export interface Call {
  id: number;
  ts: number;
  by: Side;
  durationSeconds: number;
  discardReason?: string;
}

export interface Chat {
  name: string;
  id: number;
  /** [side 0, side 1] — display names as they appear in the export */
  participants: [string, string];
}

/** A value measured separately for each participant. */
export interface Pair<T> {
  a: T;
  b: T;
}

export function pair<T>(a: T, b: T): Pair<T> {
  return { a, b };
}

// ---------------------------------------------------------------- analysis

export interface Span {
  firstTs: number;
  lastTs: number;
  /** calendar days between first and last message */
  days: number;
  /** distinct local dates with at least one message */
  activeDays: number;
  /** activeDays / days */
  activeShare: number;
}

export interface MonthBucket {
  /** "2019-04" — sortable, locale-free, and safe as a React key */
  month: string;
  /** first instant of the month, local time, unix seconds */
  ts: number;
  counts: Pair<number>;
}

export interface Volume {
  total: number;
  messages: Pair<number>;
  chars: Pair<number>;
  words: Pair<number>;
  charsPerMessage: Pair<number>;
  /** messages a : b */
  messageRatio: number;
  perActiveDay: number;
  /**
   * Messages per calendar month, per person, from January of the first year to
   * December of the last year — including the months with nothing in them.
   *
   * Dense on purpose. A series that skipped the empty months would draw a year
   * of silence as a narrow gap and flatter the conversation; the silence has to
   * take up as much width on the chart as it took up in time.
   */
  monthly: MonthBucket[];
}

/** A burst of conversation. Bounded by `SESSION_GAP_MIN` of silence. */
export interface Session {
  index: number;
  startTs: number;
  endTs: number;
  messageCount: number;
  durationMin: number;
  openedBy: Side;
  closedBy: Side;
  /** true when only one participant spoke */
  monologue: boolean;
  firstMessageId: number;
  lastMessageId: number;
}

/** A stretch of contact. Bounded by `EPISODE_GAP_DAYS` of silence. */
export interface Episode {
  index: number;
  startTs: number;
  endTs: number;
  days: number;
  messageCount: number
  messagesPerDay: number;
  /** who sent the first message of this episode (null for the very first) */
  revivedBy: Side | null;
  /** who sent the last message of the *previous* episode */
  wentQuiet: Side | null;
  /** days of silence before this episode began */
  dormantBeforeDays: number;
  /** days of silence after this episode ended (null if it's the last) */
  dormantAfterDays: number | null;
}

export type EraChangeChannel = "semantic" | "activity" | "reply" | "media" | "timing" | "language";

export interface EraChange {
  /** Combined, normalized strength of the boundary before this era. */
  score: number;
  contributors: Partial<Record<EraChangeChannel, number>>;
  strongest: Array<{ metric: string; before: number; after: number; delta: number }>;
}

/**
 * The timeline is a sequence of alternating chapters: stretches of contact and
 * the silences between them. The silences are as narratively loaded as the
 * eras, so they are first-class nodes rather than gaps in a chart.
 */
export type Chapter =
  | {
      kind: "era";
      startTs: number;
      endTs: number;
      months: number;
      messageCount: number;
      messagesPerMonth: number;
      /** Weekly windows represented by this era. */
      weeks?: number;
      /** Why the detector placed the boundary before this era. Absent for the first. */
      change?: EraChange;
      /** share of the whole corpus that lives in this era */
      share: number;
      /**
       * True when this stretch holds so little of the conversation that calling
       * it an era would overstate it — a lull between chapters rather than a
       * chapter. Kept in the timeline (the messages are real) but the UI should
       * render it as a connector and the LLM should not try to name it.
       */
      quiet: boolean;
    }
  | {
      kind: "silence";
      startTs: number;
      endTs: number;
      days: number;
      /** who sent the last message before it went quiet */
      wentQuiet: Side;
      /** who sent the first message when it came back */
      revivedBy: Side;
      /**
       * A silence is rarely perfectly clean — there are usually a few messages
       * in the middle that went nowhere. They're counted here rather than
       * promoted to an era of their own, so the timeline stays honest without
       * calling seven messages in January a chapter.
       */
      blipMessages: number;
      blipCount: number;
    };

export interface LatencyStats {
  n: number;
  medianSec: number;
  p75Sec: number;
  p90Sec: number;
  /** median restricted to replies inside a single session */
  inSessionMedianSec: number;
}

export interface MonologueStats {
  runs: number;
  meanRunLength: number;
  maxRunLength: number;
  /** share of this person's runs that are 3+ messages long */
  shareOfRunsOver3: number;
  runsOver8: number;
  /** share of this person's *messages* that sit inside a 3+ run */
  shareOfMessagesInRuns: number;
  longestRun?: { messageIds: number[]; startTs: number; endTs: number };
}

export interface Silence {
  days: number;
  fromTs: number;
  toTs: number;
  wentQuiet: Side;
  revivedBy: Side;
  lastMessageId: number;
  firstMessageId: number;
}

export interface RevivalStats {
  thresholdDays: number;
  n: number;
  revivedBy: Pair<number>;
  wentQuiet: Pair<number>;
}

export interface DoubleTextRun {
  who: Side;
  /** Follow-up messages at least two minutes after the prior unanswered message. */
  doubleTexts: number;
  /** Every message in the uninterrupted same-sender run. */
  messages: number;
  startTs: number;
  endTs: number;
  /** Stable ids only; message bodies are never persisted with the report. */
  messageIds: number[];
}

export interface DoubleTextingStats {
  frequency: Pair<number>;
  longest: DoubleTextRun | null;
}

export interface Rhythm {
  latency: Pair<LatencyStats>;
  /** a's median latency divided by b's; 1.0 means no asymmetry */
  latencyAsymmetry: number;
  monologues: Pair<MonologueStats>;
  /** messages by hour of local day, 24 buckets */
  hourHistogram: Pair<number[]>;
  lateNightShare: Pair<number>;
  longestSilences: Silence[];
  revival: RevivalStats[];
  /** Optional so reports saved before this metric was introduced remain readable. */
  doubleTexting?: DoubleTextingStats;
  dormantDays: number;
  dormantShare: number;
}

export interface DistinctiveWord {
  word: string;
  /** signed log-odds z-score. positive = characteristic of a, negative = b */
  z: number;
  countA: number;
  countB: number;
}

export interface IdiolectMarker {
  token: string;
  counts: Pair<number>;
  per1k: Pair<number>;
}

export interface EmojiUse {
  emoji: string;
  counts: Pair<number>;
}

export interface Language {
  distinctive: DistinctiveWord[];
  idiolect: IdiolectMarker[];
  emoji: { total: Pair<number>; top: Pair<EmojiUse[]>; exclusive: Pair<string[]> };
  stickers: { total: Pair<number>; top: Pair<EmojiUse[]> };
  questions: { count: Pair<number>; rate: Pair<number>; unansweredIn6h: Pair<number> };
  /** how often each person writes the other's name / known aliases */
  addressesByName: Pair<number>;
  messageLengthPercentiles: Pair<{ p25: number; p50: number; p75: number; p90: number; p99: number; max: number }>;
  /** IDs and timing only; the winning message body remains local to the browser. */
  longestMessages?: Pair<{ messageId: number | null; ts: number | null; chars: number }>;
}

export interface Behaviour {
  quoteReplies: Pair<number>;
  edits: Pair<number>;
  forwards: Pair<number>;
  stickers: Pair<number>;
  videoNotes: Pair<{ count: number; totalSeconds: number }>;
  voiceNotes: Pair<{ count: number; totalSeconds: number }>;
  reactionsGiven: Pair<number>;
  reactionsReceived: Pair<number>;
  calls: {
    total: number;
    totalMinutes: number;
    initiated: Pair<number>;
    minutes: Pair<number>;
    discardReasons: Record<string, number>;
  };
}

export interface Concentration {
  sessions: number;
  /** cumulative share of all messages held by the top N sessions */
  topSessionShare: Array<{ n: number; messages: number; share: number }>;
  topDayShare: Array<{ n: number; messages: number; share: number }>;
  busiestDays: Array<{ date: string; total: number; counts: Pair<number> }>;
}

export interface Analysis {
  chat: Chat;
  span: Span;
  volume: Volume;
  sessions: Session[];
  sessionSummary: {
    count: number;
    medianMessages: number;
    meanMessages: number;
    maxMessages: number;
    medianDurationMin: number;
    monologueSessions: number;
    opens: Pair<number>;
    closes: Pair<number>;
  };
  episodes: Episode[];
  chapters: Chapter[];
  rhythm: Rhythm;
  language: Language;
  behaviour: Behaviour;
  concentration: Concentration;
}
