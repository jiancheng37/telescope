"use client";

/**
 * Everything before the report, and the control that turns the written half on.
 *
 * The file is read and analysed here, in the browser. That isn't an optimisation —
 * it's the privacy story: drop an export, get the whole deterministic report, and
 * the conversation never leaves the machine. The written half is a separate,
 * explicit opt-in, and the button that turns it on says what it does.
 *
 * The landing copy deliberately doesn't show a chart. Every mockup of a landing
 * page has an illustrative graph on it, and this one can't: before a file is
 * dropped there is no data, and a graph of invented numbers on the front of a
 * tool whose entire pitch is "we only tell you things we counted" is the one
 * thing it can't afford to do.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ParseError, analyzeParsed, parseExport, type Parsed } from "@/domain";
import type { Analysis } from "@/domain/types";
import { Report, type AiProgressState, type LocalExtremeEvidence, type LocalStreakMessage } from "@/ui/Report";
import { ReportActions } from "@/ui/ReportActions";
import { type DeckCard, buildDeck } from "@/ui/cards";
import { Callout, Kicker, Logo, NightPanel, Panel, Pill, Shield } from "@/ui/primitives";
import type { WirePayload, WrappedStreamEvent } from "@/ui/wire";
import { signOutCurrentUser } from "@/app/actions/auth";
import { buildStickerVisuals, filesFromDrop, resultJsonFrom, type LocalStickerVisuals } from "@/ui/sticker-assets";
import { invalidateDashboardData } from "@/app/app/dashboard-data";
import { TELESCOPE_OPEN_REPORT_EVENT } from "@/app/app/AppShell";

export type Viewer = {
  name: string;
  image: string | null;
  reports: Array<{
    id: string;
    title: string;
    participantA: string;
    participantB: string;
    createdAt: string;
  }>;
} | null;

interface Loaded {
  analysis: Analysis;
  deck: DeckCard[];
  /** kept so the LLM pass can be run after the report is already on screen */
  raw: string;
  reportId: string | null;
  participants: [string, string];
  doubleTextMessages?: LocalStreakMessage[];
  extremeEvidence?: LocalExtremeEvidence;
  stickerVisuals?: LocalStickerVisuals;
  autoRunAi?: boolean;
}

interface PendingFile {
  raw: string;
  parsed: Parsed;
  files: File[];
}

type Phase = { kind: "idle" } | { kind: "working"; note: string } | { kind: "done" } | { kind: "error"; message: string };

function localDoubleTextEvidence(parsed: Parsed, analysis: Analysis): LocalStreakMessage[] | undefined {
  const ids = analysis.rhythm.doubleTexting?.longest?.messageIds;
  if (!ids?.length) return undefined;
  const wanted = new Set(ids);
  return parsed.messages
    .filter((message) => wanted.has(message.id))
    .map((message) => ({
      id: message.id,
      ts: message.ts,
      who: message.who,
      body: message.text.trim() ||
        (message.attachment === "photo"
          ? "[Photo]"
          : message.mediaType === "sticker"
            ? `[Sticker${message.stickerEmoji ? ` ${message.stickerEmoji}` : ""}]`
            : message.mediaType === "voice_message"
              ? "[Voice note]"
              : message.mediaType === "video_message"
                ? "[Telebubble]"
                : "[Media]"),
    }));
}

function localExtremeEvidence(parsed: Parsed, analysis: Analysis): LocalExtremeEvidence | undefined {
  const lengths = analysis.language.longestMessages;
  const longestSide = lengths && lengths.a.chars >= lengths.b.chars ? 0 : 1;
  const longestMessageId = lengths ? (longestSide === 0 ? lengths.a.messageId : lengths.b.messageId) : null;
  const mono = analysis.rhythm.monologues;
  const runSide = mono.a.maxRunLength >= mono.b.maxRunLength ? 0 : 1;
  const runIds = (runSide === 0 ? mono.a.longestRun : mono.b.longestRun)?.messageIds ?? [];
  const runSet = new Set(runIds);
  const toLocal = (message: Parsed["messages"][number]): LocalStreakMessage => ({
    id: message.id,
    ts: message.ts,
    who: message.who,
    body: message.text.trim() || (message.attachment === "photo" ? "[Photo]" : message.mediaType === "sticker" ? `[Sticker${message.stickerEmoji ? ` ${message.stickerEmoji}` : ""}]` : message.mediaType === "voice_message" ? "[Voice note]" : message.mediaType === "video_message" ? "[Telebubble]" : "[Media]"),
  });
  const longestMessage = longestMessageId === null ? undefined : parsed.messages.find((message) => message.id === longestMessageId);
  const longestRun = parsed.messages.filter((message) => runSet.has(message.id)).map(toLocal);
  if (!longestMessage && !longestRun.length) return undefined;
  return { longestMessage: longestMessage ? toLocal(longestMessage) : undefined, longestRun: longestRun.length ? longestRun : undefined };
}

/**
 * The five things the pipeline actually does, in order.
 *
 * There is no percentage here on purpose. The stream reports which stage it is
 * in, not how far through it is, and a progress bar that interpolates a number
 * nobody measured is a lie told in a soothing way. The bar fills by completed
 * stage instead.
 */
const STAGES = [
  "reading the conversation",
  "checking every quotation",
  "writing verdict candidates",
  "judging the candidates",
  "assembling the report",
] as const;

/** Which stage a raw stream note puts us in. Order of tests matters. */
function stageOf(note: string): number {
  if (note.startsWith("  reading:")) return 1;
  if (note.startsWith("  verdict_candidates:")) return 3;
  if (note.startsWith("  judgement:")) return 4;
  if (note.startsWith("verdict:")) return 4;
  if (note.startsWith("reading:")) return 2;
  if (note === "generating verdict candidates") return 2;
  if (note.includes("candidates to judge")) return 3;
  if (note.startsWith("reading ")) return 0;
  return 0;
}

