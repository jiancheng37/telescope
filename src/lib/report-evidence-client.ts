import type { ReportEvidence } from "@/lib/report-evidence";

const MAX_SYNC_BYTES = 3.5 * 1024 * 1024;

export function syncableReportEvidence(evidence: ReportEvidence): ReportEvidence {
  const selected: ReportEvidence = {};
  for (const key of ["groupAi", "extremes", "doubleText", "stickers"] as const) {
    if (evidence[key] === undefined) continue;
    const candidate = { ...selected, [key]: evidence[key] };
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength <= MAX_SYNC_BYTES) Object.assign(selected, { [key]: evidence[key] });
  }
  return selected;
}

export async function syncReportEvidence(reportId: string, evidence: ReportEvidence) {
  const selected = syncableReportEvidence(evidence);
  if (Object.keys(selected).length === 0) return;
  const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/evidence`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selected),
  });
  if (!response.ok) throw new Error("Report evidence could not be synced.");
}
