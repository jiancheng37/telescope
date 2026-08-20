/**
 * The handful of shapes the design repeats.
 *
 * The mockups are one long HTML file with every style inline, so the same card
 * chrome, the same mono kicker and the same telescope mark appear a dozen times
 * each with small accidental differences. These are the deliberate versions:
 * change the radius here and it changes everywhere, which is the whole reason
 * this file exists rather than the classes being pasted at each call site.
 *
 * No data, no state, no imports outside React — a panel does not need to know
 * what a conversation is.
 */
import type { ReactNode } from "react";

// ------------------------------------------------------------------ the mark

/**
 * The telescope: a lens with an aperture and four cardinal ticks.
 *
 * `tone` picks the two colours rather than taking them as props, because the
 * only two versions that exist are "on paper" and "on night sky" and a third
 * one would be a mistake rather than a feature.
 */
export function Logo({ size = 26, tone = "ink" }: { size?: number; tone?: "ink" | "night" | "accent" }) {
  const stroke = tone === "ink" ? "#17212B" : tone === "accent" ? "#168ACD" : "#FFFFFF";
  const fill = tone === "accent" ? "#2AABEE" : "#2AABEE";
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="11" stroke={stroke} strokeWidth="1.4" />
      <circle cx="13" cy="13" r="4" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <path d="M13 0v6M13 20v6M0 13h6M20 13h6" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

/** The shield-and-tick that sits next to every privacy line. */
export function Shield({ size = 15, tone = "safe" }: { size?: number; tone?: "safe" | "deep" }) {
  const c = tone === "safe" ? "#12A489" : "#0E7F6B";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="mt-px shrink-0"
    >
      <path d="M8 1.5 13 3.5v4c0 3.3-2.1 6.1-5 7-2.9-.9-5-3.7-5-7v-4L8 1.5Z" stroke={c} strokeWidth="1.3" />
      <path d="m5.6 8 1.7 1.7L10.6 6" stroke={c} strokeWidth="1.4" />
    </svg>
  );
}

// ------------------------------------------------------------------- lettering

/** Mono, uppercase, wide-tracked. Sits above a headline and labels the thing. */
export function Kicker({
  children,
  tone = "accent",
  className = "",
}: {
  children: ReactNode;
  tone?: "accent" | "deep" | "lit" | "faint" | "faint-lit";
  className?: string;
}) {
  const colour =
    tone === "accent"
      ? "text-accent"
      : tone === "deep"
        ? "text-accent-deep"
        : tone === "lit"
          ? "text-accent-lit"
          : tone === "faint"
            ? "text-ink/45"
            : "text-white/40";
  return (
    <p className={`font-mono text-[10px] uppercase tracking-[0.16em] ${colour} ${className}`}>{children}</p>
  );
}

/** A serif headline inside a card. Cards use this; page sections don't. */
export function CardTitle({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "night" }) {
  return (
    <h3
      className={`font-display text-2xl leading-none ${tone === "ink" ? "text-ink" : "text-white"} sm:text-[26px]`}
    >
      {children}
    </h3>
  );
}

/** The small grey line of prose at the bottom of a card. */
export function Note({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "night" }) {
  return (
    <p className={`text-[13.5px] leading-relaxed ${tone === "ink" ? "text-ink/60" : "text-white/55"}`}>
      {children}
    </p>
  );
}

// --------------------------------------------------------------------- panels

/**
 * The light card. `tone` chooses between the two paper greys the design uses —
 * `card` for content, `shade` for something set aside from the content.
 */