/** The one italic line under the big number. Human, and specific to the stage. */
function progressCopy(note: string): string {
  const stage = stageOf(note);
  if (stage === 0) return "Reading the whole conversation. This takes a minute or two.";
  if (stage === 1) return "Read. Now checking that every quote is really in there.";
  if (stage === 2) return "Quotes check out. Writing candidate verdicts.";
  if (stage === 3) return "Candidates written. Judging them against the numbers.";
  return "Judged. Assembling the report.";
}

/** Model calls, not stages: the pipeline is three calls over one payload. */
const CALL_OF_STAGE = [1, 1, 2, 3, 3];

export default function HomeClient({ viewer, startView = "landing" }: { viewer: Viewer; startView?: "landing" | "workspace" }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [llm, setLlm] = useState<WirePayload | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [prepared, setPrepared] = useState<Loaded | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const requestLlm = useCallback(async (target: Loaded, keepCreationLoading = false) => {
    setPhase({ kind: "working", note: "reading the conversation" });
    try {
      const res = await fetch("/api/wrapped", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(target.reportId ? { "x-report-id": target.reportId } : {}),
        },
        body: `{"export":${target.raw},"participants":${JSON.stringify(target.participants)}}`,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The server returned ${res.status}.`);
      }
      if (!res.body) throw new Error("The server returned no progress stream.");

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let result: WirePayload | null = null;
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as WrappedStreamEvent;
        if (event.type === "progress") setPhase({ kind: "working", note: event.note });
        else if (event.type === "result") result = event.payload;
        else throw new Error(event.message);
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) receive(line);
      }
      receive(buffer);
      if (!result) throw new Error("The progress stream ended before the reading finished.");
      setLlm(result);
      setPhase(keepCreationLoading ? { kind: "working", note: "assembling your Wrapped" } : { kind: "done" });
      return result;
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "The reading failed." });
      throw err;
    }
  }, []);

  const load = useCallback(async (files: File[]) => {
    setPhase({ kind: "working", note: "reading the file" });
    try {
      const file = resultJsonFrom(files);
      if (!file) throw new ParseError("No result.json was found.", "Choose the complete Telegram export folder that contains result.json.");
      // JSON.parse rejects a leading byte-order mark even though it is valid in
      // a UTF-8 text file. Some Telegram/Desktop combinations include one.
      const raw = (await file.text()).replace(/^\uFEFF/, "");
      // Yield once so the "working" state actually paints before parse blocks the
      // main thread — a 2.6MB export takes long enough to look like a dead click.
      await new Promise((r) => setTimeout(r, 0));
      const parsed = parseExport(JSON.parse(raw));
      setPendingFile({ raw, parsed, files });
      setPhase({ kind: "idle" });
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof ParseError
            ? err.message
            : err instanceof SyntaxError
              ? `The result.json in that folder could not be parsed: ${err.message}`
              : err instanceof Error
                ? err.message
                : "Couldn't read that file.",
      });
    }
  }, []);

  const confirmParticipants = useCallback(async (participants: [string, string], withAi: boolean) => {
    if (!pendingFile) return;
    setPrepared(null);
    setPendingFile(null);
    setPhase({ kind: "working", note: "counting" });
    try {
      // `analyzeParsed` is intentionally local and synchronous, but a large chat
      // can occupy the main thread for long enough that React's loading state has
      // not painted yet. Two animation frames commit the modal and put it on
      // screen before counting begins.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      pendingFile.parsed.chat.participants = participants;
      const analysis = analyzeParsed(pendingFile.parsed);
      const doubleTextMessages = localDoubleTextEvidence(pendingFile.parsed, analysis);
      const extremeEvidence = localExtremeEvidence(pendingFile.parsed, analysis);
      const stickerVisuals = await buildStickerVisuals(pendingFile.parsed, pendingFile.files);
      let reportId: string | null = null;
      if (viewer) {
        setPhase({ kind: "working", note: "saving your report" });
        const response = await fetch("/api/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(analysis),
        });
        if (response.ok) {
          reportId = ((await response.json()) as { id: string }).id;
          invalidateDashboardData();
        } else {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setSaveWarning(body?.error ?? "The report is ready, but it could not be saved.");
        }
      }
      if (reportId && doubleTextMessages) {
        try {
          localStorage.setItem(`telescope:double-text:${reportId}`, JSON.stringify(doubleTextMessages));
        } catch {
          // The report still works if private browser storage is unavailable.
        }
      }
      if (reportId && extremeEvidence) {
        try {
          localStorage.setItem(`telescope:extremes:${reportId}`, JSON.stringify(extremeEvidence));
        } catch {
          // Optional local evidence; never block the report if storage is unavailable.
        }
      }
      if (reportId && stickerVisuals) {
        try { localStorage.setItem(`telescope:stickers:${reportId}`, JSON.stringify(stickerVisuals)); } catch { /* Visuals remain available for this session. */ }
      }
      const next: Loaded = { analysis, deck: buildDeck(analysis), raw: pendingFile.raw, reportId, participants, doubleTextMessages, extremeEvidence, stickerVisuals, autoRunAi: false };
      if (withAi && viewer) {
        try {
          await requestLlm(next, true);
        } catch (error) {
          setSaveWarning(error instanceof Error ? `The local report is ready, but AI insights failed: ${error.message}` : "The local report is ready, but AI insights failed.");
          setPhase({ kind: "working", note: "assembling your Wrapped" });
        }
      }
      setPrepared(next);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof ParseError
            ? err.message
            : err instanceof Error
                ? err.message
                : "The report could not be created.",
      });
    }
  }, [pendingFile, requestLlm, viewer]);

  const runLlm = useCallback(async () => {
    if (!loaded) return;
    await requestLlm(loaded).catch(() => undefined);
  }, [loaded, requestLlm]);

  const autoAiStarted = useRef(false);
  useEffect(() => {
    if (!loaded?.autoRunAi || llm || phase.kind !== "idle" || autoAiStarted.current) return;
    autoAiStarted.current = true;
    void runLlm();
  }, [loaded, llm, phase.kind, runLlm]);

  useEffect(() => {
    if (prepared?.reportId) router.prefetch(`/reports/${prepared.reportId}`);
  }, [prepared?.reportId, router]);

  if (loaded) {
    const aiProgress: AiProgressState | undefined = phase.kind === "working"
      ? { kind: "working", stage: stageOf(phase.note) + 1, total: STAGES.length, label: STAGES[stageOf(phase.note)] }
      : phase.kind === "done"
        ? { kind: "done" }
        : phase.kind === "error"
          ? { kind: "error" }
          : undefined;
    return (
      <div className="report-reveal">
      <Report
        analysis={loaded.analysis}
        deck={loaded.deck}
        llm={llm}
        coverActions={loaded.reportId ? <ReportActions reportId={loaded.reportId} /> : undefined}
        backHref={viewer ? "/app" : "/"}
        promptInsightsAtEnd={Boolean(viewer)}
        doubleTextMessages={loaded.doubleTextMessages}
        localEvidenceKey={loaded.reportId ?? undefined}
        extremeEvidence={loaded.extremeEvidence}
        stickerVisuals={loaded.stickerVisuals}
        aiProgress={aiProgress}
        endControl={!viewer ? <GuestEndPrompt analysis={loaded.analysis} /> : undefined}
        control={
          llm ? undefined : viewer ? (
            <ReadingControl phase={phase} onRun={runLlm} />
          ) : (
            <AccountGate signedIn={Boolean(viewer)} analysis={loaded.analysis} />
          )
        }
      />
      {saveWarning && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-night px-5 py-3 text-sm text-white shadow-xl">{saveWarning}</div>}
      </div>
    );
  }

  return (
    <>
    {startView === "workspace" ? (
      <WorkspaceUpload phase={phase} dragging={dragging} setDragging={setDragging} onFiles={load} inputRef={input} viewer={viewer} />
    ) : (
      <Landing phase={phase} dragging={dragging} setDragging={setDragging} onFiles={load} inputRef={input} viewer={viewer} />
    )}
    <LocalLoadingModal
      phase={phase}
      reportReady={Boolean(prepared)}
      onView={() => {
        if (!prepared) return;
        if (prepared.reportId) {
          window.dispatchEvent(new Event(TELESCOPE_OPEN_REPORT_EVENT));
          router.push(`/reports/${prepared.reportId}`);
          return;
        }
        setLoaded(prepared);
        setPrepared(null);
        setPhase({ kind: "idle" });
      }}
    />
    {pendingFile && <ParticipantModal
      initial={viewer ? [pendingFile.parsed.chat.participants[0], viewer.name] : pendingFile.parsed.chat.participants}
      onConfirm={confirmParticipants}
      canUseAi={Boolean(viewer)}
      accountName={viewer?.name}
      onBack={() => setPendingFile(null)}
      onChooseAnother={() => {
        setPendingFile(null);
        if (input.current) input.current.value = "";
        window.requestAnimationFrame(() => input.current?.click());
      }}
    />}
    </>
  );
}

function ParticipantModal({
  initial,
  onConfirm,
  onBack,
  onChooseAnother,
  canUseAi,
  accountName,
}: {
  initial: [string, string];
  onConfirm: (names: [string, string], withAi: boolean) => void;
  onBack: () => void;
  onChooseAnother: () => void;
  canUseAi: boolean;
  accountName?: string;
}) {
  const [first, setFirst] = useState(initial[0]);
  const [second, setSecond] = useState(initial[1]);
  const [withAi, setWithAi] = useState(false);
  const valid = first.trim().length > 0 && second.trim().length > 0;

  useEffect(() => {
    if (canUseAi) {
      try {
        const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as { autoAi?: boolean };
        setWithAi(Boolean(preferences.autoAi));
      } catch { /* Keep the safe opt-in default. */ }
    }
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onBack]);

  return (
    <div onMouseDown={(event) => { if (event.target === event.currentTarget) onBack(); }} className="fixed inset-0 z-50 grid place-items-center bg-night/78 px-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="participant-title">
      <form onSubmit={(event) => { event.preventDefault(); if (valid) void onConfirm([first.trim(), second.trim()], withAi); }} className="rise w-full max-w-[520px] rounded-[24px] bg-surface p-6 text-ink shadow-2xl sm:p-9">
        <div className="mb-5 flex items-center justify-between"><Kicker>Conversation found</Kicker><button type="button" onClick={onBack} aria-label="Go back" className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 text-lg text-ink/45 transition hover:border-ink/35 hover:text-ink">×</button></div>
        <h2 id="participant-title" className="font-display text-[38px] leading-tight sm:text-[46px]">Who is in this conversation?</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/55">{accountName ? "Choose how your conversation partner appears. Your name comes from Settings." : "Use the names you want displayed throughout the report. This does not change your export."}</p>
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <label className="text-xs font-medium text-ink/55">Conversation partner<input autoFocus value={first} onChange={(event) => setFirst(event.target.value)} maxLength={60} className="mt-2 w-full border-b border-ink/20 bg-transparent py-3 font-display text-2xl text-ink outline-none transition focus:border-accent" /></label>
          {accountName ? <div className="text-xs font-medium text-ink/55">You<div className="mt-2 w-full border-b border-ink/10 py-3 font-display text-2xl text-ink/48">{second}</div></div> : <label className="text-xs font-medium text-ink/55">You<input value={second} onChange={(event) => setSecond(event.target.value)} maxLength={60} className="mt-2 w-full border-b border-ink/20 bg-transparent py-3 font-display text-2xl text-ink outline-none transition focus:border-accent" /></label>}
        </div>
        <label className={`mt-7 flex items-start gap-3 border-y border-ink/12 py-4 ${canUseAi ? "cursor-pointer" : "opacity-45"}`}><input type="checkbox" checked={withAi} disabled={!canUseAi} onChange={(event) => setWithAi(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" /><span><span className="block text-sm font-semibold">Generate AI insights now</span><span className="mt-1 block text-xs leading-relaxed text-ink/50">Named eras, recurring lore, wild sentences and the roles you grew into.{!canUseAi ? " Sign in to enable this." : " Your Wrapped opens when the complete reading is ready."}</span></span></label>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-ink/12 pt-5"><div className="flex items-center gap-4"><button type="button" onClick={onBack} className="text-sm text-ink/45 transition hover:text-ink">← Back</button><button type="button" onClick={onChooseAnother} className="text-sm text-accent transition hover:text-ink">Choose another file</button></div><button type="submit" disabled={!valid} className="rounded-full bg-night px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35">Create the report</button></div>
      </form>
    </div>
  );
}

const folderInputProps = { webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>;

function WorkspaceUpload({
  phase,
  dragging,
  setDragging,
  onFiles,
  inputRef,
  viewer,
}: {
  phase: Phase;
  dragging: boolean;
  setDragging: (value: boolean) => void;
  onFiles: (files: File[]) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  viewer: Viewer;
}) {
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!guideOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGuideOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [guideOpen]);

  return (
    <>
      <section className="flex min-h-[calc(100dvh-73px)] flex-col px-5 py-9 sm:px-10 lg:min-h-dvh lg:px-14 lg:py-12 xl:px-20">
        <header className="border-b border-ink/14 pb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">New analysis</p>
          <h1 className="mt-3 font-display text-[46px] leading-none sm:text-[64px]">Choose a conversation.</h1>
          <p className="mt-4 max-w-[54ch] text-sm leading-relaxed text-ink/52">Choose the complete folder Telegram created for one chat. Telescope reads the conversation and automatically includes sticker artwork when it is present.</p>
        </header>

        <div className="my-auto py-8">
          <label
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void filesFromDrop(event.dataTransfer).then((files) => { if (files.length) void onFiles(files); }); }}
            className={`group relative flex min-h-[310px] cursor-pointer flex-col justify-between overflow-hidden rounded-[26px] border-2 bg-night p-7 text-white transition duration-300 sm:min-h-[390px] sm:p-10 ${dragging ? "scale-[1.01] border-accent-lit" : "border-night hover:border-accent-lit"}`}
          >
            <input ref={inputRef} type="file" {...folderInputProps} className="sr-only" onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void onFiles(files); }} />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-lit">Complete Telegram export</span>
              <span className="grid h-14 w-14 place-items-center rounded-full border border-accent-lit/60 text-2xl text-accent-lit transition group-hover:-translate-y-1 group-hover:bg-accent-lit group-hover:text-night">↗</span>
            </div>
            <div>
              <p className="max-w-[13ch] font-display text-[42px] leading-[0.92] sm:text-[62px]">{phase.kind === "working" ? `${phase.note}…` : <>Choose the export <span className="italic text-accent-lit">folder</span></>}</p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/14 pt-5 text-xs text-white/45"><span>One 1:1 chat · any length</span><span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-safe-lit"><Shield /> raw chat stays local</span><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setGuideOpen(true); }} className="text-accent-lit underline decoration-accent-lit/35 underline-offset-4">How to export it</button></div>
            </div>
          </label>
          {phase.kind === "error" && <p className="mt-4 text-sm text-side-a">{phase.message}</p>}
        </div>
      </section>
      {guideOpen && <ExportGuideModal onClose={() => setGuideOpen(false)} />}
    </>
  );
}

function ExportGuideModal({ onClose }: { onClose: () => void }) {
  const steps = [
    ["01", "Use Telegram Desktop", "The phone and web apps cannot create a complete chat export."],
    ["02", "Open the conversation", "Open the chat you want to analyze, then select ⋮ and Export chat history."],
    ["03", "Choose machine-readable JSON", "For sticker artwork, include stickers and videos in Telegram’s export options. Otherwise, media can stay unticked."],
    ["04", "Complete the export", "Telegram may impose a 24-hour wait the first time you request an export."],
    ["05", "Choose the export folder", "Choose the complete folder Telegram created—do not select an individual file inside it. Telescope includes any available sticker artwork automatically."],
  ];
  return (
    <div onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-night/78 px-5 py-8 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="export-guide-title">
      <section className="rise w-full max-w-[760px] overflow-hidden rounded-[26px] bg-surface text-ink shadow-2xl">
        <header className="flex items-start justify-between gap-6 border-b border-ink/12 px-6 py-6 sm:px-9 sm:py-8">
          <div><Kicker>Telegram export guide</Kicker><h2 id="export-guide-title" className="mt-3 font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[.95]">Export the complete chat folder.</h2><p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ink/52">One chat, one folder. Create it in Telegram Desktop, then choose that entire folder in Telescope.</p></div>
          <button type="button" onClick={onClose} aria-label="Close export guide" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ink/14 text-xl text-ink/42 transition hover:border-ink/35 hover:text-ink">×</button>
        </header>
        <ol className="px-6 sm:px-9">{steps.map(([number, title, body]) => <li key={number} className="grid grid-cols-[42px_1fr] gap-3 border-b border-ink/12 py-4 last:border-b-0 sm:grid-cols-[54px_190px_1fr] sm:items-start"><span className="font-mono text-[10px] text-accent">{number}</span><p className="font-semibold text-ink">{title}</p><p className="mt-1 text-sm leading-relaxed text-ink/52 sm:mt-0">{body}</p></li>)}</ol>
        <footer className="flex flex-wrap items-center justify-between gap-4 bg-shade px-6 py-5 sm:px-9"><p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-safe-deep"><Shield /> Sticker assets stay in your browser</p><button type="button" onClick={onClose} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-accent">Back to upload</button></footer>
      </section>
    </div>
  );
}

const LOCAL_LOADING_LINES = [
  "Reading way too many messages…",
  "Counting every “HAHAHA”…",
  "Finding out who yaps more…",
  "Investigating the double texts…",
  "Looking for your most-used emoji…",
  "Digging up forgotten lore…",
  "Measuring the longest silence…",
  "Checking who always texts first…",
  "Analysing your 2am conversations…",
  "Trying to understand your sticker choices…",
  "Finding your most chaotic month…",
  "Calculating your yap-to-reply ratio…",
  "Connecting questionable conversational dots…",
  "Counting messages that could’ve been one message…",
  "Identifying your resident photo dumper…",
  "Finding out who sends more essays…",
  "Putting your friendship under a microscope…",
  "Turning years of yapping into charts…",
  "Preparing your annual performance review…",
  "Almost ready to expose the stats…",
] as const;

function LocalLoadingModal({ phase, reportReady, onView }: { phase: Phase; reportReady: boolean; onView: () => void }) {
  const [line, setLine] = useState(0);
  const [stage, setStage] = useState<"phrases" | "receipts" | "ready">("phrases");
  const startedAt = useRef(0);
  const active = phase.kind === "working" && phase.note !== "reading the file";

  useEffect(() => {
    if (!active) return;
    startedAt.current = performance.now();
    setLine(0);
    setStage("phrases");
  }, [active]);

  useEffect(() => {
    if (!active || stage !== "phrases") return;
    const timer = window.setInterval(() => setLine((current) => (current + 1) % LOCAL_LOADING_LINES.length), 1500);
    return () => window.clearInterval(timer);
  }, [active, stage]);

  useEffect(() => {
    if (!active || !reportReady || stage !== "phrases") return;
    const elapsed = performance.now() - startedAt.current;
    // Finish the current 1.5-second phrase and always show at least two complete
    // phrases before moving into the finale.
    const phraseBoundary = Math.ceil((elapsed + 1) / 1500) * 1500;
    const wait = Math.max(0, Math.max(3000, phraseBoundary) - elapsed);
    const timer = window.setTimeout(() => setStage("receipts"), wait);
    return () => window.clearTimeout(timer);
  }, [active, reportReady, stage]);

  useEffect(() => {
    if (stage !== "receipts") return;
    const timer = window.setTimeout(() => setStage("ready"), 1500);
    return () => window.clearTimeout(timer);
  }, [stage]);

  if (!active) return null;
  const display = stage === "phrases" ? LOCAL_LOADING_LINES[line] : stage === "receipts" ? "Preparing the receipts..." : "Your Wrapped is ready.";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 py-8 backdrop-blur-md" role="status">
      <span className="sr-only">Creating your report.</span>
      <div className="starfield rise relative flex min-h-[390px] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-white/16 bg-night px-6 py-6 text-white shadow-2xl sm:min-h-[440px] sm:px-9 sm:py-8">
        <header className="relative flex items-center justify-between border-b border-white/12 pb-5"><span className="flex items-center gap-2.5 font-display text-xl"><Logo size={22} tone="night" /> Telescope</span><span className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/35">{stage === "ready" ? "Ready when you are" : "Building your report"}</span></header>
        <div className="relative my-auto py-9">
          <div className="mb-6 flex items-center gap-4"><span className={`${stage === "phrases" ? "loading-orbit" : ""} grid h-11 w-11 place-items-center rounded-full border border-accent-lit/45 text-accent-lit`}>{stage === "ready" ? "✓" : "◎"}</span><Kicker tone="lit">{stage === "phrases" ? "Looking closer" : stage === "receipts" ? "One last thing" : "Finished"}</Kicker></div>
          <p key={`${stage}-${line}`} aria-hidden="true" className={`${stage === "phrases" && line === 0 ? "" : "loading-copy-enter"} max-w-[15ch] font-display text-[clamp(2.8rem,6vw,5.2rem)] leading-[0.9] tracking-[-0.025em] text-white`}>{display}</p>
          {stage === "ready" && <button type="button" onClick={onView} className="mt-8 inline-flex items-center gap-3 rounded-full bg-accent-lit px-7 py-3.5 text-sm font-semibold text-night transition duration-300 hover:-translate-y-1 hover:bg-white">View your Wrapped <span aria-hidden="true">→</span></button>}
        </div>
        <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/12 pt-5"><p className="max-w-[48ch] text-xs leading-relaxed text-white/42">Counted in this tab. The raw conversation stays on your machine.</p><span className="font-mono text-[8px] uppercase tracking-[0.16em] text-accent-lit">{stage === "ready" ? "Complete" : phase.note}</span></footer>
      </div>
    </div>
  );
}

function rememberForSignup(analysis: Analysis) {
  try {
    sessionStorage.setItem("telescope:pending-analysis", JSON.stringify(analysis));
  } catch {
    // A very large derived report can exceed browser storage. Authentication
    // still proceeds; the user can rerun the local analysis after signing in.
  }
}

function GuestEndPrompt({ analysis }: { analysis: Analysis }) {
  return (
    <div className="max-w-[760px]">
      <Kicker tone="lit" className="mb-5">Keep the report</Kicker>
      <h2 className="font-display text-[44px] leading-[0.95] text-white sm:text-[68px]">Save it. Share it.<br /><span className="italic text-accent-lit">Come back to it.</span></h2>
      <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-white/60">Log in or create an account to add this report to your dashboard and generate a shareable link. It will be saved automatically as soon as Google brings you back.</p>
      <Link href="/sign-in" onClick={() => rememberForSignup(analysis)} className="mt-8 inline-flex rounded-full bg-accent-lit px-6 py-3.5 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:brightness-110">Log in or sign up to save <span className="ml-3">→</span></Link>
    </div>
  );
}

function AccountGate({ signedIn, analysis }: { signedIn: boolean; analysis: Analysis }) {
  return (
    <NightPanel>
      <Kicker tone="lit" className="mb-3.5">Powered by AI</Kicker>
      <p className="font-display text-[23px] leading-snug text-white">
        {signedIn ? "Unlock what the numbers cannot name." : "Unlock new insights hidden in the conversation."}
      </p>
      <p className="mt-3.5 text-sm leading-relaxed text-white/60">
        {signedIn
          ? "Let AI name eras, surface recurring lore and identify the roles you each grew into."
          : "Sign up to reveal named eras, recurring lore, topic patterns and the roles you each grew into—with evidence from the chat."}
      </p>
      {!signedIn && (
        <Link href="/sign-in" onClick={() => rememberForSignup(analysis)} className="mt-5 block w-full rounded-full bg-accent-lit px-5 py-3 text-center text-sm font-semibold text-night transition hover:brightness-110">
          Sign up to unlock more insights
        </Link>
      )}
    </NightPanel>
  );
}

// ------------------------------------------------------------------- the rail

/** The opt-in, and then the progress panel it turns into. */
function ReadingControl({ phase, onRun }: { phase: Phase; onRun: () => void }) {
  if (phase.kind === "working") {
    const stage = stageOf(phase.note);
    return (
      <div className="relative p-5 text-white sm:p-6">
        <div className="flex items-center justify-between">
          <Kicker tone="lit">Call {CALL_OF_STAGE[stage]} of 3 · observing</Kicker>
          <div className="flex gap-1">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`block h-[3px] w-5 rounded-full ${
                  n <= CALL_OF_STAGE[stage] ? "bg-accent-lit" : "bg-white/18"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="pt-4 text-center">
          <p className="font-display text-[64px] leading-none text-white tnum">
            {stage + 1}
            <span className="text-[30px] text-white/50">/{STAGES.length}</span>
          </p>
          <p className="mt-2 font-display text-[19px] italic leading-snug text-accent-lit">
            {progressCopy(phase.note)}
          </p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/14">
            <div
              className="h-1.5 rounded-full bg-accent-lit transition-[width] duration-500"
              style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
            />
          </div>
        </div>

        <ul className="mt-5 flex flex-col gap-1.5 font-mono text-[11.5px] leading-relaxed">
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={i < stage ? "text-white/40" : i === stage ? "text-white" : "text-white/25"}
            >
              {i < stage ? "✓" : i === stage ? "◎" : "·"} {s}
            </li>
          ))}
        </ul>

        <p className="mt-5 border-t border-white/14 pt-4 font-mono text-[10.5px] leading-relaxed text-white/40">
          Every quote it writes down is checked against the real message before it reaches this page.
        </p>
      </div>
    );
  }

  return (
    <NightPanel>
      <Kicker tone="lit" className="mb-3.5">Powered by AI</Kicker>
      <p className="font-display text-[23px] leading-snug text-white">
        Unlock what the numbers cannot name.
      </p>
      <p className="mt-3.5 text-sm leading-relaxed text-white/60">
        Get new insights into your named eras, recurring lore, conversation topics and the roles you each grew into—with evidence under every claim.
      </p>
      <p className="mt-3 border-t border-white/12 pt-3 text-xs leading-relaxed text-white/38">This is the one step that sends the chat to the server. The numerical report above stayed on this machine.</p>
      <button
        type="button"
        onClick={onRun}
        className="mt-5 w-full rounded-full bg-accent-lit px-5 py-3 text-sm font-semibold text-night transition hover:brightness-110"
      >
        Get new insights
      </button>
      {phase.kind === "error" && (
        <p className="mt-3.5 text-[13px] leading-relaxed text-warn">{phase.message}</p>
      )}
    </NightPanel>
  );
}

