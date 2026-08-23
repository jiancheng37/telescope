"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Kicker, NightPanel } from "./primitives";
import { parseGroupExport } from "@/domain/group";
import { filesFromDrop, resultJsonFrom } from "./sticker-assets";
import { cancelAnalysisJob, requestGroupAnalysis, waitForAnalysisJob } from "@/lib/analysis-client";
import type { GroupAiPayload } from "@/llm/group";
import { TELESCOPE_AI_PROGRESS_EVENT, type AiProgressState } from "./Report";

type State = { kind: "idle" } | { kind: "working"; note: string } | { kind: "error"; message: string };
const GROUP_STAGES = ["preparing the private upload", "reading the room", "checking source messages", "naming eras and lore", "assembling the report"];
const groupStage = (note: string) => note.toLocaleLowerCase().includes("upload") ? 0 : note.toLocaleLowerCase().includes("representative") ? 1 : note.toLocaleLowerCase().includes("reading") ? 2 : note.toLocaleLowerCase().includes("theme") ? 3 : 4;
const announce = (detail: AiProgressState) => window.dispatchEvent(new CustomEvent(TELESCOPE_AI_PROGRESS_EVENT, { detail }));
const announceWorking = (note: string) => { const stage = groupStage(note); announce({ kind: "working", stage: stage + 1, total: GROUP_STAGES.length, label: GROUP_STAGES[stage] }); };

