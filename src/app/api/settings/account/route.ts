import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to update your account." }, { status: 401 });
  const body = await request.json().catch(() => null) as { reportName?: unknown } | null;
  const reportName = typeof body?.reportName === "string" ? body.reportName.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!reportName) return NextResponse.json({ error: "Report name is required." }, { status: 400 });
  await prisma.user.update({ where: { id: session.user.id }, data: { reportName } });
  return NextResponse.json({ reportName });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to delete your account." }, { status: 401 });
  const result = await prisma.user.deleteMany({ where: { id: session.user.id } });
  if (!result.count) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