// ---------------------------------------------------------------- the landing

/**
 * What the report actually contains, described rather than illustrated.
 *
 * Each entry is a real card `buildDeck` can produce, which is why the list is
 * this length and no longer: there is no tile here for an instrument that
 * doesn't exist.
 */
const INSTRUMENTS = [
  {
    title: "When you talk",
    body: "Twenty-four hourly buckets, per person. Whose messages are the ones after midnight.",
  },
  {
    title: "Who keeps going",
    body: "Unbroken runs — messages sent before the other one says anything back — measured both ways.",
  },
  {
    title: "Eras",
    body: "The history cut where the rate of conversation actually changed, not by calendar year. The silences are chapters too.",
  },
  {
    title: "Words that are yours",
    body: "Not most-used — most characteristic. Log-odds against the other person, so “the” and “you” don't win.",
  },
  {
    title: "Reply latency",
    body: "Median, in-session, 75th and 90th percentile. Four cuts, because one median hides a lot.",
  },
  {
    title: "Who comes back",
    body: "After every silence, who broke it. Shown at four different cutoffs — a pattern that only appears at one is a pattern in the cutoff.",
  },
  {
    title: "The verdict",
    body: "One sentence about the dynamic, chosen from candidates by a separate judging pass, with the quotes it rests on.",
  },
  {
    title: "What came out even",
    body: "The measurements that showed no difference, stated plainly. A report that only shows you the hits is lying by omission.",
  },
];