export function SavedGroupReadingControl({ reportId, processing = false, startOpen = false }: { reportId: string; processing?: boolean; startOpen?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(startOpen && !processing);
  const [dragging, setDragging] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!processing) return;
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/analysis-jobs?reportId=${encodeURIComponent(reportId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const job = await response.json() as { id: string; status: string };
        if (!["QUEUED", "PROCESSING"].includes(job.status)) return;
        setActiveJobId(job.id);
        await waitForAnalysisJob<GroupAiPayload>(job.id, (note) => { if (active) { setState({ kind: "working", note }); announceWorking(note); } }, controller.signal);
        if (active) { announce({ kind: "done" }); setActiveJobId(null); router.refresh(); }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) { announce({ kind: "error" }); setState({ kind: "error", message: error instanceof Error ? error.message : "The group reading failed." }); }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [processing, reportId, router]);

  const choose = async (files: File[]) => {
    setState({ kind: "working", note: "Reading the group export on this machine" });
    try {
      const file = resultJsonFrom(files);
      if (!file) throw new Error("No result.json was found in that export folder.");
      const raw = (await file.text()).replace(/^\uFEFF/, "");
      const parsed = parseGroupExport(JSON.parse(raw) as unknown);
      setOpen(false);
      announceWorking("Preparing a private upload");
      const ai = await requestGroupAnalysis({ raw, reportId, onProgress: (note) => { setState({ kind: "working", note }); announceWorking(note); }, onJobCreated: setActiveJobId });
      const ids = new Set([...(ai.topics ?? ai.themes ?? []), ...ai.roles, ...(ai.eras ?? []), ...(ai.lore ?? [])].flatMap((item) => item.evidenceMessageIds));
      const evidence = parsed.messages.filter((message) => ids.has(message.id)).map((message) => ({ id: message.id, ts: message.ts, participantId: message.participantId, body: message.text.trim() || (message.media ? "[Media]" : "[Empty message]") }));
      if (evidence.length) {
        try { localStorage.setItem(`telescope:group-ai-evidence:${reportId}`, JSON.stringify(evidence)); } catch { /* The insights remain usable without browser-local excerpts. */ }
      }
      announce({ kind: "done" });
      setActiveJobId(null);
      router.refresh();
    } catch (error) {
      announce({ kind: "error" }); setOpen(true);
      setState({ kind: "error", message: error instanceof SyntaxError ? "The result.json in that folder is not valid JSON." : error instanceof Error ? error.message : "The group reading failed." });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const cancel = async () => {
    if (!activeJobId) return;
    try { await cancelAnalysisJob(activeJobId); setActiveJobId(null); setState({ kind: "error", message: "Analysis cancelled. You can try again whenever you are ready." }); router.refresh(); }
    catch (error) { setState({ kind: "error", message: error instanceof Error ? error.message : "The analysis could not be cancelled." }); }
  };

  return <>
    <NightPanel className="ai-insights-panel border border-accent-lit/45 shadow-[inset_0_0_0_1px_rgba(42,171,238,.06)]">
      <Kicker tone="lit" className="mb-3.5">Powered by AI</Kicker>
      <p className="font-display text-[24px] leading-[1.05] text-white">Name what holds the room together.</p>
      <p className="mt-3 text-sm leading-relaxed text-white/58">Go beyond totals to the patterns that only appear between people.</p>
      <ul className="mt-4 grid grid-cols-3 gap-2 border-y border-white/12 py-4 text-center font-mono text-[8px] uppercase tracking-[.1em] text-white/42"><li>Topics</li><li>Group roles</li><li>Eras</li></ul>
      <button type="button" disabled={processing || state.kind === "working"} onClick={() => setOpen(true)} className="mt-5 w-full rounded-full bg-accent-lit px-5 py-3 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-wait disabled:opacity-55">{processing || state.kind === "working" ? "Group insights are running…" : "Get group insights"}</button>
      {activeJobId && <button type="button" onClick={() => void cancel()} className="mt-3 text-xs text-white/45 underline decoration-white/25 underline-offset-4 hover:text-white">Cancel and try again</button>}
      {state.kind === "error" && <p className="mt-3 text-sm text-side-a">{state.message}</p>}
    </NightPanel>
    {open && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-night/82 px-3 py-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="group-insights-title" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && state.kind !== "working") setOpen(false); }}>
      <section className="starfield rise relative w-full max-w-[820px] overflow-hidden rounded-[26px] border border-white/16 bg-night p-6 text-white shadow-2xl sm:p-9" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close group insights" className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full border border-white/16 text-xl text-white/55 hover:text-white">×</button>
        <header className="border-b border-white/12 pb-6 pr-14"><Kicker tone="lit">Group insights</Kicker><h2 id="group-insights-title" className="mt-3 max-w-[13ch] font-display text-[clamp(2.7rem,7vw,4.8rem)] leading-[.9]">Bring the room back.</h2></header>
        <p className="mt-6 max-w-[62ch] text-sm leading-relaxed text-white/58">Choose the same Telegram export folder. AI will name recurring topics, conversational roles, shared lore and the eras detected across the people already included in this report.</p>
        <input ref={input} type="file" {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} className="sr-only" onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void choose(files); }} />
        <button type="button" onClick={() => input.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void filesFromDrop(event.dataTransfer).then((files) => files.length && void choose(files)); }} className={`mt-6 flex min-h-[190px] w-full flex-col items-center justify-center rounded-[18px] border border-dashed px-6 py-7 text-center transition ${dragging ? "border-accent-lit bg-accent-lit/12" : "border-white/22 bg-white/[.035] hover:border-accent-lit/70"}`}><span className="grid h-13 w-13 place-items-center rounded-full border border-accent-lit/55 text-xl text-accent-lit">↗</span><span className="mt-4 font-display text-[clamp(1.7rem,5vw,2.4rem)]">Choose the group export</span><span className="mt-3 text-xs text-white/38">The same result.json used to create this report</span></button>
        {state.kind === "working" && <p className="mt-4 font-mono text-[9px] uppercase tracking-[.12em] text-accent-lit">{state.note}</p>}
        {state.kind === "error" && <p className="mt-4 text-sm text-side-a">{state.message}</p>}
        <p className="mt-6 border-t border-white/12 pt-4 text-xs leading-relaxed text-white/36">This step temporarily sends the raw conversation to the analysis server. It is deleted after processing and is never stored in the saved report; only the written insights and source message IDs are saved.</p>
      </section>
    </div>, document.body)}
  </>;
}
