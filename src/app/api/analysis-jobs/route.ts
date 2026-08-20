import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { Prisma } from "@/generated/prisma/client";
import {
  ANALYSIS_JOB_TTL_MS,
  ANALYSIS_UPLOAD_TTL_SECONDS,
  analysisInfrastructure,
  dailyAnalysisLimit,
  maximumExportBytes,
} from "@/lib/analysis-infrastructure";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view analysis jobs." }, { status: 401 });
  const limited = await enforceRateLimit("analysis-poll", session.user.id);
  if (limited) return limited;
  const reportId = new URL(request.url).searchParams.get("reportId");
  if (!reportId) return NextResponse.json({ error: "reportId is required." }, { status: 400 });
  const job = await prisma.analysisJob.findFirst({
    where: { reportId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!job) return NextResponse.json({ error: "Analysis job not found." }, { status: 404 });
  return NextResponse.json(job);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to request AI analysis." }, { status: 401 });
  }
  const limited = await enforceRateLimit("analysis-create", session.user.id);
  if (limited) return limited;
  let infrastructure: ReturnType<typeof analysisInfrastructure>;
  try {
    infrastructure = analysisInfrastructure();
  } catch {
    return NextResponse.json(
      { error: "AI analysis is not configured in this environment yet." },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => null) as {
    reportId?: unknown;
    participants?: unknown;
    uploadBytes?: unknown;
  } | null;
  const reportId = typeof body?.reportId === "string" ? body.reportId : "";
  const participants = Array.isArray(body?.participants) && body.participants.length === 2 &&
    body.participants.every((name) => typeof name === "string" && name.trim())
    ? body.participants.map((name) => (name as string).trim().slice(0, 20)) as [string, string]
    : null;
  const uploadBytes = typeof body?.uploadBytes === "number" ? body.uploadBytes : 0;
  const maxBytes = maximumExportBytes();
  if (!reportId || !participants || !Number.isSafeInteger(uploadBytes) || uploadBytes <= 0 || uploadBytes > maxBytes) {
    return NextResponse.json(
      { error: `Export must be valid JSON no larger than ${Math.floor(maxBytes / 1024 / 1024)} MiB.` },
      { status: 400 },
    );
  }

  const report = await prisma.report.findFirst({
    where: { id: reportId, userId: session.user.id, status: "COMPLETE", llm: { equals: Prisma.DbNull } },
    select: { id: true },
  });
  if (!report) {
    return NextResponse.json({ error: "That report cannot start AI analysis." }, { status: 409 });
  }
  const [active, recentJobs] = await Promise.all([
    prisma.analysisJob.findFirst({
      where: { userId: session.user.id, status: { in: ["AWAITING_UPLOAD", "QUEUED", "PROCESSING"] } },
      select: { id: true },
    }),
    prisma.analysisJob.count({
      where: { userId: session.user.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
    }),
  ]);
  if (active) {
    return NextResponse.json({ error: "Finish the current AI analysis before starting another." }, { status: 409 });
  }
  if (recentJobs >= dailyAnalysisLimit()) {
    return NextResponse.json({ error: "The daily AI analysis limit has been reached." }, { status: 429 });
  }

  const { s3, bucket } = infrastructure;
  const jobId = randomUUID();
  const storageKey = `analysis-uploads/${session.user.id}/${jobId}/result.json`;
  await prisma.analysisJob.create({
    data: {
      id: jobId,
      userId: session.user.id,
      reportId,
      storageKey,
      uploadBytes,
      participantA: participants[0],
      participantB: participants[1],
      expiresAt: new Date(Date.now() + ANALYSIS_JOB_TTL_MS),
      stage: "Waiting for the private upload",
    },
  });

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: "application/json",
        ContentLength: uploadBytes,
      }),
      { expiresIn: ANALYSIS_UPLOAD_TTL_SECONDS },
    );
    return NextResponse.json({ jobId, uploadUrl, expiresIn: ANALYSIS_UPLOAD_TTL_SECONDS });
  } catch (error) {
    await prisma.analysisJob.delete({ where: { id: jobId } }).catch(() => undefined);
    console.error("[analysis-job] couldn't create upload URL", error);
    return NextResponse.json({ error: "The private upload could not be prepared." }, { status: 503 });
  }
}
