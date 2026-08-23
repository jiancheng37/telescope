import { NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/auth";
import { analysisInfrastructure } from "@/lib/analysis-infrastructure";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { WirePayload } from "@/ui/wire";
import type { GroupAiPayload } from "@/llm/group";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view this job." }, { status: 401 });
  const limited = await enforceRateLimit("analysis-poll", session.user.id);
  if (limited) return limited;
  const { id } = await params;
  const job = await prisma.analysisJob.findFirst({
    where: { id, userId: session.user.id },
    select: {
      status: true,
      stage: true,
      error: true,
      reportId: true,
      report: { select: { llm: true } },
    },
  });
  if (!job) return NextResponse.json({ error: "Analysis job not found." }, { status: 404 });
  return NextResponse.json({
    status: job.status,
    stage: job.stage,
    error: job.error,
    reportId: job.reportId,
    result: job.status === "COMPLETE" && job.report.llm
      ? job.report.llm as unknown as WirePayload | GroupAiPayload
      : null,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to cancel this job." }, { status: 401 });
  const limited = await enforceRateLimit("analysis-cancel", session.user.id);
  if (limited) return limited;
  const { id } = await params;
  const job = await prisma.analysisJob.findFirst({
    where: { id, userId: session.user.id, status: { in: ["AWAITING_UPLOAD", "QUEUED"] } },
    select: { id: true, reportId: true, storageKey: true },
  });
  if (!job) {
    return NextResponse.json({ error: "This analysis can no longer be cancelled." }, { status: 409 });
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const updated = await tx.analysisJob.updateMany({
      where: { id: job.id, status: { in: ["AWAITING_UPLOAD", "QUEUED"] } },
      data: { status: "CANCELLED", stage: null, error: "Analysis cancelled.", completedAt: new Date() },
    });
    if (updated.count !== 1) return false;
    await tx.report.updateMany({ where: { id: job.reportId, status: "PROCESSING" }, data: { status: "COMPLETE" } });
    return true;
  });
  if (!cancelled) {
    return NextResponse.json({ error: "This analysis can no longer be cancelled." }, { status: 409 });
  }

  const { s3, bucket } = analysisInfrastructure();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: job.storageKey })).catch((error) => {
    console.error("[analysis-job] cancelled upload cleanup failed", error);
  });
  return NextResponse.json({ id: job.id, status: "CANCELLED" });
}
