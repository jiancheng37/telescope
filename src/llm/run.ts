/**
 * The LLM half, end to end.
 *
 * Three calls, in sequence, with progressively smaller payloads:
 *
 *   1. reading  — a bounded representative sample plus the complete numeric brief
 *   2. verdict  — the validated reading digest only
 *   3. judge    — the digest and candidates only
 *
 * The judge is a separate call on purpose. Asking one pass to write ten sharp
 * lines and also to be strict about which of them are horoscopes puts it in the
 * position of marking its own work, and it will pass itself.
 *
 * The complete corpus is retained in memory for citation validation, but is never
 * sent wholesale once it crosses the sample budget. Stable seq ids survive the
 * sample, so quotes are still checked against the original message rather than the
 * excerpt. Prompt caching can help identical reruns; it is not relied on for the
 * main saving, which comes from not resending raw messages to calls two and three.
 */
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import * as z from "zod";
import type { Analysis } from "../domain/types";
import type { Parsed } from "../domain/parse";
import { buildBrief } from "./brief";
import { buildCorpus, type Corpus } from "./corpus";
import { sampleCorpus } from "./sample";
import { buildSemanticEras } from "./eras";
import { candidateSystem, corpusBlock, judgeSystem, readingSystem } from "./prompts";
import {
  JudgeOutput,
  ReadingOutput,
  VerdictCandidates,
  type Judgement,
  type VerdictCandidate,
} from "./schema";
import { citableIds, validateReading, type ValidationReport } from "./validate";

/**
 * Overridable because this is the one line most likely to be wrong for a given
 * account: model availability varies by org, and the 5.6 variants are siblings
 * whose tiering isn't something this file can check. `--model` or
 * `TELESCOPE_MODEL` beats editing it.
 */
export const MODEL = process.env.TELESCOPE_MODEL ?? "gpt-5-mini";

/**
 * The corpus is already paired with a deterministic brief and a strict output
 * schema. Low effort leaves the output budget for the structured report instead
 * of spending most of it on hidden reasoning, which is especially important on
 * the mini model with a 100k-token input.
 */
export const EFFORT = "low" as const;

/**
 * The same ceiling on all three calls. It is a ceiling, not a target. The reading
 * has the largest schema and must finish its JSON object to be parseable; 16k was
 * exhausted after topics and dynamics were added, so this leaves explicit slack.
 */
const MAX_OUTPUT = 32000;

/**
 * The verdict's character budget. Derived from the card typography rather than a
 * word count — the six-word framing was always really "one line that fits".
 */
export const VERDICT_MAX_CHARS = 50;

export interface Verdict {
  text: string;
  derivedFrom: string[];
  rationale: string;
  judgement: Judgement | null;
  /** true when no candidate passed every check and this is the least-bad one */
  compromised: boolean;
}

export interface Usage {
  /** input tokens actually billed at full rate, i.e. excluding cache hits */
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** part of outputTokens, broken out because it's usually most of them */
  reasoningTokens: number;
  calls: number;
  /** embedding input tokens used to construct the semantic era timeline */
  embeddingTokens?: number;
  embeddingCalls?: number;
}

export interface WrappedResult {
  corpus: Corpus;
  brief: string;
  report: ValidationReport;
  verdict: Verdict | null;
  candidates: VerdictCandidate[];
  judgements: Judgement[];
  /** candidates thrown out before the judge ever saw them */
  rejected: Array<{ candidate: VerdictCandidate; reason: string }>;
  usage: Usage;
  model: string;
  analysisChapters: Analysis["chapters"];
}

export interface RunOptions {
  apiKey?: string;
  model?: string;
  /** called with a one-line progress note before each call */
  onProgress?: (note: string) => void;
}

