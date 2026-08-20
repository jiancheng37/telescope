"use client";

import type { WirePayload } from "@/ui/wire";

type JobState = {
  status: "AWAITING_UPLOAD" | "QUEUED" | "PROCESSING" | "COMPLETE" | "FAILED" | "CANCELLED";
  stage: string | null;
  error: string | null;
  reportId: string;
  result: WirePayload | null;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function errorFrom(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

export async function waitForAnalysisJob(jobId: string, onProgress?: (note: string) => void, signal?: AbortSignal) {
  let previousStage = "";
  while (true) {
    await wait(2_000);
    if (signal?.aborted) throw new DOMException("Analysis polling was cancelled.", "AbortError");
    const response = await fetch(`/api/analysis-jobs/${jobId}`, { cache: "no-store", signal });
    if (!response.ok) throw await errorFrom(response, `The analysis status could not be read (${response.status}).`);
    const job = await response.json() as JobState;
    if (job.stage && job.stage !== previousStage) {
      previousStage = job.stage;
      onProgress?.(job.stage);
    }
    if (job.status === "COMPLETE") {
      if (!job.result) throw new Error("The job completed without a report payload.");
      return job.result;
    }
    if (job.status === "FAILED" || job.status === "CANCELLED") {
      throw new Error(job.error ?? "The analysis job did not complete.");
    }
  }
}

export async function requestAnalysis({
  raw,
  reportId,
  participants,
  onProgress,
  onJobCreated,
  signal,
}: {
  raw: string;
  reportId: string;
  participants: [string, string];
  onProgress?: (note: string) => void;
  onJobCreated?: (jobId: string) => void;
  signal?: AbortSignal;
}): Promise<WirePayload> {
  const uploadBytes = new TextEncoder().encode(raw).byteLength;
  onProgress?.("Preparing a private upload");
  const created = await fetch("/api/analysis-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportId, participants, uploadBytes }),
  });
  if (!created.ok) throw await errorFrom(created, `The analysis service returned ${created.status}.`);
  const { jobId, uploadUrl } = await created.json() as { jobId: string; uploadUrl: string };
  onJobCreated?.(jobId);

  onProgress?.("Uploading the conversation privately");
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: raw,
  });
  if (!uploaded.ok) throw new Error(`The private upload failed (${uploaded.status}).`);

  const queued = await fetch(`/api/analysis-jobs/${jobId}/uploaded`, { method: "POST" });
  if (!queued.ok) throw await errorFrom(queued, `The analysis job could not be queued (${queued.status}).`);

  return waitForAnalysisJob(jobId, onProgress, signal);
}

export async function cancelAnalysisJob(jobId: string) {
  const response = await fetch(`/api/analysis-jobs/${jobId}`, { method: "DELETE" });
  if (!response.ok) throw await errorFrom(response, `The analysis could not be cancelled (${response.status}).`);
}
