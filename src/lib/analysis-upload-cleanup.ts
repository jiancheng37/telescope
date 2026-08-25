import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { analysisInfrastructure } from "@/lib/analysis-infrastructure";

export async function deleteAnalysisUploads(storageKeys: readonly string[]) {
  const keys = [...new Set(storageKeys)];
  if (!keys.length) return;
  const { s3, bucket } = analysisInfrastructure();
  await Promise.all(keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }))));
}
