"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Kicker, NightPanel } from "./primitives";
import { TELESCOPE_AI_PROGRESS_EVENT, type AiProgressState } from "./Report";
import { parseExport } from "@/domain/parse";
import { buildStickerVisuals, filesFromDrop, resultJsonFrom, TELESCOPE_STICKER_VISUALS_EVENT } from "./sticker-assets";
import { cancelAnalysisJob, requestAnalysis, waitForAnalysisJob } from "@/lib/analysis-client";
import { syncReportEvidence } from "@/lib/report-evidence-client";

type State =
  | { kind: "idle" }
  | { kind: "working"; note: string }
  | { kind: "error"; message: string };

const AI_STAGES = ["reading the conversation", "checking every quotation", "writing verdict candidates", "judging the candidates", "assembling the report"] as const;
const aiStage = (note: string) => {
  if (note.startsWith("  reading:")) return 1;
  if (note.startsWith("reading:")) return 2;
  if (note === "generating verdict candidates") return 2;
  if (note.startsWith("  verdict_candidates:") || note.includes("candidates to judge")) return 3;
  if (note.startsWith("  judgement:") || note.startsWith("verdict:")) return 4;
  return 0;
};

function announce(detail: AiProgressState) {
  window.dispatchEvent(new CustomEvent(TELESCOPE_AI_PROGRESS_EVENT, { detail }));
}

