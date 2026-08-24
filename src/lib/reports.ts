import { ReportStatus, Prisma } from "@/generated/prisma/client";
import type { Analysis } from "@/domain/types";
import type { GroupAnalysis } from "@/domain/group";
import type { WirePayload } from "@/ui/wire";
import type { GroupAiPayload } from "@/llm/group";
import { prisma } from "@/lib/prisma";
import { reportEvidence, type ReportEvidence } from "@/lib/report-evidence";

const PROCESSING_TTL_MS = 30 * 60 * 1000;

export async function saveLocalReport(userId: string, analysis: Analysis, evidence?: ReportEvidence) {
  const privateEvidence = reportEvidence(evidence);
  const data = {
      userId,
      chatId: String(analysis.chat.id),
      status: ReportStatus.COMPLETE,
      title: `${analysis.chat.participants[0]} & ${analysis.chat.participants[1]}`,
      participantA: analysis.chat.participants[0],
      participantB: analysis.chat.participants[1],
      firstTs: Math.round(analysis.span.firstTs),
      lastTs: Math.round(analysis.span.lastTs),
      messageCount: analysis.volume.total,
      hasAiInsights: false,
      analysis: json(analysis),
      llm: Prisma.DbNull,
      privateEvidence: privateEvidence ?? Prisma.DbNull,
      completedAt: new Date(),
    } satisfies Prisma.ReportUncheckedCreateInput;
  return prisma.report.upsert({
    where: { userId_chatId: { userId, chatId: String(analysis.chat.id) } },
    create: data,
    update: {
      status: data.status,
      title: data.title,
      participantA: data.participantA,
      participantB: data.participantB,
      firstTs: data.firstTs,
      lastTs: data.lastTs,
      messageCount: data.messageCount,
      hasAiInsights: false,
      analysis: data.analysis,
      llm: Prisma.DbNull,
      ...(privateEvidence ? { privateEvidence } : {}),
      completedAt: data.completedAt,
    },
    select: { id: true },
  });
}

export async function saveLocalGroupReport(userId: string, analysis: GroupAnalysis, evidence?: ReportEvidence) {
  const privateEvidence = reportEvidence(evidence);
  const safeAnalysis: GroupAnalysis = {
    ...analysis,
    extremes: {
      ...analysis.extremes,
      longestMessage: analysis.extremes.longestMessage
        ? { messageId: analysis.extremes.longestMessage.messageId, participantId: analysis.extremes.longestMessage.participantId, chars: analysis.extremes.longestMessage.chars, ts: analysis.extremes.longestMessage.ts }
        : null,
    },
  };
  const data = {
    userId,
    chatId: `group:${analysis.chat.id}`,
    kind: "GROUP" as const,
    status: ReportStatus.COMPLETE,
    title: analysis.chat.name,
    participantA: analysis.chat.name,
    participantB: `${analysis.participants.length} people`,
    participantCount: analysis.participants.length,
    firstTs: Math.round(analysis.span.firstTs),
    lastTs: Math.round(analysis.span.lastTs),
    messageCount: analysis.totalMessages,
    hasAiInsights: false,
    analysis: json(safeAnalysis),
    llm: Prisma.DbNull,
    privateEvidence: privateEvidence ?? Prisma.DbNull,
    completedAt: new Date(),
  } satisfies Prisma.ReportUncheckedCreateInput;
  return prisma.report.upsert({
    where: { userId_chatId: { userId, chatId: data.chatId } },
    create: data,
    update: {
      kind: data.kind,
      status: data.status,
      title: data.title,
      participantA: data.participantA,
      participantB: data.participantB,
      participantCount: data.participantCount,
      firstTs: data.firstTs,
      lastTs: data.lastTs,
      messageCount: data.messageCount,
      hasAiInsights: false,
      analysis: data.analysis,
      llm: Prisma.DbNull,
      ...(privateEvidence ? { privateEvidence } : {}),
      completedAt: data.completedAt,
    },
    select: { id: true },
  });
}

