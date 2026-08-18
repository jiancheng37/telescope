/**
 * Citation checking.
 *
 * The whole premise is that every claim is attached to a message the reader can
 * go and look at. That premise is worth exactly as much as this file: if a quote
 * is allowed through without being found in the message it points at, the cards
 * are just confident prose. So each citation is resolved back to the payload and
 * the quote is matched against the real body.
 *
 * Matching is deliberately forgiving about *form* and strict about *content*.
 * Whitespace, case, and the curly-vs-straight apostrophe are normalized away,
 * because those differ for reasons that have nothing to do with honesty. What is
 * not forgiven is a quote that isn't there.
 */
import type { Corpus, Line } from "./corpus";
import type { Card, CharacterRole, Dynamic, EraCard, Evidence, LanguageInsight, Motif, ReadingOutput, SilenceCard, Topic, WildSentence } from "./schema";
import { buildLanguageCandidates } from "./language-candidates";
import { buildWildCandidates } from "./wild-candidates";

export interface ResolvedEvidence {
  seq: number;
  quote: string;
  /** the real Telegram message id, so the UI can deep-link the export */
  messageId: number | null;
  ts: number;
  who: 0 | 1;
  /** the message as it actually reads */
  body: string;
}

export type CitationFailure =
  | { kind: "out-of-range"; seq: number; quote: string }
  | { kind: "quote-not-found"; seq: number; quote: string; body: string };

export interface Checked<T> {
  card: T;
  evidence: ResolvedEvidence[];
  failures: CitationFailure[];
}

export interface CheckedDynamic extends Checked<Dynamic> {
  counterEvidence: ResolvedEvidence[];
  counterFailures: CitationFailure[];
}

export interface ValidationReport {
  eras: Checked<EraCard>[];
  silences: Checked<SilenceCard>[];
  findings: Checked<Card>[];
  motifs: Checked<Motif>[];
  topics: Checked<Topic>[];
  dynamics: CheckedDynamic[];
  roles: { a: Checked<CharacterRole>[]; b: Checked<CharacterRole>[] };
  language: { a: Checked<LanguageInsight>[]; b: Checked<LanguageInsight>[]; shared: Checked<LanguageInsight>[] };
  wildSentences: Checked<WildSentence>[];
  naming: Checked<ReadingOutput["naming"]>;
  /** cards dropped because no citation survived */
  dropped: Array<{ what: string; id: string; failures: CitationFailure[] }>;
  totals: { citations: number; valid: number; outOfRange: number; notFound: number };
}

/** Case, whitespace, and quote-mark differences are noise; everything else isn't. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function checkOne(corpus: Corpus, e: Evidence): { ok: ResolvedEvidence } | { fail: CitationFailure } {
  const line: Line | undefined = corpus.bySeq.get(e.seq);
  if (!line) return { fail: { kind: "out-of-range", seq: e.seq, quote: e.quote } };

  const body = normalize(line.body);
  const quote = normalize(e.quote);
  // An empty quote is not evidence of anything, and a media placeholder is
  // legitimately quoted by naming it.
  const found = quote.length > 0 && body.includes(quote);
  if (!found) {
    return { fail: { kind: "quote-not-found", seq: e.seq, quote: e.quote, body: line.body } };
  }
  return {
    ok: { seq: e.seq, quote: e.quote, messageId: line.messageId, ts: line.ts, who: line.who, body: line.body },
  };
}

function checkAll<T>(corpus: Corpus, card: T, evidence: Evidence[]): Checked<T> {
  const ok: ResolvedEvidence[] = [];
  const failures: CitationFailure[] = [];
  for (const e of evidence) {
    const result = checkOne(corpus, e);
    if ("ok" in result) ok.push(result.ok);
    else failures.push(result.fail);
  }
  return { card, evidence: ok, failures };
}

/**
 * Resolves every citation in a reading and drops the cards that can't support
 * themselves. A card keeps its surviving citations — one good quote is enough to
 * stand a claim up, and discarding a card because its third quote was sloppy
 * would throw away a real finding.
 */
