import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceRateLimit, resetMemoryRateLimitsForTests } from "../src/lib/rate-limit";

describe("analysis API rate limiting", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetMemoryRateLimitsForTests();
  });

  it("allows five analysis creation requests and rejects the sixth", async () => {
    for (let request = 0; request < 5; request += 1) {
      expect(await enforceRateLimit("analysis-create", "user-a")).toBeNull();
    }
    const rejected = await enforceRateLimit("analysis-create", "user-a");
    expect(rejected?.status).toBe(429);
    expect(rejected?.headers.get("Retry-After")).toBe("60");
    expect(rejected?.headers.get("RateLimit-Limit")).toBe("5");
  });

  it("keeps counters separate between authenticated users", async () => {
    for (let request = 0; request < 5; request += 1) {
      await enforceRateLimit("analysis-create", "user-a");
    }
    expect(await enforceRateLimit("analysis-create", "user-b")).toBeNull();
  });

  it("allows requests again after the sliding window passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T00:00:00Z"));
    for (let request = 0; request < 5; request += 1) {
      await enforceRateLimit("analysis-create", "user-a");
    }
    expect((await enforceRateLimit("analysis-create", "user-a"))?.status).toBe(429);
    vi.advanceTimersByTime(60_001);
    expect(await enforceRateLimit("analysis-create", "user-a")).toBeNull();
  });
});
