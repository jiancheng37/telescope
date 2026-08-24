import { describe, expect, it } from "vitest";
import { reportEvidence } from "@/lib/report-evidence";

describe("report evidence", () => {
  it("keeps only the private receipt fields", () => {
    expect(reportEvidence({ extremes: { body: "receipt" }, unexpected: "drop me" })).toEqual({
      extremes: { body: "receipt" },
    });
  });

  it("rejects an oversized evidence payload", () => {
    expect(reportEvidence({ groupAi: "x".repeat(4 * 1024 * 1024 + 1) })).toBeNull();
  });

  it("keeps AI excerpts when optional sticker artwork exceeds the remaining space", () => {
    expect(reportEvidence({
      stickers: "x".repeat(4 * 1024 * 1024),
      groupAi: [{ id: "message-1", body: "the source excerpt" }],
    })).toEqual({ groupAi: [{ id: "message-1", body: "the source excerpt" }] });
  });
});
