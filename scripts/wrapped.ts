/**
 * Runs the full pipeline — deterministic analysis, then the LLM half — and prints
 * the result.
 *
 *   npm run wrapped -- "/path/to/result.json"
 *   npm run wrapped -- "/path/to/result.json" --dry     # payload only, no API call
 *   npm run wrapped -- "/path/to/result.json" --model gpt-5.4
 *   npm run wrapped -- "/path/to/result.json" --out r.json
 *
 * Needs OPENAI_API_KEY.
 *
 * `--dry` exists because the payload is the thing to check before spending a call
 * on it, and because it's the step where you'd notice that one of these messages
 * contains a passport number.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyze } from "../src/domain/analyze";
import { buildBrief } from "../src/llm/brief";
import { buildCorpus } from "../src/llm/corpus";
import { MODEL, runWrapped, VERDICT_MAX_CHARS } from "../src/llm/run";

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const outPath = flagValue("--out");
const modelArg = flagValue("--model");
// Anything that isn't a flag or a flag's value is the export path.
const flagValues = new Set([outPath, modelArg].filter((v): v is string => v !== null));
const path = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
const dry = args.includes("--dry");
const showPayload = args.includes("--payload");

if (!path) {
  console.error(
    'usage: npm run wrapped -- "/path/to/result.json" [--dry] [--payload] [--model id] [--out result.json]',
  );
  process.exit(1);
}

const rule = (title: string) => console.log(`\n${"=".repeat(72)}\n  ${title}\n${"=".repeat(72)}`);

const { analysis, parsed } = analyze(JSON.parse(readFileSync(path, "utf8")));
const corpus = buildCorpus(parsed);
const brief = buildBrief(analysis, corpus);

console.log(`\n"${analysis.chat.name}" — ${analysis.volume.total} messages, ${parsed.calls.length} calls`);
console.log(`labels: ${corpus.labels[0]} (side 0) / ${corpus.labels[1]} (side 1)`);
console.log(
  `payload: ${corpus.lines.length} lines, ${corpus.text.length.toLocaleString()} chars, ` +
    `~${corpus.approxTokens.toLocaleString()} tokens`,
);

if (showPayload) {
  rule("BRIEF");
  console.log(brief);
  rule("PAYLOAD (first 60 and last 20 lines)");
  const lines = corpus.text.split("\n");
  console.log(lines.slice(0, 60).join("\n"));
  console.log(`\n   ... ${lines.length - 80} lines ...\n`);
  console.log(lines.slice(-20).join("\n"));
}

if (dry) {
  if (!showPayload) {
    rule("BRIEF");
    console.log(brief);
  }
  console.log(`\n(dry run — no API call made)`);
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("\nOPENAI_API_KEY is not set. Use --dry to inspect the payload without a call.");
  process.exit(1);
}

const result = await runWrapped(parsed, analysis, {
  model: modelArg ?? undefined,
  onProgress: (n) => console.log(`  · ${n}`),
});

const { report, verdict } = result;

rule("THE VERDICT");
if (!verdict) {
  console.log("  Nothing survived. See the rejections below.");
} else {
  console.log(`\n      ${verdict.text}\n`);
  console.log(`  ${[...verdict.text].length} chars (budget ${VERDICT_MAX_CHARS})`);
  console.log(`  rests on: ${verdict.derivedFrom.join(", ")}`);
  console.log(`  because: ${verdict.rationale}`);
  if (verdict.judgement) {
    const j = verdict.judgement;
    console.log(`  sharpness ${j.sharpness}/5 | judge note: ${j.note}`);
  }
  if (verdict.compromised) {
    console.log(`  ⚠ no candidate passed every check — this is the least-bad one`);
  }
}

rule("ERAS");
for (const e of report.eras) {
  console.log(`\n▸ ${e.card.name}  (chapter ${e.card.chapterIndex})`);
  console.log(`  ${e.card.body}`);
  for (const ev of e.evidence) console.log(`    #${ev.seq} "${ev.quote}"`);
}

if (report.silences.length) {
  rule("SILENCES");
  for (const s of report.silences) {
    console.log(`\n▸ chapter ${s.card.chapterIndex}`);
    console.log(`  ${s.card.body}`);
    for (const ev of s.evidence) console.log(`    #${ev.seq} "${ev.quote}"`);
  }
}

rule("FINDINGS");
for (const f of report.findings) {
  console.log(`\n▸ ${f.card.headline}   [${f.card.id} · ${f.card.metric} · about ${f.card.about}]`);
  console.log(`  ${f.card.body}`);
  for (const ev of f.evidence) console.log(`    #${ev.seq} "${ev.quote}"`);
}

if (report.motifs.length) {
  rule("MOTIFS");
  for (const m of report.motifs) {
    console.log(`\n▸ ${m.card.name}   [${m.card.id}]`);
    console.log(`  ${m.card.body}`);
    for (const ev of m.evidence) console.log(`    #${ev.seq} "${ev.quote}"`);
  }
}

rule("WHAT THEY CALL EACH OTHER");
console.log(`  ${corpus.labels[0]} → ${corpus.labels[1]}: ${report.naming.card.aCallsB || "(never uses a name)"}`);
console.log(`  ${corpus.labels[1]} → ${corpus.labels[0]}: ${report.naming.card.bCallsA || "(never uses a name)"}`);
for (const ev of report.naming.evidence) console.log(`    #${ev.seq} "${ev.quote}"`);

rule("CITATION CHECK");
const t = report.totals;
console.log(`  ${t.valid}/${t.citations} citations verified against the payload`);
if (t.notFound) console.log(`  ${t.notFound} quote(s) not found in the message they pointed at`);
if (t.outOfRange) console.log(`  ${t.outOfRange} citation(s) pointed at a #seq that doesn't exist`);
for (const d of report.dropped) {
  console.log(`  dropped ${d.what} "${d.id}" — no citation survived:`);
  for (const f of d.failures) {
    console.log(
      f.kind === "out-of-range"
        ? `      #${f.seq} does not exist ("${f.quote}")`
        : `      #${f.seq} says "${f.body}" — not "${f.quote}"`,
    );
  }
}

rule("VERDICT CANDIDATES");
result.candidates.forEach((c, i) => {
  const j = result.judgements.find((x) => x.index === i);
  const flags: string[] = [];
  if (j?.transferable) flags.push("transferable");
  if (j?.aimedAtPerson) flags.push("aimed-at-person");
  if (j?.redemptiveClause) flags.push("redemptive");
  if (j?.therapyVocabulary) flags.push("therapy-vocab");
  if (j?.crossesRedLine) flags.push("RED LINE");
  if (j?.unsupported) flags.push("unsupported");
  const mark = verdict && c.text === verdict.text ? "★" : " ";
  console.log(
    `${mark} ${String(i).padStart(2)}. ${j?.sharpness ?? "?"}/5  ${String([...c.text].length).padStart(3)}c  "${c.text}"` +
      (flags.length ? `\n         ✗ ${flags.join(", ")}` : ""),
  );
});
for (const r of result.rejected) {
  console.log(`  – rejected before judging: "${r.candidate.text}" (${r.reason})`);
}

rule("USAGE");
const u = result.usage;
console.log(`  model ${result.model}, ${u.calls} calls`);
console.log(
  `  input ${u.inputTokens.toLocaleString()} billed + ${u.cachedTokens.toLocaleString()} cached` +
    ` | output ${u.outputTokens.toLocaleString()} (${u.reasoningTokens.toLocaleString()} reasoning)`,
);
// The cache is the whole reason the payload is only paid for once. If this is 0 on
// calls 2 and 3, the prefix isn't identical and the run costs three times what it
// should — worth noticing rather than discovering on a bill.
const cacheShare = u.inputTokens + u.cachedTokens > 0 ? u.cachedTokens / (u.inputTokens + u.cachedTokens) : 0;
console.log(`  ${(cacheShare * 100).toFixed(0)}% of input served from cache`);

// Deliberately no dollar figure: the per-model rates aren't something this script
// can know, and a confidently wrong estimate is worse than none. Multiply the
// counts above by current published rates.

if (outPath) {
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        chat: analysis.chat,
        // Which model wrote the reading, saved alongside it. A saved run without
        // this can't be compared against another one, and the readings are the
        // whole thing being compared.
        model: result.model,
        verdict: result.verdict,
        eras: report.eras.map((e) => ({ ...e.card, evidence: e.evidence })),
        silences: report.silences.map((s) => ({ ...s.card, evidence: s.evidence })),
        findings: report.findings.map((f) => ({ ...f.card, evidence: f.evidence })),
        motifs: report.motifs.map((m) => ({ ...m.card, evidence: m.evidence })),
        topics: report.topics.map((t) => ({ ...t.card, evidence: t.evidence })),
        dynamics: report.dynamics.map((d) => ({
          ...d.card,
          evidence: d.evidence,
          counterEvidence: d.counterEvidence,
        })),
        naming: { ...report.naming.card, evidence: report.naming.evidence },
        candidates: result.candidates,
        judgements: result.judgements,
        citations: report.totals,
        droppedCount: report.dropped.length,
        usage: result.usage,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${outPath}`);
}
