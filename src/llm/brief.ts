/**
 * The deterministic findings, written for the model rather than for a terminal.
 *
 * This is the other half of the hybrid: the numbers here are already true, so the
 * model is never asked to count anything. Its job is to say what they mean and to
 * find the quote that shows it. Metrics that came out flat on this corpus are
 * still listed, marked dead, because "nobody is ever waiting on a reply" is
 * itself worth knowing and stops the model inventing a pattern in the noise.
 */
import type { MetricKey } from "../domain/metrics";
import { QUIET_ERA_SHARE } from "../domain/sessions";
import { CARD_FLOORS, isAsymmetric } from "../domain/stats";
import type { Analysis, Pair, Side } from "../domain/types";
import type { Corpus } from "./corpus";
import { buildLanguageCandidates } from "./language-candidates";
import { buildWildCandidates } from "./wild-candidates";

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/**
 * Every finding is tagged with its metric key so the model can echo it back and
 * the UI can put the reading next to the number. `MetricKey` rather than `string`
 * so a typo here is a compile error rather than a card that quietly lands nowhere.
 */
const finding = (key: MetricKey, label: string, body: string) =>
  `- \`${key}\` **${label}** ${body}`;

function day(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Seconds at a human scale — a p90 of 40 seconds should not print as "0.0h". */
function dur(sec: number): string {
  if (sec < 90) return `${sec.toFixed(0)}s`;
  if (sec < 5400) return `${(sec / 60).toFixed(0)} min`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)} days`;
}

export function buildBrief(analysis: Analysis, corpus: Corpus): string {
  const [A, B] = corpus.labels;
  const name = (s: Side) => (s === 0 ? A : B);
  const L: string[] = [];
  const two = (label: string, p: Pair<string | number>) => L.push(`- ${label}: ${A} ${p.a}, ${B} ${p.b}`);

  const v = analysis.volume;
  L.push(`## The chat`);
  L.push(
    `${v.total} messages between ${A} and ${B}, ${day(analysis.span.firstTs)} to ${day(analysis.span.lastTs)} ` +
      `(${analysis.span.days.toFixed(0)} days, but only ${analysis.span.activeDays} of them had any messages — ` +
      `${pct(1 - analysis.span.activeShare)} of the calendar is silence).`,
  );
  L.push(
    finding(
      "scale",
      "Volume and length.",
      `Messages: ${A} ${v.messages.a} (${pct(v.messages.a / v.total)}), ${B} ${v.messages.b} ` +
        `(${pct(v.messages.b / v.total)}). Characters per message: ${A} ${v.charsPerMessage.a.toFixed(0)}, ` +
        `${B} ${v.charsPerMessage.b.toFixed(0)}.`,
    ),
  );
  const top10 = analysis.concentration.topSessionShare.find((t) => t.n === 10);
  L.push(
    finding(
      "concentration",
      "Bursts.",
      `${analysis.sessionSummary.count} bursts of conversation (a burst ends after 45 min of quiet); ` +
        `median ${analysis.sessionSummary.medianMessages.toFixed(0)} messages long` +
        (top10
          ? `. The busiest ${top10.n} bursts hold ${pct(top10.share)} of everything ever said.`
          : `.`),
    ),
  );

  // ------------------------------------------------------------------ timeline
  L.push(``, `## Timeline`);
  L.push(
    `Chapters, in order. Cite by the #seq range. A "lull" holds under ${pct(QUIET_ERA_SHARE)} of the corpus — ` +
      `real messages, but do not name it as an era.`,
  );
  analysis.chapters.forEach((c, i) => {
    const from = corpus.seqAt(c.startTs);
    const to = corpus.seqAt(c.endTs);
    if (c.kind === "era") {
      L.push(
        `${i + 1}. ${c.quiet ? "LULL" : "ERA"} ${day(c.startTs)} → ${day(c.endTs)} | ${c.months}mo | ` +
          `${c.messageCount} msgs (${pct(c.share)} of all) | ${c.messagesPerMonth.toFixed(0)}/mo | #${from}–#${to}`,
      );
      if (c.change) {
        const why = Object.entries(c.change.contributors)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, score]) => `${name} ${(score * 100).toFixed(0)}%`)
          .join(", ");
        const deltas = c.change.strongest
          .slice(0, 3)
          .map((item) => `${item.metric}: ${item.before.toFixed(2)} → ${item.after.toFixed(2)}`)
          .join("; ");
        L.push(`   Boundary evidence: ${why}. Largest weekly changes: ${deltas}.`);
      }
    } else {
      L.push(
        `${i + 1}. SILENCE ${day(c.startTs)} → ${day(c.endTs)} | ${c.days.toFixed(0)} days dark | ` +
          `${name(c.wentQuiet)} sent the last message, ${name(c.revivedBy)} sent the first one after` +
          (c.blipMessages ? ` | ${c.blipMessages} messages in ${c.blipCount} false start(s) inside it` : "") +
          ` | #${from}–#${to}`,
      );
    }
  });

  // -------------------------------------------------------------- asymmetries
  const { live, flat } = clockMetrics(analysis, A, B);

  L.push(``, `## Asymmetries that survived`);
  L.push(
    `Each of these is a real difference between the two of them. Numbers are already correct. ` +
      `The word in backticks starting each line is that finding's metric key — copy it verbatim into ` +
      `the \`metric\` field of any card you build on it, so the card can be shown next to its numbers.`,
  );

  const mono = analysis.rhythm.monologues;
  L.push(
    finding(
      "turn-taking",
      "Turn-taking.",
      `Average unbroken run of messages before the other replies: ` +
        `${A} ${mono.a.meanRunLength.toFixed(2)}, ${B} ${mono.b.meanRunLength.toFixed(2)}. ` +
        `Share of their own messages sent inside a run of 3+: ${A} ${pct(mono.a.shareOfMessagesInRuns)}, ` +
        `${B} ${pct(mono.b.shareOfMessagesInRuns)}. Longest run: ${A} ${mono.a.maxRunLength}, ${B} ${mono.b.maxRunLength}.`,
    ),
  );

  const bh = analysis.behaviour;
  if (isAsymmetric(bh.reactionsGiven) || isAsymmetric(bh.reactionsReceived)) {
    L.push(
      finding(
        "reactions",
        "Reactions.",
        `Given: ${A} ${bh.reactionsGiven.a}, ${B} ${bh.reactionsGiven.b}. ` +
          `Received: ${A} ${bh.reactionsReceived.a}, ${B} ${bh.reactionsReceived.b}.`,
      ),
    );
  }
  const em = analysis.language.emoji;
  const st = analysis.language.stickers;
  L.push(
    finding(
      "register",
      "Emoji vs stickers.",
      `${A}: ${em.total.a} emoji, ${st.total.a} stickers. ` +
        `${B}: ${em.total.b} emoji, ${st.total.b} stickers. ` +
        `${A}'s top: ${em.top.a.slice(0, 6).map((e) => `${e.emoji}${e.counts.a}`).join(" ")}. ` +
        `${B}'s top: ${em.top.b.slice(0, 6).map((e) => `${e.emoji}${e.counts.b}`).join(" ")}.`,
    ),
  );
  if (isAsymmetric({ a: bh.videoNotes.a.count, b: bh.videoNotes.b.count })) {
    L.push(finding("video-notes", "Telebubbles.", `${A} ${bh.videoNotes.a.count}, ${B} ${bh.videoNotes.b.count}.`));
  }
  if (isAsymmetric({ a: bh.voiceNotes.a.count, b: bh.voiceNotes.b.count })) {
    L.push(finding("voice-notes", "Voice notes.", `${A} ${bh.voiceNotes.a.count}, ${B} ${bh.voiceNotes.b.count}.`));
  }

  const rev = analysis.rhythm.revival;
  L.push(
    finding(
      "revival",
      "Who comes back.",
      `Silences and who ended them, at four thresholds ` +
        `(a pattern that holds at all four is worth more than one that only appears at a convenient cutoff):`,
    ),
  );
  for (const r of rev) {
    if (r.n === 0) continue;
    L.push(
      `    ${r.thresholdDays}+ days: ${r.n} silences | ended by ${A} ${r.revivedBy.a}, ${B} ${r.revivedBy.b} ` +
        `| last word before it went quiet was ${A}'s ${r.wentQuiet.a}, ${B}'s ${r.wentQuiet.b}`,
    );
  }

  if (live.length) L.push(...live);

  // -------------------------------------------------------------- language
  L.push(``, `## Full-corpus language candidate dossier`);
  L.push(
    `These candidates were mined from every text message, including 1–3 word phrases, then ranked by speaker ` +
      `distinctiveness, frequency, session spread and month spread. Select only candidate ids shown here. ` +
      `Counts are ${A}/${B}. Examples are real #seq lines and may be cited. Metric key: \`vocabulary\`.`,
  );
  const languageCandidates = buildLanguageCandidates(corpus);
  for (const side of ["a", "b", "shared"] as const) {
    L.push(`### ${side === "a" ? A : side === "b" ? B : "Shared language"}`);
    for (const candidate of languageCandidates.filter((item) => item.side === side)) {
      const first = (ts: number | null) => ts === null ? "never" : day(ts);
      L.push(`- \`${candidate.id}\` **${candidate.text}** | ${candidate.counts.a}/${candidate.counts.b} uses | ${candidate.sessions} sessions | ${candidate.months} months | first ${A} ${first(candidate.firstUsed.a)}, ${B} ${first(candidate.firstUsed.b)}`);
      for (const example of candidate.examples.slice(0, 2)) L.push(`    #${example.seq}: "${example.quote}"`);
    }
  }

  // ---------------------------------------------------------- wild sentences
  L.push(``, `## Wild-sentence candidate dossier`);
  L.push(
    `Candidates were retrieved from the complete chat using lexical surprise, specificity, punctuation and immediate reactions, ` +
      `then spread across speakers and months. Select only ids below. The candidate line—not a context line—must be the evidence. ` +
      `Reject serious disclosures, sensitive material, generic profanity and lines that are only strange because context is missing.`,
  );
  for (const candidate of buildWildCandidates(corpus)) {
    L.push(`- \`${candidate.id}\` ${candidate.who === 0 ? A : B} #${candidate.seq}: ${JSON.stringify(candidate.text)}`);
    const around = candidate.context.filter((line) => line.seq !== candidate.seq).map((line) => `#${line.seq} ${line.who === 0 ? A : B}: ${JSON.stringify(line.body.slice(0, 180))}`).join(" | ");
    if (around) L.push(`    context: ${around}`);
  }

  if (flat.length) {
    L.push(``, `## Measured, came out flat — do not build a card on these`);
    L.push(
      `Listed so you know they were checked. Saying nothing about them is correct; ` +
        `finding a pattern in them is not.`,
    );
    for (const f of flat) L.push(`- ${f}`);
  }

  return L.join("\n");
}