export function SavedReportReadingControl({
  reportId,
  participants,
  processing = false,
  startOpen = false,
}: {
  reportId: string;
  participants: [string, string];
  processing?: boolean;
  startOpen?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(startOpen && !processing);
  const [dragging, setDragging] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!processing) return;
    let active = true;
    const controller = new AbortController();
    const resume = async () => {
      try {
        const response = await fetch(`/api/analysis-jobs?reportId=${encodeURIComponent(reportId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const job = await response.json() as { id: string; status: string };
        if (job.status !== "QUEUED" && job.status !== "PROCESSING") return;
        setActiveJobId(job.id);
        await waitForAnalysisJob(job.id, (note) => {
          if (!active) return;
          setState({ kind: "working", note });
          const stage = aiStage(note);
          announce({ kind: "working", stage: stage + 1, total: AI_STAGES.length, label: AI_STAGES[stage] });
        }, controller.signal);
        if (!active) return;
        announce({ kind: "done" });
        setActiveJobId(null);
        router.refresh();
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        announce({ kind: "error" });
        setState({ kind: "error", message: error instanceof Error ? error.message : "The written reading failed." });
      }
    };
    void resume();
    return () => { active = false; controller.abort(); };
  }, [processing, reportId, router]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.kind !== "working") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, state.kind]);

  const choose = async (files: File[]) => {
    setState({ kind: "working", note: "Reading the file on this machine" });
    try {
      const file = resultJsonFrom(files);
      if (!file) throw new Error("No result.json was found in that export folder.");
      const rawText = (await file.text()).replace(/^\uFEFF/, "");
      const parsed = parseExport(JSON.parse(rawText) as unknown);
      parsed.chat.participants = participants;
      const visuals = await buildStickerVisuals(parsed, files);
      if (visuals) {
        try { localStorage.setItem(`telescope:stickers:${reportId}`, JSON.stringify(visuals)); } catch { /* AI analysis can continue without persisted art. */ }
        void syncReportEvidence(reportId, { stickers: visuals }).catch(() => undefined);
        window.dispatchEvent(new CustomEvent(TELESCOPE_STICKER_VISUALS_EVENT, { detail: visuals }));
      }
      setState({ kind: "working", note: "Preparing the private upload" });
      announce({ kind: "working", stage: 1, total: AI_STAGES.length, label: AI_STAGES[0] });
      setOpen(false);
      await requestAnalysis({
        raw: rawText,
        reportId,
        participants,
        onProgress(note) {
          setState({ kind: "working", note });
          const stage = aiStage(note);
          announce({ kind: "working", stage: stage + 1, total: AI_STAGES.length, label: AI_STAGES[stage] });
        },
        onJobCreated: setActiveJobId,
      });
      announce({ kind: "done" });
      setActiveJobId(null);
      try {
        sessionStorage.setItem(`telescope:ai-ready:${reportId}`, "1");
      } catch {
        // The report still refreshes if browser storage is unavailable.
      }
      router.refresh();
    } catch (error) {
      announce({ kind: "error" });
      setOpen(true);
      setState({
        kind: "error",
        message:
          error instanceof SyntaxError
            ? "The result.json in that export folder is not valid JSON."
            : error instanceof Error
              ? error.message
              : "The written reading could not be completed.",
      });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const cancel = async () => {
    if (!activeJobId) return;
    try {
      await cancelAnalysisJob(activeJobId);
      setActiveJobId(null);
      announce({ kind: "error" });
      setState({ kind: "error", message: "Analysis cancelled. You can try again whenever you are ready." });
      router.refresh();
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "The analysis could not be cancelled." });
    }
  };

  return (
    <>
      <NightPanel className="ai-insights-panel border border-accent-lit/45 shadow-[inset_0_0_0_1px_rgba(42,171,238,.06)]">
        <Kicker tone="lit" className="mb-3.5">Powered by AI</Kicker>
        <p className="font-display text-[24px] leading-[1.05] text-white">Unlock what the numbers cannot name.</p>
        <p className="mt-3 text-sm leading-relaxed text-white/58">Get new insights into the patterns running through this conversation.</p>
        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-white/12 py-4 font-mono text-[9px] uppercase tracking-[0.1em] text-white/42">
          <li>Named eras</li><li>Recurring lore</li><li>Wild sentences</li><li>The roles you grew into</li>
        </ul>
        <button type="button" disabled={processing || state.kind === "working"} onClick={() => setOpen(true)} className="mt-5 w-full rounded-full bg-accent-lit px-5 py-3 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-wait disabled:opacity-55">{processing || state.kind === "working" ? "AI insights are running…" : "Get new insights"}</button>
        {processing && <p className="mt-3 font-mono text-[9px] uppercase tracking-[.12em] text-accent-lit">You can keep reading this report while the model finishes.</p>}
        {activeJobId && <button type="button" onClick={() => void cancel()} className="mt-3 text-xs text-white/45 underline decoration-white/25 underline-offset-4 transition hover:text-white">Cancel and try again</button>}
        {state.kind === "error" && <p className="mt-3 text-sm leading-relaxed text-side-a">{state.message}</p>}
      </NightPanel>

      {open && typeof document !== "undefined" && createPortal((
        <div
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-night/82 px-3 py-3 backdrop-blur-md sm:px-6 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="insights-upload-title"
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget && state.kind !== "working") setOpen(false);
          }}
        >
          <div className="starfield rise relative my-auto w-full max-w-[820px] overflow-hidden rounded-[22px] border border-white/16 bg-night p-5 text-white shadow-2xl sm:rounded-[30px] sm:p-8 lg:p-10" onClick={(event) => event.stopPropagation()}>
            <button type="button" disabled={state.kind === "working"} onClick={() => setOpen(false)} aria-label="Close AI insights" className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/16 bg-night/75 text-xl text-white/55 backdrop-blur transition hover:border-white/40 hover:text-white disabled:opacity-30 sm:right-6 sm:top-6">×</button>
            <header className="relative border-b border-white/12 pb-5 pr-12 sm:pb-7 sm:pr-16">
              <Kicker tone="lit">AI insights</Kicker><h2 id="insights-upload-title" className="mt-3 max-w-[14ch] font-display text-[clamp(2.65rem,7vw,4.7rem)] leading-[.9] tracking-[-.025em]">Bring the conversation back.</h2>
            </header>
            <div className="relative pt-6 sm:pt-7">
              <p className="max-w-[60ch] text-sm leading-relaxed text-white/58 sm:text-[15px]">The raw chat was never saved. Choose the same Telegram export folder so AI can surface eras, lore, topics and the roles you each take. Sticker assets are detected automatically.</p>
              <div className="mt-6">
                <input ref={input} type="file" {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} className="sr-only" onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void choose(files); }} />
                <button
                  type="button"
                  disabled={state.kind === "working"}
                  onClick={() => input.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); void filesFromDrop(event.dataTransfer).then((files) => { if (files.length) void choose(files); }); }}
                  className={`relative flex min-h-[170px] w-full flex-col items-center justify-center rounded-[18px] border border-dashed px-5 py-7 text-center transition sm:min-h-[210px] sm:px-8 ${dragging ? "border-accent-lit bg-accent-lit/12" : "border-white/22 bg-white/[.035] hover:border-accent-lit/70 hover:bg-white/[.06]"}`}
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full border border-accent-lit/55 text-xl text-accent-lit sm:h-14 sm:w-14">↗</span>
                  <span className="mt-4 font-display text-[clamp(1.65rem,5vw,2.35rem)] leading-none">{state.kind === "working" ? "Reading the conversation…" : "Choose the export folder"}</span>
                  <span className="mt-3 max-w-[34ch] text-xs leading-relaxed text-white/38">Sticker files stay in this browser and are used only when present</span>
                </button>
                {state.kind === "working" && <p className="relative mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-accent-lit">{state.note}</p>}
                {state.kind === "error" && <p className="relative mt-4 text-sm leading-relaxed text-side-a">{state.message}</p>}
              </div>
              <p className="mt-6 border-t border-white/12 pt-4 text-xs leading-relaxed text-white/36">This AI step sends the conversation to the server for analysis. The raw file is not added to your saved report.</p>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