export function Panel({
  children,
  tone = "card",
  className = "",
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  tone?: "card" | "shade" | "surface" | "outline";
  className?: string;
  as?: "div" | "section" | "aside";
  id?: string;
}) {
  const bg =
    tone === "card"
      ? "bg-card"
      : tone === "shade"
        ? "bg-shade"
        : tone === "surface"
          ? "bg-surface"
          : "bg-transparent";
  return (
    <Tag id={id} className={`rounded-xl border border-ink/13 ${bg} p-5 sm:p-6 ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * The dark card. Always `relative` and always starfielded: in the mockups every
 * night panel has the stars, and one without them looks like a bug.
 */
export function NightPanel({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "aside";
}) {
  return (
    <Tag className={`starfield relative overflow-hidden rounded-xl bg-night p-5 sm:p-6 ${className}`}>
      <div className="relative">{children}</div>
    </Tag>
  );
}

/** Pill. `solid` is the primary action, `hollow` the secondary. */
export function Pill({
  children,
  tone = "solid",
  className = "",
}: {
  children: ReactNode;
  tone?: "solid" | "hollow" | "hollow-night";
  className?: string;
}) {
  const style =
    tone === "solid"
      ? "bg-ink text-white"
      : tone === "hollow"
        ? "border border-ink/28 text-ink"
        : "border border-white/28 text-white";
  return (
    <span
      className={`inline-flex items-center rounded-full px-5 py-3 text-sm font-semibold ${style} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * One number and its label. The design's stat strips are `gap-px` over an
 * ink-alpha background, so the hairlines between cells are the parent showing
 * through rather than borders that double up at the seams.
 */
export function StatStrip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-wrap gap-px overflow-hidden rounded-xl border border-ink/14 bg-ink/14 ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({
  value,
  label,
  tone = "ink",
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "ink" | "side-a" | "side-b" | "accent";
}) {
  const colour =
    tone === "ink"
      ? "text-ink"
      : tone === "side-a"
        ? "text-side-a"
        : tone === "side-b"
          ? "text-side-b"
          : "text-accent";
  return (
    <div className="flex-1 bg-card px-5 py-4">
      <div className={`font-display text-[30px] leading-none ${colour} tnum`}>{value}</div>
      <div className="mt-1 text-[11.5px] leading-tight text-ink/55">{label}</div>
    </div>
  );
}

/** The same thing on a night panel, where the hairlines aren't wanted. */
export function NightStat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div>
      <div className="font-display text-[27px] leading-none text-white tnum">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-white/50">{label}</div>
    </div>
  );
}

/**
 * The accent aside: a tinted block with a rule down its left edge, used for the
 * one sentence that says what a chart means.
 */
export function Callout({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "safe" }) {
  return tone === "accent" ? (
    <div className="border-l-2 border-accent-lit bg-accent-lit/14 px-4 py-3 text-sm leading-relaxed text-ink/78">
      {children}
    </div>
  ) : (
    <div className="flex gap-3 rounded-[10px] border border-safe/35 bg-safe/14 px-4 py-3.5">
      <Shield tone="deep" size={16} />
      <div className="text-[13.5px] leading-relaxed text-safe-deep">{children}</div>
    </div>
  );
}

/**
 * A labelled horizontal bar with its value on the right.
 *
 * `share` is the fraction of the track to fill and is clamped, because a
 * proportion computed from real data occasionally comes back at 1.0000001 and
 * an overflowing bar looks like a rendering bug rather than a rounding one.
 */
export function Bar({
  label,
  value,
  share,
  colour,
  tone = "ink",
}: {
  label: ReactNode;
  value: ReactNode;
  share: number;
  /** a literal CSS colour: bar widths and fills are data, so they're inline */
  colour: string;
  tone?: "ink" | "night";
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-24 shrink-0 text-[13px] leading-tight ${tone === "ink" ? "text-ink/60" : "text-white/60"}`}
      >
        {label}
      </span>
      <span
        className={`h-[22px] flex-1 overflow-hidden rounded ${tone === "ink" ? "bg-ink/8" : "bg-white/10"}`}
      >
        <span className="block h-[22px] rounded-r" style={{ width: `${pct}%`, background: colour }} />
      </span>
      <span
        className={`w-16 shrink-0 text-right font-mono text-xs tnum ${tone === "ink" ? "text-ink" : "text-white"}`}
      >
        {value}
      </span>
    </div>
  );
}
