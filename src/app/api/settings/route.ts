import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view settings." }, { status: 401 });

  const [shared, profile] = await Promise.all([
    prisma.report.findMany({ where: { userId: session.user.id, shareToken: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, participantA: true, participantB: true, shareToken: true, createdAt: true } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } }),
  ]);

  return NextResponse.json({
    account: { name: session.user.name ?? "Google user", reportName: profile?.reportName ?? session.user.name ?? "You", email: session.user.email ?? "", image: session.user.image ?? null },
    shares: shared.map((report) => ({ id: report.id, names: `${report.participantA} & ${report.participantB}`, path: `/share/${report.shareToken}`, createdAt: report.createdAt.toISOString() })),
  });
}
