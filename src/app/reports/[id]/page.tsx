import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Analysis } from "@/domain/types";
import type { GroupAnalysis } from "@/domain/group";
import type { WirePayload } from "@/ui/wire";
import { buildDeck } from "@/ui/cards";
import { Report } from "@/ui/Report";
import { ReportActions } from "@/ui/ReportActions";
import { SavedReportReadingControl } from "@/ui/SavedReportReadingControl";
import { Prisma } from "@/generated/prisma/client";
import { dashboardUrl } from "@/lib/app-url";
import { GroupReport } from "@/ui/GroupReport";
import { SavedGroupReadingControl } from "@/ui/SavedGroupReadingControl";
import type { GroupAiPayload } from "@/llm/group";

export default async function SavedReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ insights?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  const query = await searchParams;
  const [saved, profile] = await Promise.all([prisma.report.findFirst({
    where: { id, userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } },
    select: { analysis: true, llm: true, privateEvidence: true, participantA: true, participantB: true, status: true, sharedMessagesVisible: true, kind: true },
  }), prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } })]);
  if (!saved?.analysis) notFound();

  if (saved.kind === "GROUP") {
    const ai = saved.llm ? saved.llm as unknown as GroupAiPayload : null;
    const evidence = saved.privateEvidence && typeof saved.privateEvidence === "object" ? saved.privateEvidence as { groupAi?: unknown; extremes?: unknown; doubleText?: unknown; stickers?: unknown } : null;
    return <GroupReport analysis={saved.analysis as unknown as GroupAnalysis} ai={ai} aiEvidence={evidence?.groupAi as never} extremeEvidence={evidence?.extremes as never} doubleTextEvidence={evidence?.doubleText as never} stickerVisuals={evidence?.stickers as never} aiControl={!ai ? <SavedGroupReadingControl reportId={id} processing={saved.status === "PROCESSING"} startOpen={query.insights === "1"} /> : undefined} backHref={dashboardUrl()} saved localEvidenceKey={id} coverActions={<ReportActions reportId={id} canConfigureMessages={Boolean(ai)} initialIncludeMessages={saved.sharedMessagesVisible} evidenceKind="group" />} />;
  }

  const analysis = saved.analysis as unknown as Analysis;
  const accountName = profile?.reportName?.trim() || session.user.name?.trim();
  if (accountName) analysis.chat.participants = [saved.participantA, accountName];
  const llm = saved.llm ? (saved.llm as unknown as WirePayload) : null;
  const participants: [string, string] = [saved.participantA, accountName || saved.participantB];
  const evidence = saved.privateEvidence && typeof saved.privateEvidence === "object" ? saved.privateEvidence as { extremes?: unknown; doubleText?: unknown; stickers?: unknown } : null;
  return <Report analysis={analysis} deck={buildDeck(analysis)} llm={llm} doubleTextMessages={evidence?.doubleText as never} extremeEvidence={evidence?.extremes as never} stickerVisuals={evidence?.stickers as never} control={!llm ? <SavedReportReadingControl reportId={id} participants={participants} processing={saved.status === "PROCESSING"} startOpen={query.insights === "1"} /> : undefined} coverActions={<ReportActions reportId={id} canConfigureMessages={Boolean(llm)} initialIncludeMessages={saved.sharedMessagesVisible} />} backHref={dashboardUrl()} promptInsightsAtEnd localEvidenceKey={id} />;
}
