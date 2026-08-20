import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

const globalForAws = globalThis as unknown as {
  telescopeS3?: S3Client;
  telescopeSqs?: SQSClient;
};

export function analysisInfrastructure() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_UPLOAD_BUCKET;
  const queueUrl = process.env.AWS_SQS_ANALYSIS_QUEUE_URL;
  if (!region || !bucket || !queueUrl) {
    throw new Error("AWS analysis infrastructure is not configured.");
  }
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const s3 = globalForAws.telescopeS3 ?? new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  const sqs = globalForAws.telescopeSqs ?? new SQSClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });
  if (process.env.NODE_ENV !== "production") {
    globalForAws.telescopeS3 = s3;
    globalForAws.telescopeSqs = sqs;
  }
  return { s3, sqs, bucket, queueUrl };
}

export function maximumExportBytes() {
  const configured = Number(process.env.TELESCOPE_MAX_EXPORT_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 50 * 1024 * 1024;
}

export function dailyAnalysisLimit() {
  const configured = Number(process.env.TELESCOPE_DAILY_ANALYSIS_LIMIT);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
}

export const ANALYSIS_UPLOAD_TTL_SECONDS = 15 * 60;
export const ANALYSIS_JOB_TTL_MS = 24 * 60 * 60 * 1000;
