import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to organise reports." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { collectionIds?: unknown } | null;
  const requested = Array.isArray(body?.collectionIds) ? [...new Set(body.collectionIds.filter((value): value is string => typeof value === "string"))] : [];
  const [report, owned] = await Promise.all([
    prisma.report.findFirst({ where: { id, userId: session.user.id }, select: { id: true } }),
    prisma.collection.findMany({ where: { userId: session.user.id, id: { in: requested } }, select: { id: true } }),
  ]);
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  if (owned.length !== requested.length) return NextResponse.json({ error: "One or more collections were not found." }, { status: 400 });
  await prisma.$transaction([
    prisma.collectionReport.deleteMany({ where: { reportId: id } }),
    ...(owned.length ? [prisma.collectionReport.createMany({ data: owned.map((collection) => ({ reportId: id, collectionId: collection.id })) })] : []),
  ]);
  return NextResponse.json({ collectionIds: requested });
}
