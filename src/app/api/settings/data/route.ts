import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteAnalysisUploads } from "@/lib/analysis-upload-cleanup";

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to manage your data." }, { status: 401 });
  const body = await request.json().catch(() => null) as { scope?: unknown } | null;
  if (body?.scope === "reports") {
    const jobs = await prisma.analysisJob.findMany({ where: { userId: session.user.id }, select: { storageKey: true } });
    try {
      await deleteAnalysisUploads(jobs.map((job) => job.storageKey));
    } catch (error) {
      console.error("[report-delete-all] raw upload cleanup failed", error);
      return NextResponse.json({ error: "Temporary analysis data could not be removed. Please try again." }, { status: 503 });
    }
    const result = await prisma.report.deleteMany({ where: { userId: session.user.id } });
    return NextResponse.json({ deleted: result.count });
  }
  if (body?.scope === "collections") {
    const result = await prisma.collection.deleteMany({ where: { userId: session.user.id } });
    return NextResponse.json({ deleted: result.count });
  }
  return NextResponse.json({ error: "Unknown deletion scope." }, { status: 400 });
}
