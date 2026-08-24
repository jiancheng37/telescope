import { Prisma } from "@/generated/prisma/client";

export type ReportEvidence = {
  doubleText?: unknown;
  extremes?: unknown;
  stickers?: unknown;
  groupAi?: unknown;
};

const ALLOWED_KEYS = ["doubleText", "extremes", "stickers", "groupAi"] as const;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

export function reportEvidence(value: unknown): Prisma.InputJsonValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const selected = Object.fromEntries(ALLOWED_KEYS.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
  if (Object.keys(selected).length === 0) return null;
  const serialized = JSON.stringify(selected);
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_BYTES) return null;
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}
