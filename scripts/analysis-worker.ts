import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { analyze } from "../src/domain/index";
import { runWrapped } from "../src/llm/run";
import { toWire } from "../src/ui/wire";
import { completeReport } from "../src/lib/reports";
import { prisma } from "../src/lib/prisma";
import { analysisInfrastructure, maximumExportBytes } from "../src/lib/analysis-infrastructure";
import { closeStaleAnalysisJobs } from "../src/lib/analysis-job-maintenance";
import * as Sentry from "@sentry/node";

const MAX_ATTEMPTS = 3;
const VISIBILITY_SECONDS = 15 * 60;
let stopping = false;
let nextMaintenanceAt = 0;

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
    const { parsed, analysis } = analyze(decoded);
    console.log(
      `[analysis-worker] job ${job.id} parsed ${analysis.volume.total.toLocaleString()} messages`,
    );
    parsed.chat.participants = [job.participantA, job.participantB];
    analysis.chat.participants = [job.participantA, job.participantB];

    const result = await runWrapped(parsed, analysis, {
      onProgress(note) {
        if (finished) return;
        console.log(`[analysis-worker] job ${job.id} ${note}`);
        void prisma.analysisJob.updateMany({
          where: { id: job.id, status: "PROCESSING" },
          data: { stage: note.slice(0, 500) },
        }).catch((error) => console.error("[analysis-worker] couldn't persist progress", error));
      },
    });
    const payload = toWire(result);
    await completeReport(job.reportId, job.userId, analysis, payload);
    finished = true;
    await prisma.analysisJob.update({
      where: { id: job.id },
      data: { status: "COMPLETE", stage: "Report ready", error: null, completedAt: new Date() },
    });
    console.log(
      `[analysis-worker] job ${job.id} complete in ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`,
    );
    return { handled: true, storageKey: job.storageKey };
  } catch (error) {
    finished = true;
    const message = error instanceof Error ? error.message : "The analysis worker failed.";
    console.error(`[analysis-worker] job ${job.id}`, error);
    Sentry.captureException(error, { tags: { component: "analysis-worker", jobId: job.id } });
    if (job.attempts < MAX_ATTEMPTS) {
      console.warn(
        `[analysis-worker] job ${job.id} queued for retry (${job.attempts}/${MAX_ATTEMPTS})`,
      );
      await prisma.analysisJob.update({
        where: { id: job.id },
        data: { status: "QUEUED", stage: "Waiting to retry", error: message.slice(0, 1_000) },
      });
      return { handled: false, storageKey: null };
    }
    console.error(`[analysis-worker] job ${job.id} failed after ${job.attempts} attempts`);
    await prisma.$transaction([
      prisma.analysisJob.update({
        where: { id: job.id },
        data: { status: "FAILED", stage: null, error: message.slice(0, 1_000), completedAt: new Date() },
      }),
      prisma.report.update({ where: { id: job.reportId }, data: { status: "COMPLETE" } }),
    ]);
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
