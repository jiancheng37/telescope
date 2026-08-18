/**
 * What the LLM route sends back to the browser.
 *
 * A `WrappedResult` holds the whole `Corpus` — 8,950 rendered lines — because the
 * pipeline needs it to resolve citations. None of that should cross the wire: the
 * browser already has the messages, and the only thing it can't compute itself is
 * the model's reading. So this is the narrow projection, and `toWire` is the one
 * place that knows how to take it.
 *
 * Type-only imports on purpose. This module is loaded by a client component, and a
 * value import from `src/llm/` would drag `node:crypto` and the OpenAI SDK into the
 * browser bundle.
 */
import type { ResolvedEvidence, ValidationReport } from "@/llm/validate";
import type { Usage, WrappedResult } from "@/llm/run";
import type { Chapter } from "@/domain/types";

/** One quote, already checked against the message it claims to come from. */
export interface Cited {
  quote: string;
  /** the whole message the quote sits in, so the UI can show it in context */
  body: string;
  who: 0 | 1;
  ts: number;
  messageId: number | null;
}

export interface WireFinding {
  id: string;
  /** the deterministic card this belongs next to, e.g. "turn-taking" */
  metric: string;
  headline: string;
  body: string;
  about: "a" | "b" | "both" | "neither";
  evidence: Cited[];
}

export interface WireChapterNote {
  /** 1-based index into `analysis.chapters` */
  chapterIndex: number;
  /** eras get a name; silences don't */
  name: string | null;
  body: string;
  evidence: Cited[];
}

export interface WireMotif {
  id: string;
  name: string;
  body: string;
  evidence: Cited[];
}

export interface WireTopic {
  id: string;
  category: string;
  label: string;
  summary: string;
  chapterIndexes: number[];
  evidence: Cited[];
}

export interface WireDynamic {
  id: string;
  category: string;
  headline: string;
  body: string;
  roleA: string;
  roleB: string;
  evidence: Cited[];
  counterEvidence: Cited[];
}

export interface WireRole {
  id: string;
  title: string;
  description: string;
  evidence: Cited[];
}

export interface WireLanguageInsight {
  candidateId: string;
  text: string;
  category: string;
  explanation: string;
  evidence: Cited[];
}

export interface WireWildSentence {
  candidateId: string;
  category: string;
  explanation: string;
  sentence: Cited;
  context: Cited[];
}

export interface WirePayload {
  verdict: { text: string; rationale: string; compromised: boolean } | null;
  chapterNotes: WireChapterNote[];
  /** Hybrid behavioural + semantic boundaries used by the AI reading. */
  eraChapters?: Chapter[];
  findings: WireFinding[];
  motifs: WireMotif[];
  topics: WireTopic[];
  dynamics: WireDynamic[];
  /** Absent on reports generated before AI character roles were introduced. */
  roles?: { a: WireRole[]; b: WireRole[] };
  language?: { a: WireLanguageInsight[]; b: WireLanguageInsight[]; shared: WireLanguageInsight[] } | null;
  /** Absent on reports generated before wild-sentence curation was introduced. */
  wildSentences?: WireWildSentence[];
  naming: { aCallsB: string; bCallsA: string; evidence: Cited[] } | null;
  /**
   * Surfaced rather than logged. A run where the model cited eleven messages that
   * don't say what it claimed is a run whose reading shouldn't be trusted, and the
   * person reading it is the only one who can make that call.
   */
  citations: ValidationReport["totals"];
  droppedCount: number;
  usage: Usage;
  model: string;
}

/**
 * Lines streamed by `/api/wrapped`. Keeping the protocol beside `WirePayload`
 * gives the route and browser one shared contract without importing server code
 * into the client bundle.
 */
export type WrappedStreamEvent =
  | { type: "progress"; note: string }
  | { type: "result"; payload: WirePayload }
  | { type: "error"; message: string };

const cite = (e: ResolvedEvidence): Cited => ({
  quote: e.quote,
  body: e.body,
  who: e.who,
  ts: e.ts,
  messageId: e.messageId,
});

export function toWire(result: WrappedResult): WirePayload {
  const { report, verdict } = result;
  const hiddenMetrics = new Set(["quote-replies", "calls", "names"]);
  const contextFor = (seq: number): Cited[] => {
    const index = result.corpus.lines.findIndex((line) => line.seq === seq);
    if (index < 0) return [];
    const anchor = result.corpus.lines[index];
    return result.corpus.lines.slice(Math.max(0, index - 2), index + 3)
      .filter((line) => Math.abs(line.ts - anchor.ts) <= 45 * 60)
      .map((line) => ({ quote: line.body, body: line.body, who: line.who, ts: line.ts, messageId: line.messageId }));
  };
  return {
    verdict: verdict
      ? { text: verdict.text, rationale: verdict.rationale, compromised: verdict.compromised }
      : null,
    eraChapters: result.analysisChapters,
    // Eras and silences are one list here. They're separate schemas because the
    // model is asked different questions about them, but they land on the same
    // timeline and the UI only cares which chapter they annotate.
    chapterNotes: [
      ...report.eras.map((c) => ({
        chapterIndex: c.card.chapterIndex,
        name: c.card.name,
        body: c.card.body,
        evidence: c.evidence.map(cite),
      })),
      ...report.silences.map((c) => ({
        chapterIndex: c.card.chapterIndex,
        name: null,
        body: c.card.body,
        evidence: c.evidence.map(cite),
      })),
    ].sort((x, y) => x.chapterIndex - y.chapterIndex),
    findings: report.findings.filter((c) => !hiddenMetrics.has(c.card.metric)).map((c) => ({
      id: c.card.id,
      metric: c.card.metric,
      headline: c.card.headline,
      body: c.card.body,
      about: c.card.about,
      evidence: c.evidence.map(cite),
    })),
    motifs: report.motifs.map((c) => ({
      id: c.card.id,
      name: c.card.name,
      body: c.card.body,
      evidence: c.evidence.map(cite),
    })),
    topics: report.topics.map((c) => ({
      id: c.card.id,
      category: c.card.category,
      label: c.card.label,
      summary: c.card.summary,
      chapterIndexes: c.card.chapterIndexes,
      evidence: c.evidence.map(cite),
    })),
    dynamics: report.dynamics.map((c) => ({
      id: c.card.id,
      category: c.card.category,
      headline: c.card.headline,
      body: c.card.body,
      roleA: c.card.roleA,
      roleB: c.card.roleB,
      evidence: c.evidence.map(cite),
      counterEvidence: c.counterEvidence.map(cite),
    })),
    roles: {
      a: report.roles.a.map((c) => ({ id: c.card.id, title: c.card.title, description: c.card.description, evidence: c.evidence.map(cite) })),
      b: report.roles.b.map((c) => ({ id: c.card.id, title: c.card.title, description: c.card.description, evidence: c.evidence.map(cite) })),
    },
    language: {
      a: report.language.a.map((item) => ({ ...item.card, evidence: item.evidence.map(cite) })),
      b: report.language.b.map((item) => ({ ...item.card, evidence: item.evidence.map(cite) })),
      shared: report.language.shared.map((item) => ({ ...item.card, evidence: item.evidence.map(cite) })),
    },
    wildSentences: report.wildSentences.flatMap((item) => {
      const sentence = item.evidence[0];
      return sentence ? [{ candidateId: item.card.candidateId, category: item.card.category, explanation: item.card.explanation, sentence: cite(sentence), context: contextFor(sentence.seq) }] : [];
    }),
    naming: null,
    citations: report.totals,
    droppedCount: report.dropped.length,
    usage: result.usage,
    model: result.model,
  };
}