export async function runWrapped(
  parsed: Parsed,
  analysis: Analysis,
  opts: RunOptions = {},
): Promise<WrappedResult> {
  const client = new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY });
  const model = opts.model ?? MODEL;
  const note = opts.onProgress ?? (() => {});
  const usage: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 0, embeddingTokens: 0, embeddingCalls: 0 };

  const corpus = buildCorpus(parsed);
  const semanticEras = await buildSemanticEras(parsed, analysis, client, note);
  analysis.chapters = semanticEras.chapters;
  usage.embeddingTokens = semanticEras.inputTokens;
  usage.embeddingCalls = semanticEras.calls;
  const configuredSampleBudget = Number(process.env.TELESCOPE_SAMPLE_TOKENS);
  const sampleBudget = Number.isFinite(configuredSampleBudget) && configuredSampleBudget > 0
    ? configuredSampleBudget
    : undefined;
  const { corpus: readingCorpus, stats: sample } = sampleCorpus(
    corpus,
    analysis,
    sampleBudget,
    semanticEras.representativeMessageIds,
  );
  const brief = buildBrief(analysis, corpus);
  const payload = corpusBlock(readingCorpus, brief);

  // Buckets the three calls together for caching. Derived from the payload so it
  // is stable across a re-run of the same export and distinct across chats.
  const cacheKey = `telescope-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;

  /**
   * One structured pass. `context` is present only for the initial reading; later
   * calls deliberately receive the compact validated digest in `task` instead.
   *
   * Generic over the schema rather than over the return type, so the two can't
   * drift apart at a call site — this is the boundary where model output becomes
   * typed data, and an unchecked cast here is the one place it would go unnoticed.
   */
  async function pass<S extends z.ZodType>(
    label: string,
    context: string | null,
    instructions: string,
    task: string,
    schema: S,
  ): Promise<z.infer<S> | null> {
    const stream = client.responses.stream({
      model,
      reasoning: { effort: EFFORT },
      max_output_tokens: MAX_OUTPUT,
      prompt_cache_key: cacheKey,
      input: [
        ...(context ? [{ role: "user" as const, content: context }] : []),
        { role: "developer" as const, content: instructions },
        { role: "user" as const, content: task },
      ],
      text: { format: zodTextFormat(schema, label) },
    });
    const response = await stream.finalResponse();

    usage.calls++;
    const u = response.usage;
    if (u) {
      const cached = u.input_tokens_details?.cached_tokens ?? 0;
      // `input_tokens` is the whole input, cache hits included, so the part billed
      // at full rate is the difference.
      usage.inputTokens += Math.max(0, u.input_tokens - cached);
      usage.cachedTokens += cached;
      usage.outputTokens += u.output_tokens;
      usage.reasoningTokens += u.output_tokens_details?.reasoning_tokens ?? 0;
      // Per call, not just the total. The first call is expected to miss — it's the
      // one writing the cache — so a low overall percentage says nothing about
      // *which* call missed, and that's the only thing that would point at a cause.
      note(
        `  ${label}: ${u.input_tokens.toLocaleString()} in ` +
          `(${cached.toLocaleString()} cached, ${Math.round((cached / Math.max(1, u.input_tokens)) * 100)}%), ` +
          `${u.output_tokens.toLocaleString()} out`,
      );
    }
    if (response.incomplete_details) {
      note(`  ! ${label} stopped early: ${response.incomplete_details.reason ?? "unknown"}`);
      if (!response.output_parsed) {
        throw new Error(
          `${label} stopped before its structured response was complete (${response.incomplete_details.reason ?? "unknown reason"}).`,
        );
      }
    }
    return (response.output_parsed as z.infer<S> | null) ?? null;
  }

  // ------------------------------------------------------------- 1. reading
  note(
    sample.sampled
      ? `reading representative sample: ${sample.selectedLines.toLocaleString()}/${sample.originalLines.toLocaleString()} lines ` +
        `(~${sample.selectedTokens.toLocaleString()}/${sample.originalTokens.toLocaleString()} tokens) with ${model}`
      : `reading ${corpus.lines.length} lines (~${corpus.approxTokens.toLocaleString()} tokens) with ${model}`,
  );
  const reading = await pass(
    "reading",
    payload,
    readingSystem(readingCorpus),
    "Read it and produce the reading described in your instructions.",
    ReadingOutput,
  );
  if (!reading) throw new Error("The reading pass returned nothing parseable.");

  const report = validateReading(corpus, reading);
  note(
    `reading: ${report.findings.length} findings, ${report.eras.length} eras, ${report.motifs.length} motifs, ` +
      `${report.topics.length} topics, ${report.dynamics.length} dynamics, ${report.roles.a.length + report.roles.b.length} roles | ` +
      `citations ${report.totals.valid}/${report.totals.citations} verified` +
      (report.dropped.length ? `, ${report.dropped.length} card(s) dropped` : ""),
  );

  // A reading with nothing left to stand on can't support a verdict, and inventing
  // one anyway is exactly the failure this whole structure exists to prevent.
  if (report.findings.length === 0) {
    return { corpus, brief, report, verdict: null, candidates: [], judgements: [], rejected: [], usage, model, analysisChapters: analysis.chapters };
  }

  // ------------------------------------------------------------- 2. candidates
  const readingDigest = digestFor(report);
  note("generating verdict candidates");
  const generatedOut = await pass(
    "verdict_candidates",
    null,
    candidateSystem(readingCorpus, VERDICT_MAX_CHARS),
    `# The reading\n\n${readingDigest}\n\nWrite the candidate verdicts.`,
    VerdictCandidates,
  );
  const generated = generatedOut?.candidates ?? [];

  // Filter before judging: an over-budget line or one resting on a finding that
  // didn't survive validation is unusable regardless of how good it reads, and
  // spending judge attention on it costs a slot that a real candidate needs.
  const allowed = citableIds(report);
  const rejected: WrappedResult["rejected"] = [];
  const candidates: VerdictCandidate[] = [];
  for (const c of generated) {
    const overBudget = [...c.text].length > VERDICT_MAX_CHARS + 10;
    const unknown = c.derivedFrom.filter((id) => !allowed.has(id));
    if (overBudget) {
      rejected.push({ candidate: c, reason: `${[...c.text].length} chars, over the ${VERDICT_MAX_CHARS} budget` });
    } else if (c.derivedFrom.length === 0 || unknown.length === c.derivedFrom.length) {
      rejected.push({ candidate: c, reason: `cites nothing that survived validation (${unknown.join(", ") || "no ids"})` });
    } else {
      candidates.push(c);
    }
  }
  note(`${candidates.length} candidates to judge${rejected.length ? `, ${rejected.length} rejected up front` : ""}`);

  if (candidates.length === 0) {
    return { corpus, brief, report, verdict: null, candidates, judgements: [], rejected, usage, model, analysisChapters: analysis.chapters };
  }

  // ------------------------------------------------------------- 3. judge
  const judged = await pass(
    "judgement",
    null,
    judgeSystem(VERDICT_MAX_CHARS),
    `# The reading these rest on\n\n${readingDigest}\n\n# Candidates\n\n` +
      candidates
        .map(
          (c, i) =>
            `${i}. "${c.text}" (${[...c.text].length} chars)\n   derivedFrom: ${c.derivedFrom.join(", ")}\n   rationale: ${c.rationale}`,
        )
        .join("\n") +
      `\n\nJudge every candidate and pick a winner.`,
    JudgeOutput,
  );
  const judgements = judged?.judgements ?? [];

  const verdict = pickVerdict(candidates, judgements, judged?.winner ?? -1);
  note(verdict ? `verdict: "${verdict.text}"` : "no candidate survived judging");

  return { corpus, brief, report, verdict, candidates, judgements, rejected, usage, model, analysisChapters: analysis.chapters };
}

