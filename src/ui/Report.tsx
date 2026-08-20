"use client";

/**
 * The report, as a deck: one thing per screen, snapped.
 *
 * Everything a dashboard puts side by side, this puts one at a time. The reason to
 * prefer it is that a number about two people takes a moment to land, and a screen
 * with eleven other numbers on it doesn't give you that moment. The cost is real
 * and worth naming: comparing card four with card nine now means scrolling. The
 * compensation is that every card carries both people's version of its own
 * measurement, so the comparison that matters is never off-screen — it's inside the
 * card.
 *
 * Four things here are load-bearing and easy to undo by accident:
 *
 *   1. Side 0 is warm, side 1 is cool. In an export side 0 is the other person and
 *      side 1 is you. Bar fills read the `--color-side-*` tokens through `var()`
 *      rather than repeating the hex, so there is one place to change.
 *   2. Eras use a palette that deliberately excludes both person colours. An era
 *      bar in the warm red would read as "this era was theirs", which is not what
 *      it means.
 *   3. A quote is shown as the whole message with the cited fragment marked inside
 *      it, never clipped to the fragment. A quote clipped to the words that support
 *      the claim is how a true sentence gets used to say something false.
 *   4. A slide centres its content with `m-auto`, not `justify-center`. Centring a
 *      flex child that is taller than the viewport with `justify-center` pushes its
 *      top out of the scroll container and makes it unreachable; `margin: auto`
 *      degrades to top-aligned instead. Some slides do overflow — a card with two
 *      readings and four quotes on a laptop — and losing the top of one is worse
 *      than losing the centring.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Analysis, Chapter, Pair } from "@/domain/types";
import {
  assignEvidence,
  type DeckCard,
  type EvidenceSlot,
  type Split,
  displayNames,
  dur,
  interleaveFindings,
  monthYear,
} from "./cards";
import { Callout, Kicker, Logo, Panel, Shield, Stat, StatStrip } from "./primitives";
import type { Cited, WireChapterNote, WireDynamic, WireFinding, WireLanguageInsight, WireMotif, WirePayload, WireRole, WireTopic, WireWildSentence } from "./wire";
import { TELESCOPE_STICKER_VISUALS_EVENT, type LocalStickerVisual, type LocalStickerVisuals } from "./sticker-assets";

export interface LocalStreakMessage {
  id: number;
  ts: number;
  who: 0 | 1;
  body: string;
}

export interface LocalExtremeEvidence {
  longestMessage?: LocalStreakMessage;
  longestRun?: LocalStreakMessage[];
}

export type AiProgressState =
  | { kind: "working"; stage: number; total: number; label: string }
  | { kind: "done" }
  | { kind: "error" };

export const TELESCOPE_AI_PROGRESS_EVENT = "telescope:ai-progress";

// ----------------------------------------------------------------- formatting

const num = (n: number) => Math.round(n).toLocaleString();
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/** 0 → "12 am", 14 → "2 pm". The histogram is in local hours. */
function hourLabel(h: number): string {
  if (h === 0) return "12 am";
  if (h < 12) return `${h} am`;
  if (h === 12) return "12 pm";
  return `${h - 12} pm`;
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

const sideVar = (side: 0 | 1) => (side === 0 ? "var(--color-side-a)" : "var(--color-side-b)");

/**
 * Era fills. Neither person colour appears here on purpose — see the note at the
 * top of the file. Silences and quiet stretches are always the grey.
 */
const ERA_FILLS = [
  "var(--color-accent)",
  "var(--color-safe)",
  "var(--color-warn)",
  "var(--color-accent-lit)",
  "var(--color-safe-deep)",
];
const QUIET_FILL = "rgba(23,33,43,0.22)";

// ---------------------------------------------------------------- slide chrome

type Tone = "light" | "shade" | "night";

/**
 * One screen.
 *
 * `min-h-dvh` rather than `h-dvh`: a slide is allowed to be taller than the
 * viewport when its card genuinely has more in it. Scroll snapping handles that
 * correctly — a snap area larger than the snapport is scrolled through freely
 * instead of being forced — so the long ones read like a normal page and the
 * short ones, which is nearly all of them, snap.
 */
function Slide({
  id,
  tone,
  step,
  total,
  label,
  children,
}: {
  id: string;
  tone: Tone;
  step: number;
  total: number;
  /** what this screen is, for the footer marker and the rail's tooltip */
  label: string;
  children: ReactNode;
}) {
  const night = tone === "night";
  const cover = id === "cover";
  const bg = night
    ? "report-night-slide starfield bg-night"
    : tone === "shade"
      ? "bg-shade"
      : "bg-surface";
  return (
    <section
      id={id}
      className={`relative flex min-h-dvh w-full snap-start snap-always flex-col ${cover ? "p-3 sm:p-5" : "px-5 pb-20 pt-16 sm:px-10 xl:px-20"} ${bg}`}
    >
      <div className={`relative m-auto w-full ${cover ? "h-full" : "max-w-[1180px]"}`}>{children}</div>
      {!cover && <p
        className={`absolute bottom-7 left-5 font-mono text-[10.5px] uppercase tracking-[0.16em] sm:left-10 xl:left-20 ${
          night ? "text-white/35" : "text-ink/35"
        }`}
      >
        {String(step).padStart(2, "0")} <span className={night ? "text-white/20" : "text-ink/20"}>/</span>{" "}
        {String(total).padStart(2, "0")} · {label}
      </p>}
    </section>
  );
}

/** The heading of a slide. Bigger than a card title, because it has a screen. */
function SlideTitle({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "night" }) {
  return (
    <h2
      className={`font-display text-[clamp(2.7rem,6vw,6.4rem)] leading-[0.88] tracking-[-0.035em] ${
        tone === "ink" ? "text-ink" : "text-white"
      }`}
    >
      {children}
    </h2>
  );
}

/** The line of prose under a slide heading. */
function Lede({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "night" }) {
  return (
    <p
      className={`mt-3.5 max-w-[70ch] text-[15px] leading-relaxed sm:text-[16.5px] ${
        tone === "ink" ? "text-ink/65" : "text-white/60"
      }`}
    >
      {children}
    </p>
  );
}

/** Kicker + heading + lede, the top of nearly every slide. */
function SlideHead({
  kicker,
  title,
  lede,
  tone = "ink",
  aside,
}: {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  tone?: "ink" | "night";
  /** the legend, usually — sits on the right on wide screens */
  aside?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <p className={`mb-4 font-mono text-[clamp(.95rem,1.5vw,1.3rem)] font-semibold uppercase tracking-[0.16em] ${tone === "ink" ? "text-accent" : "text-accent-lit"}`}>{kicker}</p>
        <SlideTitle tone={tone}>{title}</SlideTitle>
        {lede && <Lede tone={tone}>{lede}</Lede>}
      </div>
      {aside}
    </div>
  );
}

// ------------------------------------------------------------------ fragments

/** The two-tone key that has to sit next to anything split by person. */
function Legend({ names, tone = "ink" }: { names: [string, string]; tone?: "ink" | "night" }) {
  return (
    <div className={`flex gap-4 text-[13px] ${tone === "ink" ? "text-ink/55" : "text-white/55"}`}>
      {([0, 1] as const).map((side) => (
        <span key={side} className="flex items-center gap-1.5">
          <span className="block h-2.5 w-2.5 rounded-sm" style={{ background: sideVar(side) }} />
          {names[side]}
        </span>
      ))}
    </div>
  );
}

/** One measurement taken twice, as a proportional two-colour bar. */
function SplitRow({ split }: { split: Split }) {
  const [wa, wb] = split.weights;
  const total = wa + wb;
  // Equal values render half-and-half rather than as an empty bar.
  const frac = total === 0 ? 0.5 : wa / total;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink/70">{split.label}</span>
        <span className="font-mono tnum">
          <span className="text-side-a">{split.a}</span>
          <span className="text-ink/30"> / </span>
          <span className="text-side-b">{split.b}</span>
        </span>
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-ink/10">
        <span style={{ width: `${frac * 100}%`, background: sideVar(0) }} />
        <span className="flex-1" style={{ background: sideVar(1) }} />
      </div>
    </div>
  );
}

/**
 * A cited message, shown whole, with the quoted fragment marked.
 *
 * The fallback matters: if the fragment can't be found in the body the bare
 * fragment is shown rather than nothing, and `scripts/render.tsx` counts how
 * often that happens so a silent drift between the two is visible.
 */
