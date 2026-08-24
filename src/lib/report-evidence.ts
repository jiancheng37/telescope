import { Prisma } from "@/generated/prisma/client";

export type ReportEvidence = {
  doubleText?: unknown;
  extremes?: unknown;
  stickers?: unknown;
  groupAi?: unknown;
};

// Keep source messages ahead of optional artwork when a report's private
// evidence approaches the storage cap. This ordering also matches the client.
const ALLOWED_KEYS = ["groupAi", "extremes", "doubleText", "stickers"] as const;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

export function reportEvidence(value: unknown): Prisma.InputJsonValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const selected: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (source[key] === undefined) continue;
    const candidate = { ...selected, [key]: source[key] };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= MAX_EVIDENCE_BYTES) selected[key] = source[key];
  }
  if (Object.keys(selected).length === 0) return null;
  return JSON.parse(JSON.stringify(selected)) as Prisma.InputJsonValue;
}
