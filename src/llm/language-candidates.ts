import type { Corpus, Line } from "./corpus";

const SESSION_GAP = 45 * 60;
const MAX_RECORDS = 120_000;
const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "did", "do", "does", "for", "from",
  "get", "got", "had", "has", "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "is", "it",
  "its", "just", "me", "more", "my", "no", "not", "now", "of", "on", "or", "our", "she", "so", "that", "the",
  "their", "them", "then", "there", "they", "this", "to", "too", "up", "us", "was", "we", "were", "what", "when",
  "where", "who", "why", "will", "with", "would", "you", "your",
]);

export interface LanguageCandidate {
  id: string;
  text: string;
  side: "a" | "b" | "shared";
  counts: { a: number; b: number };
  sessions: number;
  months: number;
  firstUsed: { a: number | null; b: number | null };
  examples: Array<{ seq: number; quote: string }>;
  score: number;
}

const words = (text: string) => (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*/gu) ?? [])
  .map((word) => word.replaceAll("’", "'"));

function usable(tokens: string[]): boolean {
  if (!tokens.length || tokens.join(" ").length > 52) return false;
  if (tokens.length === 1 && (tokens[0].length < 2 || STOP.has(tokens[0]))) return false;
  return tokens.some((token) => !STOP.has(token));
}

type CandidateRecord = {
  counts: [number, number];
  sessions: Set<number>;
  months: Set<string>;
  examples: [Line[], Line[]];
  firstTs: [number | null, number | null];
};

/** Mine compact, verifiable word-and-phrase candidates from the complete corpus. */
export function buildLanguageCandidates(corpus: Corpus): LanguageCandidate[] {
  const records = new Map<string, CandidateRecord>();
  const prune = () => {
    // Most raw n-grams occur once. Discarding those cannot affect the eventual
    // frequency floors and keeps multi-year chats from retaining millions of
    // unique sentence fragments in memory.
    for (const [text, record] of records) {
      if (record.counts[0] + record.counts[1] <= 1) records.delete(text);
    }
    if (records.size <= MAX_RECORDS) return;
    const weakest = [...records.entries()]
      .sort((a, b) => (a[1].counts[0] + a[1].counts[1]) - (b[1].counts[0] + b[1].counts[1]))
      .slice(0, records.size - MAX_RECORDS);
    for (const [text] of weakest) records.delete(text);
  };
  let session = -1;
  let previousTs = -Infinity;
  for (const line of corpus.lines) {
    if (line.ts - previousTs > SESSION_GAP) session++;
    previousTs = line.ts;
    if (line.kind !== "text") continue;
    const tokens = words(line.body);
    const seenHere = new Set<string>();
    for (let size = 1; size <= 3; size++) {
      for (let i = 0; i + size <= tokens.length; i++) {
        const slice = tokens.slice(i, i + size);
        if (!usable(slice)) continue;
        const text = slice.join(" ");
        // Repetition inside one message is not independent evidence of a habit.
        if (seenHere.has(text)) continue;
        seenHere.add(text);
        const record = records.get(text) ?? { counts: [0, 0], sessions: new Set(), months: new Set(), examples: [[], []], firstTs: [null, null] };
        record.counts[line.who]++;
        record.sessions.add(session);
        record.months.add(new Date(line.ts * 1000).toISOString().slice(0, 7));
        if (record.firstTs[line.who] === null) record.firstTs[line.who] = line.ts;
        if (record.examples[line.who].length < 4) record.examples[line.who].push(line);
        records.set(text, record);
        if (records.size > MAX_RECORDS * 1.25) prune();
      }
    }
  }
  prune();

  const totalBySide = [0, 0];
  for (const record of records.values()) {
    totalBySide[0] += record.counts[0];
    totalBySide[1] += record.counts[1];
  }
  const pools: globalThis.Record<"a" | "b" | "shared", LanguageCandidate[]> = { a: [], b: [], shared: [] };
  for (const [text, record] of records) {
    const [a, b] = record.counts;
    const total = a + b;
    const tokenCount = text.split(" ").length;
    const floor = tokenCount === 1 ? 12 : 5;
    if (total < floor || record.sessions.size < 3) continue;
    const rateA = (a + 1) / Math.max(1, totalBySide[0]);
    const rateB = (b + 1) / Math.max(1, totalBySide[1]);
    const spread = Math.log2(record.sessions.size + 1) * Math.log2(record.months.size + 1);
    const specificity = tokenCount === 1 ? 1 : tokenCount === 2 ? 1.65 : 2.05;
    const delta = Math.log(rateA / rateB);
    const commonShare = Math.min(a, b) / Math.max(1, Math.max(a, b));
    const side: LanguageCandidate["side"] = commonShare >= 0.28 && a >= 3 && b >= 3 ? "shared" : delta >= 0 ? "a" : "b";
    const score = side === "shared"
      ? Math.log2(total + 1) * spread * specificity * (0.5 + commonShare)
      : Math.abs(delta) * Math.log2(total + 1) * spread * specificity;
    const exampleLines = (side === "a" ? record.examples[0] : side === "b" ? record.examples[1] : [...record.examples[0].slice(0, 2), ...record.examples[1].slice(0, 2)]).sort((x, y) => x.ts - y.ts);
    pools[side].push({
      id: "",
      text,
      side,
      counts: { a, b },
      sessions: record.sessions.size,
      months: record.months.size,
      firstUsed: { a: record.firstTs[0], b: record.firstTs[1] },
      examples: exampleLines.slice(0, 3).map((line) => ({ seq: line.seq, quote: line.body })),
      score,
    });
  }

  const limits = { a: 40, b: 40, shared: 24 };
  const result: LanguageCandidate[] = [];
  for (const side of ["a", "b", "shared"] as const) {
    pools[side].sort((x, y) => y.score - x.score || y.text.length - x.text.length);
    pools[side].slice(0, limits[side]).forEach((candidate, index) => result.push({ ...candidate, id: `${side}-${index + 1}` }));
  }
  return result;
}