function Quote({
  cited,
  names,
  tone = "ink",
}: {
  cited: Cited;
  names: [string, string];
  tone?: "ink" | "night";
}) {
  const at = cited.body.toLowerCase().indexOf(cited.quote.toLowerCase());
  const body: ReactNode =
    at < 0 ? (
      cited.quote
    ) : (
      <>
        {cited.body.slice(0, at)}
        <mark
          className={
            tone === "ink" ? "rounded bg-accent-lit/30 px-0.5 text-ink" : "rounded bg-accent-lit/35 px-0.5 text-white"
          }
        >
          {cited.body.slice(at, at + cited.quote.length)}
        </mark>
        {cited.body.slice(at + cited.quote.length)}
      </>
    );
  return (
    <figure className="border-l-2 pl-3.5" style={{ borderColor: sideVar(cited.who) }}>
      <blockquote
        className={`text-sm leading-relaxed ${tone === "ink" ? "text-ink/80" : "text-white/80"}`}
      >
        {body}
      </blockquote>
      <figcaption
        className={`mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] ${
          tone === "ink" ? "text-ink/45" : "text-white/45"
        }`}
      >
        {names[cited.who]} ·{" "}
        {new Date(cited.ts * 1000).toLocaleDateString("en", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
        {cited.messageId === null ? "" : ` · #${cited.messageId}`}
      </figcaption>
    </figure>
  );
}

/** A model reading, filed under the number it is about. */
function Reading({
  headline,
  body,
  quotes,
  names,
  tone = "ink",
}: {
  headline: string | null;
  body: string;
  quotes: Cited[];
  names: [string, string];
  /** must be set to "night" on a dark slide — the tint alone is not enough contrast */
  tone?: "ink" | "night";
}) {
  const night = tone === "night";
  return (
    <div className={`border-l-2 border-accent-lit p-4 ${night ? "bg-white/8" : "bg-accent-lit/12"}`}>
      {headline && (
        <p className={`font-display text-xl leading-tight ${night ? "text-white" : "text-ink"}`}>
          {headline}
        </p>
      )}
      <p
        className={`text-sm leading-relaxed ${night ? "text-white/70" : "text-ink/75"} ${headline ? "mt-2" : ""}`}
      >
        {body}
      </p>
      {quotes.length > 0 && (
        <div className="mt-4 flex flex-col gap-3.5">
          {quotes.map((q, i) => (
            <Quote key={`${q.messageId ?? q.ts}-${i}`} cited={q} names={names} tone={tone} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The readings under a card, in the two-column arrangement a wide screen wants.
 *
 * Two or more sit side by side rather than stacking, because stacking them is what
 * pushes a slide past the viewport. A single one is held to ~90 characters instead
 * of running the full 1180: a slide is wide, and a paragraph that uses all of it is
 * 150 characters to a line, which is the width at which the eye loses its place
 * coming back from the right edge.
 */
function Readings({ children, count }: { children: ReactNode; count: number }) {
  if (count === 0) return null;
  return (
    <div className={count > 1 ? "mt-8 grid gap-4 lg:grid-cols-2" : "mt-8 max-w-[660px]"}>{children}</div>
  );
}

// --------------------------------------------------------------------- charts

function StackedBarTooltip({
  label,
  names,
  counts,
  align = "center",
  tone = "light",
}: {
  label: string;
  names: [string, string];
  counts: Pair<number>;
  align?: "left" | "center" | "right";
  tone?: "light" | "night";
}) {
  const position =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  const night = tone === "night";

  return (
    <span
      className={`pointer-events-none absolute bottom-full z-30 mb-3 hidden w-max min-w-[170px] rounded-md border px-3 py-2.5 text-left shadow-2xl group-hover:block group-focus-visible:block ${position} ${night ? "border-white/15 bg-[#0b1620] text-white" : "border-ink/15 bg-surface text-ink"}`}
      role="tooltip"
    >
      <span className="mb-2 block font-mono text-[9px] uppercase tracking-[.14em] opacity-55">{label}</span>
      <span className="flex items-center justify-between gap-6 text-xs">
        <span className="max-w-[120px] truncate text-side-a">{names[0]}</span>
        <b className="font-mono tnum">{num(counts.a)}</b>
      </span>
      <span className="mt-1 flex items-center justify-between gap-6 text-xs">
        <span className="max-w-[120px] truncate text-side-b">{names[1]}</span>
        <b className="font-mono tnum">{num(counts.b)}</b>
      </span>
      <span className={`mt-2 flex items-center justify-between gap-6 border-t pt-2 text-xs ${night ? "border-white/12" : "border-ink/12"}`}>
        <span className="opacity-55">Total</span>
        <b className="font-mono tnum">{num(counts.a + counts.b)}</b>
      </span>
    </span>
  );
}

/**
 * Messages per calendar month, stacked, one column per month including the empty
 * ones. The empty columns are the point: they are what a quiet year looks like.
 */
function MonthlyChart({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const months = analysis.volume.monthly;
  const peak = Math.max(1, ...months.map((m) => m.counts.a + m.counts.b));
  const gap = analysis.rhythm.longestSilences[0];

  return (
    <>
      <SlideHead
        kicker="Volume over time"
        title="Messages per month"
        lede={`Busiest month held ${num(peak)} messages. The tallest column and the empty ones are drawn to the same scale, so a gap year takes up as much width here as it did in life.`}
        aside={<Legend names={names} />}
      />

      <div className="flex h-[clamp(150px,34vh,360px)] items-end gap-[3px]">
        {months.map((m, i) => (
          <span
            key={m.month}
            className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end gap-px outline-none focus-visible:z-20 focus-visible:ring-1 focus-visible:ring-accent"
            tabIndex={0}
            aria-label={`${monthYear(m.ts)}: ${names[0]} ${num(m.counts.a)} messages, ${names[1]} ${num(m.counts.b)} messages, ${num(m.counts.a + m.counts.b)} total`}
          >
            <StackedBarTooltip
              label={monthYear(m.ts)}
              names={names}
              counts={m.counts}
              align={i < 3 ? "left" : i > months.length - 4 ? "right" : "center"}
            />
            <span
              className="block rounded-t-sm transition-[filter,transform] duration-150 group-hover:brightness-125 group-focus-visible:brightness-125"
              style={{ height: `${(m.counts.b / peak) * 100}%`, background: sideVar(1) }}
            />
            <span
              className="block transition-[filter,transform] duration-150 group-hover:brightness-125 group-focus-visible:brightness-125"
              style={{ height: `${(m.counts.a / peak) * 100}%`, background: sideVar(0) }}
            />
          </span>
        ))}
      </div>
      {/*
       * One cell per month, same flex-1 and same gap as the bars, so a year label
       * sits over the column it belongs to. Spacing the labels evenly with
       * `justify-between` looked right until the first year was partial — then
       * every label was shifted off its own data by up to eleven months, which is
       * a mislabelled axis rather than an untidy one. Labels are out of flow so a
       * four-character year can't widen a one-month column.
       */}
      <div className="mt-3 flex gap-[3px] border-t border-ink/12 pt-3 font-mono text-[10.5px] text-ink/45">
        {months.map((m, i) => (
          <span key={m.month} className="relative block h-4 min-w-0 flex-1">
            {(i === 0 || m.month.endsWith("-01")) && (
              // The last few columns anchor on their right edge instead, or the
              // label runs out past the slide's padding.
              <span className={`absolute top-0 ${i > months.length - 6 ? "right-0" : "left-0"}`}>
                {m.month.slice(0, 4)}
              </span>
            )}
          </span>
        ))}
      </div>

      {gap && (
        <div className="mt-8 max-w-[80ch]">
          <Callout>
            <b>{monthYear(gap.fromTs)}:</b> {num(gap.days)} days of nothing — the longest silence in
            the whole span.
          </Callout>
        </div>
      )}
    </>
  );
}

/** Reply latency, four cuts of it, both people on every row. */
function LatencyChart({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const { latency, latencyAsymmetry } = analysis.rhythm;
  const rows = [
    { label: "Median", a: latency.a.medianSec, b: latency.b.medianSec },
    { label: "In session", a: latency.a.inSessionMedianSec, b: latency.b.inSessionMedianSec },
    { label: "75th pct", a: latency.a.p75Sec, b: latency.b.p75Sec },
    { label: "90th pct", a: latency.a.p90Sec, b: latency.b.p90Sec },
  ];
  const peak = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));

  return (
    <>
      <SlideHead
        kicker="Rhythm"
        title="How long the other one waits"
        lede={
          <>
            Measured on {num(latency.a.n + latency.b.n)} replies.{" "}
            {Number.isFinite(latencyAsymmetry) && latencyAsymmetry > 0 ? (
              <>
                The two medians are{" "}
                {(latencyAsymmetry >= 1 ? latencyAsymmetry : 1 / latencyAsymmetry).toFixed(2)}× apart
                — under 1.25× and there is no difference worth a sentence.
              </>
            ) : (
              <>One of the two medians is zero, so there is no ratio to report.</>
            )}
          </>
        }
        aside={<Legend names={names} />}
      />

      <div className="flex flex-col gap-6">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-4">
            <span className="w-[88px] shrink-0 text-sm leading-tight text-ink/60">{r.label}</span>
            <span className="flex flex-1 flex-col gap-1">
              {([0, 1] as const).map((side) => {
                const v = side === 0 ? r.a : r.b;
                return (
                  <span key={side} className="block h-3.5 overflow-hidden rounded-sm bg-ink/8">
                    <span
                      className="block h-3.5 rounded-sm"
                      style={{
                        // One shared linear scale across all four rows — that's the
                        // honest comparison. But a median of 3s against a 90th
                        // percentile of two days is 0.002% of the track, which
                        // rounds to nothing and reads as "no data". A visible stub
                        // for any non-zero value; the exact figure is printed on the
                        // right, so the stub can't be mistaken for a measurement.
                        width: `${v > 0 ? Math.max(1.5, (v / peak) * 100) : 0}%`,
                        background: sideVar(side),
                      }}
                    />
                  </span>
                );
              })}
            </span>
            <span className="w-[92px] shrink-0 text-right font-mono text-[12px] leading-tight tnum">
              <span className="block text-side-a">{dur(r.a)}</span>
              <span className="block text-side-b">{dur(r.b)}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** The 24-hour clock, stacked by person. The one chart that is about sleep. */
function HoursChart({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const h = analysis.rhythm.hourHistogram;
  const totals = h.a.map((n, i) => n + (h.b[i] ?? 0));
  const peak = Math.max(1, ...totals);
  const peakHour = totals.indexOf(Math.max(...totals));
  const late = analysis.rhythm.lateNightShare;

  return (
    <>
      <SlideHead
        kicker="The clock"
        title="When you talk"
        tone="night"
        lede={
          <>
            Busiest hour is {hourLabel(peakHour)}. Between midnight and 5am sits {pct(late.a, 1)} of{" "}
            {names[0]}&rsquo;s messages and {pct(late.b, 1)} of {names[1]}&rsquo;s.
          </>
        }
        aside={<Legend names={names} tone="night" />}
      />

      <div className="flex h-[clamp(140px,32vh,340px)] items-end gap-[3px]">
        {totals.map((_, hour) => (
          <span
            key={hour}
            className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end gap-px outline-none focus-visible:z-20 focus-visible:ring-1 focus-visible:ring-accent"
            tabIndex={0}
            aria-label={`${hourLabel(hour)}: ${names[0]} ${num(h.a[hour] ?? 0)} messages, ${names[1]} ${num(h.b[hour] ?? 0)} messages, ${num(totals[hour])} total`}
          >
            <StackedBarTooltip
              label={hourLabel(hour)}
              names={names}
              counts={{ a: h.a[hour] ?? 0, b: h.b[hour] ?? 0 }}
              align={hour < 3 ? "left" : hour > 20 ? "right" : "center"}
              tone="night"
            />
            <span
              className="block rounded-t-sm transition-[filter] duration-150 group-hover:brightness-125 group-focus-visible:brightness-125"
              style={{ height: `${((h.b[hour] ?? 0) / peak) * 100}%`, background: sideVar(1) }}
            />
            <span
              className="block transition-[filter] duration-150 group-hover:brightness-125 group-focus-visible:brightness-125"
              style={{ height: `${((h.a[hour] ?? 0) / peak) * 100}%`, background: sideVar(0) }}
            />
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-[3px] border-t border-white/14 pt-3 font-mono text-[10.5px] text-white/40">
        {totals.map((_, hour) => (
          <span key={hour} className="relative block h-4 min-w-0 flex-1">
            {hour % 3 === 0 && (
              <span className="absolute left-0 top-0">{String(hour).padStart(2, "0")}</span>
            )}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * The timeline. Eras get a proportional bar in the era palette; silences get a
 * full-width grey row instead, because days and messages-per-month are different
 * units and one axis can't honestly carry both.
 */
function ErasChart({
  card,
  analysis,
  names,
  notes,
}: {
  card: DeckCard & { kind: "timeline" };
  analysis: Analysis;
  names: [string, string];
  notes: WireChapterNote[];
}) {
  const peak = Math.max(1, ...card.chapters.map((c) => (c.kind === "era" ? c.messagesPerMonth : 0)));
  const byIndex = new Map(notes.map((n) => [n.chapterIndex, n]));

  // Fills resolved up front rather than counted during the render pass, so the
  // colour an era gets can't depend on how many times React chose to render.
  const fills = new Map<number, string>();
  let seen = 0;
  card.chapters.forEach((c, i) => {
    if (c.kind === "era" && !c.quiet) fills.set(i, ERA_FILLS[seen++ % ERA_FILLS.length]);
  });

  return (
    <>
      {/*
       * The encoding note is part of the lede rather than a line under the chart:
       * thirteen chapters is the one screen in the deck that genuinely fills a
       * laptop viewport, and a caption below the last bar was the thing that fell
       * off the bottom. It also belongs above the chart — it says how to read it.
       */}
      <SlideHead
        kicker={card.kicker}
        title={card.headline}
        lede={
          <>
            {card.detail} Bar width is messages per month, so it reads as how loud an era was rather
            than how long. The grey rows are silences — {num(analysis.rhythm.dormantDays)} days,{" "}
            {pct(analysis.rhythm.dormantShare)} of the calendar, spent saying nothing.
          </>
        }
      />

      <div className="flex flex-col gap-2">
        {card.chapters.map((c, i) => {
          const note = byIndex.get(i + 1);
          const range = `${monthYear(c.startTs)} – ${monthYear(c.endTs)}`;
          if (c.kind === "silence") {
            return (
              <div key={c.startTs} className="flex items-center gap-3.5">
                <span className="w-[104px] shrink-0 font-mono text-[10.5px] leading-tight text-ink/45">
                  {range}
                </span>
                <div
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 rounded-md px-3.5 py-1.5"
                  style={{ background: QUIET_FILL }}
                >
                  <span className="text-[14px] font-medium text-ink">{num(c.days)} days quiet</span>
                  <span className="font-mono text-[11px] text-ink/60">
                    {names[c.wentQuiet]} last, {names[c.revivedBy]} first
                    {c.blipMessages > 0 ? ` · ${num(c.blipMessages)} stray messages` : ""}
                  </span>
                </div>
              </div>
            );
          }
          const fill = fills.get(i) ?? QUIET_FILL;
          return (
            <div key={c.startTs} className="flex items-center gap-3.5">
              <span className="w-[104px] shrink-0 font-mono text-[10.5px] leading-tight text-ink/45">
                {range}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="flex min-h-[34px] flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md px-3.5 py-1"
                  style={{
                    // Floored so the label inside always has somewhere to sit;
                    // the block wraps rather than clips if it still doesn't fit.
                    width: `${Math.max(38, (c.messagesPerMonth / peak) * 100)}%`,
                    background: fill,
                    color: c.quiet ? "#17212B" : "#FFFFFF",
                  }}
                >
                  <span className="text-[14.5px] font-medium">
                    {note?.name ?? (c.quiet ? "A lull" : `${num(c.months)} months`)}
                  </span>
                  <span className="font-mono text-[11.5px] opacity-70">
                    {num(c.messageCount)} msg · {num(c.messagesPerMonth)}/mo · {pct(c.share)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </>
  );
}

/**
 * Words that are characteristic rather than frequent, biggest first.
 *
 * Sizes are `clamp()`ed rather than fixed: a 56px word is right on a laptop and
 * off the edge of a phone, and the size is inline (it's data — rank), so a
 * responsive class can't do it.
 */
const WORD_SIZES = [56, 48, 43, 39, 35, 32, 29, 27];
const wordSize = (i: number) => {
  const s = WORD_SIZES[Math.min(i, WORD_SIZES.length - 1)];
  return `clamp(${Math.round(s * 0.52)}px, ${(s / 15).toFixed(2)}vw + 10px, ${s}px)`;
};

function WordsPanel({ card, names }: { card: DeckCard & { kind: "words" }; names: [string, string] }) {
  return (
    <>
      <SlideHead kicker={card.kicker} title={card.headline} lede={card.detail} tone="night" />

      <div className="grid gap-8 lg:grid-cols-2">
        {([0, 1] as const).map((side) => {
          const words = side === 0 ? card.words.a : card.words.b;
          if (!words.length) return null;
          return (
            <div key={side}>
              <p
                className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{ color: sideVar(side) }}
              >
                {names[side]}
              </p>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                {words.map((w, i) => (
                  <span
                    key={w.word}
                    className="font-display leading-none text-white"
                    style={{ fontSize: wordSize(i), opacity: 1 - Math.min(i, 7) * 0.06 }}
                  >
                    {w.word}
                  </span>
                ))}
              </div>
              <p className="mt-3.5 font-mono text-[11px] leading-relaxed text-white/45">
                {words
                  .slice(0, 3)
                  .map((w) => `${w.word} ${num(w.mine)}×/${num(w.theirs)}×`)
                  .join(" · ")}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A deterministic card that isn't one of the four charts. */
function CardBody({ card }: { card: DeckCard & { kind: "stat" | "flat" } }) {
  return (
    <>
      <SlideHead kicker={card.kicker} title={card.headline} lede={card.detail} />

      {card.kind === "stat" && card.splits.length > 0 && (
        <div className="flex max-w-[900px] flex-col gap-5">
          {card.splits.map((s) => (
            <SplitRow key={s.label} split={s} />
          ))}
        </div>
      )}
      {card.kind === "flat" && (
        <ul className="grid gap-3.5 sm:grid-cols-2">
          {card.items.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-ink/65">
              <span className="font-mono text-ink/35">·</span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------- other slides

/** The cover. Who, over what span, and how much of it there is. */
function TitleSlide({
  analysis,
  names,
  control,
  nextId,
  total,
  actions,
  backHref,
  visibilityLabel,
}: {
  analysis: Analysis;
  names: [string, string];
  control?: ReactNode;
  nextId: string;
  total: number;
  actions?: ReactNode;
  backHref: string;
  visibilityLabel: string;
}) {
  const span = analysis.span;
  const v = analysis.volume;
  const longMonth = (ts: number) => new Date(ts * 1000).toLocaleDateString("en", { month: "long", year: "numeric" });

  return (
    <div className="cover-frame rise relative flex min-h-[calc(100dvh-1.5rem)] flex-col border border-accent-lit/22 px-5 py-5 text-white sm:min-h-[calc(100dvh-2.5rem)] sm:px-10 sm:py-8 xl:px-16">
      <header className="flex flex-wrap items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[0.18em] text-white/38">
        <div className="flex items-center gap-5"><a href={backHref} className="transition hover:text-accent-lit">← All reports</a><span className="h-5 w-px bg-white/16" /><span className="flex items-center gap-2.5 font-display text-xl normal-case tracking-normal text-white"><Logo size={22} tone="night" /> Telescope</span></div>
        <span>{visibilityLabel} · read locally</span>
      </header>

      <div className={`my-auto w-full py-10 sm:py-14 ${control ? "grid items-center gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] xl:gap-16" : "max-w-[1050px]"}`}>
        <div className="min-w-0">
          <div className="mb-8 flex items-center gap-5"><span className="h-px w-14 bg-accent-lit" /><Kicker tone="lit">A report on one conversation</Kicker></div>
          <h1 className={`font-display leading-[0.82] tracking-[-0.035em] text-white ${control ? "text-[clamp(3.75rem,7vw,7.5rem)]" : "text-[clamp(4rem,9vw,9rem)]"}`}>{names[1]} <span className="text-accent-lit">&amp;</span> <span className="italic">{names[0]}</span></h1>
          <p className="mt-7 max-w-[780px] font-display text-[20px] leading-relaxed text-white/52 sm:text-[27px]">{longMonth(span.firstTs)} to {longMonth(span.lastTs)}. {total - 1} screens, one finding each — the rhythms, the silences, and the words that only exist between the two of you.</p>
        </div>
        {control && <aside className="w-full max-w-[520px] justify-self-center" aria-label="The written half">{control}</aside>}
      </div>

      <footer className="grid gap-6 border-t border-white/14 pt-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <p className="max-w-[620px] text-sm leading-relaxed text-white/48">Everything here was computed from {num(v.total)} messages. The raw conversation stays on your machine.</p>
        <div className="flex flex-wrap items-center gap-4">{actions}<a href={`#${nextId}`} className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/38 transition hover:text-accent-lit">↓ Turn the page&nbsp;&nbsp; 01 / {String(total).padStart(2, "0")}</a></div>
      </footer>
    </div>
  );
}

function RecordsSlide({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const rows: Array<{ label: string; value: string; sub?: string }> = [];

  const silence = analysis.rhythm.longestSilences[0];
  if (silence) {
    rows.push({
      label: "Longest silence",
      value: `${num(silence.days)} days`,
      sub: `${monthYear(silence.fromTs)} – ${monthYear(silence.toTs)}`,
    });
  }

  const day = analysis.concentration.busiestDays[0];
  if (day) {
    rows.push({
      label: "Busiest day",
      value: `${num(day.total)} msg`,
      sub: `${dayLabel(day.date)} · ${num(day.counts.a)}/${num(day.counts.b)}`,
    });
  }

  const len = analysis.language.messageLengthPercentiles;
  const longest = len.a.max >= len.b.max ? 0 : 1;
  rows.push({
    label: "Longest message",
    value: `${num(Math.max(len.a.max, len.b.max))} chars`,
    sub: `${names[longest]}’s`,
  });

  const mono = analysis.rhythm.monologues;
  const talker = mono.a.maxRunLength >= mono.b.maxRunLength ? 0 : 1;
  rows.push({
    label: "Longest unbroken run",
    value: `${num(Math.max(mono.a.maxRunLength, mono.b.maxRunLength))} msg`,
    sub: `${names[talker]}’s, nothing back`,
  });

  const q = analysis.language.questions;
  const asked = q.count.a + q.count.b;
  if (asked > 0) {
    rows.push({
      label: "Questions asked",
      value: num(asked),
      sub: `1 in ${Math.max(1, Math.round(analysis.volume.total / asked))} messages`,
    });
  }

  const top = analysis.concentration.topSessionShare.find((t) => t.n === 10);
  if (top) {
    rows.push({
      label: "In the ten best nights",
      value: pct(top.share),
      sub: `${num(top.messages)} of ${num(analysis.volume.total)}`,
    });
  }

  return (
    <>
      <SlideHead
        kicker="Records"
        title="The extremes"
        lede="Single moments rather than tendencies — the one day, the one message, the one silence that beat every other."
      />
      <dl className="grid gap-px overflow-hidden rounded-xl border border-ink/14 bg-ink/14 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div
            key={r.label}
            // The hairlines are the parent's background showing through the gaps, so
            // an odd number of rows leaves the last cell as a grey rectangle that
            // reads as a row that failed to render. The odd one out spans instead.
            className={`flex items-baseline justify-between gap-4 bg-surface px-5 py-4 ${
              rows.length % 2 === 1 && i === rows.length - 1 ? "sm:col-span-2" : ""
            }`}
          >
            <dt className="text-sm text-ink/65">{r.label}</dt>
            <dd className="text-right font-mono text-[13.5px] text-ink tnum">
              {r.value}
              {r.sub && <span className="block text-[11px] text-ink/45">{r.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 max-w-[70ch]">
        <Panel tone="outline" className="flex gap-3">
          <Shield size={16} />
          <p className="text-[13px] leading-relaxed text-ink/65">
            Every number in this deck was counted in this tab, from a file that never left the
            machine. Close it and the report is gone.
          </p>
        </Panel>
      </div>
    </>
  );
}

function TopicsSlide({ topics, names }: { topics: WireTopic[]; names: [string, string] }) {
  return (
    <>
      <SlideHead kicker="The subjects that held" title="What you kept talking about" lede="Ranked recurring themes, named from the conversation rather than from keywords alone." />
      <ol className="border-t border-ink/16">
        {topics.map((topic, index) => (
          <li key={topic.id} className="grid gap-3 border-b border-ink/16 py-4 sm:grid-cols-[42px_minmax(180px,.7fr)_1fr] sm:items-start">
            <span className="font-mono text-[10px] text-ink/35">{String(index + 1).padStart(2, "0")}</span>
            <div><p className="font-display text-[24px] leading-tight text-ink">{topic.label}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.13em] text-accent">{topic.category.replaceAll("-", " ")}</p></div>
            <div><p className="text-sm leading-relaxed text-ink/65">{topic.summary}</p>{topic.evidence[0] && <div className="mt-3"><Quote cited={topic.evidence[0]} names={names} /></div>}</div>
          </li>
        ))}
      </ol>
    </>
  );
}

function DynamicsSlide({ dynamics, names }: { dynamics: WireDynamic[]; names: [string, string] }) {
  return (
    <>
      <SlideHead kicker="How the exchange works" title="The roles you take with each other" lede="Patterns in this conversation, not fixed personality labels." />
      <div className="grid gap-5 lg:grid-cols-2">
        {dynamics.map((dynamic) => (
          <article key={dynamic.id} className="border-t-2 border-accent-lit pt-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink/38">{dynamic.category.replaceAll("-", " ")}</p>
            <h3 className="mt-2 font-display text-[27px] leading-tight text-ink">{dynamic.headline}</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink/65">{dynamic.body}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-y border-ink/12 py-3 text-xs"><p><span className="text-side-a">{names[0]}</span><br /><span className="text-ink/55">{dynamic.roleA}</span></p><p><span className="text-side-b">{names[1]}</span><br /><span className="text-ink/55">{dynamic.roleB}</span></p></div>
            {dynamic.evidence[0] && <div className="mt-4"><Quote cited={dynamic.evidence[0]} names={names} /></div>}
            {dynamic.counterEvidence[0] && <p className="mt-3 text-xs leading-relaxed text-ink/48">Exception: “{dynamic.counterEvidence[0].quote}”</p>}
          </article>
        ))}
      </div>
    </>
  );
}

/** The one shareable screen: the verdict, alone, on the dark. */
function VerdictSlide({ verdict }: { verdict: NonNullable<WirePayload["verdict"]> }) {
  return (
    <div className="mx-auto max-w-[900px] text-center">
      <Kicker tone="lit" className="mb-8">
        The verdict
      </Kicker>
      {/*
        The measure is in `ch` on the line itself, not on a wrapper: `ch` resolves
        against the element's own font-size, so 20ch is twenty characters of *this*
        display serif at whatever size the breakpoint gave it. A verdict is capped at
        50 characters, which lands it in two or three lines at every width instead of
        one line on a desktop and six on a phone. A `ch` measure on the wrapper would
        be twenty characters of 16px body text — about 245px — which is what put a
        six-word verdict on six lines.
      */}
      <p className="mx-auto max-w-[20ch] font-display text-[42px] leading-[1.04] text-white sm:text-[64px] xl:text-[76px]">
        {verdict.text}
      </p>
      <p className="mx-auto mt-8 max-w-[54ch] text-[15px] leading-relaxed text-white/60">
        {verdict.rationale}
      </p>
      {verdict.compromised && (
        <p className="mx-auto mt-7 max-w-[54ch] border-t border-white/14 pt-5 text-[12.5px] leading-relaxed text-warn">
          Every candidate for this line failed at least one check, so this is the least bad one rather
          than a good one. Read it as a draft.
        </p>
      )}
    </div>
  );
}

/** What made this, and what it cost. A report should say where it came from. */
function ColophonSlide({ analysis, llm }: { analysis: Analysis; llm: WirePayload | null }) {
  return (
    <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
      <div>
        <div className="mb-4 flex items-center gap-2.5">
          <Logo size={24} tone="night" />
          <span className="font-display text-[24px] text-white">Telescope</span>
        </div>
        <p className="max-w-[42ch] text-sm leading-relaxed text-white/60">
          An instrument for reading your own messages. Everything before the verdict is arithmetic
          over {num(analysis.volume.total)} messages, done in your browser. Not affiliated with
          Telegram.
        </p>
        <p className="mt-6">
          <a
            href="#cover"
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent-lit transition hover:brightness-110"
          >
            ↑ back to the top
          </a>
        </p>
      </div>

      <div className="flex flex-col gap-2.5 text-sm text-white/60">
        <Kicker tone="faint-lit" className="mb-1">
          Counted here
        </Kicker>
        <span>{num(analysis.volume.total)} messages parsed</span>
        <span>{num(analysis.sessionSummary.count)} bursts of talking</span>
        <span>{num(analysis.chapters.length)} chapters cut by rate of change</span>
        <span>0 bytes sent anywhere</span>
      </div>

      <div className="flex flex-col gap-2.5 text-sm text-white/60">
        <Kicker tone="faint-lit" className="mb-1">
          The written half
        </Kicker>
        {llm ? (
          <>
            <span className="font-mono text-[12.5px]">{llm.model}</span>
            <span>
              {num(llm.citations.citations)} quotes checked against the messages,{" "}
              {num(llm.citations.valid)} held up
              {llm.citations.citations > llm.citations.valid
                ? `, ${num(llm.citations.citations - llm.citations.valid)} thrown out`
                : ""}
            </span>
            <span>
              {num(llm.usage.inputTokens)} tokens in ({num(llm.usage.cachedTokens)} cached),{" "}
              {num(llm.usage.outputTokens)} out over {llm.usage.calls} calls
            </span>
            {llm.droppedCount > 0 && <span>{num(llm.droppedCount)} readings dropped as unsupported</span>}
          </>
        ) : (
          <span>Not run. Everything in this deck is arithmetic.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Notes the model wrote about specific chapters, under the timeline.
 *
 * Silences get a note too and that's the interesting half — a year-in-review
 * usually only annotates the parts where something was happening.
 */
const NOTES_PER_SLIDE = 4;

function chapterNotes(notes: WireChapterNote[], chapters: Chapter[], names: [string, string]) {
  return notes
    .filter((n) => n.body)
    .map((n) => {
      const chapter = chapters[n.chapterIndex - 1];
      return (
        <Reading
          key={n.chapterIndex}
          headline={
            // Only eras get named, so a note with no name is about a silence — and
            // "392 days quiet" says that immediately where a date range doesn't.
            n.name ??
            (chapter?.kind === "silence"
              ? `${num(chapter.days)} days quiet`
              : chapter
                ? `${monthYear(chapter.startTs)} – ${monthYear(chapter.endTs)}`
                : "A silence")
          }
          body={n.body}
          quotes={n.evidence.slice(0, 2)}
          names={names}
        />
      );
    });
}

// --------------------------------------------------------------------- the deck

interface SlideSpec {
  /** anchor target, rail key, React key */
  id: string;
  tone: Tone;
  /** the footer marker and the rail tooltip */
  label: string;
  /**
   * A function, not a node, so a slide can close over the finished `slides` array
   * — the cover needs the total, and the total isn't known until the array is
   * built. Called during render, by which point it is.
   */
  content: () => ReactNode;
}

function LegacyReport({
  analysis,
  deck,
  llm,
  control,
  endControl,
  coverActions,
  backHref = "/app",
  visibilityLabel = "Private",
}: {
  analysis: Analysis;
  deck: DeckCard[];
  llm: WirePayload | null;
  /** the opt-in for the written half; absent when there is nothing to offer */
  control?: ReactNode;
  /** Optional final invitation, shown after the report's own colophon. */
  endControl?: ReactNode;
  coverActions?: ReactNode;
  backHref?: string;
  visibilityLabel?: string;
}) {
  const names = displayNames(analysis.chat.participants);
  const { slots, leftover } = interleaveFindings(deck, llm?.findings ?? []);

  // Mirrored in `scripts/render.tsx`. Every surface that shows quotes declares
  // how many it has room for, in one place, so the allocation is inspectable.
  const quotes = assignEvidence([
    ...deck.flatMap((c) =>
      (slots.get(c.id) ?? []).map(
        (f): EvidenceSlot => ({ key: `finding:${f.id}`, evidence: f.evidence, want: 2 }),
      ),
    ),
    ...leftover.map((f): EvidenceSlot => ({ key: `finding:${f.id}`, evidence: f.evidence, want: 3 })),
    ...(llm?.motifs ?? []).map((m): EvidenceSlot => ({ key: `motif:${m.id}`, evidence: m.evidence, want: 4 })),
  ]);

  const readings = (card: DeckCard, tone: "ink" | "night" = "ink") =>
    (slots.get(card.id) ?? []).map((f: WireFinding) => (
      <Reading
        key={f.id}
        headline={f.headline}
        body={f.body}
        quotes={quotes.get(`finding:${f.id}`) ?? []}
        names={names}
        tone={tone}
      />
    ));

  const slides: SlideSpec[] = [];

  slides.push({
    id: "cover",
    tone: "night",
    label: "cover",
    content: () => (
      <TitleSlide
        analysis={analysis}
        names={names}
        control={control}
        nextId={slides[1]?.id ?? "cover"}
        total={slides.length}
        actions={coverActions}
        backHref={backHref}
        visibilityLabel={visibilityLabel}
      />
    ),
  });

  slides.push({
    id: "months",
    tone: "night",
    label: "messages per month",
    content: () => <MonthlyChart analysis={analysis} names={names} />,
  });
  slides.push({
    id: "latency",
    tone: "night",
    label: "reply latency",
    content: () => <LatencyChart analysis={analysis} names={names} />,
  });
  slides.push({
    id: "hours",
    tone: "night",
    label: "when you talk",
    content: () => <HoursChart analysis={analysis} names={names} />,
  });

  // The cover's midnight editorial system carries through the deck. Paper
  // reversals are kept rare so they read as chapter turns, not striping.
  let alternate = 0;
  for (const card of deck) {
    if (card.kind === "timeline") {
      const found = readings(card);
      slides.push({
        id: card.id,
        tone: "light",
        label: "eras",
        content: () => (
          <>
            <ErasChart card={card} analysis={analysis} names={names} notes={llm?.chapterNotes ?? []} />
            <Readings count={found.length}>{found}</Readings>
          </>
        ),
      });

      /*
       * The chapter notes get their own screens rather than sitting under the
       * timeline. Thirteen chapters plus eight notes is two and a half viewports on
       * one slide, which is the one place a deck reads worse than a page: the
       * timeline is the spine of the report and should be the whole screen, and
       * reading what a chapter was is a different act from seeing where it sat.
       * Paged in fours so a page always fits, and `render.tsx` mirrors the count.
       */
      const noted = (llm?.chapterNotes ?? []).filter((n) => n.body);
      for (let i = 0; i < noted.length; i += NOTES_PER_SLIDE) {
        const page = noted.slice(i, i + NOTES_PER_SLIDE);
        const nth = i / NOTES_PER_SLIDE;
        const from = card.chapters[page[0].chapterIndex - 1];
        const to = card.chapters[page[page.length - 1].chapterIndex - 1];
        slides.push({
          id: `chapters-${nth + 1}`,
          tone: nth % 3 === 2 ? "light" : "night",
          label: "chapters, in words",
          content: () => (
            <>
              <SlideHead
                kicker="What each chapter was"
                title={from && to ? `${monthYear(from.startTs)} – ${monthYear(to.endTs)}` : "The chapters"}
                lede={
                  nth === 0
                    ? "Named after the fact, from what was in them rather than from the calendar. The silences are named too."
                    : undefined
                }
              />
              <div className="grid gap-4 lg:grid-cols-2">{chapterNotes(page, card.chapters, names)}</div>
            </>
          ),
        });
      }
      continue;
    }
    if (card.kind === "words") {
      const found = readings(card, "night");
      slides.push({
        id: card.id,
        tone: "night",
        label: "words that are yours",
        content: () => (
          <>
            <WordsPanel card={card} names={names} />
            {/* the only dark slide that carries readings — hence the tone */}
            <Readings count={found.length}>{found}</Readings>
          </>
        ),
      });
      continue;
    }
    const found = readings(card);
    slides.push({
      id: card.id,
      tone: alternate++ % 5 === 4 ? "light" : "night",
      label: card.kicker.toLowerCase(),
      content: () => (
        <>
          <CardBody card={card} />
          <Readings count={found.length}>{found}</Readings>
        </>
      ),
    });
  }

  // Readings whose metric matched no card. Shown rather than dropped: the model
  // saw the whole brief and may have found something that sits across two numbers.
  for (const f of leftover) {
    slides.push({
      id: `finding-${f.id}`,
      tone: "night",
      label: "read across the numbers",
      content: () => (
        <>
          <SlideHead kicker="Read across the numbers" title={f.headline} lede={f.body} />
          <div className="flex max-w-[80ch] flex-col gap-4">
            {(quotes.get(`finding:${f.id}`) ?? []).map((q, i) => (
              <Quote key={`${q.messageId ?? q.ts}-${i}`} cited={q} names={names} />
            ))}
          </div>
        </>
      ),
    });
  }

  for (const m of llm?.motifs ?? []) {
    const motif: WireMotif = m;
    slides.push({
      id: `motif-${motif.id}`,
      tone: "night",
      label: "a thing that kept happening",
      content: () => (
        <>
          <SlideHead kicker="A thing that kept happening" title={motif.name} lede={motif.body} />
          <div className="grid gap-4 sm:grid-cols-2">
            {(quotes.get(`motif:${motif.id}`) ?? []).map((q, i) => (
              <Quote key={`${q.messageId ?? q.ts}-${i}`} cited={q} names={names} />
            ))}
          </div>
        </>
      ),
    });
  }

  if (llm?.verdict) {
    const verdict = llm.verdict;
    slides.push({
      id: "verdict",
      tone: "night",
      label: "the verdict",
      content: () => <VerdictSlide verdict={verdict} />,
    });
  }

  if (llm?.topics?.length) {
    slides.push({
      id: "topics",
      tone: "light",
      label: "recurring topics",
      content: () => <TopicsSlide topics={llm.topics} names={names} />,
    });
  }

  const dynamics = llm?.dynamics ?? [];
  for (let i = 0; i < dynamics.length; i += 2) {
    const page = dynamics.slice(i, i + 2);
    slides.push({
      id: `dynamics-${i / 2 + 1}`,
      tone: i % 6 === 4 ? "light" : "night",
      label: "interaction dynamics",
      content: () => <DynamicsSlide dynamics={page} names={names} />,
    });
  }

  slides.push({
    id: "records",
    tone: "night",
    label: "records",
    content: () => <RecordsSlide analysis={analysis} names={names} />,
  });
  slides.push({
    id: "colophon",
    tone: "night",
    label: "colophon",
    content: () => <ColophonSlide analysis={analysis} llm={llm} />,
  });
  if (endControl) {
    slides.push({
      id: "keep-going",
      tone: "night",
      label: "save and go deeper",
      content: () => endControl,
    });
  }

  return (
    /*
     * The scroller is this element, not the window: `h-dvh` plus `overflow-y-auto`
     * so the snap points belong to the deck and nothing else on the page has to
     * know about them. Nothing inside may rely on `position: sticky` — this box is
     * its scroll container, and a scroll container that snaps will fight it.
     *
     * `tabIndex` is not decoration. Arrow keys and Page Down scroll the focused
     * element's scroll container, and on load that is the document — which has no
     * overflow here, because this box took it. Without a tab stop the whole report
     * is unreachable by keyboard until you happen to click inside it.
     */
    <main
      tabIndex={0}
      aria-label="The report, one screen at a time"
      className="h-dvh snap-y snap-mandatory overflow-y-auto overscroll-y-contain scroll-smooth bg-canvas"
    >
      {slides.map((s, i) => (
        <Slide key={s.id} id={s.id} tone={s.tone} step={i + 1} total={slides.length} label={s.label}>
          {s.content()}
        </Slide>
      ))}

      {/*
        Jump-to-slide. Plain anchors, so it works with JavaScript off and needs no
        scroll listener; there is deliberately no "you are here" highlight, because
        faking one without measuring scroll position would be a lie, and the
        bottom-left marker on every slide already says where you are.
      */}
      <nav
        aria-label="Jump to a screen"
        // Dark pill, light dots, on every slide. The rail is fixed and the slides
        // alternate light and dark under it, so it can't take its colours from the
        // slide it happens to be over; one scheme that reads on both is the only
        // option that doesn't disappear half the time. A pale pill was the first
        // try and it read as a scrollbar on the night slides.
        className="fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 rounded-full border border-white/10 bg-night/55 px-2 py-3 backdrop-blur lg:flex"
      >
        {slides.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            title={s.label}
            className="block h-1.5 w-1.5 rounded-full bg-white/40 transition hover:bg-accent-lit"
          >
            <span className="sr-only">{s.label}</span>
          </a>
        ))}
      </nav>
    </main>
  );
}

// ---------------------------------------------------------------- Wrapped 2.0

type WrappedSlideSpec = {
  id: string;
  label: string;
  tone: Tone;
  content: ReactNode;
};

function WrappedHead({ eyebrow, children, copy, night = true }: {
  eyebrow: string;
  children: ReactNode;
  copy?: ReactNode;
  night?: boolean;
}) {
  return (
    <header className="max-w-[920px]">
      <p className={`font-mono text-[clamp(.95rem,1.5vw,1.3rem)] font-semibold uppercase tracking-[0.16em] ${night ? "text-accent-lit" : "text-accent"}`}>{eyebrow}</p>
      <h2 className={`mt-4 font-display text-[clamp(2.7rem,6vw,6.4rem)] leading-[0.88] tracking-[-0.035em] ${night ? "text-white" : "text-ink"}`}>{children}</h2>
      {copy && <p className={`mt-5 max-w-[720px] text-[clamp(.9rem,1.35vw,1.15rem)] leading-relaxed ${night ? "text-white/56" : "text-ink/58"}`}>{copy}</p>}
    </header>
  );
}

function OverviewSlide({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const v = analysis.volume;
  const stats = [
    [num(v.total), "messages"],
    [num(v.words.a + v.words.b), "words"],
    [num(analysis.span.activeDays), "active days"],
    [num(analysis.sessionSummary.count), "conversations"],
  ];
  return (
    <div>
      <WrappedHead eyebrow="The conversation at a glance" copy={`${names[0]} and ${names[1]}, across ${num(Math.round(analysis.span.days))} calendar days.`}>You two had<br />a lot to say.</WrappedHead>
      <dl className="mt-10 grid grid-cols-2 border-y border-white/14 min-[1024px]:grid-cols-4">
        {stats.map(([value, label], i) => <div key={label} className={`py-5 min-[1024px]:px-6 ${i % 2 ? "border-l border-white/14 pl-5" : ""} ${i ? "min-[1024px]:border-l min-[1024px]:border-white/14" : ""}`}><dd className="font-display text-[clamp(2rem,4vw,4.4rem)] leading-none text-white">{value}</dd><dt className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/38">{label}</dt></div>)}
      </dl>
    </div>
  );
}

function YapperSlide({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const v = analysis.volume;
  const messageShare = v.messages.a / Math.max(1, v.total);
  const words = v.words.a + v.words.b;
  const wordShare = v.words.a / Math.max(1, words);
  const lead: 0 | 1 = v.words.a >= v.words.b ? 0 : 1;
  return (
    <div>
      <WrappedHead night={false} eyebrow="The yapper split" copy={`${names[lead]} owns the larger share of the words. Message count and word count do not always tell the same story.`}>{names[0]} sent <span className="text-side-a">{pct(messageShare)}</span> of the messages—and <span className="text-side-b">{pct(wordShare)}</span> of the words.</WrappedHead>
      <div className="mt-10 max-w-[960px] space-y-7">
        <SplitRow split={{ label: "messages", a: num(v.messages.a), b: num(v.messages.b), weights: [v.messages.a, v.messages.b] }} />
        <SplitRow split={{ label: "words", a: num(v.words.a), b: num(v.words.b), weights: [v.words.a, v.words.b] }} />
        <SplitRow split={{ label: "characters per message", a: v.charsPerMessage.a.toFixed(0), b: v.charsPerMessage.b.toFixed(0), weights: [v.charsPerMessage.a, v.charsPerMessage.b] }} />
      </div>
    </div>
  );
}

function WhoStartsSlide({ analysis, names }: { analysis: Analysis; names: [string, string] }) {
  const starts = analysis.rhythm.revival.find((item) => item.thresholdDays === 2 / 24);
  const counts = starts?.revivedBy ?? { a: 0, b: 0 };
  const total = counts.a + counts.b;
  const leader: 0 | 1 = counts.a >= counts.b ? 0 : 1;
  const leaderCount = leader === 0 ? counts.a : counts.b;
  const leaderShare = total ? leaderCount / total : 0;
  const tied = counts.a === counts.b && total > 0;

  return (
    <div>
      <WrappedHead
        night={false}
        eyebrow="Who starts it?"
        copy={total ? `${num(total)} conversations restarted after more than two hours of silence. The first message after the gap gets the credit.` : "A restart needs more than two hours of silence. This conversation never stayed quiet that long between messages."}
      >
        {total === 0 ? "This chat never really stopped." : tied ? "You restarted it equally." : <><span style={{ color: sideVar(leader) }}>{names[leader]}</span> brought it back {pct(leaderShare)} of the time.</>}
      </WrappedHead>

      {total > 0 && (
        <div className="mt-10 max-w-[980px]">
          <div className="flex h-5 overflow-hidden rounded-full bg-ink/8" aria-label={`${names[0]} restarted ${counts.a} times; ${names[1]} restarted ${counts.b} times`}>
            <span className="h-full bg-side-a" style={{ width: `${(counts.a / total) * 100}%` }} />
            <span className="h-full bg-side-b" style={{ width: `${(counts.b / total) * 100}%` }} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-8 border-t border-ink/14 pt-5">
            {([0, 1] as const).map((side) => {
              const count = side === 0 ? counts.a : counts.b;
              return <div key={side}><p className="font-mono text-[9px] uppercase tracking-[.16em]" style={{ color: sideVar(side) }}>{names[side]}</p><p className="mt-2 font-display text-[clamp(2.4rem,5vw,5.5rem)] leading-none text-ink">{pct(count / total)}</p><p className="mt-2 text-sm text-ink/46">{num(count)} restarts</p></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DoubleTexterSlide({ analysis, names, messages }: { analysis: Analysis; names: [string, string]; messages?: LocalStreakMessage[] }) {
  const metric = analysis.rhythm.doubleTexting;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (!metric) return null;
  const total = metric.frequency.a + metric.frequency.b;
  const longest = metric.longest;
  const winner = longest?.who;
  const duration = longest ? longest.endTs - longest.startTs : 0;

  return (
    <div>
      <WrappedHead
        eyebrow="Double Texter Award"
        copy="A double text is another unanswered message sent at least two minutes after the previous one. There is no maximum gap."
      >
        {longest && winner !== undefined ? <><span style={{ color: sideVar(winner) }}>{names[winner]}</span> reached {num(longest.doubleTexts)} follow-ups without a reply.</> : "Neither of you double texted."}
      </WrappedHead>

      {longest && (
        <div className="mt-9 grid max-w-[1040px] items-end gap-7 border-y border-white/14 py-6 md:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="font-display text-[clamp(3.5rem,8vw,8rem)] leading-[.72] text-accent-lit tnum">{num(longest.doubleTexts)}</p>
            <p className="mt-4 font-mono text-[9px] uppercase tracking-[.16em] text-white/38">qualifying follow-ups · {num(longest.messages)} messages in the run · {dur(duration)}</p>
            <button type="button" onClick={() => setOpen(true)} className="mt-5 rounded-full border border-white/20 px-5 py-2.5 text-sm text-white/72 transition hover:-translate-y-0.5 hover:border-accent-lit hover:text-white">View the actual streak <span className="ml-2">↗</span></button>
          </div>
          <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-white/10" aria-label={`${names[0]} double texted ${metric.frequency.a} times; ${names[1]} double texted ${metric.frequency.b} times`}>
              <span className="h-full bg-side-a" style={{ width: `${total ? (metric.frequency.a / total) * 100 : 50}%` }} />
              <span className="h-full bg-side-b" style={{ width: `${total ? (metric.frequency.b / total) * 100 : 50}%` }} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-5">
              {([0, 1] as const).map((side) => {
                const count = side === 0 ? metric.frequency.a : metric.frequency.b;
                return <div key={side}><p className="font-mono text-[9px] uppercase tracking-[.14em]" style={{ color: sideVar(side) }}>{names[side]}</p><p className="mt-1 font-display text-[clamp(2rem,4vw,4rem)] leading-none text-white">{num(count)}</p><p className="mt-1 text-xs text-white/38">double texts</p></div>;
              })}
            </div>
          </div>
        </div>
      )}
      {open && longest && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-night/84 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="double-text-streak-title" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="rise flex max-h-[86dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-[26px] border border-white/14 bg-night text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-5 border-b border-white/12 px-6 py-5 sm:px-8 sm:py-6">
              <div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-accent-lit">The receipts</p><h2 id="double-text-streak-title" className="mt-2 font-display text-[clamp(2rem,5vw,3.8rem)] leading-none">{names[longest.who]}&rsquo;s longest streak.</h2><p className="mt-3 text-sm text-white/45">{num(longest.messages)} unanswered messages from {new Date(longest.startTs * 1000).toLocaleString()} to {new Date(longest.endTs * 1000).toLocaleString()}.</p></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close streak" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/16 text-xl text-white/45 transition hover:border-white/40 hover:text-white">×</button>
            </header>
            <div className="overflow-y-auto px-5 py-6 sm:px-8">
              {messages?.length ? (
                <ol className="space-y-3">{messages.map((message) => <li key={message.id} className={`flex ${message.who === 0 ? "justify-start" : "justify-end"}`}><div className="max-w-[82%]"><p className="mb-1 px-1 font-mono text-[8px] uppercase tracking-[.12em]" style={{ color: sideVar(message.who) }}>{names[message.who]} · {new Date(message.ts * 1000).toLocaleString()}</p><p className="rounded-[18px] border border-white/10 bg-white/[.06] px-4 py-3 text-sm leading-relaxed text-white/78">{message.body}</p></div></li>)}</ol>
              ) : (
                <div className="py-12 text-center"><p className="font-display text-3xl">The messages stayed on the original device.</p><p className="mx-auto mt-4 max-w-[48ch] text-sm leading-relaxed text-white/48">Telescope saved the streak&rsquo;s message IDs and timing, but not the conversation text. Open this report in the browser where it was created to view the messages.</p></div>
              )}
            </div>
            <footer className="border-t border-white/12 px-6 py-4 font-mono text-[8px] uppercase tracking-[.13em] text-white/28 sm:px-8">Hidden from insights-only links · included only when private messages are shared</footer>
          </section>
        </div>
      )}
    </div>
  );
}

function ConcentrationSlide({ analysis }: { analysis: Analysis }) {
  const top = analysis.concentration.topSessionShare.find((x) => x.n === 10) ?? analysis.concentration.topSessionShare.at(-1);
  const day = analysis.concentration.busiestDays[0];
  return (
    <div>
      <WrappedHead eyebrow="Where it actually happened" copy={`A conversation ends after two hours of quiet. There were ${num(analysis.sessionSummary.count)} separate bursts in total.`}>
        {top ? <><span className="text-accent-lit">{pct(top.share)}</span> of everything happened in just ten conversations.</> : <>A few conversations did most of the work.</>}
      </WrappedHead>
      <div className="mt-10 grid max-w-[920px] gap-px overflow-hidden rounded-2xl bg-white/12 sm:grid-cols-3">
        {[[day ? num(day.total) : "—", "messages on the busiest day"], [num(analysis.sessionSummary.maxMessages), "messages in the biggest burst"], [num(Math.round(analysis.sessionSummary.medianMessages)), "messages in the median burst"]].map(([value, label]) => <div key={label} className="bg-night/75 p-6"><p className="font-display text-4xl text-white">{value}</p><p className="mt-2 text-sm text-white/45">{label}</p></div>)}
      </div>
    </div>
  );
}

function StickerSpecimen({ sticker }: { sticker: LocalStickerVisual }) {
  return <div className="group relative min-w-0"><div className="grid aspect-square w-full place-items-center overflow-hidden rounded-[14px] bg-white/[.055] transition duration-300 group-hover:-translate-y-1 group-hover:bg-white/[.09]">{sticker.video ? <video src={sticker.src} autoPlay loop muted playsInline className="h-full w-full object-contain" /> : <img src={sticker.src} alt={sticker.emoji ? `${sticker.emoji} sticker` : "Telegram sticker"} className="h-full w-full object-contain" />}</div><p className="mt-1.5 text-center font-mono text-[8px] uppercase tracking-[.1em] text-white/34">{num(sticker.count)}×</p></div>;
}

function CommunicationSlide({ analysis, names, stickerVisuals }: { analysis: Analysis; names: [string, string]; stickerVisuals?: LocalStickerVisuals }) {
  const { emoji, stickers } = analysis.language;
  const tele = analysis.behaviour.videoNotes;
  const voice = analysis.behaviour.voiceNotes;
  const topEmoji = (side: 0 | 1) => (side === 0 ? emoji.top.a : emoji.top.b).slice(0, 5).map((x) => x.emoji).join(" ") || "—";
  return (
    <div>
      <WrappedHead eyebrow="How you speak" copy="The punctuation, reactions and little formats that became part of the conversation.">Same chat.<br /><span className="italic text-accent-lit">Different dialects.</span></WrappedHead>
      <div className="mt-9 grid gap-8 lg:grid-cols-2">
        {([0, 1] as const).map((side) => {
          const e = side === 0 ? emoji.total.a : emoji.total.b;
          const s = side === 0 ? stickers.total.a : stickers.total.b;
          const t = side === 0 ? tele.a : tele.b;
          const v = side === 0 ? voice.a : voice.b;
          const visual = side === 0 ? stickerVisuals?.a : stickerVisuals?.b;
          return <section key={side} className="border-t pt-5" style={{ borderColor: sideVar(side) }}><p className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[.2em]" style={{ color: sideVar(side) }}>{names[side]}</p><p className="mt-4 text-[clamp(2rem,4vw,4.4rem)] leading-none">{topEmoji(side)}</p>{visual?.length ? <div className="mt-5"><p className="mb-2 font-mono text-[8px] uppercase tracking-[.13em] text-white/28">Top sent stickers</p><div className="grid max-w-[400px] grid-cols-5 gap-2 max-[1024px]:w-3/5">{visual.map((sticker) => <StickerSpecimen key={sticker.path} sticker={sticker} />)}</div></div> : null}<p className="sr-only">{num(e)} emoji, {num(s)} stickers, {num(t.count)} telebubbles lasting {dur(t.totalSeconds)}, and {num(v.count)} voice notes lasting {dur(v.totalSeconds)}</p><div aria-hidden="true" className="communication-stat-cycle mt-4 font-mono text-[8px] uppercase tracking-[.08em] text-white/42"><span>{num(e)} emoji · {num(s)} stickers</span><span>{num(t.count)} telebubbles · {dur(t.totalSeconds)}</span><span>{num(v.count)} voice notes · {dur(v.totalSeconds)}</span></div></section>;
        })}
      </div>
    </div>
  );
}

function LanguageSlide({ card, names, reading, selection }: { card: DeckCard & { kind: "words" }; names: [string, string]; reading?: WireFinding; selection?: WirePayload["language"] | { a: string[]; b: string[] } }) {
  const modern = selection && (selection.a.length === 0 || typeof selection.a[0] !== "string")
    ? selection as { a: WireLanguageInsight[]; b: WireLanguageInsight[]; shared: WireLanguageInsight[] }
    : null;
  if (modern && (modern.a.length || modern.b.length || modern.shared.length)) {
    return (
      <div>
        <WrappedHead eyebrow="Your language" copy="Mined from the full conversation, then selected for meaning, spread and the job each expression performs.">The phrases that<br /><span className="italic text-accent-lit">sound like you.</span></WrappedHead>
        <div className="mt-8 grid gap-7 lg:grid-cols-2">
          {([0, 1] as const).map((side) => {
            const insights = (side === 0 ? modern.a : modern.b).slice(0, 2);
            return <section key={side} className="border-t pt-4" style={{ borderColor: sideVar(side) }}><p className="font-mono text-[9px] uppercase tracking-[.18em]" style={{ color: sideVar(side) }}>{names[side]}</p><div className="mt-3 space-y-4 max-[1024px]:grid max-[1024px]:grid-cols-2 max-[1024px]:gap-4 max-[1024px]:space-y-0">{insights.map((item, index) => <article key={item.candidateId} className={index ? "border-t border-white/10 pt-4 max-[1024px]:border-l max-[1024px]:border-t-0 max-[1024px]:pl-4 max-[1024px]:pt-0" : ""}><p className="font-display text-[clamp(1.8rem,3.4vw,3.8rem)] leading-none text-white">“{item.text}”</p><p className="mt-2 font-mono text-[8px] uppercase tracking-[.14em] text-accent-lit/70">{item.category.replaceAll("-", " ")}</p><p className="mt-2 max-w-[48ch] text-xs leading-relaxed text-white/48">{item.explanation}</p></article>)}</div></section>;
          })}
        </div>
        {modern.shared[0] && <div className="mt-7 flex items-baseline gap-4 border-t border-white/12 pt-4"><p className="font-mono text-[8px] uppercase tracking-[.15em] text-white/32">What became yours</p><p className="font-display text-[clamp(1.4rem,2.5vw,2.5rem)] italic text-accent-lit">“{modern.shared[0].text}”</p><p className="hidden max-w-[42ch] text-xs text-white/42 md:block">{modern.shared[0].explanation}</p></div>}
      </div>
    );
  }
  return (
    <div>
      <WrappedHead eyebrow="Your language" copy={reading?.body ?? "Not the words everyone uses—the words that are unusually yours compared with the other person."}>{reading?.headline ?? "The words that sound like each of you."}</WrappedHead>
      <div className="mt-10 grid gap-9 lg:grid-cols-2">
        {([0, 1] as const).map((side) => {
          const candidates = side === 0 ? card.words.a : card.words.b;
          const selected = side === 0 ? selection?.a : selection?.b;
          const byWord = new Map(candidates.map((word) => [word.word.toLowerCase(), word]));
          const legacyWords = selected?.filter((word): word is string => typeof word === "string");
          const curated = legacyWords?.length ? legacyWords.map((word) => byWord.get(word.toLowerCase())).filter((word): word is NonNullable<typeof word> => Boolean(word)) : undefined;
          const words = curated?.length ? curated.slice(0, 7) : candidates.slice(0, 7);
          return <section key={side}><p className="font-mono text-[10px] uppercase tracking-[.2em]" style={{ color: sideVar(side) }}>{names[side]}</p><div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">{words.map((w, i) => <span key={w.word} className="font-display leading-none text-white" style={{ fontSize: `clamp(${Math.max(24, 48 - i * 4)}px, ${Math.max(2.3, 4.3 - i * .3)}vw, ${72 - i * 5}px)`, opacity: 1 - i * .07 }}>{w.word}</span>)}</div></section>;
        })}
      </div>
    </div>
  );
}

function LoreSlide({ motifs, names }: { motifs: WireMotif[]; names: [string, string] }) {
  const motif = motifs[0];
  if (!motif) return null;
  return (
    <div>
      <WrappedHead eyebrow="The lore" copy={motif.body}>“{motif.name}” somehow became canon.</WrappedHead>
      <div className="mt-9 grid max-w-[980px] gap-5 md:grid-cols-2">{motif.evidence.slice(0, 2).map((q, i) => <Quote key={`${q.messageId}-${i}`} cited={q} names={names} tone="night" />)}</div>
    </div>
  );
}

function eraChangeLine(chapter: Extract<Chapter, { kind: "era" }>): string | null {
  const change = chapter.change?.strongest[0];
  if (!change) return null;
  const format = (value: number) => {
    if (change.metric.startsWith("reply time")) return dur(value);
    if (["initiator share", "emoji rate", "late-night share"].includes(change.metric)) return pct(value, 0);
    if (change.metric === "words/message") return value.toFixed(1);
    return num(value);
  };
  return `${change.metric}: ${format(change.before)} → ${format(change.after)}`;
}

function EraWrappedSlide({ card, notes, modelAssisted, names }: { card: DeckCard & { kind: "timeline" }; notes: WireChapterNote[]; modelAssisted: boolean; names: [string, string] }) {
  const [selected, setSelected] = useState<{ chapter: Extract<Chapter, { kind: "era" }>; index: number; position: number } | null>(null);
  const byIndex = new Map(notes.map((note) => [note.chapterIndex, note]));
  const candidates = card.chapters
    .map((chapter, index) => ({ chapter, index: index + 1 }))
    .filter((item): item is { chapter: Extract<Chapter, { kind: "era" }>; index: number } => item.chapter.kind === "era" && !item.chapter.quiet);
  const eraMessages = candidates.reduce((sum, item) => sum + item.chapter.messageCount, 0);
  const minimumMessages = Math.max(25, Math.round(eraMessages * 0.005));
  const meaningful = candidates.filter(({ chapter }) => (chapter.weeks ?? chapter.months * 4) >= 2 && chapter.messageCount >= minimumMessages);
  const retained = new Set(
    (meaningful.length >= Math.min(3, candidates.length)
      ? meaningful
      : [...candidates].sort((a, b) => (b.chapter.share * Math.max(2, b.chapter.weeks ?? 1)) - (a.chapter.share * Math.max(2, a.chapter.weeks ?? 1))).slice(0, Math.min(3, candidates.length)))
      .map((item) => item.index),
  );
  const eras = candidates.filter((item) => retained.has(item.index));

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);

  return (
    <div>
      <WrappedHead night={false} eyebrow="Your eras" copy={modelAssisted ? `${eras.length} significant chapters survived the cut. Scroll through them, then open one for the full story.` : "Weekly changes in volume, replies, media, timing and language located these stretches. AI insights can add meaning and names."}>This conversation had chapters.</WrappedHead>
      <div className="era-scroll mt-7" onClick={(event) => event.stopPropagation()}>
      <ol className="era-timeline" style={{ "--era-count": Math.max(1, eras.length) } as CSSProperties}>
        {eras.map(({ chapter, index }, position) => {
        const note = byIndex.get(index);
        const change = eraChangeLine(chapter);
        const above = position % 2 === 0;
        const color = ERA_FILLS[position % ERA_FILLS.length];
        return (
          <li key={`${chapter.startTs}-${chapter.endTs}`} className={`era-stop ${above ? "era-stop-above" : "era-stop-below"}`} style={{ "--era-position": position } as CSSProperties}>
            <button type="button" className="era-stop-button" onClick={(event) => { event.stopPropagation(); setSelected({ chapter, index, position }); }} aria-label={`Open ${note?.name || `era ${position + 1}`}`}>
              <span className="era-stop-node" style={{ background: color }}><span>{String(position + 1).padStart(2, "0")}</span></span>
              <span className="era-stop-copy" style={{ borderColor: color }}>
                <span className="era-stop-date">{monthYear(chapter.startTs)} — {monthYear(chapter.endTs)}</span>
                <strong>{note?.name || `Era ${position + 1}`}</strong>
                <span className="era-stop-volume">{num(chapter.messageCount)} messages · {num(chapter.messagesPerMonth)}/mo</span>
                {change && <span className="era-stop-change">{change}</span>}
                <span className="era-stop-open">open chapter ↗</span>
              </span>
            </button>
          </li>
        );
      })}
      </ol>
      </div>
      {selected && (() => {
        const note = byIndex.get(selected.index);
        const color = ERA_FILLS[selected.position % ERA_FILLS.length];
        return <div className="fixed inset-0 z-[100] grid place-items-center bg-night/82 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="era-detail-title" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="rise max-h-[88dvh] w-full max-w-[820px] overflow-y-auto rounded-[28px] bg-surface p-6 text-ink shadow-2xl sm:p-9" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-6 border-b border-ink/14 pb-6">
              <div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-accent">{monthYear(selected.chapter.startTs)} — {monthYear(selected.chapter.endTs)}</p><h3 id="era-detail-title" className="mt-3 font-display text-[clamp(2.4rem,6vw,5.2rem)] leading-[.9]">{note?.name || `Era ${selected.position + 1}`}</h3></div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close era details" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink/16 text-xl text-ink/45 transition hover:border-ink/40 hover:text-ink">×</button>
            </header>
            <p className="mt-6 max-w-[65ch] text-[clamp(1rem,1.8vw,1.25rem)] leading-relaxed text-ink/68">{note?.body || "A sustained stretch with its own rhythm and conversational shape."}</p>
            <dl className="mt-7 grid grid-cols-2 border-y border-ink/14 sm:grid-cols-4"><div className="py-4"><dd className="font-display text-3xl">{num(selected.chapter.messageCount)}</dd><dt className="mt-1 font-mono text-[8px] uppercase tracking-[.12em] text-ink/38">messages</dt></div><div className="border-l border-ink/14 py-4 pl-5"><dd className="font-display text-3xl">{num(selected.chapter.messagesPerMonth)}</dd><dt className="mt-1 font-mono text-[8px] uppercase tracking-[.12em] text-ink/38">per month</dt></div><div className="py-4 sm:border-l sm:border-ink/14 sm:pl-5"><dd className="font-display text-3xl">{selected.chapter.weeks ?? "—"}</dd><dt className="mt-1 font-mono text-[8px] uppercase tracking-[.12em] text-ink/38">weeks</dt></div><div className="border-l border-ink/14 py-4 pl-5"><dd className="font-display text-3xl">{pct(selected.chapter.share)}</dd><dt className="mt-1 font-mono text-[8px] uppercase tracking-[.12em] text-ink/38">of the chat</dt></div></dl>
            {selected.chapter.change?.strongest.length ? <div className="mt-7"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">What changed</p><ul className="mt-3 grid gap-2 sm:grid-cols-2">{selected.chapter.change.strongest.slice(0, 4).map((change) => <li key={change.metric} className="border-t border-ink/12 py-3 text-sm text-ink/64">{change.metric}: <span className="font-semibold text-ink">{num(change.before)} → {num(change.after)}</span></li>)}</ul></div> : null}
            {note?.evidence.length ? <div className="mt-7"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">From this era</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{note.evidence.slice(0, 4).map((quote, quoteIndex) => <Quote key={`${quote.messageId}-${quoteIndex}`} cited={quote} names={names} />)}</div></div> : null}
            <div className="mt-8 h-1 w-20 rounded-full" style={{ background: color }} />
          </section>
        </div>;
      })()}
    </div>
  );
}

function TopicsWrappedSlide({ topics }: { topics: WireTopic[] }) {
  return (
    <div>
      <WrappedHead night={false} eyebrow="What you actually talk about" copy="Recurring themes from representative windows across the full timeline—not a keyword count from one loud week.">The subjects that kept coming back.</WrappedHead>
      <ol className="mt-8 border-t border-ink/16">{topics.slice(0, 4).map((topic, index) => <li key={topic.id} className="grid grid-cols-[34px_1fr] gap-3 border-b border-ink/16 py-3 sm:grid-cols-[44px_260px_1fr]"><span className="font-mono text-[9px] text-ink/35">0{index + 1}</span><h3 className="font-display text-[clamp(1.25rem,2.3vw,2rem)] leading-none text-ink">{topic.label}</h3><p className="hidden text-sm leading-relaxed text-ink/55 sm:block">{topic.summary}</p></li>)}</ol>
    </div>
  );
}

function DynamicsWrappedSlide({ dynamics, names }: { dynamics: WireDynamic[]; names: [string, string] }) {
  return (
    <div>
      <WrappedHead eyebrow="How the exchange works" copy="Observable roles in this conversation—not permanent personality labels.">The rhythm underneath the words.</WrappedHead>
      <div className="mt-9 grid gap-8 lg:grid-cols-2">{dynamics.slice(0, 2).map((dynamic) => <article key={dynamic.id} className="border-t border-accent-lit pt-4"><h3 className="font-display text-[clamp(1.7rem,3vw,3.2rem)] leading-none text-white">{dynamic.headline}</h3><p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/54">{dynamic.body}</p><div className="mt-5 grid grid-cols-2 gap-4 font-mono text-[9px] uppercase tracking-[.1em]"><p className="text-side-a">{names[0]}<span className="mt-1 block normal-case tracking-normal text-white/42">{dynamic.roleA}</span></p><p className="text-side-b">{names[1]}<span className="mt-1 block normal-case tracking-normal text-white/42">{dynamic.roleB}</span></p></div></article>)}</div>
    </div>
  );
}

function ExtremesWrappedSlide({ analysis, names, evidence }: { analysis: Analysis; names: [string, string]; evidence?: LocalExtremeEvidence }) {
  const [open, setOpen] = useState<"message" | "run" | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const silence = analysis.rhythm.longestSilences[0];
  const day = analysis.concentration.busiestDays[0];
  const len = analysis.language.messageLengthPercentiles;
  const longestSide = len.a.max >= len.b.max ? 0 : 1;
  const mono = analysis.rhythm.monologues;
  const runSide = mono.a.maxRunLength >= mono.b.maxRunLength ? 0 : 1;
  const rows: Array<{ value: string; label: string; reveal?: "message" | "run" }> = [
    { value: silence ? `${num(silence.days)} days` : "—", label: "longest silence" },
    { value: day ? num(day.total) : "—", label: "messages on the busiest day" },
    { value: `${num(Math.max(len.a.max, len.b.max))} chars`, label: `longest message · ${names[longestSide]}`, reveal: "message" },
    { value: `${num(Math.max(mono.a.maxRunLength, mono.b.maxRunLength))} messages`, label: `longest unbroken run · ${names[runSide]}`, reveal: "run" },
  ];
  const shown = open === "message" ? (evidence?.longestMessage ? [evidence.longestMessage] : undefined) : evidence?.longestRun;
  return (
    <div>
      <WrappedHead night={false} eyebrow="The extremes" copy="Single moments rather than tendencies—the records that beat every other day, message and silence.">The biggest, longest and quietest.</WrappedHead>
      <dl className="mt-8 grid grid-cols-2 gap-x-8 border-y border-ink/16 lg:grid-cols-4">{rows.map((row, index) => <div key={row.label} className={`py-5 ${index % 2 ? "border-l border-ink/16 pl-5" : ""} lg:border-l lg:border-ink/16 lg:pl-5`}><dd className="font-display text-[clamp(1.8rem,3.6vw,3.8rem)] leading-none text-ink">{row.reveal ? <button type="button" onClick={() => setOpen(row.reveal!)} className="text-left underline decoration-accent/35 decoration-2 underline-offset-[7px] transition hover:text-accent">{row.value}</button> : row.value}</dd><dt className="mt-2 text-xs leading-tight text-ink/48">{row.label}{row.reveal && <span className="mt-1 block font-mono text-[8px] uppercase tracking-[.1em] text-accent">click to reveal ↗</span>}</dt></div>)}</dl>
      {open && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-night/84 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="extreme-receipt-title" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(null); }}>
          <section className="rise flex max-h-[86dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-white/14 bg-night text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-5 border-b border-white/12 px-6 py-5 sm:px-8 sm:py-6"><div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-accent-lit">The receipts</p><h2 id="extreme-receipt-title" className="mt-2 font-display text-[clamp(2rem,5vw,3.8rem)] leading-none">{open === "message" ? "The longest message." : "The longest unbroken run."}</h2><p className="mt-3 text-sm text-white/45">{open === "message" ? `${names[longestSide]} wrote ${num(Math.max(len.a.max, len.b.max))} characters.` : `${names[runSide]} sent ${num(Math.max(mono.a.maxRunLength, mono.b.maxRunLength))} messages before anything came back.`}</p></div><button type="button" onClick={() => setOpen(null)} aria-label="Close receipt" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/16 text-xl text-white/45 transition hover:border-white/40 hover:text-white">×</button></header>
            <div className="overflow-y-auto px-5 py-6 sm:px-8">{shown?.length ? <ol className="space-y-3">{shown.map((message) => <li key={message.id} className={`flex ${message.who === 0 ? "justify-start" : "justify-end"}`}><div className="max-w-[88%]"><p className="mb-1 px-1 font-mono text-[8px] uppercase tracking-[.12em]" style={{ color: sideVar(message.who) }}>{names[message.who]} · {new Date(message.ts * 1000).toLocaleString()}</p><p className="whitespace-pre-wrap break-words rounded-[18px] border border-white/10 bg-white/[.06] px-4 py-3 text-sm leading-relaxed text-white/78">{message.body}</p></div></li>)}</ol> : <div className="py-12 text-center"><p className="font-display text-3xl">The text stayed on the original device.</p><p className="mx-auto mt-4 max-w-[48ch] text-sm leading-relaxed text-white/48">Only the winning message IDs and measurements were saved. Open this report in the browser where it was generated to reveal the content.</p></div>}</div>
            <footer className="border-t border-white/12 px-6 py-4 font-mono text-[8px] uppercase tracking-[.13em] text-white/28 sm:px-8">Hidden from insights-only links · included only when private messages are shared</footer>
          </section>
        </div>
      )}
    </div>
  );
}

function CharacterSlide({ roles, names }: { roles: { a: WireRole[]; b: WireRole[] }; names: [string, string] }) {
  const [roleIndexes, setRoleIndexes] = useState<[number, number]>([0, 0]);
  const moveRole = (side: 0 | 1, delta: number) => {
    const personRoles = side === 0 ? roles.a : roles.b;
    if (personRoles.length < 2) return;
    setRoleIndexes((current) => {
      const next: [number, number] = [...current];
      next[side] = (current[side] + delta + personRoles.length) % personRoles.length;
      return next;
    });
  };
  const roleCard = (role: WireRole, index: number) => <article key={role.id}><p className="font-mono text-[9px] uppercase tracking-[.16em] text-white/28">Role {String(index + 1).padStart(2, "0")}</p><h4 className="mt-1 font-display text-[clamp(1.4rem,2.2vw,2.25rem)] leading-tight text-white/90">{role.title}</h4><p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-white/52">{role.description}</p>{role.evidence[0] && <p className="mt-3 line-clamp-2 border-l border-white/16 pl-3 text-xs italic leading-relaxed text-white/36">“{role.evidence[0].quote}”</p>}</article>;
  return (
    <div>
      <WrappedHead eyebrow="Character cards" copy="Roles inferred from repeated behaviour in this conversation—not fixed personality labels.">The roles you grew into.</WrappedHead>
      <div className="mt-9 grid gap-8 max-[640px]:mt-5 lg:grid-cols-2">{([0, 1] as const).map((side) => {
        const personRoles = side === 0 ? roles.a : roles.b;
        const currentIndex = Math.min(roleIndexes[side], Math.max(0, personRoles.length - 1));
        const currentRole = personRoles[currentIndex];
        return <section key={side} className="border-t pt-5 max-[640px]:pt-3" style={{ borderColor: sideVar(side) }}><h3 className="font-display text-[clamp(2.3rem,4vw,4.8rem)]" style={{ color: sideVar(side) }}>{names[side]}</h3><div className="mt-5 hidden space-y-6 min-[1024px]:block">{personRoles.map(roleCard)}</div>{currentRole && <div className="mt-5 max-[640px]:mt-3 min-[1024px]:hidden"><div key={currentRole.id} className="role-card-swap relative pr-12">{roleCard(currentRole, currentIndex)}{personRoles.length > 1 && <button type="button" onClick={() => moveRole(side, 1)} aria-label={`Show next role for ${names[side]}`} className="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-full border border-white/14 text-base text-white/48 transition hover:border-accent-lit hover:text-accent-lit">→</button>}</div></div>}</section>;
      })}</div>
    </div>
  );
}

function WildSentenceSlide({ item, names, position, total }: { item: WireWildSentence; names: [string, string]; position: number; total: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const side = item.sentence.who;
  return <div>
    <p className="flex items-baseline gap-2 font-mono text-[clamp(.95rem,1.5vw,1.3rem)] font-semibold uppercase tracking-[.16em] text-accent-lit max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-1"><span>Things you actually said</span><span className="text-accent-lit/58"><span className="max-[640px]:hidden">· </span>{String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}</span></p>
    <button type="button" onClick={() => setOpen(true)} className="group mt-7 block max-w-[1050px] text-left">
      <h2 className="font-display text-[clamp(2.5rem,7vw,7.6rem)] leading-[.88] tracking-[-.035em] text-white transition group-hover:text-accent-lit">“{item.sentence.body}”</h2>
      <span className="mt-6 inline-flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.16em]" style={{ color: sideVar(side) }}>{names[side]} · {item.category.replaceAll("-", " ")} <span className="text-white/28">context ↗</span></span>
    </button>
    <p className="mt-5 max-w-[64ch] text-sm leading-relaxed text-white/48">{item.explanation}</p>
    {open && <div className="fixed inset-0 z-[90] grid place-items-center bg-night/86 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby={`wild-context-${item.candidateId}`} onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}><section className="rise flex max-h-[86dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-white/14 bg-night text-white shadow-2xl" onClick={(event) => event.stopPropagation()}><header className="flex items-start justify-between gap-5 border-b border-white/12 px-6 py-5 sm:px-8"><div><p className="font-mono text-[8px] uppercase tracking-[.17em] text-accent-lit">Before and after</p><h3 id={`wild-context-${item.candidateId}`} className="mt-2 font-display text-3xl">The sentence in its natural habitat.</h3></div><button type="button" onClick={() => setOpen(false)} aria-label="Close context" className="grid h-10 w-10 place-items-center rounded-full border border-white/16 text-xl text-white/45">×</button></header><ol className="overflow-y-auto px-5 py-6 sm:px-8">{item.context.map((message, index) => <li key={`${message.messageId ?? message.ts}-${index}`} className={`mb-3 flex ${message.who === 0 ? "justify-start" : "justify-end"}`}><div className={`max-w-[88%] ${message.body === item.sentence.body && message.who === item.sentence.who ? "rounded-[18px] ring-1 ring-accent-lit/65" : ""}`}><p className="mb-1 px-1 font-mono text-[8px] uppercase tracking-[.12em]" style={{ color: sideVar(message.who) }}>{names[message.who]} · {new Date(message.ts * 1000).toLocaleString()}</p><p className="whitespace-pre-wrap rounded-[18px] bg-white/[.06] px-4 py-3 text-sm leading-relaxed text-white/76">{message.body}</p></div></li>)}</ol></section></div>}
  </div>;
}

function FinaleSlide({
  analysis,
  names,
  returnHref,
  insightControl,
  shareControl,
  guestControl,
  onRestart,
}: {
  analysis: Analysis;
  names: [string, string];
  returnHref: string | null;
  insightControl?: ReactNode;
  shareControl?: ReactNode;
  guestControl?: ReactNode;
  onRestart: () => void;
}) {
  const words = analysis.volume.words.a + analysis.volume.words.b;
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [shareLineIndex, setShareLineIndex] = useState(0);
  useEffect(() => {
    setHeadlineIndex(Math.floor(Math.random() * 8));
    setShareLineIndex(Math.floor(Math.random() * 5));
  }, []);
  const headlines: ReactNode[] = [
    <>{num(analysis.volume.total)} messages later, <span className="italic text-accent-lit">they still haven&rsquo;t run out of things to say.</span></>,
    <>{num(words)} words, countless side quests, and <span className="italic text-accent-lit">somehow they&rsquo;re still not done.</span></>,
    <>{num(analysis.volume.total)} messages. {num(words)} words. <span className="italic text-accent-lit">Zero signs of shutting up.</span></>,
    <>Yapping, oversharing, and <span className="italic text-accent-lit">suspiciously fast replies.</span></>,
    <>{num(analysis.volume.total)} messages later, <span className="italic text-accent-lit">the lore only got worse.</span></>,
    <>All this talking, and <span className="italic text-accent-lit">still no conclusion.</span></>,
    <>{names[0]} and {names[1]} came, saw, and <span className="italic text-accent-lit">sent {num(analysis.volume.total)} messages.</span></>,
    <>Somehow, {num(words)} words only made <span className="italic text-accent-lit">the lore deeper.</span></>,
  ];
  const shareLines = [
    "This deserves to be seen by the other person.",
    "Send this to your chat partner before they deny everything.",
    "Too much lore to keep to yourself.",
    "Go on. Forward the evidence.",
    "Share it with the co-star of this chaos.",
  ];
  return (
    <div className={insightControl ? "grid items-center gap-9 lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-14" : "text-center"}>
      <div className={insightControl ? "text-left" : undefined}>
        <p className="font-mono text-[clamp(.95rem,1.5vw,1.3rem)] font-semibold uppercase tracking-[.16em] text-accent-lit">Send the receipts</p>
        <h2 className={`mt-5 font-display leading-[.9] tracking-[-.035em] text-white ${insightControl ? "max-w-[760px] text-[clamp(2.5rem,5vw,5.25rem)]" : "mx-auto max-w-[1050px] text-[clamp(2.7rem,6vw,6.4rem)]"}`}>{headlines[headlineIndex]}</h2>
        {guestControl ?? <p className={`${insightControl ? "" : "mx-auto"} mt-8 max-w-[620px] text-[clamp(1.05rem,1.8vw,1.35rem)] font-semibold leading-snug text-white/76`}>{shareLines[shareLineIndex]}</p>}
        <div className={`flex flex-wrap items-center gap-3 ${insightControl ? "mt-6" : "mt-7 justify-center"}`}>
          {shareControl && <div className="wrapped-finale-actions">{shareControl}</div>}
          <button type="button" onClick={onRestart} className="inline-flex items-center gap-2 rounded-full border border-white/18 px-6 py-3.5 text-sm font-semibold text-white/62 transition hover:-translate-y-0.5 hover:border-white/45 hover:text-white"><span aria-hidden="true">↺</span> Replay</button>
          {returnHref && <a href={returnHref} className="inline-flex items-center gap-2 px-4 py-3.5 text-sm font-semibold text-white/42 transition hover:text-white">{returnHref === "/app" ? "Dashboard" : "Home"} <span aria-hidden="true">→</span></a>}
        </div>
      </div>
      {insightControl && (
        <aside className="wrapped-finale-insights max-w-[440px] justify-self-center lg:justify-self-end">
          <p className="mb-3 font-mono text-[9px] uppercase tracking-[.18em] text-white/38">One more layer remains</p>
          {insightControl}
        </aside>
      )}
    </div>
  );
}

function WrappedScreen({ slide, active, index, total, direction }: { slide: WrappedSlideSpec; active: boolean; index: number; total: number; direction: 1 | -1 }) {
  const night = slide.tone === "night";
  const bg = night ? "report-night-slide starfield bg-night" : slide.tone === "shade" ? "bg-shade" : "bg-surface";
  return (
    <section id={slide.id} aria-hidden={!active} className={`wrapped-screen wrapped-variant-${index % 4} absolute inset-0 flex h-dvh w-full overflow-hidden px-5 pb-20 pt-16 sm:px-10 xl:px-20 ${bg} ${active ? `wrapped-active wrapped-${direction === 1 ? "forward" : "reverse"} z-10` : "wrapped-inactive pointer-events-none z-0"}`}>
      <div aria-hidden="true" className="wrapped-atmosphere"><span className="wrapped-orbit" /><span className="wrapped-orbit wrapped-orbit-two" /><span className="wrapped-sweep" /></div>
      <div className="wrapped-content relative m-auto w-full max-w-[1180px]">{slide.content}</div>
      <div className={`absolute bottom-6 left-5 flex items-baseline gap-3 font-mono uppercase sm:left-10 xl:left-20 ${night ? "text-white" : "text-ink"}`}>
        <span className="text-[9px] tracking-[.14em] opacity-30">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        <span className="text-[clamp(.78rem,1.15vw,1rem)] tracking-[.12em] opacity-60 max-[640px]:hidden">{slide.label}</span>
      </div>
    </section>
  );
}

function AiProgressSignal({ state }: { state: AiProgressState }) {
  const working = state.kind === "working";
  const width = working ? Math.max(8, Math.min(100, (state.stage / state.total) * 100)) : 100;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-[4.5rem] z-50 w-[calc(100vw-2.5rem)] -translate-x-1/2 overflow-hidden rounded-full border px-4 py-2.5 shadow-2xl backdrop-blur-xl transition-colors sm:top-5 sm:w-[360px] ${state.kind === "error" ? "border-side-a/45 bg-night/92" : state.kind === "done" ? "border-safe-lit/45 bg-night/92" : "border-accent-lit/30 bg-night/88"}`}
    >
      <div className="flex items-center gap-3">
        <span className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[10px] ${state.kind === "done" ? "border-safe-lit/60 text-safe-lit" : state.kind === "error" ? "border-side-a/60 text-side-a" : "border-accent-lit/55 text-accent-lit"}`}>
          {state.kind === "done" ? "✓" : state.kind === "error" ? "!" : <><span className="absolute inset-1 animate-ping rounded-full bg-accent-lit/30" /><span className="relative">◎</span></>}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[.14em]">
            <span className={state.kind === "done" ? "text-safe-lit" : state.kind === "error" ? "text-side-a" : "text-accent-lit"}>{state.kind === "done" ? "AI insights ready" : state.kind === "error" ? "AI reading stopped" : "AI reading in progress"}</span>
            {working && <span className="text-white/38">{state.stage}/{state.total}</span>}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-white/58">{state.kind === "done" ? "New screens have joined your report." : state.kind === "error" ? "Return to the AI panel to try again." : state.label}</p>
        </div>
      </div>
      <span className={`absolute inset-x-0 bottom-0 h-px origin-left transition-[width] duration-700 ${state.kind === "error" ? "bg-side-a" : state.kind === "done" ? "bg-safe-lit" : "bg-accent-lit"}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Report({
  analysis,
  deck,
  llm,
  control,
  endControl,
  guestFinalControl,
  coverActions,
  backHref = "/app",
  visibilityLabel = "Private",
  promptInsightsAtEnd = false,
  doubleTextMessages,
  localEvidenceKey,
  extremeEvidence,
  aiProgress,
  stickerVisuals,
}: {
  analysis: Analysis;
  deck: DeckCard[];
  llm: WirePayload | null;
  control?: ReactNode;
  endControl?: ReactNode;
  guestFinalControl?: ReactNode;
  coverActions?: ReactNode;
  backHref?: string | null;
  visibilityLabel?: string;
  /** Signed-in viewers without an AI reading get a final opt-in on the finale. */
  promptInsightsAtEnd?: boolean;
  doubleTextMessages?: LocalStreakMessage[];
  /** Report id used only to retrieve locally stored evidence in this browser. */
  localEvidenceKey?: string;
  extremeEvidence?: LocalExtremeEvidence;
  /** Persistent AI status shown above every Wrapped screen. */
  aiProgress?: AiProgressState;
  stickerVisuals?: LocalStickerVisuals;
}) {
  const names = displayNames(analysis.chat.participants);
  const timelineBase = deck.find((c): c is DeckCard & { kind: "timeline" } => c.kind === "timeline");
  const timeline = llm?.eraChapters && llm.eraChapters.length > 1
    ? {
        kind: "timeline" as const,
        id: "timeline" as const,
        kicker: "In chapters",
        headline: `${llm.eraChapters.filter((chapter) => chapter.kind === "era" && !chapter.quiet).length} distinct eras`,
        detail: "Split where the weekly shape or subject of the conversation materially changed.",
        chapters: llm.eraChapters,
      }
    : timelineBase;
  const words = deck.find((c): c is DeckCard & { kind: "words" } => c.kind === "words");
  const [storedDoubleTextMessages, setStoredDoubleTextMessages] = useState<LocalStreakMessage[] | undefined>();
  const [storedExtremeEvidence, setStoredExtremeEvidence] = useState<LocalExtremeEvidence | undefined>();
  const [storedStickerVisuals, setStoredStickerVisuals] = useState<LocalStickerVisuals | undefined>();
  useEffect(() => {
    const receive = (event: Event) => setStoredStickerVisuals((event as CustomEvent<LocalStickerVisuals>).detail);
    window.addEventListener(TELESCOPE_STICKER_VISUALS_EVENT, receive);
    return () => window.removeEventListener(TELESCOPE_STICKER_VISUALS_EVENT, receive);
  }, []);
  const [savedCompletion, setSavedCompletion] = useState(false);
  const [showInlineCompletion, setShowInlineCompletion] = useState(false);
  const [externalAiProgress, setExternalAiProgress] = useState<AiProgressState | undefined>();
  useEffect(() => {
    const receive = (event: Event) => setExternalAiProgress((event as CustomEvent<AiProgressState>).detail);
    window.addEventListener(TELESCOPE_AI_PROGRESS_EVENT, receive);
    return () => window.removeEventListener(TELESCOPE_AI_PROGRESS_EVENT, receive);
  }, []);
  useEffect(() => {
    if (externalAiProgress?.kind !== "done") return;
    const timeout = window.setTimeout(() => setExternalAiProgress(undefined), 6000);
    return () => window.clearTimeout(timeout);
  }, [externalAiProgress]);
  useEffect(() => {
    if (aiProgress?.kind !== "done") {
      setShowInlineCompletion(false);
      return;
    }
    setShowInlineCompletion(true);
    const timeout = window.setTimeout(() => setShowInlineCompletion(false), 6000);
    return () => window.clearTimeout(timeout);
  }, [aiProgress]);
  useEffect(() => {
    if (!localEvidenceKey) return;
    const key = `telescope:ai-ready:${localEvidenceKey}`;
    try {
      if (sessionStorage.getItem(key)) {
        sessionStorage.removeItem(key);
        setSavedCompletion(true);
        const timeout = window.setTimeout(() => setSavedCompletion(false), 6000);
        return () => window.clearTimeout(timeout);
      }
    } catch {
      // A completion flourish is optional when browser storage is unavailable.
    }
  }, [localEvidenceKey]);
  useEffect(() => {
    if (doubleTextMessages || !localEvidenceKey) return;
    try {
      const saved = localStorage.getItem(`telescope:double-text:${localEvidenceKey}`);
      if (saved) setStoredDoubleTextMessages(JSON.parse(saved) as LocalStreakMessage[]);
    } catch {
      // Local evidence is optional; a corrupt or unavailable browser store must
      // never make the report itself unreadable.
    }
  }, [doubleTextMessages, localEvidenceKey]);
  useEffect(() => {
    if (extremeEvidence || !localEvidenceKey) return;
    try {
      const saved = localStorage.getItem(`telescope:extremes:${localEvidenceKey}`);
      if (saved) setStoredExtremeEvidence(JSON.parse(saved) as LocalExtremeEvidence);
    } catch {
      // Local evidence is optional and must never block the report.
    }
  }, [extremeEvidence, localEvidenceKey]);
  useEffect(() => {
    if (stickerVisuals || !localEvidenceKey) return;
    try {
      const saved = localStorage.getItem(`telescope:stickers:${localEvidenceKey}`);
      if (saved) setStoredStickerVisuals(JSON.parse(saved) as LocalStickerVisuals);
    } catch { /* Sticker art is optional browser-local context. */ }
  }, [localEvidenceKey, stickerVisuals]);
  const visibleDoubleTextMessages = doubleTextMessages ?? storedDoubleTextMessages;
  const visibleExtremeEvidence = extremeEvidence ?? storedExtremeEvidence;
  const visibleStickerVisuals = stickerVisuals ?? storedStickerVisuals;
  const vocabularyReading = llm?.findings.find((f) => f.metric === "vocabulary");
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const restart = useCallback(() => {
    setDirection(-1);
    setCurrent(0);
  }, []);
  const slides = useMemo<WrappedSlideSpec[]>(() => {
    const out: WrappedSlideSpec[] = [
      {
        id: "opening",
        label: "opening",
        tone: "night",
        content: (
          <div>
            <div className="flex justify-end"><span className="hidden font-mono text-[9px] uppercase tracking-[.18em] text-white/30 sm:inline">{visibilityLabel} · read locally</span></div>
            <div className={`mt-[clamp(2.5rem,9vh,6.5rem)] ${control ? "grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-12" : ""}`}>
              <div>
                <p className="font-mono text-[clamp(.95rem,1.5vw,1.3rem)] font-semibold uppercase tracking-[.16em] text-accent-lit">Your conversation report</p>
                <h1 className={`mt-5 font-display leading-[.78] tracking-[-.045em] text-white ${control ? "text-[clamp(3.6rem,8vw,8.5rem)]" : "text-[clamp(4rem,10vw,10rem)]"}`}>{names[0]} <span className="text-accent-lit">&amp;</span><br /><span className="italic">{names[1]}</span></h1>
                <p className="mt-7 max-w-[620px] text-lg text-white/48">Everything here was computed from {num(analysis.volume.total)} messages. The raw conversation stays on your machine.</p>
              </div>
              {control && <aside className="max-w-[440px] lg:justify-self-end">{control}</aside>}
            </div>
          </div>
        ),
      },
      { id: "overview", label: "at a glance", tone: "night", content: <OverviewSlide analysis={analysis} names={names} /> },
      { id: "yapper", label: "the yapper split", tone: "light", content: <YapperSlide analysis={analysis} names={names} /> },
      { id: "who-starts", label: "who starts it", tone: "light", content: <WhoStartsSlide analysis={analysis} names={names} /> },
      ...(analysis.rhythm.doubleTexting ? [{ id: "double-texting", label: "double texter award", tone: "night" as const, content: <DoubleTexterSlide analysis={analysis} names={names} messages={visibleDoubleTextMessages} /> }] : []),
      { id: "months", label: "your year in messages", tone: "night", content: <MonthlyChart analysis={analysis} names={names} /> },
      { id: "concentration", label: "where it happened", tone: "night", content: <ConcentrationSlide analysis={analysis} /> },
      { id: "hours", label: "when you talk", tone: "night", content: <HoursChart analysis={analysis} names={names} /> },
    ];
    if (timeline && llm) out.push({ id: "eras", label: "your eras", tone: "light", content: <EraWrappedSlide card={timeline} notes={llm.chapterNotes} modelAssisted names={names} /> });
    out.push({ id: "dialects", label: "how you speak", tone: "night", content: <CommunicationSlide analysis={analysis} names={names} stickerVisuals={visibleStickerVisuals} /> });
    if (words) out.push({ id: "language", label: "your language", tone: "night", content: <LanguageSlide card={words} names={names} reading={vocabularyReading} selection={llm?.language} /> });
    if (llm?.motifs[0]) out.push({ id: "lore", label: "the lore", tone: "night", content: <LoreSlide motifs={llm.motifs} names={names} /> });
    if (llm?.topics.length) out.push({ id: "topics", label: "what you talk about", tone: "light", content: <TopicsWrappedSlide topics={llm.topics} /> });
    if (llm?.wildSentences?.length) {
      const seenMessages = new Set<string>();
      const seenSentences = new Set<string>();
      const uniqueWild = llm.wildSentences.filter((item) => {
        const messageKey = item.sentence.messageId === null ? `time:${item.sentence.ts}:${item.sentence.who}` : `message:${item.sentence.messageId}`;
        const sentenceKey = item.sentence.body.toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
        if (seenMessages.has(messageKey) || seenSentences.has(sentenceKey)) return false;
        seenMessages.add(messageKey);
        seenSentences.add(sentenceKey);
        return true;
      });
      uniqueWild.forEach((item, index) => out.push({ id: `wild-${index + 1}`, label: "things you actually said", tone: "night", content: <WildSentenceSlide item={item} names={names} position={index + 1} total={uniqueWild.length} /> }));
    }
    if (llm?.dynamics.length) out.push({ id: "dynamics", label: "how the exchange works", tone: "night", content: <DynamicsWrappedSlide dynamics={llm.dynamics} names={names} /> });
    out.push(
      { id: "extremes", label: "the extremes", tone: "light", content: <ExtremesWrappedSlide analysis={analysis} names={names} evidence={visibleExtremeEvidence} /> },
    );
    if (llm?.roles && (llm.roles.a.length || llm.roles.b.length)) out.push({ id: "characters", label: "character cards", tone: "night", content: <CharacterSlide roles={llm.roles} names={names} /> });
    if (endControl) out.push({ id: "save-report", label: "save and share", tone: "night", content: <div className="mx-auto max-w-[900px]">{endControl}</div> });
    out.push({ id: "finale", label: "the final word", tone: "night", content: <FinaleSlide analysis={analysis} names={names} returnHref={backHref} insightControl={promptInsightsAtEnd && !llm ? control : undefined} shareControl={coverActions} guestControl={guestFinalControl} onRestart={restart} /> });
    return out;
  }, [analysis, backHref, control, coverActions, deck, endControl, guestFinalControl, llm, names, promptInsightsAtEnd, restart, timeline, visibilityLabel, visibleDoubleTextMessages, visibleExtremeEvidence, visibleStickerVisuals, vocabularyReading, words]);

  const touchStart = useRef<number | null>(null);
  const go = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(slides.length - 1, next));
    if (bounded === current) return;
    setDirection(bounded > current ? 1 : -1);
    setCurrent(bounded);
  }, [current, slides.length]);
  const advance = useCallback(() => go(current + 1), [current, go]);
  const retreat = useCallback(() => go(current - 1), [current, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); advance(); }
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); retreat(); }
      if (event.key === "Home") go(0);
      if (event.key === "End") go(slides.length - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, go, retreat, slides.length]);

  const clickAdvance = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a,button,input,textarea,select,[role='button'],[role='dialog']")) return;
    advance();
  };

  return (
    <main aria-label="Your conversation report" className="relative h-dvh overflow-hidden bg-night" onClick={clickAdvance} onTouchStart={(e) => { touchStart.current = e.touches[0]?.clientX ?? null; }} onTouchEnd={(e) => { if (touchStart.current === null) return; const delta = (e.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current; if (Math.abs(delta) > 45) delta < 0 ? advance() : retreat(); touchStart.current = null; }}>
      {slides.map((slide, index) => <WrappedScreen key={slide.id} slide={slide} active={index === current} index={index} total={slides.length} direction={direction} />)}
      {backHref && <div className="fixed left-5 top-5 z-40 flex items-center gap-3 sm:left-10">
        <a href={backHref} aria-label={backHref === "/app" ? "Back to dashboard" : "Back home"} className="report-back-button inline-flex h-11 items-center gap-2.5 rounded-full border border-white/14 bg-night/72 px-4 font-mono text-[9px] uppercase tracking-[.16em] text-white/58 backdrop-blur transition hover:border-accent-lit hover:text-white">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-none stroke-current" strokeWidth="1.7"><path d="M19 12H5m0 0 5-5m-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{backHref === "/app" ? "Dashboard" : "Home"}</span>
        </a>
      </div>}
      {coverActions && <div className={`report-cover-actions fixed right-5 top-5 z-40 sm:right-10 ${slides[current]?.tone === "light" ? "report-actions-light" : ""}`}>{coverActions}</div>}
      {(((externalAiProgress ?? aiProgress) && (externalAiProgress ?? aiProgress)?.kind !== "done") || showInlineCompletion || savedCompletion || externalAiProgress?.kind === "done") && (
        <AiProgressSignal state={showInlineCompletion || savedCompletion || externalAiProgress?.kind === "done" ? { kind: "done" } : (externalAiProgress ?? aiProgress)!} />
      )}
      <div className="fixed inset-x-0 bottom-0 z-30 h-1 bg-white/8"><span key={current} className="wrapped-progress-fill block h-full bg-accent-lit transition-[width] duration-500" style={{ width: `${((current + 1) / slides.length) * 100}%` }} /></div>
      <nav aria-label="Report navigation" className="fixed bottom-5 right-5 z-40 flex items-center gap-2 sm:right-10">
        <button type="button" onClick={retreat} disabled={current === 0} aria-label="Previous screen" className="grid h-11 w-11 place-items-center rounded-full border border-white/16 bg-night/70 text-white/70 backdrop-blur transition hover:border-accent-lit hover:text-white disabled:pointer-events-none disabled:opacity-20">←</button>
        <button type="button" onClick={advance} disabled={current === slides.length - 1} aria-label="Next screen" className="grid h-11 w-11 place-items-center rounded-full border border-white/16 bg-night/70 text-white/70 backdrop-blur transition hover:border-accent-lit hover:text-white disabled:pointer-events-none disabled:opacity-20">→</button>
      </nav>
    </main>
  );
}
