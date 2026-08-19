import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Analysis } from "@/domain/types";
import type { WirePayload } from "@/ui/wire";
import { buildDeck } from "@/ui/cards";
import { Report } from "@/ui/Report";
import { ReportActions } from "@/ui/ReportActions";
import { SavedReportReadingControl } from "@/ui/SavedReportReadingControl";
import { Prisma } from "@/generated/prisma/client";

export default async function SavedReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ insights?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  const query = await searchParams;
  const [saved, profile] = await Promise.all([prisma.report.findFirst({
    where: { id, userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } },
    select: { analysis: true, llm: true, participantA: true, participantB: true, status: true },
  }), prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } })]);
  if (!saved?.analysis) notFound();

  const analysis = saved.analysis as unknown as Analysis;
  const accountName = profile?.reportName?.trim() || session.user.name?.trim();
  if (accountName) analysis.chat.participants = [saved.participantA, accountName];
  const llm = saved.llm ? (saved.llm as unknown as WirePayload) : null;
  const participants: [string, string] = [saved.participantA, accountName || saved.participantB];
  return <Report analysis={analysis} deck={buildDeck(analysis)} llm={llm} control={!llm ? <SavedReportReadingControl reportId={id} participants={participants} processing={saved.status === "PROCESSING"} startOpen={query.insights === "1"} /> : undefined} coverActions={<ReportActions reportId={id} />} backHref="/app" promptInsightsAtEnd localEvidenceKey={id} />;
}
