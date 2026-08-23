import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Analysis } from "@/domain/types";
import type { GroupAnalysis } from "@/domain/group";
import type { WirePayload } from "@/ui/wire";
import { buildDeck } from "@/ui/cards";
import { Report, type LocalExtremeEvidence, type LocalStreakMessage } from "@/ui/Report";
import { ReportActions } from "@/ui/ReportActions";
import { GroupReport, type LocalGroupExtremeEvidence, type LocalGroupMessage } from "@/ui/GroupReport";
import type { GroupAiPayload } from "@/llm/group";

export const metadata = { robots: { index: false, follow: false } };

function hideMessageExcerpts(llm: WirePayload): WirePayload {
  const withoutEvidence = <T extends { evidence: unknown[] }>(item: T): T => ({ ...item, evidence: [] });
  return {
    ...llm,
    chapterNotes: llm.chapterNotes.map(withoutEvidence),
    findings: llm.findings.map(withoutEvidence),
    motifs: llm.motifs.map(withoutEvidence),
    topics: llm.topics.map(withoutEvidence),
    dynamics: llm.dynamics.map((item) => ({ ...item, evidence: [], counterEvidence: [] })),
    roles: llm.roles ? { a: llm.roles.a.map(withoutEvidence), b: llm.roles.b.map(withoutEvidence) } : undefined,
    language: llm.language ? { a: llm.language.a.map(withoutEvidence), b: llm.language.b.map(withoutEvidence), shared: llm.language.shared.map(withoutEvidence) } : null,
    wildSentences: [],
    naming: llm.naming ? { ...llm.naming, evidence: [] } : null,
  };
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const saved = await prisma.report.findFirst({ where: { OR: [{ shareToken: token }, { shareMessagesToken: token }] }, select: { kind: true, analysis: true, llm: true, participantA: true, participantB: true, shareToken: true, shareMessagesToken: true, sharedMessagesVisible: true, sharedEvidence: true, user: { select: { reportName: true, name: true } } } });
  if (!saved?.analysis) notFound();
  if (saved.kind === "GROUP") {
    const messagesVisible = saved.shareMessagesToken === token;
    const evidence = messagesVisible && saved.sharedEvidence && typeof saved.sharedEvidence === "object" ? saved.sharedEvidence as { groupAiEvidence?: LocalGroupMessage[]; groupExtremeEvidence?: LocalGroupExtremeEvidence } : null;
    const storedGroupAi = saved.llm ? saved.llm as unknown as GroupAiPayload : null;
    const groupAi = storedGroupAi && !messagesVisible ? { ...storedGroupAi, wildTexts: [] } : storedGroupAi;
    return <GroupReport analysis={saved.analysis as unknown as GroupAnalysis} ai={groupAi} aiEvidence={evidence?.groupAiEvidence} extremeEvidence={evidence?.groupExtremeEvidence} backHref="/" returnLabel="Home" visibilityLabel={messagesVisible ? "Shared group report · evidence included" : "Shared group report · messages hidden"} coverActions={<ReportActions publicPath={`/share/${token}`} />} />;
  }
  const analysis = saved.analysis as unknown as Analysis;
  analysis.chat.participants = [saved.participantA, saved.user.reportName?.trim() || saved.user.name?.trim() || saved.participantB];
  const messagesVisible = saved.shareMessagesToken === token || (saved.shareToken === token && saved.sharedMessagesVisible);
  const storedLlm = saved.llm ? (saved.llm as unknown as WirePayload) : null;
  const llm = storedLlm && !messagesVisible ? hideMessageExcerpts(storedLlm) : storedLlm;
  const sharedEvidence = messagesVisible && saved.sharedEvidence && typeof saved.sharedEvidence === "object"
    ? saved.sharedEvidence as { doubleTextMessages?: LocalStreakMessage[]; extremeEvidence?: LocalExtremeEvidence }
    : null;
  return <Report analysis={analysis} deck={buildDeck(analysis)} llm={llm} doubleTextMessages={sharedEvidence?.doubleTextMessages} extremeEvidence={sharedEvidence?.extremeEvidence} coverActions={<ReportActions publicPath={`/share/${token}`} />} backHref={null} visibilityLabel="Shared report" />;
}
