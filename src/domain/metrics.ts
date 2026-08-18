/**
 * The canonical name for each thing the deterministic layer measures.
 *
 * This exists because three parts of the app have to agree on it and they can't
 * see each other: the brief names a metric for the model, the model echoes that
 * name back in a card's `metric` field, and the UI uses it to file the model's
 * reading next to the numbers it came from. The first live run had the model
 * writing "who comes back" and "emoji vs stickers" for cards the UI calls
 * `revival` and `register` — the readings were correct and landed nowhere near the
 * evidence, which is the one thing the whole design is for.
 *
 * Keys are the wire format and must not change casually. Values are only shown to
 * the model as a gloss.
 */
export const METRICS = {
  scale: "how much was said, and how long each message is",
  concentration: "how much of the chat lives in its busiest bursts",
  timeline: "the shape of the whole span",
  "turn-taking": "unbroken runs of messages before the other replies",
  reactions: "reactions given and received",
  register: "emoji versus stickers",
  "quote-replies": "replying by quoting versus replying in the flow",
  "video-notes": "telebubbles",
  "voice-notes": "voice notes",
  calls: "phone calls, who starts them and who is on them",
  revival: "who ends the silences",
  vocabulary: "words characteristic of one of them",
  names: "using the other's name",
  "reply-speed": "how long each waits before replying",
  questions: "who asks the questions",
  "late-night": "messages between midnight and 5am",
  "opens-closes": "who starts and who ends a burst",
} as const;

export type MetricKey = keyof typeof METRICS;

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
