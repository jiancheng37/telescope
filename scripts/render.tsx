/**
 * Renders the real deck to HTML, from a real export plus a saved run, and checks
 * the things a screenshot wouldn't show you.
 *
 * `buildDeck` has been checked against real data, but `Report.tsx` never had —
 * everything the model returns arrives here as a string and gets interpolated
 * somewhere, and the failure mode isn't a crash, it's a slide that quietly reads
 * "undefined" or a quote whose highlight silently didn't resolve. Both render fine.
 *
 * This does not call the API. It reads the `--out` file a previous `npm run wrapped`
 * wrote, so it can be run as often as needed on a corpus that has already been sent.
 *
 *   npx tsx scripts/render.tsx <export.json> <saved.wrapped.json> [--html out.html]
 *
 * `Report` is hook-free, so what comes out of `renderToStaticMarkup` is what the
 * browser renders — the deck's snapping and its anchor rail are pure CSS and
 * anchors. The written HTML can be opened directly, given a stylesheet.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { analyze } from "../src/domain";
import { assignEvidence, buildDeck, displayNames, interleaveFindings } from "../src/ui/cards";
import { Report } from "../src/ui/Report";
import type { Cited, WireDynamic, WirePayload, WireTopic } from "../src/ui/wire";

/**
 * The shape `scripts/wrapped.ts --out` writes. Close to `WirePayload` but not
 * identical: it's already flattened past the `{card, evidence}` wrapper, and it
 * carries the candidates and judgements too, which the browser never sees.
 */
interface Saved {
  chat: { participants: [string, string] };
  verdict: { text: string; rationale: string; compromised: boolean } | null;
  eras: Array<{ chapterIndex: number; name: string; body: string; evidence: Cited[] }>;
  silences: Array<{ chapterIndex: number; body: string; evidence: Cited[] }>;
  findings: Array<{
    id: string;
    metric: string;
    headline: string;
    body: string;
    about: "a" | "b" | "both" | "neither";
    evidence: Cited[];
  }>;
  motifs: Array<{ id: string; name: string; body: string; evidence: Cited[] }>;
  topics?: WireTopic[];
  dynamics?: WireDynamic[];
  naming: { aCallsB: string; bCallsA: string; evidence: Cited[] } | null;
  citations: WirePayload["citations"];
  usage: WirePayload["usage"];
  model?: string;
}

function toPayload(s: Saved): WirePayload {
  return {
    verdict: s.verdict,
    chapterNotes: [
      ...s.eras.map((e) => ({ ...e, name: e.name as string | null })),
      ...s.silences.map((x) => ({ ...x, name: null })),
    ].sort((x, y) => x.chapterIndex - y.chapterIndex),
    findings: s.findings,
    motifs: s.motifs,
    topics: s.topics ?? [],
    dynamics: s.dynamics ?? [],
    naming: s.naming,
    citations: s.citations,
    droppedCount: 0,
    usage: s.usage,
    model: s.model ?? "(saved run)",
  };
}

const [exportPath, savedPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!exportPath || !savedPath) {
  console.error("usage: tsx scripts/render.tsx <export.json> <saved.wrapped.json> [--html out.html]");
  process.exit(1);
}

const { analysis } = analyze(JSON.parse(readFileSync(exportPath, "utf8")));
const saved: Saved = JSON.parse(readFileSync(savedPath, "utf8"));
const llm = toPayload(saved);
const deck = buildDeck(analysis);
const names = displayNames(analysis.chat.participants);

// Mirrors what `Report` does internally. Duplicated rather than exported from the
// component so this script checks the allocation it can see, not one it was handed.
const { slots, leftover } = interleaveFindings(deck, llm.findings);
const quotes = assignEvidence([
  ...deck.flatMap((c) =>
    (slots.get(c.id) ?? []).map((f) => ({ key: `finding:${f.id}`, evidence: f.evidence, want: 2 })),
  ),
  ...leftover.map((f) => ({ key: `finding:${f.id}`, evidence: f.evidence, want: 3 })),
  ...(llm.naming ? [{ key: "naming", evidence: llm.naming.evidence, want: 3 }] : []),
  ...llm.motifs.map((m) => ({ key: `motif:${m.id}`, evidence: m.evidence, want: 4 })),
]);

const html = renderToStaticMarkup(<Report analysis={analysis} deck={deck} llm={llm} />);

// ------------------------------------------------------------------- checks
const text = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const problems: string[] = [];

