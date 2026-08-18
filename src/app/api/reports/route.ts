import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Analysis } from "@/domain/types";
import { saveLocalReport } from "@/lib/reports";

function looksLikeAnalysis(value: unknown): value is Analysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Analysis>;
  return Boolean(
    candidate.chat &&
    Array.isArray(candidate.chat.participants) &&
    candidate.chat.participants.length === 2 &&
    candidate.chat.participants.every((name) => typeof name === "string") &&
    candidate.span &&
    Number.isFinite(candidate.span.firstTs) &&
    Number.isFinite(candidate.span.lastTs),
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to save reports." }, { status: 401 });

  const analysis: unknown = await request.json().catch(() => null);
  if (!looksLikeAnalysis(analysis)) {
    return NextResponse.json({ error: "That analysis could not be saved." }, { status: 400 });
  }

  const report = await saveLocalReport(session.user.id, analysis);
  return NextResponse.json({ id: report.id }, { status: 201 });
}
