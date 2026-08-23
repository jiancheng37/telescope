import { prisma } from "@/lib/prisma";

const QUEUED_TIMEOUT_MS = 45 * 60 * 1_000;
const PROCESSING_TIMEOUT_MS = 90 * 60 * 1_000;
export const FAILED_ANALYSIS_JOB_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type StaleAnalysisJob = {
  id: string;
  storageKey: string;
  previousStatus: "AWAITING_UPLOAD" | "QUEUED" | "PROCESSING";
};

/**
 * Close jobs which can no longer make forward progress. The caller owns object
 * deletion so this helper stays useful outside AWS-backed environments.
 */
export async function closeStaleAnalysisJobs(now = new Date()): Promise<StaleAnalysisJob[]> {
  const queuedBefore = new Date(now.getTime() - QUEUED_TIMEOUT_MS);
  const processingBefore = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
  const candidates = await prisma.analysisJob.findMany({
    where: {
      OR: [
        { status: "AWAITING_UPLOAD", expiresAt: { lte: now } },
        { status: "QUEUED", createdAt: { lte: queuedBefore } },
        { status: "PROCESSING", startedAt: { lte: processingBefore } },
      ],
    },
    select: { id: true, reportId: true, storageKey: true, status: true },
    take: 100,
  });

  const closed: StaleAnalysisJob[] = [];
  for (const job of candidates) {
    if (job.status !== "AWAITING_UPLOAD" && job.status !== "QUEUED" && job.status !== "PROCESSING") continue;
    const nextStatus = job.status === "AWAITING_UPLOAD" ? "CANCELLED" : "FAILED";
    const error = job.status === "AWAITING_UPLOAD"
      ? "The private upload expired before analysis started. Please try again."
      : "The analysis stopped making progress. Please try again.";
    const wasClosed = await prisma.$transaction(async (tx) => {
      const updated = await tx.analysisJob.updateMany({
        where: { id: job.id, status: job.status },
        data: { status: nextStatus, stage: null, error, completedAt: now },
      });
      if (updated.count !== 1) return false;
      await tx.report.updateMany({
        where: { id: job.reportId, status: "PROCESSING" },
        data: { status: "COMPLETE" },
      });
      return true;
    });
    if (wasClosed) {
      closed.push({ id: job.id, storageKey: job.storageKey, previousStatus: job.status });
    }
  }
  return closed;
}

export type ClearedFailedAnalysisJob = {
  id: string;
  storageKey: string;
};

/**
 * Remove failed job records after their retry/error state has had time to be
 * shown to the user. Reports are retained and are already returned to COMPLETE
 * when a job enters FAILED, so they remain available for another attempt.
 */
export async function clearExpiredFailedAnalysisJobs(
  now = new Date(),
): Promise<ClearedFailedAnalysisJob[]> {
  const completedBefore = new Date(now.getTime() - FAILED_ANALYSIS_JOB_RETENTION_MS);
  const candidates = await prisma.analysisJob.findMany({
    where: { status: "FAILED", completedAt: { lte: completedBefore } },
    select: { id: true, storageKey: true },
    orderBy: { completedAt: "asc" },
    take: 100,
  });

  const cleared: ClearedFailedAnalysisJob[] = [];
  for (const job of candidates) {
    const deleted = await prisma.analysisJob.deleteMany({
      where: { id: job.id, status: "FAILED", completedAt: { lte: completedBefore } },
    });
    if (deleted.count === 1) cleared.push(job);
  }
  return cleared;
}