/**
 * The four metrics whose usefulness depends entirely on the chat, sorted into
 * ones worth a card and ones that came out flat.
 *
 * Which way they fall is not knowable in advance: on a bursty corpus reply speed
 * is noise, on a steady one it is the best card available. Deciding here, from the
 * numbers, is the point — the alternative is a prompt that asserts one of the two
 * and is wrong for half of all chats.
 */
function clockMetrics(analysis: Analysis, A: string, B: string): { live: string[]; flat: string[] } {
  const live: string[] = [];
  const flat: string[] = [];

  const lat = analysis.rhythm.latency;
  const latText =
    `Reply speed. Median ${A} ${dur(lat.a.medianSec)}, ${B} ${dur(lat.b.medianSec)} ` +
    `(${analysis.rhythm.latencyAsymmetry.toFixed(2)}x); 90th percentile ${A} ${dur(lat.a.p90Sec)}, ` +
    `${B} ${dur(lat.b.p90Sec)}.`;
  if (Math.abs(analysis.rhythm.latencyAsymmetry - 1) < CARD_FLOORS.latencyBand) {
    flat.push(
      `${latText} The two medians are the same number. This conversation happens in bursts — when they are ` +
        `talking, neither is waiting — so there is no "left on read" story to tell here.`,
    );
  } else {
    live.push(finding("reply-speed", latText, `One of them waits longer than the other, consistently.`));
  }

  const q = analysis.language.questions;
  const qText =
    `Questions. ${A} asks in ${pct(q.rate.a, 1)} of their messages, ${B} in ${pct(q.rate.b, 1)}; ` +
    `still unanswered 6h later: ${A} ${q.unansweredIn6h.a}, ${B} ${q.unansweredIn6h.b}.`;
  if (isAsymmetric(q.rate, CARD_FLOORS.questionRatio)) {
    live.push(finding("questions", qText, `One of them does the asking.`));
  } else flat.push(`${qText} Neither is interviewing the other.`);

  const late = analysis.rhythm.lateNightShare;
  const lateText = `Late night (midnight–5am): ${A} ${pct(late.a, 1)} of their messages, ${B} ${pct(late.b, 1)}.`;
  if (isAsymmetric(late, CARD_FLOORS.lateNightRatio) && Math.max(late.a, late.b) > CARD_FLOORS.lateNightFloor) {
    live.push(finding("late-night", lateText, ``));
  } else flat.push(`${lateText} Neither of them is the one who's up.`);

  // Opens and closes are shares of the same fixed total, so with a few hundred
  // sessions a 59/41 split is statistically real and still not interesting. 1.5
  // is a floor on being worth saying, not on significance.
  const opens = analysis.sessionSummary.opens;
  const closes = analysis.sessionSummary.closes;
  const n = Math.max(1, analysis.sessionSummary.count);
  const openText =
    `Who starts and ends a burst: opens ${A} ${pct(opens.a / n)} / ${B} ${pct(opens.b / n)}, ` +
    `closes ${A} ${pct(closes.a / n)} / ${B} ${pct(closes.b / n)}.`;
  if (isAsymmetric(opens, CARD_FLOORS.openCloseRatio) || isAsymmetric(closes, CARD_FLOORS.openCloseRatio)) {
    live.push(finding("opens-closes", openText, ``));
  } else flat.push(`${openText} Close enough to even that the split is noise.`);

  return { live, flat };
}
