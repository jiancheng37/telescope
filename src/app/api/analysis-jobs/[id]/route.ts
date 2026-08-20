import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { WirePayload } from "@/ui/wire";

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
      ? job.report.llm as unknown as WirePayload
      : null,
  });
}
