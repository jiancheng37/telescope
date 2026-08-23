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
  const report = await prisma.report.findFirst({ where: { id, userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } }, select: { kind: true, shareToken: true, shareMessagesToken: true, hasAiInsights: true, sharedEvidence: true } });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const messagesVisible = hasMessagePreference && report.hasAiInsights && body?.includeMessages === true;
  const shareToken = messagesVisible
    ? report.shareMessagesToken ?? randomBytes(24).toString("base64url")
    : report.shareToken ?? randomBytes(24).toString("base64url");
  if ((messagesVisible && !report.shareMessagesToken) || (!messagesVisible && !report.shareToken) || hasMessagePreference) {
    const suppliedEvidence = body?.evidence && typeof body.evidence === "object" && JSON.stringify(body.evidence).length <= 2_000_000
      ? body.evidence as Prisma.InputJsonValue
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
