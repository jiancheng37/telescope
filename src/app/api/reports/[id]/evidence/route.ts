import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { reportEvidence } from "@/lib/report-evidence";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to sync report evidence." }, { status: 401 });
  const { id } = await params;
  const incoming = await request.json().catch(() => null);
  const saved = await prisma.report.findFirst({
    where: { id, userId: session.user.id },
    select: { privateEvidence: true },
  });
  if (!saved) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  const existing = saved.privateEvidence && typeof saved.privateEvidence === "object" && !Array.isArray(saved.privateEvidence)
    ? saved.privateEvidence as Record<string, unknown>
    : {};
  const next = reportEvidence({ ...existing, ...(incoming && typeof incoming === "object" ? incoming : {}) });
  if (!next) return NextResponse.json({ error: "That evidence could not be synced." }, { status: 413 });
  await prisma.report.update({ where: { id }, data: { privateEvidence: next } });
  return NextResponse.json({ synced: true });
}
