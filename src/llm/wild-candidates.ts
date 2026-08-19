import type { Corpus, Line } from "./corpus";

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’_-]*/gu;
const REACTION = /^(?:ha){2,}|^(?:he){2,}|^[?！!]{2,}$|^(?:bro|bruh|what|huh|wtf)\b|[😭💀😂]{1,}$/iu;
const PRIVATE = /https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b(?:\+?\d[\s-]?){8,}\b/iu;
const SENSITIVE = /\b(?:suicid|self[- ]?harm|kill myself|funeral|died|death|cancer|diagnos|hospital|assault|abuse|pregnan|miscarriage)\b/iu;

export interface WildCandidate {
  id: string;
  seq: number;
  text: string;
  who: 0 | 1;
  ts: number;
  score: number;
  context: Array<{ seq: number; who: 0 | 1; body: string }>;
}

const tokens = (body: string) => (body.toLocaleLowerCase().match(WORD) ?? []).map((word) => word.replaceAll("’", "'"));
const sentenceKey = (body: string) => body.toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Retrieve surprising, safe-ish candidate sentences from every text message. */
export function buildWildCandidates(corpus: Corpus): WildCandidate[] {
  const textLines = corpus.lines.filter((line) => line.kind === "text");
  const frequencies = new Map<string, number>();
  for (const line of textLines) for (const token of new Set(tokens(line.body))) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);

  const ranked: WildCandidate[] = [];
  for (let index = 0; index < corpus.lines.length; index++) {
    const line = corpus.lines[index];
    if (line.kind !== "text" || line.body.length < 18 || line.body.length > 280 || PRIVATE.test(line.body) || SENSITIVE.test(line.body)) continue;
    const lineTokens = tokens(line.body);
    if (lineTokens.length < 4 || lineTokens.length > 48) continue;
    const rarity = lineTokens.reduce((sum, token) => sum + 1 / Math.sqrt(frequencies.get(token) ?? 1), 0) / lineTokens.length;
    const uppercase = [...line.body].filter((char) => /[A-Z]/.test(char)).length / Math.max(1, [...line.body].filter((char) => /[A-Za-z]/.test(char)).length);
    const specificity = /\d/.test(line.body) ? 0.65 : 0;
    const punctuation = /[!?]{2,}|[“”"]/.test(line.body) ? 0.55 : 0;
    const next = corpus.lines[index + 1];
    const reacted = next && next.who !== line.who && next.ts - line.ts <= 600 && REACTION.test(next.body) ? 1.35 : 0;
    const score = rarity * 5 + Math.min(1, uppercase) + specificity + punctuation + reacted + Math.min(1.2, lineTokens.length / 18);
    const context = corpus.lines
      .slice(Math.max(0, index - 2), index + 3)
      .filter((item) => Math.abs(item.ts - line.ts) <= 45 * 60)
      .map((item) => ({ seq: item.seq, who: item.who, body: item.body }));
    if (context.some((item) => PRIVATE.test(item.body) || SENSITIVE.test(item.body))) continue;
    ranked.push({ id: `wild-${line.seq}`, seq: line.seq, text: line.body, who: line.who, ts: line.ts, score, context });
  }

  ranked.sort((a, b) => b.score - a.score);
  // Keep one loud month from swallowing the dossier, and give both people room.
  const monthCounts = new Map<string, number>();
  const sideCounts = [0, 0];
  const seenSentences = new Set<string>();
  const selected: WildCandidate[] = [];
  for (const candidate of ranked) {
    const month = new Date(candidate.ts * 1000).toISOString().slice(0, 7);
    const key = sentenceKey(candidate.text);
    if (seenSentences.has(key) || (monthCounts.get(month) ?? 0) >= 4 || sideCounts[candidate.who] >= 34) continue;
    selected.push(candidate);
    seenSentences.add(key);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    sideCounts[candidate.who]++;
    if (selected.length >= 60) break;
  }
  return selected;
}