// One <section> per screen of the deck, and nothing else in the tree is a section:
// the cover, the three fixed charts, one per deck card, one per reading that landed
// nowhere, naming, each motif, the verdict, records, and the colophon. If the count
// is off, a screen rendered nothing — and an empty screen in a snapping deck is
// worse than a missing card in a scrolling one, because it still takes a whole
// scroll to get past.
const sections = html.match(/<section /g)?.length ?? 0;
// The chapter notes are paged four to a screen after the timeline. Duplicated from
// `Report` rather than imported, same as the evidence allocation above: if the two
// drift apart this check fails loudly, which is the point of it.
const chapterNoteScreens = Math.ceil(llm.chapterNotes.filter((n) => n.body).length / 4);
const expected =
  1 + // the cover
  3 + // months, latency, hours
  deck.length +
  chapterNoteScreens +
  leftover.length +
  (llm.naming ? 1 : 0) +
  llm.motifs.length +
  (llm.verdict ? 1 : 0) +
  1 + // records
  1; // colophon
if (sections !== expected) problems.push(`${sections} sections rendered, expected ${expected}`);

// The one failure this is really for: a template hole that filled with nothing.
for (const bad of ["undefined", "NaN", "[object Object]", "Infinity", "null"]) {
  if (text.includes(bad)) problems.push(`the visible text contains "${bad}"`);
}

// Every finding must be on screen somewhere, and every headline is unique enough
// to search for. A finding that renders nowhere is a reading that was paid for and
// thrown away.
for (const f of llm.findings) {
  if (!text.includes(f.headline.replace(/\s+/g, " "))) problems.push(`finding "${f.id}" headline is not in the output`);
}
for (const m of llm.motifs) if (!text.includes(m.name)) problems.push(`motif "${m.id}" name is not in the output`);
if (llm.verdict && !text.includes(llm.verdict.text.replace(/"/g, "&quot;").replace(/&quot;/g, '"'))) {
  problems.push("the verdict text is not in the output");
}

// Quotes are shown as the whole message with the cited fragment marked inside it.
// A quote that doesn't resolve falls back to the bare fragment — legible, but the
// context that keeps it honest is gone, so it's worth counting.
const allCited = [...quotes.values()].flat();
const unmarked = allCited.filter((c) => c.body.toLowerCase().indexOf(c.quote.toLowerCase()) < 0);

// The same message quoted on two cards makes the deck look out of material. The
// allocator is meant to prevent it wherever the evidence allows; where it can't
// (a card whose every quote is already spoken for) that's worth seeing named.
const times = new Map<string, string[]>();
for (const [key, list] of quotes) {
  for (const c of list) {
    const id = c.messageId === null ? `${c.ts}:${c.quote}` : String(c.messageId);
    times.set(id, [...(times.get(id) ?? []), key]);
  }
}
const repeated = [...times.entries()].filter(([, on]) => on.length > 1);

// ------------------------------------------------------------------- report
console.log(`${names[0]} & ${names[1]} — ${deck.length} deterministic cards, ${sections} screens, ${html.length.toLocaleString()} bytes\n`);

console.log("readings, by the card they landed on:");
for (const card of deck) {
  const on = slots.get(card.id) ?? [];
  console.log(`  ${on.length ? "✓" : " "} ${card.id.padEnd(15)} ${on.map((f) => `"${f.headline}"`).join(", ")}`);
}
if (leftover.length) {
  console.log("\n  landed nowhere, rendered on their own:");
  for (const f of leftover) console.log(`    ${f.metric} → "${f.headline}"`);
}

console.log(
  `\nquotes shown: ${allCited.length}, ` +
    `${unmarked.length ? `${unmarked.length} without a resolvable highlight` : "all highlighted in context"}`,
);
for (const c of unmarked) console.log(`  "${c.quote}" is not inside "${c.body}"`);

console.log(
  repeated.length
    ? `${repeated.length} message(s) quoted on more than one card:`
    : "no message is quoted twice.",
);
for (const [id, on] of repeated) console.log(`  message ${id} on ${on.join(", ")}`);

const htmlFlag = process.argv.indexOf("--html");
if (htmlFlag > -1 && process.argv[htmlFlag + 1]) {
  writeFileSync(process.argv[htmlFlag + 1], html);
  console.log(`\nwrote ${process.argv[htmlFlag + 1]}`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nno problems.");
