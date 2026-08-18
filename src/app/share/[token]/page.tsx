import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Analysis } from "@/domain/types";
import type { WirePayload } from "@/ui/wire";
import { buildDeck } from "@/ui/cards";
import { Report } from "@/ui/Report";
import { ReportActions } from "@/ui/ReportActions";

export const metadata = { robots: { index: false, follow: false } };

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const saved = await prisma.report.findUnique({ where: { shareToken: token }, select: { analysis: true, llm: true } });
  if (!saved?.analysis) notFound();
  const analysis = saved.analysis as unknown as Analysis;
  const llm = saved.llm ? (saved.llm as unknown as WirePayload) : null;
  return <Report analysis={analysis} deck={buildDeck(analysis)} llm={llm} coverActions={<ReportActions publicPath={`/share/${token}`} />} backHref="/" visibilityLabel="Shared report" />;
}