export function validateReading(corpus: Corpus, reading: ReadingOutput): ValidationReport {
  const dropped: ValidationReport["dropped"] = [];
  const totals = { citations: 0, valid: 0, outOfRange: 0, notFound: 0 };

  const tally = (c: Checked<unknown>) => {
    totals.citations += c.evidence.length + c.failures.length;
    totals.valid += c.evidence.length;
    for (const f of c.failures) {
      if (f.kind === "out-of-range") totals.outOfRange++;
      else totals.notFound++;
    }
  };

  const keep = <T>(what: string, id: (card: T) => string, items: T[], ev: (card: T) => Evidence[]) => {
    const out: Checked<T>[] = [];
    for (const item of items) {
      const checked = checkAll(corpus, item, ev(item));
      tally(checked);
      if (checked.evidence.length === 0) {
        dropped.push({ what, id: id(item), failures: checked.failures });
        continue;
      }
      out.push(checked);
    }
    return out;
  };

  const eras = keep("era", (c: EraCard) => c.name, reading.eras, (c) => c.evidence);
  const silences = keep("silence", (c: SilenceCard) => `chapter ${c.chapterIndex}`, reading.silences, (c) => c.evidence);
  const findings = keep("finding", (c: Card) => c.id, reading.findings, (c) => c.evidence);
  const motifs = keep("motif", (c: Motif) => c.id, reading.motifs, (c) => c.evidence);
  const topics = keep("topic", (c: Topic) => c.id, reading.topics, (c) => c.evidence);
  const dynamics: CheckedDynamic[] = [];
  for (const item of reading.dynamics) {
    const primary = checkAll(corpus, item, item.evidence);
    const counter = checkAll(corpus, item, item.counterEvidence);
    tally(primary);
    tally(counter);
    if (primary.evidence.length === 0) {
      dropped.push({ what: "dynamic", id: item.id, failures: primary.failures });
      continue;
    }
    dynamics.push({ ...primary, counterEvidence: counter.evidence, counterFailures: counter.failures });
  }
  const roles = {
    a: keep("role", (c: CharacterRole) => c.id, reading.roles.a, (c) => c.evidence),
    b: keep("role", (c: CharacterRole) => c.id, reading.roles.b, (c) => c.evidence),
  };
  const candidateMap = new Map(buildLanguageCandidates(corpus).map((candidate) => [candidate.id, candidate]));
  const keepLanguage = (side: "a" | "b" | "shared", items: LanguageInsight[]) => {
    const eligible = items.filter((item) => {
      const candidate = candidateMap.get(item.candidateId);
      const valid = candidate?.side === side && normalize(candidate.text) === normalize(item.text);
      if (!valid) dropped.push({ what: "language", id: item.candidateId, failures: [] });
      return valid;
    });
    return keep("language", (item: LanguageInsight) => item.candidateId, eligible, (item) => item.evidence);
  };
  const language = {
    a: keepLanguage("a", reading.language.a),
    b: keepLanguage("b", reading.language.b),
    shared: keepLanguage("shared", reading.language.shared),
  };
  const wildMap = new Map(buildWildCandidates(corpus).map((candidate) => [candidate.id, candidate]));
  const eligibleWild = reading.wildSentences.filter((item) => {
    const candidate = wildMap.get(item.candidateId);
    const valid = candidate && item.evidence[0]?.seq === candidate.seq && normalize(candidate.text) === normalize(item.evidence[0]?.quote ?? "");
    if (!valid) dropped.push({ what: "wild sentence", id: item.candidateId, failures: [] });
    return Boolean(valid);
  });
  const wildSentences = keep("wild sentence", (item: WildSentence) => item.candidateId, eligibleWild, (item) => item.evidence);

  // Naming is not dropped when its citations fail: "she never uses his name" is a
  // real finding that is *supposed* to have thin evidence on one side.
  const naming = checkAll(corpus, reading.naming, reading.naming.evidence);
  tally(naming);

  return { eras, silences, findings, motifs, topics, dynamics, roles, language, wildSentences, naming, dropped, totals };
}

/** Every id a verdict is allowed to cite in `derivedFrom`. */
export function citableIds(report: ValidationReport): Set<string> {
  const ids = new Set<string>();
  for (const f of report.findings) ids.add(f.card.id);
  for (const m of report.motifs) ids.add(m.card.id);
  for (const t of report.topics) ids.add(t.card.id);
  for (const d of report.dynamics) ids.add(d.card.id);
  for (const r of [...report.roles.a, ...report.roles.b]) ids.add(r.card.id);
  for (const e of report.eras) ids.add(e.card.name);
  return ids;
}
