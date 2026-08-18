/**
 * Prints the full deterministic analysis for a Telegram export.
 *
 *   npm run report -- "/path/to/result.json"
 *
 * This exists to check the analysis against real data outside the browser. The
 * numbers it prints are the numbers the UI will render and the numbers the LLM
 * pass will be handed, so if something looks wrong here it is wrong everywhere.
 */
import { readFileSync } from "node:fs";
import { analyze } from "../src/domain/analyze";
import type { Analysis, Pair, Side } from "../src/domain/types";

const path = process.argv[2];
if (!path) {
  console.error('usage: npm run report -- "/path/to/result.json"');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, "utf8"));
const started = performance.now();
const { analysis, parsed } = analyze(raw);
const elapsed = performance.now() - started;

const [A, B] = analysis.chat.participants;
const nameOf = (s: Side) => (s === 0 ? A : B);
const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number, w = 7, d = 0) => n.toFixed(d).padStart(w);
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
// Local time, not UTC — a message sent at 11pm in Singapore belongs to that
// evening, not to the next morning.
const day = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const bar = (n: number, max: number, w = 30) => "█".repeat(max ? Math.max(0, Math.round((n / max) * w)) : 0);

function hdr(title: string) {
  console.log(`\n\n${"=".repeat(72)}\n  ${title}\n${"=".repeat(72)}`);
}

function twoCol(label: string, p: Pair<string | number>) {
  console.log(`${pad(label, 26)} ${String(p.a).padStart(14)}  ${String(p.b).padStart(14)}`);
}

