/**
 * A bounded, representative view of a corpus for the interpretive pass.
 *
 * This is selection, not summarisation: chosen messages keep their original seq
 * ids and bodies, so the existing citation validator can still resolve every
 * quote against the complete conversation. The sample deliberately mixes
 * narrative anchors with broad timeline coverage:
 *
 * - the beginning and end
 * - both sides of every chapter boundary and long silence
 * - the busiest sessions
 * - unusually long messages and distinctive vocabulary
 * - evenly spaced control windows across the remaining timeline
 */
import type { Analysis } from "../domain/types";
import { corpusFromLines, type Corpus, type Line } from "./corpus";

export const DEFAULT_SAMPLE_TOKENS = 80_000;
const CHARS_PER_TOKEN = 2.6;
const SAFETY = 0.88;

export interface SampleStats {
  sampled: boolean;
  originalLines: number;
  selectedLines: number;
  originalTokens: number;
  selectedTokens: number;
  budgetTokens: number;
}

export interface SampledCorpus {
  corpus: Corpus;
  stats: SampleStats;
}

function stableRank(line: Line): number {
  // A deterministic integer mixer. It provides a control sample without making
  // identical uploads produce different bills or different findings.
  let x = Math.imul(line.seq ^ line.body.length, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function sampleCorpus(
  full: Corpus,
  analysis: Analysis,
  budgetTokens = DEFAULT_SAMPLE_TOKENS,
  representativeMessageIds: number[] = [],
): SampledCorpus {
  const budget = Math.max(2_000, Math.floor(budgetTokens));
  if (full.approxTokens <= budget || full.lines.length <= 2) {
    return {
      corpus: full,
      stats: {
        sampled: false,
        originalLines: full.lines.length,
        selectedLines: full.lines.length,
        originalTokens: full.approxTokens,
        selectedTokens: full.approxTokens,
        budgetTokens: budget,
      },
    };
  }

  const lines = full.lines;
  const maxChars = Math.floor(budget * CHARS_PER_TOKEN * SAFETY);
  const chosen = new Set<number>();
  let usedChars = 0;
  const lineCost = (line: Line) => line.body.length + full.labels[line.who].length + 28;

  const offer = (index: number) => {
    if (index < 0 || index >= lines.length) return;
    const line = lines[index];
    if (chosen.has(line.seq)) return;
    const cost = lineCost(line);
    if (usedChars + cost > maxChars) return;
    chosen.add(line.seq);
    usedChars += cost;
  };
  const window = (center: number, radius: number) => {
    for (let offset = -radius; offset <= radius; offset++) offer(center + offset);
  };

  // Guarantee the literal endpoints and broad timeline coverage before any rich
  // category can spend the budget. This ordering matters on deliberately small
  // budgets: "representative" must not degrade to opening-and-ending only.
  offer(0);
  offer(lines.length - 1);
  for (let band = 0; band < 16; band++) {
    window(Math.floor(((band + 0.5) * lines.length) / 16), 2);
  }

  // Expand the opening and current register evenly, so neither side can crowd
  // the other out when the budget is tight.
  for (let offset = 1; offset < Math.min(80, lines.length); offset++) {
    offer(offset);
    offer(lines.length - 1 - offset);
  }

  // Every structural change gets context on both sides. This includes silence
  // endpoints because silences are first-class chapters in the analysis.
  for (const chapter of analysis.chapters) {
    window(Math.max(0, full.seqAt(chapter.startTs) - 1), 28);
    window(Math.max(0, full.seqAt(chapter.endTs) - 1), 28);
    window(Math.floor((full.seqAt(chapter.startTs) + full.seqAt(chapter.endTs)) / 2) - 1, 10);
  }

  // Read the densest actual exchanges, rather than selecting isolated messages
  // merely because the day containing them was busy.
  const indexByMessageId = new Map<number, number>();
  lines.forEach((line, index) => {
    if (line.messageId !== null) indexByMessageId.set(line.messageId, index);
  });
  for (const messageId of representativeMessageIds) {
    const index = indexByMessageId.get(messageId);
    if (index !== undefined) window(index, 8);
  }
  const busiest = [...analysis.sessions].sort((a, b) => b.messageCount - a.messageCount).slice(0, 14);
  for (const session of busiest) {
    const from = indexByMessageId.get(session.firstMessageId);
    const to = indexByMessageId.get(session.lastMessageId);
    if (from === undefined || to === undefined) continue;
    if (to - from <= 140) {
      for (let i = from; i <= to; i++) offer(i);
    } else {
      window(from, 35);
      window(Math.floor((from + to) / 2), 20);
      window(to, 35);
    }
  }

  // Long messages and media often carry events, explanations, or shifts in
  // register. Context on either side prevents them becoming decontextualised hits.
  const notable = [...lines]
    .sort((a, b) => (b.body.length + (b.kind === "text" ? 0 : 80)) - (a.body.length + (a.kind === "text" ? 0 : 80)))
    .slice(0, 120);
  for (const line of notable) window(line.seq - 1, 3);

  // Distinctive vocabulary is already computed over the full corpus. Use it as
  // retrieval, not as an LLM conclusion, and cap each marker so one catchphrase
  // cannot consume the whole sample.
  const markers = [
    ...analysis.language.distinctive.slice(0, 18).map((item) => item.word),
    ...analysis.language.distinctive.slice(-18).map((item) => item.word),
    ...analysis.language.idiolect.slice(0, 18).map((item) => item.token),
  ].filter((marker) => marker.length >= 2);
  for (const marker of markers) {
    const needle = marker.toLocaleLowerCase();
    const matches = lines.filter((line) => line.body.toLocaleLowerCase().includes(needle));
    matches.sort((a, b) => stableRank(a) - stableRank(b));
    for (const line of matches.slice(0, 10)) window(line.seq - 1, 2);
  }

  // Finally, a deterministic control sample prevents the hand-picked categories
  // above from seeing only extremes. Windows are spread across the full timeline;
  // repeated passes add a different stable offset within every band.
  const bands = Math.min(128, Math.max(16, Math.ceil(lines.length / 250)));
  for (let pass = 0; pass < 8 && usedChars < maxChars; pass++) {
    for (let band = 0; band < bands; band++) {
      const from = Math.floor((band * lines.length) / bands);
      const to = Math.max(from + 1, Math.floor(((band + 1) * lines.length) / bands));
      const candidates = lines.slice(from, to).sort((a, b) => stableRank(a) - stableRank(b));
      const line = candidates[pass % candidates.length];
      if (line) window(line.seq - 1, 5);
    }
  }

  const selected = lines.filter((line) => chosen.has(line.seq));
  const corpus = corpusFromLines(selected, full.labels, {
    originalLines: full.lines.length,
    originalTokens: full.approxTokens,
  });
  return {
    corpus,
    stats: {
      sampled: true,
      originalLines: full.lines.length,
      selectedLines: selected.length,
      originalTokens: full.approxTokens,
      selectedTokens: corpus.approxTokens,
      budgetTokens: budget,
    },
  };
}