function fails(j: Judgement): string[] {
  const out: string[] = [];
  if (j.transferable) out.push("transferable");
  if (j.aimedAtPerson) out.push("aimed at a person");
  if (j.redemptiveClause) out.push("redemptive clause");
  if (j.therapyVocabulary) out.push("therapy vocabulary");
  if (j.crossesRedLine) out.push("crosses a red line");
  if (j.unsupported) out.push("unsupported");
  return out;
}

/**
 * The judge names a winner, but its pick is re-derived here rather than trusted.
 * A judge that marks a candidate as crossing a red line and then nominates it
 * anyway is a thing that happens, and the red line is not a preference.
 */
export function pickVerdict(
  candidates: VerdictCandidate[],
  judgements: Judgement[],
  proposed: number,
): Verdict | null {
  const byIndex = new Map(judgements.map((j) => [j.index, j]));
  const eligible = candidates
    .map((c, i) => ({ c, i, j: byIndex.get(i) ?? null }))
    .filter(({ j }) => !j || !j.crossesRedLine);
  if (eligible.length === 0) return null;

  const clean = eligible.filter(({ j }) => j && fails(j).length === 0);
  const pool = clean.length ? clean : eligible;

  // A candidate the judge skipped scores zero and sorts last, but it must not
  // crash the sort — a judge that returns nine judgements for ten candidates, or
  // no parseable output at all, is a bad response and not a reason to have no card.
  const failureCount = (j: Judgement | null) => (j ? fails(j).length : 0);

  const proposedEntry = pool.find(({ i }) => i === proposed);
  const best =
    proposedEntry ??
    [...pool].sort((x, y) => {
      const sharp = (y.j?.sharpness ?? 0) - (x.j?.sharpness ?? 0);
      if (sharp !== 0) return sharp;
      // Tie-break on failure count, then on brevity: the budget is real.
      const byFailures = failureCount(x.j) - failureCount(y.j);
      if (byFailures !== 0) return byFailures;
      return [...x.c.text].length - [...y.c.text].length;
    })[0];

  return {
    text: best.c.text,
    derivedFrom: best.c.derivedFrom,
    rationale: best.c.rationale,
    judgement: best.j,
    compromised: clean.length === 0,
  };
}

