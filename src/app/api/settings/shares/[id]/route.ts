import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to manage sharing." }, { status: 401 });
  const { id } = await params;
  const result = await prisma.report.updateMany({ where: { id, userId: session.user.id }, data: { shareToken: null } });
  if (!result.count) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
