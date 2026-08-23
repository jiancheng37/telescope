import { SESSION_GAP_MIN } from "./sessions";
import { maximum, mean, median, quantile, ratio, share } from "./stats";
import type {
  LatencyStats,
  DoubleTextingStats,
  Message,
  MonologueStats,
  Pair,
  RevivalStats,
  Rhythm,
  Side,
  Silence,
} from "./types";

const DAY = 86400;

/** Hours counted as "late night" for the after-midnight card. */
const LATE_NIGHT_HOURS = [0, 1, 2, 3, 4];

function emptyPair<T>(make: () => T): Pair<T> {
  return { a: make(), b: make() };
}

function key(side: Side): "a" | "b" {
  return side === 0 ? "a" : "b";
}

/**
 * Time between one person's message and the other's next message.
 *
 * Worth knowing before you build a card on this: in a chat that happens in
 * bursts rather than continuously, both medians collapse to a few seconds and
 * the asymmetry vanishes. Check `latencyAsymmetry` before showing it.
 */
export function replyLatency(messages: Message[]): { latency: Pair<LatencyStats>; asymmetry: number } {
  const all = emptyPair<number[]>(() => []);
  const inSession = emptyPair<number[]>(() => []);

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const m = messages[i];
    if (m.who === prev.who) continue;
    const gap = m.ts - prev.ts;
    all[key(m.who)].push(gap);
    if (gap <= SESSION_GAP_MIN * 60) inSession[key(m.who)].push(gap);
  }

  const stats = (gaps: number[], within: number[]): LatencyStats => ({
    n: gaps.length,
    medianSec: median(gaps),
    p75Sec: quantile(gaps, 0.75),
    p90Sec: quantile(gaps, 0.9),
    inSessionMedianSec: median(within),
  });

  const latency: Pair<LatencyStats> = {
    a: stats(all.a, inSession.a),
    b: stats(all.b, inSession.b),
  };
  return { latency, asymmetry: ratio(latency.a.medianSec, latency.b.medianSec) };
}

/**
 * Consecutive messages from the same person with no reply in between. This is
 * the metric that survives a bursty chat: it measures turn-taking shape without
 * reference to the clock.
 */
export function monologues(messages: Message[]): Pair<MonologueStats> {
  const runs = emptyPair<number[]>(() => []);
  const runMessages = emptyPair<Message[][]>(() => []);
  const totals = { a: 0, b: 0 };

  let length = 1;
  let start = 0;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].who === messages[i - 1].who) {
      length++;
    } else {
      runs[key(messages[i - 1].who)].push(length);
      runMessages[key(messages[i - 1].who)].push(messages.slice(start, i));
      length = 1;
      start = i;
    }
  }
  if (messages.length) {
    runs[key(messages[messages.length - 1].who)].push(length);
    runMessages[key(messages[messages.length - 1].who)].push(messages.slice(start));
  }
  for (const m of messages) totals[key(m.who)]++;

  const stats = (rs: number[], messageCount: number, messageRuns: Message[][]): MonologueStats => {
    const long = rs.filter((r) => r >= 3);
    const longest = [...messageRuns].sort((a, b) => b.length - a.length || (b[b.length - 1]?.ts - b[0]?.ts) - (a[a.length - 1]?.ts - a[0]?.ts))[0];
    return {
      runs: rs.length,
      meanRunLength: mean(rs),
      maxRunLength: maximum(rs),
      shareOfRunsOver3: share(long.length, rs.length),
      runsOver8: rs.filter((r) => r >= 8).length,
      shareOfMessagesInRuns: share(
        long.reduce((a, b) => a + b, 0),
        messageCount,
      ),
      ...(longest?.length ? { longestRun: { messageIds: longest.map((message) => message.id), startTs: longest[0].ts, endTs: longest[longest.length - 1].ts } } : {}),
    };
  };

  return { a: stats(runs.a, totals.a, runMessages.a), b: stats(runs.b, totals.b, runMessages.b) };
}

/**
 * A double text is exactly the product definition: another message from the
 * same sender, with no reply in between, at least two minutes after their prior
 * message. There is deliberately no upper time limit.
 */
