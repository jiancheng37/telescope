"use client";

import { useState } from "react";

export function ReportActions({ reportId, publicPath, canConfigureMessages = false, initialIncludeMessages = false, evidenceKind = "direct" }: { reportId?: string; publicPath?: string; canConfigureMessages?: boolean; initialIncludeMessages?: boolean; evidenceKind?: "direct" | "group" }) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [includeMessages, setIncludeMessages] = useState(initialIncludeMessages);

  const share = async (messagePreference?: boolean) => {
    if (!publicPath && !canConfigureMessages) {
      try {
        const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as { confirmSharing?: boolean };
        if (preferences.confirmSharing !== false && !window.confirm("Create a public link to this report? Anyone with the link can view it.")) return;
      } catch {
        if (!window.confirm("Create a public link to this report? Anyone with the link can view it.")) return;
      }
    }
    setState("working");
    try {
      let path = publicPath;
      if (!path && reportId) {
        let evidence: { doubleTextMessages?: unknown; extremeEvidence?: unknown; groupAiEvidence?: unknown; groupExtremeEvidence?: unknown } | undefined;
        if (messagePreference) {
          try {
            if (evidenceKind === "group") {
              const groupAiEvidence = localStorage.getItem(`telescope:group-ai-evidence:${reportId}`);
              const groupExtremeEvidence = localStorage.getItem(`telescope:group-extremes:${reportId}`);
              evidence = { ...(groupAiEvidence ? { groupAiEvidence: JSON.parse(groupAiEvidence) as unknown } : {}), ...(groupExtremeEvidence ? { groupExtremeEvidence: JSON.parse(groupExtremeEvidence) as unknown } : {}) };
            } else {
              const doubleTextMessages = localStorage.getItem(`telescope:double-text:${reportId}`);
              const extremeEvidence = localStorage.getItem(`telescope:extremes:${reportId}`);
              evidence = { ...(doubleTextMessages ? { doubleTextMessages: JSON.parse(doubleTextMessages) as unknown } : {}), ...(extremeEvidence ? { extremeEvidence: JSON.parse(extremeEvidence) as unknown } : {}) };
            }
          } catch {
            // AI excerpts can still be shared if optional browser-local receipts
            // are corrupt or unavailable.
          }
        }
        const response = await fetch(`/api/reports/${reportId}/share`, {
          method: "POST",
          headers: messagePreference === undefined ? undefined : { "content-type": "application/json" },
          body: messagePreference === undefined ? undefined : JSON.stringify({ includeMessages: messagePreference, evidence }),
        });
        if (!response.ok) throw new Error("Could not create link");
        path = ((await response.json()) as { path: string }).path;
      }
      if (!path) throw new Error("Save this report before sharing it");
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setOpen(false);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="report-actions flex flex-wrap gap-3">
      {(reportId || publicPath) && <button type="button" onClick={() => canConfigureMessages && !publicPath ? setOpen(true) : void share()} disabled={state === "working"} className="report-action-button"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-none stroke-current" strokeWidth="1.7"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{state === "copied" ? "Link copied" : state === "error" ? "Try sharing again" : state === "working" ? "Creating link" : "Share report"}</span></button>}
      {open && <div className="fixed inset-0 z-[110] grid place-items-center bg-night/82 px-4 py-6 text-left backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="share-privacy-title" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}><section className="w-full max-w-[560px] rounded-[26px] border border-white/16 bg-night p-6 text-white shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-5"><div><p className="font-mono text-[9px] uppercase tracking-[.16em] text-accent-lit">Share privacy</p><h2 id="share-privacy-title" className="mt-3 font-display text-[clamp(2.3rem,6vw,4rem)] leading-[.92]">What should they see?</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Close sharing options" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/16 text-xl text-white/50">×</button></div><p className="mt-5 text-sm leading-relaxed text-white/55">AI summaries can still describe what you discussed. Direct quotations and message context are controlled separately below.</p><label className="mt-6 flex cursor-pointer items-center justify-between gap-5 border-y border-white/14 py-5"><span><span className="block text-sm font-semibold">Include message excerpts</span><span className="mt-1 block text-xs leading-relaxed text-white/45">Show only the source excerpts used as evidence in this report.</span></span><input type="checkbox" checked={includeMessages} onChange={(event) => setIncludeMessages(event.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--color-accent-lit)]" /></label><p className="mt-4 font-mono text-[9px] uppercase tracking-[.1em] text-safe-lit">{includeMessages ? "Evidence messages will be visible" : "Insights only · messages hidden"}</p><div className="mt-7 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="px-4 py-3 text-sm text-white/48">Cancel</button><button type="button" disabled={state === "working"} onClick={() => void share(includeMessages)} className="rounded-full bg-accent-lit px-6 py-3 text-sm font-semibold text-night disabled:opacity-50">{state === "working" ? "Creating link…" : "Create link"}</button></div></section></div>}
    </div>
  );
}
