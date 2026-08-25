import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteAnalysisUploads } from "@/lib/analysis-upload-cleanup";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to update your account." }, { status: 401 });
  const body = await request.json().catch(() => null) as { reportName?: unknown } | null;
  const reportName = typeof body?.reportName === "string" ? body.reportName.trim().replace(/\s+/g, " ").slice(0, 20) : "";
  if (!reportName) return NextResponse.json({ error: "Report name is required." }, { status: 400 });
  await prisma.user.update({ where: { id: session.user.id }, data: { reportName } });
  return NextResponse.json({ reportName });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to delete your account." }, { status: 401 });
  const jobs = await prisma.analysisJob.findMany({ where: { userId: session.user.id }, select: { storageKey: true } });
  try {
    await deleteAnalysisUploads(jobs.map((job) => job.storageKey));
  } catch (error) {
    console.error("[account-delete] raw upload cleanup failed", error);
    return NextResponse.json({ error: "Temporary analysis data could not be removed. Please try again." }, { status: 503 });
  }
  const result = await prisma.user.deleteMany({ where: { id: session.user.id } });
  if (!result.count) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