const RESULT_PREVIEW_ROWS = [
  { value: "41 days", label: "the longest silence", detail: "then one of you came back at 02:14", tone: "text-side-a" },
  { value: "“sooo?”", label: "language only you two use", detail: "312 times · absent from the first year", tone: "text-accent-lit italic" },
  { value: "23:40", label: "when you actually talk", detail: "the hour holding a third of everything", tone: "text-white" },
  { value: "62%", label: "who restarts the chat", detail: "measured after meaningful silence", tone: "text-safe-lit" },
  { value: "17 texts", label: "the longest uninterrupted run", detail: "before the other person replied", tone: "text-warn" },
] as const;

function ResultPreview() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % RESULT_PREVIEW_ROWS.length), 3600);
    return () => window.clearInterval(timer);
  }, [paused, active]);

  const row = RESULT_PREVIEW_ROWS[active];

  return (
    <div
      aria-label="Example report preview"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <div className="mb-3 flex items-center justify-between px-1 font-mono text-[9px] uppercase tracking-[0.2em] text-white/32">
        <span>What comes back</span><span>{String(active + 1).padStart(2, "0")} / {String(RESULT_PREVIEW_ROWS.length).padStart(2, "0")}</span>
      </div>
      <div className="relative overflow-hidden border-y border-white/16 bg-white/[0.025] px-5 py-6 sm:px-7">
        <div key={row.label} className="result-stat-enter min-h-[132px]">
          <p className={`font-display text-[52px] leading-[0.9] sm:text-[64px] ${row.tone}`}>{row.value}</p>
          <p className="mt-4 text-[15px] font-semibold text-white/90">{row.label}</p>
          <p className="mt-1 text-xs text-white/38">{row.detail}</p>
        </div>
        {!paused && <span key={`progress-${active}`} className="result-stat-progress absolute bottom-0 left-0 h-px bg-accent-lit" />}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" aria-label="Choose an example finding">
        {RESULT_PREVIEW_ROWS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            aria-pressed={index === active}
            onClick={() => setActive(index)}
            className={`h-1 rounded-full transition-colors ${index === active ? "bg-accent-lit" : "bg-white/16 hover:bg-white/35"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Landing({
  phase,
  dragging,
  setDragging,
  onFiles,
  inputRef,
  viewer,
}: {
  phase: Phase;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onFiles: (files: File[]) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  viewer: Viewer;
}) {
  return (
    <div className="min-h-dvh bg-surface">
      <section className="starfield relative min-h-dvh overflow-hidden bg-night text-white">
        <header className="relative z-10 flex h-[72px] items-center justify-between border-b border-white/12 px-5 sm:px-10 xl:px-16 2xl:px-24">
          <div className="flex items-center gap-2.5 rise">
            <Logo size={25} tone="night" />
            <span className="font-display text-[24px]">Telescope</span>
          </div>
          <div className="flex items-center gap-4">
            {viewer ? (
              <>
                <Link href="/app" className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/60 transition hover:text-white">
                  Dashboard
                </Link>
                <form action={signOutCurrentUser}><button className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-white">Sign out</button></form>
              </>
            ) : (
              <Link href="/sign-in" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-lit hover:text-white">Log in / sign up</Link>
            )}
          </div>
        </header>

        <div className="relative z-[1] grid min-h-[calc(100dvh-72px)] items-center gap-10 px-5 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.72fr)] xl:gap-14 xl:px-16 2xl:px-24">
          <div className="relative z-10 max-w-[760px]">
            <p className="rise font-mono text-[10px] uppercase tracking-[0.2em] text-accent-lit" style={{ animationDelay: "80ms" }}>
              A private instrument for one conversation
            </p>
            <p className="rise mt-5 font-display text-[clamp(4rem,8vw,8.5rem)] leading-[0.72] tracking-[-0.045em]" style={{ animationDelay: "140ms" }}>
              Telescope:
            </p>
            <h1 className="rise mt-9 max-w-[760px] font-display text-[clamp(2.15rem,4.2vw,4.8rem)] leading-[0.96] tracking-[-0.02em] text-white" style={{ animationDelay: "220ms" }}>
              See the conversation<br />
              <span className="italic text-accent-lit">you were too close to notice.</span>
            </h1>
            <p className="rise mt-6 max-w-[560px] text-[16px] leading-relaxed text-white/62 sm:text-[18px]" style={{ animationDelay: "300ms" }}>
              Drop one Telegram chat. Get its rhythms, silences, private language, and the parts that only appear when years are seen at once.
            </p>
          </div>

          <div className="rise grid w-full max-w-[560px] justify-self-end gap-5" style={{ animationDelay: "300ms" }}>
          <div id="drop" className="scroll-mt-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void filesFromDrop(e.dataTransfer).then((files) => { if (files.length) void onFiles(files); });
            }}
            className={`drop-zone group relative grid min-h-[164px] cursor-pointer gap-5 overflow-hidden rounded-[22px] border-2 px-6 py-6 transition-all sm:grid-cols-[auto_1fr] sm:items-center sm:px-8 ${
              dragging ? "scale-[1.01] border-accent-lit bg-accent-lit/16" : "border-accent-lit/55 bg-white/[0.055] hover:border-accent-lit hover:bg-white/[0.08]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              {...folderInputProps}
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) void onFiles(files);
              }}
            />
            <span className={`relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-full border transition duration-300 sm:h-16 sm:w-16 ${dragging ? "rotate-[-8deg] border-accent-lit bg-accent-lit text-night" : "border-accent-lit/70 bg-accent-lit/10 text-accent-lit group-hover:-translate-y-1 group-hover:bg-accent-lit group-hover:text-night"}`}>
              <span className="text-2xl">↗</span>
            </span>
            <div className="relative z-10 min-w-0">
            {phase.kind === "working" ? (
              <div><p className="font-display text-[30px] leading-tight sm:text-[36px]">{phase.note}…</p><p className="mt-2 text-xs text-white/48">Large exports can pause the tab briefly.</p></div>
            ) : (
              <div><p className="font-mono text-[9px] uppercase tracking-[0.2em] text-accent-lit">Start your analysis</p><p className="mt-2 font-display text-[30px] leading-tight sm:text-[38px]">Choose the export <span className="italic text-accent-lit">folder</span></p></div>
            )}
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-start-2">
              <span className="text-xs text-white/45">One 1:1 chat · any length</span>
              <span className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.14em] text-safe-lit"><Shield /> never uploaded</span>
              <a href="#export" className="text-xs text-accent-lit underline decoration-accent-lit/35 underline-offset-4 transition hover:text-white">How do I export the folder?</a>
            </div>
          </label>

          {phase.kind === "error" && (
            <p className="mt-4 text-sm leading-relaxed text-side-a">{phase.message}</p>
          )}
          </div>
          <ResultPreview />
          </div>
        </div>
      </section>

      {/* instruments */}
      <section className="px-5 py-20 sm:px-10 sm:py-28 xl:px-16 2xl:px-24">
        <div className="grid gap-14 lg:grid-cols-[minmax(240px,.65fr)_1.35fr]">
          <div className="lg:sticky lg:top-12 lg:self-start">
            <Kicker className="mb-4">What comes back</Kicker>
            <h2 className="max-w-[420px] font-display text-[42px] leading-[0.98] text-ink sm:text-[58px]">Not a summary.<br /><span className="italic text-accent">A point of view.</span></h2>
            <p className="mt-6 max-w-[36ch] text-[15px] leading-relaxed text-ink/58">Eight instruments measure the same conversation from different angles. Only real differences earn space in the report.</p>
          </div>
          <ol className="border-t border-ink/18">
            {INSTRUMENTS.map((ins, i) => (
              <li key={ins.title} className="group grid gap-3 border-b border-ink/18 py-6 transition-colors hover:border-accent sm:grid-cols-[52px_minmax(160px,.65fr)_1fr] sm:items-baseline">
                <span className="font-mono text-[10px] text-ink/35">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-[25px] leading-tight text-ink transition-transform duration-300 group-hover:translate-x-1 group-hover:text-accent">{ins.title}</h3>
                <p className="max-w-[56ch] text-[13.5px] leading-relaxed text-ink/58">{ins.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* privacy */}
      <section className="starfield relative overflow-hidden bg-night px-5 py-16 sm:px-10 xl:px-16 2xl:px-24">
        <div className="relative grid gap-14 lg:grid-cols-2">
          <div>
            <Kicker tone="lit" className="mb-5">
              The only promise that matters
            </Kicker>
            <h2 className="font-display text-[40px] leading-[1.02] text-white sm:text-[52px]">
              Your chat never leaves your computer.
            </h2>
            <p className="mt-5 max-w-[440px] text-[17px] leading-relaxed text-white/66">
              Not &ldquo;encrypted in transit&rdquo;. Not &ldquo;deleted after 30 days&rdquo;. The file
              you drop in is read by the page you&rsquo;re looking at, on the machine you&rsquo;re
              sitting at. Every number in the report is arithmetic done in this tab.
            </p>
          </div>
          <ol className="flex flex-col gap-px overflow-hidden rounded-xl border border-white/16">
            {[
              {
                n: "01",
                h: "You export the chat yourself",
                b: "Telegram Desktop → open the chat → ⋮ → Export chat history → JSON. Telegram makes you wait 24 hours the first time; that one's theirs, not ours.",
              },
              {
                n: "02",
                h: "The page reads it in memory",
                b: "Parsed and counted on the main thread of this tab. The raw conversation never crosses the network. When you're signed in, only the finished numerical analysis is saved.",
              },
              {
                n: "03",
                h: "The written half is opt-in, and it is an upload",
                b: "One button, clearly labelled, sends the conversation to a model to be read. Don't press it and the report is still complete — just unnarrated.",
              },
            ].map((step) => (
              <li key={step.n} className="flex gap-4 bg-white/5 p-6">
                <span className="font-display text-[26px] leading-none text-accent-lit">{step.n}</span>
                <div>
                  <p className="mb-1.5 font-semibold text-white">{step.h}</p>
                  <p className="text-sm leading-relaxed text-white/58">{step.b}</p>
                </div>
              </li>
            ))}
            <li className="flex items-center gap-2.5 bg-safe/18 px-6 py-4">
              <span className="block h-[7px] w-[7px] rounded-full bg-safe-lit" />
              <span className="font-mono text-[11.5px] tracking-wide text-safe-lit">
                raw chat stays local · saved results are account-only
              </span>
            </li>
          </ol>
        </div>
      </section>

      {/* how to export */}
      <div id="export" className="scroll-mt-6 bg-shade px-5 py-16 sm:px-10 xl:px-16 2xl:px-24">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Kicker className="mb-3">Step 1 · get the folder</Kicker>
            <h2 className="font-display text-[31px] leading-tight text-ink sm:text-[38px]">
              Telegram hands out your history if you ask nicely.
            </h2>
            <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-ink/65">
              One folder, one chat. Choose the complete Telegram export folder and Telescope automatically reads the conversation and any sticker artwork inside it.
            </p>
          </div>
          <Panel tone="surface" className="flex flex-col gap-3.5">
            {[
              ["01", "Open Telegram Desktop — the phone app can't export."],
              ["02", "Open the chat → ⋮ → Export chat history."],
              ["03", "Set the format to machine-readable JSON. Include stickers if you want their artwork shown."],
              ["04", "Telegram waits 24 hours the first time you ask. Sorry — that one's theirs."],
              ["05", "Choose or drop the complete export folder at the top of this page."],
            ].map(([n, text]) => (
              <div key={n} className="flex gap-3.5">
                <span className="pt-0.5 font-mono text-[11px] text-accent">{n}</span>
                <span className="text-[14.5px] leading-relaxed text-ink/75">{text}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {/* final CTA */}
      <div
        className="flex flex-col items-center gap-5 px-5 py-20 text-center sm:px-10 xl:px-16 2xl:px-24"
        style={{
          background: "radial-gradient(700px 300px at 50% 0%, rgba(42,171,238,0.2), transparent 72%)",
        }}
      >
        <Logo size={34} />
        <h2 className="max-w-[660px] font-display text-[38px] leading-[1.03] text-ink sm:text-[56px]">
          Years of small talk.
          <br />
          Somebody should look at it.
        </h2>
        <a href="#drop" className="mt-1.5">
          <Pill>Point it at a chat</Pill>
        </a>
        <p className="font-mono text-[11.5px] text-ink/50">
          no account · no upload · the numbers take about a second
        </p>
      </div>

      {/* footer */}
      <footer className="starfield relative overflow-hidden bg-night px-5 py-12 text-white/60 sm:px-10 xl:px-16 2xl:px-24">
        <div className="relative">
          <div className="grid gap-9 border-b border-white/14 pb-8 md:grid-cols-[1.6fr_1fr_1fr]">
            <div>
              <div className="mb-3.5 flex items-center gap-2.5">
                <Logo size={22} tone="night" />
                <span className="font-display text-[22px] text-white">Telescope</span>
              </div>
              <p className="max-w-[38ch] text-sm leading-relaxed">
                An instrument for reading your own messages. Not affiliated with Telegram.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 text-sm">
              <Kicker tone="faint-lit" className="mb-1">
                How it works
              </Kicker>
              <span>Counted in your browser</span>
              <span>Every claim carries a quote</span>
              <span>Quotes checked before they render</span>
            </div>
            <div className="flex flex-col gap-2.5 text-sm">
              <Kicker tone="faint-lit" className="mb-1">
                Fine print
              </Kicker>
              <span>No accounts, no storage</span>
              <span>The written half is opt-in</span>
              <span>1:1 chats, English</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-3 pt-5 font-mono text-[11px] tracking-wider text-white/40">
            <span>Telescope</span>
            <span>◎ built local-first</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