/** What the verdict and judge passes need to know about the reading. */
function digestFor(report: ValidationReport): string {
  const L: string[] = [];
  if (report.eras.length) {
    L.push("## Eras");
    for (const e of report.eras) L.push(`- **${e.card.name}** — ${e.card.body}`);
  }
  if (report.silences.length) {
    L.push("", "## Silences");
    for (const s of report.silences) L.push(`- chapter ${s.card.chapterIndex}: ${s.card.body}`);
  }
  L.push("", "## Findings (cite these ids)");
  for (const f of report.findings) {
    L.push(`- \`${f.card.id}\` **${f.card.headline}** — ${f.card.body}`);
    for (const ev of f.evidence) L.push(`    #${ev.seq}: "${ev.quote}"`);
  }
  if (report.motifs.length) {
    L.push("", "## Motifs (cite these ids)");
    for (const m of report.motifs) L.push(`- \`${m.card.id}\` **${m.card.name}** — ${m.card.body}`);
  }
  if (report.topics.length) {
    L.push("", "## Topics (cite these ids)");
    for (const t of report.topics) L.push(`- \`${t.card.id}\` **${t.card.label}** [${t.card.category}] — ${t.card.summary}`);
  }
  if (report.dynamics.length) {
    L.push("", "## Interaction dynamics (cite these ids)");
    for (const d of report.dynamics) {
      L.push(`- \`${d.card.id}\` **${d.card.headline}** [${d.card.category}] — ${d.card.body}`);
      for (const ev of d.evidence) L.push(`    #${ev.seq}: "${ev.quote}"`);
    }
  }
  if (report.roles.a.length || report.roles.b.length) {
    L.push("", "## Character roles (cite these ids)");
    for (const [side, roles] of [["a", report.roles.a], ["b", report.roles.b]] as const) {
      for (const r of roles) L.push(`- \`${r.card.id}\` side ${side}: **${r.card.title}** — ${r.card.description}`);
    }
  }
  const n = report.naming.card;
  if (n.aCallsB || n.bCallsA) {
    L.push("", `## What they call each other`, `- a→b: ${n.aCallsB || "(never)"}`, `- b→a: ${n.bCallsA || "(never)"}`);
  }
  return L.join("\n");
}
