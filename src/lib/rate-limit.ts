import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export type RateLimitAction = "analysis-create" | "analysis-uploaded" | "analysis-poll";

type RateLimitRule = {
  limit: number;
  windowMs: number;
  window: `${number} ${"s" | "m" | "h" | "d"}`;
  failClosed: boolean;
};

type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

const RULES: Record<RateLimitAction, RateLimitRule> = {
  "analysis-create": { limit: 5, windowMs: 60_000, window: "1 m", failClosed: true },
  "analysis-uploaded": { limit: 10, windowMs: 60_000, window: "1 m", failClosed: true },
  "analysis-poll": { limit: 30, windowMs: 60_000, window: "1 m", failClosed: false },
};

type MemoryBuckets = Map<string, number[]>;

const globalForRateLimit = globalThis as typeof globalThis & {
  telescopeRateLimitBuckets?: MemoryBuckets;
};

const memoryBuckets = globalForRateLimit.telescopeRateLimitBuckets ?? new Map();
globalForRateLimit.telescopeRateLimitBuckets = memoryBuckets;

const productionLimiters = new Map<RateLimitAction, Ratelimit>();

function environmentName() {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

function memoryLimit(action: RateLimitAction, identifier: string, now = Date.now()): RateLimitResult {
  const rule = RULES[action];
  const key = `${environmentName()}:${action}:${identifier}`;
  const cutoff = now - rule.windowMs;
  const timestamps: number[] = memoryBuckets.get(key) ?? [];
  const recent = timestamps.filter((timestamp) => timestamp > cutoff);
  const success = recent.length < rule.limit;
  if (success) recent.push(now);
  memoryBuckets.set(key, recent);
  return {
    success,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - recent.length),
    reset: (recent[0] ?? now) + rule.windowMs,
  };
}

function productionLimiter(action: RateLimitAction) {
  const existing = productionLimiters.get(action);
  if (existing) return existing;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis rate limiting is not configured.");
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(RULES[action].limit, RULES[action].window),
    prefix: `telescope:${environmentName()}:${action}`,
    analytics: false,
  });
  productionLimiters.set(action, limiter);
  return limiter;
}

async function checkRateLimit(action: RateLimitAction, identifier: string): Promise<RateLimitResult> {
  if (process.env.NODE_ENV !== "production") return memoryLimit(action, identifier);
  return productionLimiter(action).limit(identifier);
}

function retryAfterSeconds(reset: number) {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1_000));
}

export async function enforceRateLimit(action: RateLimitAction, identifier: string) {
  const rule = RULES[action];
  let result: RateLimitResult;
  try {
    result = await checkRateLimit(action, identifier);
  } catch (error) {
    console.error(`[rate-limit] ${action} backend unavailable`, error);
    if (!rule.failClosed) return null;
    return NextResponse.json(
      { error: "Request protection is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  if (result.success) return null;
  return NextResponse.json(
    { error: "Too many requests. Please wait before trying again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds(result.reset)),
        "RateLimit-Limit": String(result.limit),
        "RateLimit-Remaining": String(result.remaining),
        "RateLimit-Reset": String(Math.ceil(result.reset / 1_000)),
      },
    },
  );
}

export function resetMemoryRateLimitsForTests() {
  if (process.env.NODE_ENV === "test") memoryBuckets.clear();
}
