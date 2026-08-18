import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to share reports." }, { status: 401 });
  const { id } = await params;
  const report = await prisma.report.findFirst({ where: { id, userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } }, select: { shareToken: true } });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const shareToken = report.shareToken ?? randomBytes(24).toString("base64url");
  if (!report.shareToken) await prisma.report.update({ where: { id }, data: { shareToken } });
  return NextResponse.json({ path: `/share/${shareToken}` });
}
