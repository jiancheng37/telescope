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

export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const { id } = await params;
  const saved = await prisma.report.findFirst({
    where: { id, userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } },
    select: { analysis: true, llm: true, participantA: true, participantB: true, status: true },
  });
  if (!saved?.analysis) notFound();

  const analysis = saved.analysis as unknown as Analysis;
  const llm = saved.llm ? (saved.llm as unknown as WirePayload) : null;
  return <Report analysis={analysis} deck={buildDeck(analysis)} llm={llm} control={!llm ? <SavedReportReadingControl reportId={id} participants={[saved.participantA, saved.participantB]} processing={saved.status === "PROCESSING"} /> : undefined} coverActions={<ReportActions reportId={id} />} backHref="/app" promptInsightsAtEnd localEvidenceKey={id} />;
}