export function doubleTexting(messages: Message[], minGapSeconds = 120): DoubleTextingStats {
  const frequency = { a: 0, b: 0 };
  let longest: DoubleTextingStats["longest"] = null;

  for (let start = 0; start < messages.length; ) {
    let end = start + 1;
    while (end < messages.length && messages[end].who === messages[start].who) end++;

    let qualifying = 0;
    for (let i = start + 1; i < end; i++) {
      if (messages[i].ts - messages[i - 1].ts >= minGapSeconds) qualifying++;
    }
    frequency[key(messages[start].who)] += qualifying;

    if (qualifying > 0) {
      const candidate = {
        who: messages[start].who,
        doubleTexts: qualifying,
        messages: end - start,
        startTs: messages[start].ts,
        endTs: messages[end - 1].ts,
        messageIds: messages.slice(start, end).map((message) => message.id),
      };
      const candidateDuration = candidate.endTs - candidate.startTs;
      const longestDuration = longest ? longest.endTs - longest.startTs : -1;
      if (!longest || candidate.doubleTexts > longest.doubleTexts || (candidate.doubleTexts === longest.doubleTexts && candidateDuration > longestDuration)) {
        longest = candidate;
      }
    }
    start = end;
  }

  return { frequency, longest };
}

export function hourHistogram(messages: Message[]): Pair<number[]> {
  const hist = emptyPair<number[]>(() => new Array(24).fill(0));
  for (const m of messages) hist[key(m.who)][new Date(m.ts * 1000).getHours()]++;
  return hist;
}

export function weekdayHistogram(messages: Message[]): Pair<number[]> {
  const hist = emptyPair<number[]>(() => new Array(7).fill(0));
  for (const m of messages) hist[key(m.who)][new Date(m.ts * 1000).getDay()]++;
  return hist;
}

export function lateNightShare(hist: Pair<number[]>): Pair<number> {
  const forSide = (h: number[]) => {
    const total = h.reduce((a, b) => a + b, 0);
    const late = LATE_NIGHT_HOURS.reduce((a, hour) => a + h[hour], 0);
    return share(late, total);
  };
  return { a: forSide(hist.a), b: forSide(hist.b) };
}

/** Every gap in the conversation longer than a day, longest first. */
export function silences(messages: Message[], minDays = 1): Silence[] {
  const out: Silence[] = [];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const m = messages[i];
    const days = (m.ts - prev.ts) / DAY;
    if (days < minDays) continue;
    out.push({
      days,
      fromTs: prev.ts,
      toTs: m.ts,
      wentQuiet: prev.who,
      revivedBy: m.who,
      lastMessageId: prev.id,
      firstMessageId: m.id,
    });
  }
  return out.sort((x, y) => y.days - x.days);
}

/**
 * Who ends silences, and who lets them start — measured at several thresholds
 * because the answer can differ between "went quiet for a week" and "went
 * quiet for two months", and a finding that holds at every threshold is worth
 * more than one that only appears at a convenient cutoff.
 */
export function revival(messages: Message[], thresholds = [2 / 24, 7, 14, 30, 60]): RevivalStats[] {
  return thresholds.map((thresholdDays) => {
    const revivedBy = { a: 0, b: 0 };
    const wentQuiet = { a: 0, b: 0 };
    let n = 0;
    for (let i = 1; i < messages.length; i++) {
      if ((messages[i].ts - messages[i - 1].ts) / DAY <= thresholdDays) continue;
      n++;
      revivedBy[key(messages[i].who)]++;
      wentQuiet[key(messages[i - 1].who)]++;
    }
    return { thresholdDays, n, revivedBy, wentQuiet };
  });
}

export function dormancy(messages: Message[], gapDays = 14): { dormantDays: number; dormantShare: number } {
  if (messages.length < 2) return { dormantDays: 0, dormantShare: 0 };
  let dormant = 0;
  for (let i = 1; i < messages.length; i++) {
    const gap = (messages[i].ts - messages[i - 1].ts) / DAY;
    if (gap > gapDays) dormant += gap;
  }
  const span = (messages[messages.length - 1].ts - messages[0].ts) / DAY;
  return { dormantDays: dormant, dormantShare: share(dormant, span) };
}

export function buildRhythm(messages: Message[]): Rhythm {
  const { latency, asymmetry } = replyLatency(messages);
  const hist = hourHistogram(messages);
  const { dormantDays, dormantShare } = dormancy(messages);
  return {
    latency,
    latencyAsymmetry: asymmetry,
    monologues: monologues(messages),
    hourHistogram: hist,
    weekdayHistogram: weekdayHistogram(messages),
    lateNightShare: lateNightShare(hist),
    longestSilences: silences(messages).slice(0, 15),
    revival: revival(messages),
    doubleTexting: doubleTexting(messages),
    dormantDays,
    dormantShare,
  };
}
