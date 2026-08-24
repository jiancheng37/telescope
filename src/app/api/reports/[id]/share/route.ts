import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to share reports." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { includeMessages?: unknown; evidence?: unknown } | null;
  const hasMessagePreference = typeof body?.includeMessages === "boolean";
  const report = await prisma.report.findFirst({ where: { id, userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } }, select: { kind: true, shareToken: true, shareMessagesToken: true, hasAiInsights: true, sharedEvidence: true, privateEvidence: true } });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const messagesVisible = hasMessagePreference && report.hasAiInsights && body?.includeMessages === true;
  const shareToken = messagesVisible
    ? report.shareMessagesToken ?? randomBytes(24).toString("base64url")
    : report.shareToken ?? randomBytes(24).toString("base64url");
  if ((messagesVisible && !report.shareMessagesToken) || (!messagesVisible && !report.shareToken) || hasMessagePreference) {
    const privateEvidence = report.privateEvidence && typeof report.privateEvidence === "object" && !Array.isArray(report.privateEvidence)
      ? report.privateEvidence as Record<string, unknown>
      : null;
    const accountEvidence = privateEvidence
      ? report.kind === "GROUP"
        ? { groupAiEvidence: privateEvidence.groupAi, groupExtremeEvidence: privateEvidence.extremes }
        : { doubleTextMessages: privateEvidence.doubleText, extremeEvidence: privateEvidence.extremes }
      : undefined;
    const requestedEvidence = {
      ...(accountEvidence ?? {}),
      ...(body?.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence) ? body.evidence as Record<string, unknown> : {}),
    };
    const suppliedEvidence = requestedEvidence && JSON.stringify(requestedEvidence).length <= 2_000_000
      ? requestedEvidence as Prisma.InputJsonValue
      : undefined;
    await prisma.report.update({
      where: { id },
      data: {
        ...(messagesVisible ? {
          shareMessagesToken: shareToken,
          sharedMessagesVisible: true,
          sharedEvidence: messagesVisible ? suppliedEvidence ?? report.sharedEvidence ?? Prisma.DbNull : Prisma.DbNull,
        } : { shareToken, sharedMessagesVisible: false }),
      },
    });
  }
  return NextResponse.json({ path: `/share/${shareToken}` });
}
