/** Small numeric helpers. Nothing here knows about Telegram. */
import type { Pair } from "./types";

/**
 * Is this asymmetry big enough to build a card on? Below this the two numbers are
 * the same number and any story told about the difference is a story about noise.
 *
 * Lives here rather than next to either consumer because both the brief and the UI
 * have to answer it identically — a card the model was told not to make is worse
 * than no card, and so is a card the UI shows that the brief called flat.
 */
export function isAsymmetric(p: Pair<number>, minRatio = 1.3): boolean {
  const lo = Math.min(p.a, p.b);
  const hi = Math.max(p.a, p.b);
  if (hi === 0) return false;
  return lo === 0 ? hi >= 5 : hi / lo >= minRatio;
}

/**
 * Floors on being worth saying, for the handful of metrics whose usefulness
 * depends on the chat rather than on the metric.
 *
 * These are interestingness thresholds, not significance tests. Opens and closes
 * are the clearest case: they're shares of one fixed total, so across a few
 * hundred bursts a 59/41 split is statistically real and still not worth a card.
 *
 * Shared by the brief and the UI on purpose. Showing the reader a card that the
 * brief told the model was flat is the one inconsistency that would make both
 * halves look untrustworthy at once.
 */
export const CARD_FLOORS = {
  /** how far the reply-speed ratio must sit from 1.0 before it means anything */
  latencyBand: 0.15,
  questionRatio: 1.4,
  lateNightRatio: 1.5,
  /** below this share, a late-night difference is a handful of messages */
  lateNightFloor: 0.02,
  openCloseRatio: 1.5,
} as const;

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/** `xs` need not be sorted. Linear interpolation between neighbours. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Guards against division by zero, which shows up constantly in ratio metrics. */
export function ratio(a: number, b: number): number {
  return b === 0 ? (a === 0 ? 1 : Infinity) : a / b;
}

export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * Log-odds ratio with an informative Dirichlet prior (Monroe, Colaresi & Quinn
 * 2008). This is the right tool for "which words are characteristic of speaker
 * A rather than speaker B" — raw frequency just returns stopwords, and plain
 * log-odds is unstable for rare words.
 *
 * Returns a z-score: positive means characteristic of A, negative of B.
 */
export function logOddsZ(
  countsA: Map<string, number>,
  countsB: Map<string, number>,
  opts: { minTotal?: number; priorStrength?: number } = {},
): Array<{ word: string; z: number; countA: number; countB: number }> {
  const { minTotal = 20, priorStrength: a0 = 500 } = opts;

  const combined = new Map<string, number>();
  for (const [w, c] of countsA) combined.set(w, (combined.get(w) ?? 0) + c);
  for (const [w, c] of countsB) combined.set(w, (combined.get(w) ?? 0) + c);

  const nTotal = sum([...combined.values()]);
  const nA = sum([...countsA.values()]);
  const nB = sum([...countsB.values()]);
  if (nTotal === 0) return [];

  const out: Array<{ word: string; z: number; countA: number; countB: number }> = [];
  for (const [word, total] of combined) {
    if (total < minTotal) continue;
    const ai = (a0 * total) / nTotal;
    const yA = countsA.get(word) ?? 0;
    const yB = countsB.get(word) ?? 0;
    const lA = Math.log((yA + ai) / (nA + a0 - yA - ai));
    const lB = Math.log((yB + ai) / (nB + a0 - yB - ai));
    const variance = 1 / (yA + ai) + 1 / (yB + ai);
    out.push({ word, z: (lA - lB) / Math.sqrt(variance), countA: yA, countB: yB });
  }
  return out.sort((x, y) => y.z - x.z);
}

/**
 * Binary segmentation change-point detection: repeatedly split the series at
 * the point that most reduces within-segment sum of squared error, stopping
 * when the best available split no longer buys `minGainShare` of the total.
 *
 * Returns segment boundary indices including 0 and series.length.
 */
export function segment(
  series: number[],
  opts: { minSegmentLength?: number; maxSplits?: number; minGainShare?: number } = {},
): number[] {
  const { minSegmentLength = 2, maxSplits = 8, minGainShare = 0.025 } = opts;
  const n = series.length;
  if (n < minSegmentLength * 2) return [0, n];

  const sse = (a: number, b: number): number => {
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += series[i];
    const mu = s / (b - a);
    let e = 0;
    for (let i = a; i < b; i++) e += (series[i] - mu) ** 2;
    return e;
  };

  const total = sse(0, n);
  const bounds = [0, n];
  for (let split = 0; split < maxSplits; split++) {
    let best: { gain: number; at: number } | null = null;
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i];
      const b = bounds[i + 1];
      const base = sse(a, b);
      for (let c = a + minSegmentLength; c <= b - minSegmentLength; c++) {
        const gain = base - sse(a, c) - sse(c, b);
        if (!best || gain > best.gain) best = { gain, at: c };
      }
    }
    // `gain <= 0` is checked separately from the share threshold because a
    // perfectly flat series has total SSE of zero, and `0 < 0.025 * 0` is false
    // — without this it would keep splitting a steady conversation into eras
    // that differ in nothing.
    if (!best || best.gain <= 0 || best.gain < minGainShare * total) break;
    bounds.push(best.at);
    bounds.sort((x, y) => x - y);
  }
  return bounds;
}
