import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { analyze } from "../src/domain/index";
import { analyzeGroup, parseGroupExport, selectGroupParticipants, type GroupAnalysis } from "../src/domain/group";
import { runWrapped } from "../src/llm/run";
import { runGroupReading } from "../src/llm/group";
import { toWire } from "../src/ui/wire";
import { completeGroupReport, completeReport } from "../src/lib/reports";
import { prisma } from "../src/lib/prisma";
import { analysisInfrastructure, maximumExportBytes } from "../src/lib/analysis-infrastructure";
import {
  clearExpiredFailedAnalysisJobs,
  closeStaleAnalysisJobs,
} from "../src/lib/analysis-job-maintenance";
import * as Sentry from "@sentry/node";

const MAX_ATTEMPTS = 3;
const VISIBILITY_SECONDS = 15 * 60;
let stopping = false;
let nextMaintenanceAt = 0;

class NonRetryableJobError extends Error {}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  includeLocalVariables: false,
  tracesSampleRate: 0,
});

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function processJob(jobId: string) {
  const startedAt = Date.now();
  console.log(`[analysis-worker] job ${jobId} claiming`);
  const claimed = await prisma.analysisJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: {
      status: "PROCESSING",
      stage: "Downloading the private export",
      error: null,
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    console.log(`[analysis-worker] job ${jobId} skipped (not queued)`);
    return { handled: true, storageKey: null };
  }

  const job = await prisma.analysisJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      reportId: true,
      storageKey: true,
      uploadBytes: true,
      participantA: true,
      participantB: true,
      attempts: true,
      report: { select: { kind: true, chatId: true, analysis: true } },
    },
  });
  if (!job) {
    console.log(`[analysis-worker] job ${jobId} skipped (record missing)`);
    return { handled: true, storageKey: null };
  }
  const { s3, bucket } = analysisInfrastructure();
  let finished = false;
  try {
    console.log(`[analysis-worker] job ${job.id} downloading ${job.uploadBytes.toLocaleString()} bytes`);
    if (job.uploadBytes > maximumExportBytes()) throw new Error("The export exceeds the configured size limit.");
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: job.storageKey }));
    if (!object.Body) throw new Error("The private export was missing.");
    const raw = await object.Body.transformToString("utf-8");
    const decoded = JSON.parse(raw) as unknown;
    const progress = (note: string) => {
      if (finished) return;
      console.log(`[analysis-worker] job ${job.id} ${note}`);
      void prisma.analysisJob.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: { stage: note.slice(0, 500), startedAt: new Date() },
      }).catch((error) => console.error("[analysis-worker] couldn't persist progress", error));
    };
    if (job.report.kind === "GROUP") {
      const parsedGroup = parseGroupExport(decoded);
      if (job.report.chatId !== `group:${parsedGroup.chat.id}`) {
        throw new NonRetryableJobError("That export belongs to a different Telegram group.");
      }
      const saved = job.report.analysis as unknown as GroupAnalysis;
      const displayNames = new Map(saved.participants.map((person) => [person.id, person.name]));
      const selected = selectGroupParticipants(parsedGroup, new Set(displayNames.keys()), displayNames);
      const analysis = analyzeGroup(selected);
      console.log(`[analysis-worker] job ${job.id} parsed ${analysis.totalMessages.toLocaleString()} group messages`);
      const payload = await runGroupReading(selected, analysis, { onProgress: progress });
      const evidenceIds = new Set([...(payload.topics ?? payload.themes ?? []), ...payload.roles, ...(payload.eras ?? []), ...(payload.lore ?? [])].flatMap((item) => item.evidenceMessageIds));
      const groupAiEvidence = selected.messages.filter((message) => evidenceIds.has(message.id)).map((message) => ({ id: message.id, ts: message.ts, participantId: message.participantId, body: message.text.trim() || (message.media ? "[Media]" : "[Empty message]") }));
      await completeGroupReport(job.reportId, job.userId, analysis, payload, groupAiEvidence, job.id);
    } else {
      const { parsed, analysis } = analyze(decoded);
      if (job.report.chatId !== String(parsed.chat.id)) {
        throw new NonRetryableJobError("That export belongs to a different Telegram chat.");
      }
      console.log(`[analysis-worker] job ${job.id} parsed ${analysis.volume.total.toLocaleString()} messages`);
      parsed.chat.participants = [job.participantA, job.participantB];
      analysis.chat.participants = [job.participantA, job.participantB];
      const result = await runWrapped(parsed, analysis, { onProgress: progress });
      await completeReport(job.reportId, job.userId, analysis, toWire(result), job.id);
    }
    finished = true;
    console.log(
      `[analysis-worker] job ${job.id} complete in ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`,
    );
    return { handled: true, storageKey: job.storageKey };
  } catch (error) {
    finished = true;
    const message = error instanceof Error ? error.message : "The analysis worker failed.";
    console.error(`[analysis-worker] job ${job.id}`, error);
    Sentry.captureException(error, { tags: { component: "analysis-worker", jobId: job.id } });
    if (!(error instanceof NonRetryableJobError) && job.attempts < MAX_ATTEMPTS) {
      console.warn(
        `[analysis-worker] job ${job.id} queued for retry (${job.attempts}/${MAX_ATTEMPTS})`,
      );
      const requeued = await prisma.analysisJob.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: { status: "QUEUED", stage: "Waiting to retry", error: message.slice(0, 1_000) },
      });
      if (requeued.count !== 1) return { handled: true, storageKey: job.storageKey };
      return { handled: false, storageKey: null };
    }
    console.error(`[analysis-worker] job ${job.id} failed after ${job.attempts} attempts`);
    await prisma.$transaction(async (tx) => {
      const failed = await tx.analysisJob.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: { status: "FAILED", stage: null, error: message.slice(0, 1_000), completedAt: new Date() },
      });
      if (failed.count !== 1) return;
      await tx.report.updateMany({ where: { id: job.reportId, status: "PROCESSING" }, data: { status: "COMPLETE" } });
    });
    return { handled: true, storageKey: job.storageKey };
  }
}