function fmtDuration(sec: number): string {
  if (sec < 90) return `${sec.toFixed(0)}s`;
  if (sec < 5400) return `${(sec / 60).toFixed(0)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------

console.log(`\n"${analysis.chat.name}"  (chat id ${analysis.chat.id})`);
console.log(`sides: 0=${A}  1=${B}${parsed.selfSide !== null ? `   (you are ${nameOf(parsed.selfSide)})` : ""}`);
console.log(
  `parsed + analyzed ${analysis.volume.total} messages in ${elapsed.toFixed(0)}ms | ` +
    `skipped: ${parsed.skipped.serviceMessages} service, ${parsed.skipped.thirdParties} third-party, ` +
    `${parsed.skipped.noTimestamp} undated`,
);

hdr("VOLUME");
const v = analysis.volume;
console.log(`${pad("", 26)} ${pad(A, 14).padStart(14)}  ${pad(B, 14).padStart(14)}`);
twoCol("messages", v.messages);
twoCol("share", { a: pct(v.messages.a / v.total, 1), b: pct(v.messages.b / v.total, 1) });
twoCol("characters", v.chars);
twoCol("words", v.words);
twoCol("chars / message", { a: v.charsPerMessage.a.toFixed(1), b: v.charsPerMessage.b.toFixed(1) });
console.log(`\nmessage ratio ${A} : ${B} = ${v.messageRatio.toFixed(2)} : 1`);
console.log(
  `span ${analysis.span.days.toFixed(0)} days | ${analysis.span.activeDays} active ` +
    `(${pct(analysis.span.activeShare)}) | ${v.perActiveDay.toFixed(1)} msgs per active day`,
);

hdr("SESSIONS  (45min gap)");
const ss = analysis.sessionSummary;
console.log(
  `${ss.count} sessions | median ${ss.medianMessages.toFixed(1)} msgs, mean ${ss.meanMessages.toFixed(1)}, ` +
    `max ${ss.maxMessages} | median ${ss.medianDurationMin.toFixed(0)} min`,
);
console.log(`${ss.monologueSessions} sessions (${pct(ss.monologueSessions / ss.count)}) had one person only`);
twoCol("opens", { a: pct(ss.opens.a / ss.count), b: pct(ss.opens.b / ss.count) });
twoCol("closes", { a: pct(ss.closes.a / ss.count), b: pct(ss.closes.b / ss.count) });

hdr("EPISODES  (14+ day silence ends one)");
console.log(
  `${pad("#", 3)}${pad("start", 12)}${pad("end", 12)}${"days".padStart(5)}${"msgs".padStart(6)}` +
    `${"/day".padStart(7)}  ${pad("revived by", 16)}${pad("went quiet", 16)}${"dormant after".padStart(14)}`,
);
for (const e of analysis.episodes) {
  console.log(
    pad(String(e.index), 3) +
      pad(day(e.startTs), 12) +
      pad(day(e.endTs), 12) +
      num(e.days, 5) +
      num(e.messageCount, 6) +
      num(e.messagesPerDay, 7, 1) +
      "  " +
      pad(e.revivedBy === null ? "— (first)" : nameOf(e.revivedBy), 16) +
      pad(e.wentQuiet === null ? "—" : nameOf(e.wentQuiet), 16) +
      (e.dormantAfterDays === null ? "—" : `${e.dormantAfterDays.toFixed(0)}d`).padStart(14),
  );
}
console.log(
  `\ndormant ${analysis.rhythm.dormantDays.toFixed(0)} of ${analysis.span.days.toFixed(0)} days ` +
    `(${pct(analysis.rhythm.dormantShare)})`,
);

hdr("CHAPTERS  (eras and the silences between them)");
const maxRate = Math.max(...analysis.chapters.filter((c) => c.kind === "era").map((c) => (c.kind === "era" ? c.messagesPerMonth : 0)));
for (const c of analysis.chapters) {
  if (c.kind === "era") {
    console.log(
      `${c.quiet ? "  lull  " : "ERA    "}  ${day(c.startTs)} → ${day(c.endTs)}  ${num(c.months, 3)}mo ` +
        `${num(c.messageCount, 6)} msgs ${num(c.messagesPerMonth, 6)}/mo ${pct(c.share, 0).padStart(5)}  ` +
        `${bar(c.messagesPerMonth, maxRate, 22)}`,
    );
  } else {
    console.log(
      `  silence ${day(c.startTs)} → ${day(c.endTs)}  ${num(c.days, 4)} days dark   ` +
        `${nameOf(c.wentQuiet)} stopped, ${nameOf(c.revivedBy)} came back` +
        (c.blipMessages
          ? `   (${c.blipMessages} msgs in ${c.blipCount} false start${c.blipCount > 1 ? "s" : ""})`
          : ""),
    );
  }
}

hdr("REPLY LATENCY");
const lat = analysis.rhythm.latency;
console.log(`${pad("replier", 26)} ${"n".padStart(8)} ${"median".padStart(9)} ${"p75".padStart(9)} ${"p90".padStart(9)} ${"in-session".padStart(11)}`);
for (const [side, s] of [[0, lat.a], [1, lat.b]] as const) {
  console.log(
    pad(nameOf(side as Side), 26) +
      String(s.n).padStart(9) +
      fmtDuration(s.medianSec).padStart(10) +
      fmtDuration(s.p75Sec).padStart(10) +
      fmtDuration(s.p90Sec).padStart(10) +
      fmtDuration(s.inSessionMedianSec).padStart(12),
  );
}
console.log(`\nasymmetry ${analysis.rhythm.latencyAsymmetry.toFixed(2)}x` +
  (Math.abs(analysis.rhythm.latencyAsymmetry - 1) < 0.15 ? "   <- no signal, do not build a card on this" : ""));

hdr("MONOLOGUE RUNS");
const mono = analysis.rhythm.monologues;
console.log(`${pad("", 26)} ${"runs".padStart(7)} ${"mean".padStart(7)} ${"max".padStart(6)} ${"3+".padStart(7)} ${"8+".padStart(6)} ${"msgs in runs".padStart(13)}`);
for (const [side, s] of [[0, mono.a], [1, mono.b]] as const) {
  console.log(
    pad(nameOf(side as Side), 26) +
      num(s.runs, 8) +
      num(s.meanRunLength, 8, 2) +
      num(s.maxRunLength, 7) +
      pct(s.shareOfRunsOver3).padStart(8) +
      num(s.runsOver8, 7) +
      pct(s.shareOfMessagesInRuns).padStart(14),
  );
}

hdr("HOUR OF DAY");
const hist = analysis.rhythm.hourHistogram;
const maxHour = Math.max(...hist.a, ...hist.b);
console.log(`${"hr".padStart(3)}  ${pad(A, 34)} ${B}`);
for (let h = 0; h < 24; h++) {
  console.log(`${String(h).padStart(3)}  ${pad(bar(hist.a[h], maxHour), 34)} ${bar(hist.b[h], maxHour)}`);
}
twoCol("midnight-5am share", {
  a: pct(analysis.rhythm.lateNightShare.a, 1),
  b: pct(analysis.rhythm.lateNightShare.b, 1),
});

hdr("LONGEST SILENCES");
console.log(`${"gap".padStart(8)}  ${pad("from", 12)}${pad("to", 12)}${pad("went quiet", 18)}${pad("came back", 18)}`);
for (const s of analysis.rhythm.longestSilences.slice(0, 12)) {
  console.log(
    `${s.days.toFixed(1).padStart(7)}d  ${pad(day(s.fromTs), 12)}${pad(day(s.toTs), 12)}` +
      `${pad(nameOf(s.wentQuiet), 18)}${pad(nameOf(s.revivedBy), 18)}`,
  );
}

hdr("REVIVAL  (who ends silences vs who lets them start)");
console.log(`${"threshold".padStart(10)} ${"n".padStart(4)}   ${pad("revived by " + A, 24)}${pad("revived by " + B, 24)}`);
for (const r of analysis.rhythm.revival) {
  console.log(
    `${String(r.thresholdDays).padStart(9)}d ${String(r.n).padStart(4)}   ` +
      pad(`${r.revivedBy.a}  (${pct(r.revivedBy.a / Math.max(1, r.n))})`, 24) +
      pad(`${r.revivedBy.b}  (${pct(r.revivedBy.b / Math.max(1, r.n))})`, 24),
  );
}
console.log();
for (const r of analysis.rhythm.revival) {
  console.log(
    `${String(r.thresholdDays).padStart(9)}d ${String(r.n).padStart(4)}   ` +
      pad(`last word ${A}: ${r.wentQuiet.a} (${pct(r.wentQuiet.a / Math.max(1, r.n))})`, 34) +
      pad(`last word ${B}: ${r.wentQuiet.b} (${pct(r.wentQuiet.b / Math.max(1, r.n))})`, 34),
  );
}

hdr("CONCENTRATION");
console.log(`${analysis.concentration.sessions} sessions`);
for (const t of analysis.concentration.topSessionShare) {
  console.log(`  top ${String(t.n).padStart(3)} sessions hold ${String(t.messages).padStart(5)} msgs (${pct(t.share, 1).padStart(5)})`);
}
console.log(`\n${analysis.span.activeDays} active days`);
for (const t of analysis.concentration.topDayShare) {
  console.log(`  top ${String(t.n).padStart(3)} days     hold ${String(t.messages).padStart(5)} msgs (${pct(t.share, 1).padStart(5)})`);
}
console.log("\nbusiest days:");
for (const d of analysis.concentration.busiestDays.slice(0, 6)) {
  console.log(`  ${d.date}  ${String(d.total).padStart(4)} msgs   ${A}: ${String(d.counts.a).padStart(4)}  ${B}: ${String(d.counts.b).padStart(4)}`);
}

hdr("BEHAVIOURAL TELLS");
const bh = analysis.behaviour;
const rate = (p: Pair<number>) => ({
  a: `${p.a} (${pct(p.a / v.messages.a, 1)})`,
  b: `${p.b} (${pct(p.b / v.messages.b, 1)})`,
});
console.log(`${pad("", 26)} ${pad(A, 14).padStart(14)}  ${pad(B, 14).padStart(14)}`);
twoCol("quote-replies", rate(bh.quoteReplies));
twoCol("edited own message", rate(bh.edits));
twoCol("forwards", rate(bh.forwards));
twoCol("stickers", bh.stickers);
twoCol("video notes", { a: `${bh.videoNotes.a.count} (${(bh.videoNotes.a.totalSeconds / 60).toFixed(0)}m)`, b: `${bh.videoNotes.b.count} (${(bh.videoNotes.b.totalSeconds / 60).toFixed(0)}m)` });
twoCol("voice notes", { a: `${bh.voiceNotes.a.count} (${(bh.voiceNotes.a.totalSeconds / 60).toFixed(0)}m)`, b: `${bh.voiceNotes.b.count} (${(bh.voiceNotes.b.totalSeconds / 60).toFixed(0)}m)` });
twoCol("reactions given", bh.reactionsGiven);
twoCol("reactions received", bh.reactionsReceived);
console.log(`\ncalls: ${bh.calls.total}, ${bh.calls.totalMinutes.toFixed(0)} min total`);
twoCol("  initiated", bh.calls.initiated);
twoCol("  minutes on the call", { a: bh.calls.minutes.a.toFixed(0), b: bh.calls.minutes.b.toFixed(0) });
console.log(`  discard reasons: ${JSON.stringify(bh.calls.discardReasons)}`);

hdr("QUESTIONS");
const q = analysis.language.questions;
twoCol("messages with ?", q.count);
twoCol("rate", { a: pct(q.rate.a, 1), b: pct(q.rate.b, 1) });
twoCol("no reply within 6h", q.unansweredIn6h);

hdr("DISTINCTIVE VOCABULARY  (log-odds z)");
const dist = analysis.language.distinctive;
console.log(`most characteristic of ${A}:`);
for (const w of dist.filter((d) => d.z > 0).slice(0, 15)) {
  console.log(`  ${num(w.z, 7, 2)}  ${pad(w.word, 14)} ${A}: ${String(w.countA).padStart(5)}   ${B}: ${String(w.countB).padStart(5)}`);
}
console.log(`\nmost characteristic of ${B}:`);
for (const w of dist.filter((d) => d.z < 0).slice(-15).reverse()) {
  console.log(`  ${num(w.z, 7, 2)}  ${pad(w.word, 14)} ${A}: ${String(w.countA).padStart(5)}   ${B}: ${String(w.countB).padStart(5)}`);
}

hdr("IDIOLECT");
console.log(`${pad("token", 16)} ${A.slice(0, 12).padStart(12)} ${B.slice(0, 12).padStart(12)}    per 1k msgs`);
for (const m of analysis.language.idiolect.slice(0, 22)) {
  console.log(
    `${pad(m.token, 16)} ${String(m.counts.a).padStart(12)} ${String(m.counts.b).padStart(12)}    ` +
      `${m.per1k.a.toFixed(1).padStart(6)} / ${m.per1k.b.toFixed(1)}`,
  );
}

hdr("EMOJI AND STICKERS");
const em = analysis.language.emoji;
console.log(`${pad(A, 20)} ${String(em.total.a).padStart(5)} emoji | ${em.top.a.map((e) => `${e.emoji} ${e.counts.a}`).join("  ")}`);
console.log(`${pad(B, 20)} ${String(em.total.b).padStart(5)} emoji | ${em.top.b.map((e) => `${e.emoji} ${e.counts.b}`).join("  ")}`);
console.log(`\nused 5+ times by ${A} only: ${em.exclusive.a.slice(0, 15).join(" ")}`);
console.log(`used 5+ times by ${B} only: ${em.exclusive.b.slice(0, 15).join(" ")}`);
const st = analysis.language.stickers;
console.log(`\n${pad(A, 20)} ${String(st.total.a).padStart(5)} stickers | ${st.top.a.map((e) => `${e.emoji} ${e.counts.a}`).join("  ")}`);
console.log(`${pad(B, 20)} ${String(st.total.b).padStart(5)} stickers | ${st.top.b.map((e) => `${e.emoji} ${e.counts.b}`).join("  ")}`);

hdr("MISC ASYMMETRIES");
const nm = analysis.language.addressesByName;
twoCol("addresses other by name", nm);
console.log(`  (${A} aliases matched against ${B}'s messages and vice versa; a 0 may mean "uses a nickname")`);
console.log();
const lp = analysis.language.messageLengthPercentiles;
for (const [side, p] of [[0, lp.a], [1, lp.b]] as const) {
  console.log(
    `${pad(nameOf(side as Side), 20)} chars: p25=${num(p.p25, 3)} p50=${num(p.p50, 3)} ` +
      `p75=${num(p.p75, 3)} p90=${num(p.p90, 4)} p99=${num(p.p99, 5)} max=${p.max}`,
  );
}
console.log();
