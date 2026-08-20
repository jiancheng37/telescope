import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { analysisInfrastructure } from "@/lib/analysis-infrastructure";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to start analysis." }, { status: 401 });
  const limited = await enforceRateLimit("analysis-uploaded", session.user.id);
  if (limited) return limited;
  const { id } = await params;
  const job = await prisma.analysisJob.findFirst({
    where: { id, userId: session.user.id, status: "AWAITING_UPLOAD", expiresAt: { gt: new Date() } },
    select: { id: true, reportId: true, storageKey: true, uploadBytes: true },
  });
  if (!job) return NextResponse.json({ error: "Upload job is missing or expired." }, { status: 409 });

  const { s3, sqs, bucket, queueUrl } = analysisInfrastructure();
  const uploaded = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: job.storageKey })).catch(() => null);
  if (!uploaded || uploaded.ContentLength !== job.uploadBytes || uploaded.ContentType !== "application/json") {
    return NextResponse.json({ error: "The uploaded export could not be verified." }, { status: 400 });
  }

  const queued = await prisma.$transaction(async (tx) => {
    const claimed = await tx.analysisJob.updateMany({
      where: { id: job.id, status: "AWAITING_UPLOAD" },
      data: { status: "QUEUED", stage: "Waiting for an analysis worker" },
    });
    if (claimed.count !== 1) return false;
    await tx.report.update({ where: { id: job.reportId }, data: { status: "PROCESSING", hasAiInsights: false } });
    return true;
  });
  if (!queued) return NextResponse.json({ error: "This job was already queued." }, { status: 409 });

  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ jobId: job.id }) }));
    return NextResponse.json({ jobId: job.id, status: "QUEUED" });
  } catch (error) {
    console.error("[analysis-job] couldn't enqueue job", error);
    await prisma.$transaction([
      prisma.analysisJob.update({ where: { id: job.id }, data: { status: "FAILED", stage: null, error: "The analysis queue was unavailable.", completedAt: new Date() } }),
      prisma.report.update({ where: { id: job.reportId }, data: { status: "COMPLETE" } }),
    ]);
    return NextResponse.json({ error: "The analysis queue was unavailable." }, { status: 503 });
  }
}
