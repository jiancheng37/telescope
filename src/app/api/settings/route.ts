import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view settings." }, { status: 401 });

  const [shared, profile, collections] = await Promise.all([
    prisma.report.findMany({ where: { userId: session.user.id, OR: [{ shareToken: { not: null } }, { shareMessagesToken: { not: null } }] }, orderBy: { createdAt: "desc" }, select: { id: true, participantA: true, shareToken: true, shareMessagesToken: true, createdAt: true } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } }),
    prisma.collection.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, _count: { select: { reports: true } } } }),
  ]);

  return NextResponse.json({
    account: { name: session.user.name ?? "Google user", reportName: profile?.reportName ?? session.user.name ?? "You", email: session.user.email ?? "", image: session.user.image ?? null },
    shares: shared.flatMap((report) => [
      ...(report.shareToken ? [{ id: `${report.id}:public`, names: report.participantA, path: `/share/${report.shareToken}`, createdAt: report.createdAt.toISOString(), privacy: "Insights only" }] : []),
      ...(report.shareMessagesToken ? [{ id: `${report.id}:messages`, names: report.participantA, path: `/share/${report.shareMessagesToken}`, createdAt: report.createdAt.toISOString(), privacy: "Includes messages" }] : []),
    ]),
    collections: collections.map((collection) => ({ id: collection.id, name: collection.name, count: collection._count.reports })),
  });
}