/** Mark a saved local report as processing, or create a fresh processing report. */
export async function reserveReport(userId: string, analysis: Analysis, savedReportId?: string): Promise<string | null> {
  const staleBefore = new Date(Date.now() - PROCESSING_TTL_MS);
  return prisma.$transaction(async (tx) => {
    await tx.report.updateMany({
      where: { userId, status: ReportStatus.PROCESSING, completedAt: { lt: staleBefore }, analysis: { not: Prisma.DbNull } },
      data: { status: ReportStatus.COMPLETE },
    });
    await tx.report.deleteMany({
      where: { userId, status: ReportStatus.PROCESSING, createdAt: { lt: staleBefore }, analysis: { equals: Prisma.DbNull } },
    });
    if (savedReportId) {
      const claimed = await tx.report.updateMany({
        where: { id: savedReportId, userId, status: ReportStatus.COMPLETE, llm: { equals: Prisma.DbNull } },
        data: { status: ReportStatus.PROCESSING, hasAiInsights: false, completedAt: new Date() },
      });
      return claimed.count === 1 ? savedReportId : null;
    }
    const existing = await tx.report.findUnique({
      where: { userId_chatId: { userId, chatId: String(analysis.chat.id) } },
      select: { id: true },
    });
    if (existing) {
      await tx.report.update({
        where: { id: existing.id },
        data: {
          status: ReportStatus.PROCESSING,
          title: `${analysis.chat.participants[0]} & ${analysis.chat.participants[1]}`,
          participantA: analysis.chat.participants[0],
          participantB: analysis.chat.participants[1],
          firstTs: Math.round(analysis.span.firstTs),
          lastTs: Math.round(analysis.span.lastTs),
          messageCount: analysis.volume.total,
          hasAiInsights: false,
          llm: Prisma.DbNull,
          completedAt: new Date(),
        },
      });
      return existing.id;
    }
    const report = await tx.report.create({
      data: {
        userId,
        chatId: String(analysis.chat.id),
        title: `${analysis.chat.participants[0]} & ${analysis.chat.participants[1]}`,
        participantA: analysis.chat.participants[0],
        participantB: analysis.chat.participants[1],
        firstTs: Math.round(analysis.span.firstTs),
        lastTs: Math.round(analysis.span.lastTs),
        messageCount: analysis.volume.total,
        hasAiInsights: false,
      },
      select: { id: true },
    });
    return report.id;
  });
}

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function completeReport(id: string, userId: string, analysis: Analysis, llm: WirePayload) {
  await prisma.report.update({
    where: { id, userId },
    data: {
      status: ReportStatus.COMPLETE,
      analysis: json(analysis),
      llm: json(llm),
      messageCount: analysis.volume.total,
      hasAiInsights: true,
      completedAt: new Date(),
    },
  });
}

export async function completeGroupReport(id: string, userId: string, analysis: GroupAnalysis, llm: GroupAiPayload, groupAi?: unknown) {
  await prisma.$transaction(async (tx) => {
    const saved = await tx.report.findUnique({ where: { id, userId }, select: { privateEvidence: true } });
    const existing = saved?.privateEvidence && typeof saved.privateEvidence === "object" && !Array.isArray(saved.privateEvidence)
      ? saved.privateEvidence as Record<string, unknown>
      : {};
    await tx.report.update({
      where: { id, userId },
      data: {
      status: ReportStatus.COMPLETE,
      analysis: json(analysis),
      llm: json(llm),
      privateEvidence: reportEvidence({ ...existing, ...(groupAi ? { groupAi } : {}) }) ?? Prisma.DbNull,
      messageCount: analysis.totalMessages,
      hasAiInsights: true,
      completedAt: new Date(),
      },
    });
  });
}

export async function releaseReport(id: string, userId: string) {
  const report = await prisma.report.findFirst({ where: { id, userId, status: ReportStatus.PROCESSING }, select: { analysis: true } });
  if (!report) return;
  if (report.analysis) {
    await prisma.report.update({ where: { id }, data: { status: ReportStatus.COMPLETE } });
  } else {
    await prisma.report.delete({ where: { id } });
  }
}
