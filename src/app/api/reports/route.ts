import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Analysis } from "@/domain/types";
import type { GroupAnalysis } from "@/domain/group";
import { saveLocalGroupReport, saveLocalReport } from "@/lib/reports";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { ReportEvidence } from "@/lib/report-evidence";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view reports." }, { status: 401 });
  const [reports, collections] = await Promise.all([
    prisma.report.findMany({ where: { userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, title: true, participantCount: true, participantA: true, participantB: true, createdAt: true, completedAt: true, firstTs: true, lastTs: true, messageCount: true, status: true, hasAiInsights: true, shareToken: true, shareMessagesToken: true, collections: { select: { collectionId: true } } } }),
    prisma.collection.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, _count: { select: { reports: true } } } }),
  ]);
  return NextResponse.json({
    reports: reports.map((report) => ({ id: report.id, kind: report.kind, title: report.title, participantCount: report.participantCount, participantA: report.participantA, participantB: report.participantB, createdAt: report.createdAt.toISOString(), completedAt: report.completedAt?.toISOString() ?? null, firstTs: report.firstTs, lastTs: report.lastTs, messageCount: report.messageCount, status: report.status, aiReady: report.hasAiInsights, shared: Boolean(report.shareToken || report.shareMessagesToken), sharedInsights: Boolean(report.shareToken), sharedMessages: Boolean(report.shareMessagesToken), collectionIds: report.collections.map((membership) => membership.collectionId) })),
    collections: collections.map((collection) => ({ id: collection.id, name: collection.name, count: collection._count.reports })),
  });
}

function looksLikeAnalysis(value: unknown): value is Analysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Analysis>;
  return Boolean(
    candidate.chat &&
    Array.isArray(candidate.chat.participants) &&
    candidate.chat.participants.length === 2 &&
    candidate.chat.participants.every((name) => typeof name === "string" && name.trim().length > 0 && name.trim().length <= 20) &&
    candidate.span &&
    Number.isFinite(candidate.span.firstTs) &&
    Number.isFinite(candidate.span.lastTs),
  );
}

function looksLikeGroupAnalysis(value: unknown): value is GroupAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GroupAnalysis>;
  return Boolean(
    candidate.kind === "group" &&
    candidate.chat && typeof candidate.chat.name === "string" && candidate.chat.name.trim().length > 0 && candidate.chat.name.trim().length <= 40 &&
    Array.isArray(candidate.participants) && candidate.participants.length >= 3 &&
    candidate.participants.length <= 10_000 &&
    candidate.participants.every((person) => person && typeof person.id === "string" && typeof person.name === "string" && person.name.trim().length > 0 && person.name.length <= 20) &&
    candidate.span && Number.isFinite(candidate.span.firstTs) && Number.isFinite(candidate.span.lastTs) &&
    Number.isFinite(candidate.totalMessages) && Number(candidate.totalMessages) > 0
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to save reports." }, { status: 401 });

  const submitted: unknown = await request.json().catch(() => null);
  const wrapped = submitted && typeof submitted === "object" && "analysis" in submitted
    ? submitted as { analysis?: unknown; evidence?: ReportEvidence }
    : null;
  const analysis = wrapped?.analysis ?? submitted;
  if (!looksLikeAnalysis(analysis) && !looksLikeGroupAnalysis(analysis)) {
    return NextResponse.json({ error: "That analysis could not be saved." }, { status: 400 });
  }

  const report = looksLikeGroupAnalysis(analysis)
    ? await saveLocalGroupReport(session.user.id, analysis, wrapped?.evidence)
    : await saveLocalReport(session.user.id, analysis, wrapped?.evidence);
  return NextResponse.json({ id: report.id }, { status: 201 });
}
