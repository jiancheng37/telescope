import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Analysis } from "@/domain/types";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to edit reports." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { participantA?: unknown; participantB?: unknown } | null;
  const participantA = typeof body?.participantA === "string" ? body.participantA.trim().slice(0, 20) : "";
  const participantB = typeof body?.participantB === "string" ? body.participantB.trim().slice(0, 20) : "";
  if (!participantA || !participantB) return NextResponse.json({ error: "Both names are required." }, { status: 400 });
  const report = await prisma.report.findFirst({ where: { id, userId: session.user.id }, select: { analysis: true } });
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  const analysis = report.analysis as unknown as Analysis | null;
  if (analysis?.chat) analysis.chat.participants = [participantA, participantB];
  await prisma.report.update({ where: { id }, data: { participantA, participantB, title: `${participantA} & ${participantB}`, ...(analysis ? { analysis: json(analysis) } : {}) } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to delete reports." }, { status: 401 });
  const { id } = await params;
  const deleted = await prisma.report.deleteMany({ where: { id, userId: session.user.id } });
  if (!deleted.count) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