async function main() {
  const { s3, sqs, bucket, queueUrl } = analysisInfrastructure();
  console.log("[analysis-worker] waiting for jobs");
  while (!stopping) {
    if (Date.now() >= nextMaintenanceAt) {
      nextMaintenanceAt = Date.now() + 5 * 60 * 1_000;
      try {
        const staleJobs = await closeStaleAnalysisJobs();
        for (const stale of staleJobs) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: stale.storageKey }));
          console.warn(`[analysis-worker] job ${stale.id} closed as stale (${stale.previousStatus})`);
        }
        const failedJobs = await clearExpiredFailedAnalysisJobs();
        for (const failed of failedJobs) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: failed.storageKey }))
            .catch((error) => console.error("[analysis-worker] expired failed export cleanup failed", error));
          console.log(`[analysis-worker] expired failed job ${failed.id} cleared`);
        }
      } catch (error) {
        console.error("[analysis-worker] stale job cleanup failed", error);
        Sentry.captureException(error, { tags: { component: "analysis-worker", operation: "stale-cleanup" } });
      }
    }
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: VISIBILITY_SECONDS,
    }));
    const message = response.Messages?.[0];
    if (!message?.ReceiptHandle || !message.Body) continue;
    let jobId = "";
    try {
      const body = JSON.parse(message.Body) as { jobId?: unknown };
      if (typeof body.jobId !== "string") throw new Error("Queue message has no jobId.");
      jobId = body.jobId;
      console.log(`[analysis-worker] received job ${jobId}`);
    } catch (error) {
      console.error("[analysis-worker] invalid queue message", error);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      continue;
    }

    const heartbeat = setInterval(() => {
      void sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: VISIBILITY_SECONDS,
      })).catch((error) => console.error("[analysis-worker] visibility heartbeat failed", error));
    }, 60_000);
    try {
      const result = await processJob(jobId);
      if (result.handled) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
        console.log(`[analysis-worker] job ${jobId} removed from queue`);
      }
      if (result.storageKey) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: result.storageKey }))
          .then(() => console.log(`[analysis-worker] job ${jobId} deleted temporary export`))
          .catch((error) => console.error("[analysis-worker] export cleanup failed", error));
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[analysis-worker] fatal", error);
  Sentry.captureException(error, { tags: { component: "analysis-worker", fatal: "true" } });
  process.exitCode = 1;
});
