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
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Parsed } from "@/domain/parse";
import type { Analysis } from "@/domain/types";
import type { GroupAnalysis, ParsedGroup } from "@/domain/group";
import type { AiProgressState, LocalExtremeEvidence, LocalStreakMessage } from "@/ui/Report";
import type { LocalGroupExtremeEvidence, LocalGroupMessage } from "@/ui/GroupReport";
import type { DeckCard } from "@/ui/cards";
import { Callout, Kicker, Logo, NightPanel, Panel, Pill, Shield } from "@/ui/primitives";
import type { WirePayload } from "@/ui/wire";
import { signOutCurrentUser } from "@/app/actions/auth";
import type { LocalGroupStickerVisuals, LocalStickerVisuals } from "@/ui/sticker-assets";
import { invalidateDashboardData } from "@/app/app/dashboard-data";
import { TELESCOPE_OPEN_REPORT_EVENT } from "@/app/app/AppShell";
import { requestAnalysis, requestGroupAnalysis } from "@/lib/analysis-client";
import type { GroupAiPayload } from "@/llm/group";
import { applicationUrl, dashboardUrl } from "@/lib/app-url";
import { syncReportEvidence, syncableReportEvidence } from "@/lib/report-evidence-client";

const Report = lazy(() => import("@/ui/Report").then((module) => ({ default: module.Report })));
const ReportActions = lazy(() => import("@/ui/ReportActions").then((module) => ({ default: module.ReportActions })));
const GroupReport = lazy(() => import("@/ui/GroupReport").then((module) => ({ default: module.GroupReport })));

async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const { filesFromDrop: collectFiles } = await import("@/ui/sticker-assets");
  return collectFiles(dataTransfer);
}

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

interface PreparedGroup {
  analysis: GroupAnalysis;
  reportId: string | null;
  extremeEvidence?: LocalGroupExtremeEvidence;
  ai?: GroupAiPayload;
  aiEvidence?: LocalGroupMessage[];
  doubleTextEvidence?: LocalGroupMessage[];
  stickerVisuals?: LocalGroupStickerVisuals;
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

function localGroupExtremeEvidence(parsed: ParsedGroup, analysis: GroupAnalysis): LocalGroupExtremeEvidence | undefined {
  const longestId = analysis.extremes.longestMessage?.messageId;
  const runIds = new Set(analysis.extremes.longestRun?.messageIds ?? []);
  const toLocal = (message: ParsedGroup["messages"][number]) => ({ id: message.id, ts: message.ts, participantId: message.participantId, body: message.text.trim() || (message.media ? "[Media]" : "[Empty message]") });
  const longestMessage = longestId === undefined ? undefined : parsed.messages.find((message) => message.id === longestId);
  const longestRun = parsed.messages.filter((message) => runIds.has(message.id)).map(toLocal);
  if (!longestMessage && !longestRun.length) return undefined;
  return { longestMessage: longestMessage ? toLocal(longestMessage) : undefined, longestRun: longestRun.length ? longestRun : undefined };
}

function localGroupDoubleTextEvidence(parsed: ParsedGroup, analysis: GroupAnalysis): LocalGroupMessage[] | undefined {
  const ids = analysis.doubleTexting?.longest?.messageIds;
  if (!ids?.length) return undefined;
  const wanted = new Set(ids);
  return parsed.messages.filter((message) => wanted.has(message.id)).map((message) => ({ id: message.id, ts: message.ts, participantId: message.participantId, body: message.text.trim() || (message.media ? "[Media]" : "[Empty message]") }));
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
  const [groupLoaded, setGroupLoaded] = useState<PreparedGroup | null>(null);
  const [preparedGroup, setPreparedGroup] = useState<PreparedGroup | null>(null);
  const [pendingGroup, setPendingGroup] = useState<ParsedGroup | null>(null);
  const [pendingGroupRaw, setPendingGroupRaw] = useState<string | null>(null);
  const [pendingGroupFiles, setPendingGroupFiles] = useState<File[]>([]);
  const [telegramSenderId, setTelegramSenderId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!viewer) return;
    void fetch("/api/settings/telegram-identity", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((body: { telegramSenderId?: string | null } | null) => setTelegramSenderId(body?.telegramSenderId ?? null));
  }, [viewer?.name]);

  const requestLlm = useCallback(async (target: Loaded, keepCreationLoading = false) => {
    setPhase({ kind: "working", note: "reading the conversation" });
    try {
      if (!target.reportId) throw new Error("Save the report before requesting AI insights.");
      const result = await requestAnalysis({
        raw: target.raw,
        reportId: target.reportId,
        participants: target.participants,
        onProgress: (note) => setPhase({ kind: "working", note }),
      });
      setLlm(result);
      setPhase(keepCreationLoading ? { kind: "working", note: "assembling your report" } : { kind: "done" });
      return result;
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "The reading failed." });
      throw err;
    }
  }, []);

  const load = useCallback(async (files: File[]) => {
    setPreparedGroup(null);
    setPendingGroup(null);
    setPhase({ kind: "working", note: "reading the file" });
    try {
      const [{ ParseError, parseExport }, { resultJsonFrom }, groupModule] = await Promise.all([
        import("@/domain/parse"),
        import("@/ui/sticker-assets"),
        import("@/domain/group"),
      ]);
      const file = resultJsonFrom(files);
      if (!file) throw new ParseError("No result.json was found.", "Choose the complete Telegram export folder that contains result.json.");
      // JSON.parse rejects a leading byte-order mark even though it is valid in
      // a UTF-8 text file. Some Telegram/Desktop combinations include one.
      const raw = (await file.text()).replace(/^\uFEFF/, "");
      // Yield once so the "working" state actually paints before parse blocks the
      // main thread — a 2.6MB export takes long enough to look like a dead click.
      await new Promise((r) => setTimeout(r, 0));
      const decoded = JSON.parse(raw) as unknown;
      if (groupModule.isGroupExport(decoded)) {
        setPendingGroup(groupModule.parseGroupExport(decoded));
        setPendingGroupRaw(raw);
        setPendingGroupFiles(files);
        setPhase({ kind: "idle" });
        return;
      }
      const parsed = parseExport(decoded);
      if (viewer && parsed.selfSide !== null) {
        const selfEntry = [...parsed.idToSide].find(([, side]) => side === parsed.selfSide);
        if (selfEntry && selfEntry[0] !== telegramSenderId) {
          setTelegramSenderId(selfEntry[0]);
          void fetch("/api/settings/telegram-identity", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramSenderId: selfEntry[0] }) });
        }
      }
      setPendingFile({ raw, parsed, files });
      setPhase({ kind: "idle" });
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof SyntaxError
            ? `The result.json in that folder could not be parsed: ${err.message}`
            : err instanceof Error
              ? err.message
              : "Couldn't read that file.",
      });
    }
  }, [telegramSenderId, viewer]);

  const confirmGroupParticipants = useCallback(async (includedIds: Set<string>, displayNames: Map<string, string>, groupName: string, withAi: boolean, selfSenderId: string | null) => {
    if (!pendingGroup) return;
    const raw = pendingGroupRaw;
    setPendingGroup(null);
    setPreparedGroup(null);
    setPhase({ kind: "working", note: "counting the group" });
    try {
      if (viewer && selfSenderId && selfSenderId !== telegramSenderId) {
        setTelegramSenderId(selfSenderId);
        void fetch("/api/settings/telegram-identity", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ telegramSenderId: selfSenderId }) });
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const [{ analyzeGroup, selectGroupParticipants }, { buildGroupStickerVisuals }] = await Promise.all([import("@/domain/group"), import("@/ui/sticker-assets")]);
      const selectedGroup = selectGroupParticipants(pendingGroup, includedIds, displayNames);
      selectedGroup.chat.name = groupName.trim().slice(0, 40);
      const analysis = analyzeGroup(selectedGroup);
      const extremeEvidence = localGroupExtremeEvidence(selectedGroup, analysis);
      const doubleTextEvidence = localGroupDoubleTextEvidence(selectedGroup, analysis);
      const stickerVisuals = await buildGroupStickerVisuals(selectedGroup, pendingGroupFiles);
      let reportId: string | null = null;
      if (viewer) {
        setPhase({ kind: "working", note: "saving your group report" });
        const evidence = syncableReportEvidence({ extremes: extremeEvidence, doubleText: doubleTextEvidence, stickers: stickerVisuals });
        const response = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(analysis) });
        if (response.ok) {
          reportId = ((await response.json()) as { id: string }).id;
          void syncReportEvidence(reportId, evidence).catch(() => undefined);
          invalidateDashboardData();
        } else {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          setSaveWarning(body?.error ?? "The group report is ready, but it could not be saved.");
        }
      }
      if (reportId && extremeEvidence) {
        try { localStorage.setItem(`telescope:group-extremes:${reportId}`, JSON.stringify(extremeEvidence)); } catch { /* The saved numerical report remains usable without browser-local receipts. */ }
      }
      if (reportId && doubleTextEvidence) {
        try { localStorage.setItem(`telescope:group-double-text:${reportId}`, JSON.stringify(doubleTextEvidence)); } catch { /* Browser-local receipts are optional. */ }
      }
      if (reportId && stickerVisuals) {
        try { localStorage.setItem(`telescope:group-stickers:${reportId}`, JSON.stringify(stickerVisuals)); } catch { /* Sticker artwork remains available for this session. */ }
      }
      let ai: GroupAiPayload | undefined;
      let aiEvidence: LocalGroupMessage[] | undefined;
      if (withAi && viewer && reportId && raw) {
        try {
          setPhase({ kind: "working", note: "reading the group conversation" });
          ai = await requestGroupAnalysis({ raw, reportId, onProgress: (note) => setPhase({ kind: "working", note }) });
          const ids = new Set([...(ai.topics ?? ai.themes ?? []), ...ai.roles, ...(ai.eras ?? []), ...(ai.lore ?? [])].flatMap((item) => item.evidenceMessageIds));
          aiEvidence = selectedGroup.messages.filter((message) => ids.has(message.id)).map((message) => ({ id: message.id, ts: message.ts, participantId: message.participantId, body: message.text.trim() || (message.media ? "[Media]" : "[Empty message]") }));
          if (aiEvidence.length) {
            localStorage.setItem(`telescope:group-ai-evidence:${reportId}`, JSON.stringify(aiEvidence));
            // This final write happens after the worker completes, preventing
            // the earlier numerical-evidence sync from winning a write race.
            await syncReportEvidence(reportId, { groupAi: aiEvidence });
          }
        } catch (error) {
          setSaveWarning(error instanceof Error ? `The group report is ready, but AI insights failed: ${error.message}` : "The group report is ready, but AI insights failed.");
        }
      }
      setPreparedGroup({ analysis, reportId, extremeEvidence, ai, aiEvidence, doubleTextEvidence, stickerVisuals });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "The group report could not be created." });
    }
  }, [pendingGroup, pendingGroupFiles, pendingGroupRaw, telegramSenderId, viewer]);

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
      const [{ analyzeParsed }, { buildDeck }, { buildStickerVisuals }] = await Promise.all([
        import("@/domain/analyze"),
        import("@/ui/cards"),
        import("@/ui/sticker-assets"),
      ]);
      pendingFile.parsed.chat.participants = participants;
      const analysis = analyzeParsed(pendingFile.parsed);
      const doubleTextMessages = localDoubleTextEvidence(pendingFile.parsed, analysis);
      const extremeEvidence = localExtremeEvidence(pendingFile.parsed, analysis);
      const stickerVisuals = await buildStickerVisuals(pendingFile.parsed, pendingFile.files);
      let reportId: string | null = null;
      if (viewer) {
        setPhase({ kind: "working", note: "saving your report" });
        const evidence = syncableReportEvidence({ doubleText: doubleTextMessages, extremes: extremeEvidence, stickers: stickerVisuals });
        const response = await fetch("/api/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(analysis),
        });
        if (response.ok) {
          reportId = ((await response.json()) as { id: string }).id;
          void syncReportEvidence(reportId, evidence).catch(() => undefined);
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
          setPhase({ kind: "working", note: "assembling your report" });
        }
      }
      setPrepared(next);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error
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
      <Suspense fallback={<div className="min-h-dvh bg-night" aria-label="Opening report" />}>
      <div className="report-reveal">
      <Report
        analysis={loaded.analysis}
        deck={loaded.deck}
        llm={llm}
        coverActions={loaded.reportId ? <ReportActions reportId={loaded.reportId} canConfigureMessages={Boolean(llm)} /> : undefined}
        backHref={viewer ? dashboardUrl() : "/"}
        promptInsightsAtEnd={Boolean(viewer)}
        doubleTextMessages={loaded.doubleTextMessages}
        localEvidenceKey={loaded.reportId ?? undefined}
        extremeEvidence={loaded.extremeEvidence}
        stickerVisuals={loaded.stickerVisuals}
        aiProgress={aiProgress}
        endControl={!viewer ? <GuestEndPrompt analysis={loaded.analysis} /> : undefined}
        guestFinalControl={!viewer ? <GuestFinalPrompt analysis={loaded.analysis} /> : undefined}
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
      </Suspense>
    );
  }

  if (groupLoaded) {
    return <Suspense fallback={<div className="min-h-dvh bg-night" aria-label="Opening group report" />}><div className="report-reveal"><GroupReport analysis={groupLoaded.analysis} ai={groupLoaded.ai} aiEvidence={groupLoaded.aiEvidence} aiControl={!viewer ? <AccountGate signedIn={false} analysis={groupLoaded.analysis} /> : undefined} endControl={!viewer ? <GuestEndPrompt analysis={groupLoaded.analysis} /> : undefined} guestFinalControl={!viewer ? <GuestFinalPrompt analysis={groupLoaded.analysis} /> : undefined} extremeEvidence={groupLoaded.extremeEvidence} doubleTextEvidence={groupLoaded.doubleTextEvidence} stickerVisuals={groupLoaded.stickerVisuals} localEvidenceKey={groupLoaded.reportId ?? undefined} onBack={() => { setGroupLoaded(null); setPhase({ kind: "idle" }); if (input.current) input.current.value = ""; }} /></div></Suspense>;
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
      reportReady={Boolean(prepared || preparedGroup)}
      onView={() => {
        if (preparedGroup) {
          if (preparedGroup.reportId) {
            window.dispatchEvent(new Event(TELESCOPE_OPEN_REPORT_EVENT));
            router.push(`/reports/${preparedGroup.reportId}`);
            return;
          }
          setGroupLoaded(preparedGroup);
          setPreparedGroup(null);
          setPhase({ kind: "idle" });
          return;
        }
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
    {pendingGroup && <GroupParticipantModal
      group={pendingGroup}
      onConfirm={confirmGroupParticipants}
      accountName={viewer?.name}
      canUseAi={Boolean(viewer)}
      telegramSenderId={telegramSenderId}
      onBack={() => setPendingGroup(null)}
      onChooseAnother={() => {
        setPendingGroup(null);
        if (input.current) input.current.value = "";
        window.requestAnimationFrame(() => input.current?.click());
      }}
    />}
    </>
  );
}

function GroupParticipantModal({
  group,
  onConfirm,
  onBack,
  onChooseAnother,
  accountName,
  canUseAi,
  telegramSenderId,
}: {
  group: ParsedGroup;
  onConfirm: (includedIds: Set<string>, displayNames: Map<string, string>, groupName: string, withAi: boolean, selfSenderId: string | null) => void;
  onBack: () => void;
  onChooseAnother: () => void;
  accountName?: string;
  canUseAi: boolean;
  telegramSenderId: string | null;
}) {
  const counts = new Map<string, number>();
  for (const message of group.messages) counts.set(message.participantId, (counts.get(message.participantId) ?? 0) + 1);
  const people = [...group.participants].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const [selected, setSelected] = useState(() => new Set(people.map((person) => person.id)));
  const [displayNames, setDisplayNames] = useState(() => new Map(people.map((person) => [person.id, person.name])));
  const matchingSelf = accountName ? people.filter((person) => person.name.toLocaleLowerCase() === accountName.toLocaleLowerCase()) : [];
  const [selfId, setSelfId] = useState<string | null>(() => people.some((person) => person.id === telegramSenderId) ? telegramSenderId : matchingSelf.length === 1 ? matchingSelf[0].id : null);
  const [query, setQuery] = useState("");
  const [withAi, setWithAi] = useState(false);
  const [groupName, setGroupName] = useState(group.chat.name.slice(0, 40));
  const visible = people.filter((person) => (displayNames.get(person.id) ?? person.name).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectedMessages = group.messages.reduce((sum, message) => sum + Number(selected.has(message.participantId)), 0);
  const peak = Math.max(1, ...people.map((person) => counts.get(person.id) ?? 0));
  const namesValid = [...selected].every((id) => (selfId === id && accountName ? accountName : displayNames.get(id))?.trim());
  const valid = selected.size >= 3 && namesValid && Boolean(groupName.trim()) && (!accountName || Boolean(selfId));
  const toggle = (id: string) => setSelected((current) => {
    if (id === selfId) return current;
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const chooseSelf = (id: string) => {
    setSelfId(id);
    setSelected((current) => new Set(current).add(id));
  };
  const confirmedNames = () => {
    const names = new Map(displayNames);
    if (selfId && accountName) names.set(selfId, accountName);
    return names;
  };

  useEffect(() => {
    if (!telegramSenderId || !people.some((person) => person.id === telegramSenderId)) return;
    setSelfId(telegramSenderId);
    setSelected((current) => current.has(telegramSenderId) ? current : new Set(current).add(telegramSenderId));
  }, [group.participants, telegramSenderId]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onBack]);

  return <div onMouseDown={(event) => { if (event.target === event.currentTarget) onBack(); }} className="fixed inset-0 z-50 grid h-dvh place-items-center overflow-hidden bg-night/82 p-4 backdrop-blur-md sm:p-7" role="dialog" aria-modal="true" aria-labelledby="group-participant-title">
    <form onSubmit={(event) => { event.preventDefault(); if (valid) void onConfirm(new Set(selected), confirmedNames(), groupName.trim(), withAi, selfId); }} className="starfield rise relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[900px] flex-col overflow-hidden rounded-[26px] border border-white/14 bg-night text-white shadow-2xl sm:max-h-[calc(100dvh-3.5rem)]">
      <header className="relative shrink-0 px-6 pb-5 pt-6 sm:px-9 sm:pt-8">
        <div className="flex items-start justify-between gap-5"><div><Kicker tone="lit">Group found · {people.length} active senders</Kicker><h2 id="group-participant-title" className="mt-3 font-display text-[clamp(2.5rem,6vw,5rem)] leading-[.9] tracking-[-.025em]">Who belongs in the report?</h2><p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-white/48">Rename anyone as they should appear, and remove people whose messages should not shape the results.{accountName ? ` Choose which participant is you; your name will stay “${accountName}” and can only be changed in Settings.` : ""}</p></div><button type="button" onClick={onBack} aria-label="Close participant review" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/16 text-xl text-white/42 transition hover:border-white/40 hover:text-white">×</button></div>
        <label className="mt-6 block border-t border-white/12 pt-4"><span className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[.12em] text-white/38"><span>Group report name</span><span>{40 - groupName.length} left</span></span><input value={groupName} maxLength={40} onChange={(event) => setGroupName(event.target.value)} className="mt-2 w-full border-b border-white/16 bg-transparent pb-2 font-display text-2xl text-white outline-none focus:border-accent-lit" /></label>
        <div className="mt-4 grid gap-3 border-y border-white/12 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><label className="flex items-center gap-3"><span className="text-white/28">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a participant" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28" /></label><button type="button" onClick={() => setSelected(new Set(people.map((person) => person.id)))} className="font-mono text-[8px] uppercase tracking-[.12em] text-accent-lit transition hover:text-white">Include everyone</button></div>
      </header>
      <ol className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 sm:px-9">{visible.map((person, index) => {
        const count = counts.get(person.id) ?? 0;
        const included = selected.has(person.id);
        const isSelf = selfId === person.id && Boolean(accountName);
        return <li key={person.id} className={`grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b py-3 transition sm:grid-cols-[36px_minmax(140px,230px)_minmax(70px,1fr)_auto] sm:gap-5 ${included ? "border-white/12 text-white" : "border-white/[.07] text-white/28"}`}><button type="button" aria-pressed={included} disabled={isSelf} onClick={() => toggle(person.id)} aria-label={`${included ? "Exclude" : "Include"} ${displayNames.get(person.id) ?? person.name}`} className={`grid h-7 w-7 place-items-center rounded-full border font-mono text-[9px] transition ${included ? "border-accent-lit bg-accent-lit text-night" : "border-white/16"} disabled:cursor-default`}>{included ? "✓" : String(index + 1).padStart(2, "0")}</button><div className="min-w-0">{isSelf ? <div className="border-b border-white/10 py-1 font-display text-xl text-white/52 sm:text-2xl">{accountName}</div> : <input value={displayNames.get(person.id) ?? person.name} maxLength={20} disabled={!included} aria-label={`Report name for ${person.name}`} onChange={(event) => setDisplayNames((current) => new Map(current).set(person.id, event.target.value))} className="w-full border-b border-white/18 bg-transparent py-1 font-display text-xl text-inherit outline-none transition focus:border-accent-lit disabled:opacity-45 sm:text-2xl" />}<span className="mt-1 flex gap-3 font-mono text-[7px] uppercase tracking-[.1em]">{isSelf ? <span className="text-accent-lit">You · name from Settings</span> : accountName ? <button type="button" onClick={() => chooseSelf(person.id)} className="text-white/30 transition hover:text-accent-lit">This is me</button> : null}</span></div><span className="col-start-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-white/8 sm:col-start-auto sm:row-start-auto"><span className={`block h-full rounded-full transition ${included ? "bg-accent-lit" : "bg-white/14"}`} style={{ width: `${Math.max(1, count / peak * 100)}%` }} /></span><span className="row-span-2 text-right font-mono text-[8px] uppercase tracking-[.1em] sm:row-span-1">{count.toLocaleString()} <span className="hidden sm:inline">messages</span></span></li>;
      })}</ol>
      <footer className="relative shrink-0 border-t border-white/12 bg-night/84 px-6 py-4 sm:px-9"><label className={`flex items-start gap-3 border-b border-white/10 pb-4 ${canUseAi ? "cursor-pointer" : "opacity-42"}`}><input type="checkbox" checked={withAi} disabled={!canUseAi} onChange={(event) => setWithAi(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-accent-lit)]" /><span><span className="block text-sm font-semibold">Generate group AI insights now</span><span className="mt-1 block text-xs leading-relaxed text-white/42">Recurring themes, conversational roles and group dynamics.{!canUseAi ? " Sign in to enable this." : " Your report opens after the reading is ready."}</span></span></label><div className="mt-4 flex flex-wrap items-center justify-between gap-4"><div><p className={`font-mono text-[9px] uppercase tracking-[.14em] ${valid ? "text-accent-lit" : "text-warn"}`}>{selected.size} people · {selectedMessages.toLocaleString()} messages included</p><div className="mt-2 flex gap-4"><button type="button" onClick={onBack} className="text-xs text-white/38 transition hover:text-white">← Back</button><button type="button" onClick={onChooseAnother} className="text-xs text-white/38 transition hover:text-white">Choose another file</button></div></div><button type="submit" disabled={!valid} className="rounded-full bg-accent-lit px-6 py-3 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30">Build group report →</button>{!valid && <p className="basis-full text-right text-xs text-warn">{selected.size < 3 ? "Keep at least three people." : !namesValid ? "Every included person needs a name." : "Choose which participant is you."}</p>}</div></footer>
    </form>
  </div>;
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
          <label className="text-xs font-medium text-ink/55">Conversation partner<input autoFocus value={first} onChange={(event) => setFirst(event.target.value)} maxLength={20} className="mt-2 w-full border-b border-ink/20 bg-transparent py-3 font-display text-2xl text-ink outline-none transition focus:border-accent" /><span aria-live="polite" className="mt-2 block text-right font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - first.length)} characters left</span></label>
          {accountName ? <div className="text-xs font-medium text-ink/55">You<div className="mt-2 w-full border-b border-ink/10 py-3 font-display text-2xl text-ink/48">{second}</div></div> : <label className="text-xs font-medium text-ink/55">You<input value={second} onChange={(event) => setSecond(event.target.value)} maxLength={20} className="mt-2 w-full border-b border-ink/20 bg-transparent py-3 font-display text-2xl text-ink outline-none transition focus:border-accent" /><span aria-live="polite" className="mt-2 block text-right font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - second.length)} characters left</span></label>}
        </div>
        <label className={`mt-7 flex items-start gap-3 border-y border-ink/12 py-4 ${canUseAi ? "cursor-pointer" : "opacity-45"}`}><input type="checkbox" checked={withAi} disabled={!canUseAi} onChange={(event) => setWithAi(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" /><span><span className="block text-sm font-semibold">Generate AI insights now</span><span className="mt-1 block text-xs leading-relaxed text-ink/50">Named eras, recurring lore, wild sentences and the roles you grew into.{!canUseAi ? " Sign in to enable this." : " Your report opens when the complete reading is ready."}</span></span></label>
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
          <p className="mt-4 max-w-[54ch] text-sm leading-relaxed text-ink/52">Choose the complete folder Telegram created for a direct or group chat. Telescope detects the report type and includes sticker artwork when it is present.</p>
        </header>

        <div className="my-auto py-8">
          <label
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void filesFromDrop(event.dataTransfer).then((files) => { if (files.length) void onFiles(files); }); }}
            className={`analysis-export-dropzone group relative flex min-h-[310px] cursor-pointer flex-col justify-between overflow-hidden rounded-[26px] border-2 bg-night p-7 text-white transition duration-300 sm:min-h-[390px] sm:p-10 ${dragging ? "scale-[1.01] border-accent-lit" : "border-night hover:border-accent-lit"}`}
          >
            <input ref={inputRef} type="file" {...folderInputProps} className="sr-only" onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void onFiles(files); }} />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-lit">Complete Telegram export</span>
              <span className="grid h-14 w-14 place-items-center rounded-full border border-accent-lit/60 text-2xl text-accent-lit transition group-hover:-translate-y-1 group-hover:bg-accent-lit group-hover:text-night">↗</span>
            </div>
            <div>
              <p className="max-w-[13ch] font-display text-[42px] leading-[0.92] sm:text-[62px]">{phase.kind === "working" ? `${phase.note}…` : <>Choose the export <span className="italic text-accent-lit">folder</span></>}</p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/14 pt-5 text-xs text-white/45"><span>Direct or group chat · any length</span><span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-safe-lit"><Shield /> raw chat stays local</span><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setGuideOpen(true); }} className="text-accent-lit underline decoration-accent-lit/35 underline-offset-4">How to export it</button></div>
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
    <div onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 z-50 grid h-dvh place-items-center overflow-hidden bg-night/78 p-4 backdrop-blur-md sm:px-5 sm:py-8" role="dialog" aria-modal="true" aria-labelledby="export-guide-title">
      <section className="rise flex max-h-[calc(100dvh-2rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] bg-surface text-ink shadow-2xl sm:max-h-[calc(100dvh-4rem)]">
        <header className="flex shrink-0 items-start justify-between gap-6 border-b border-ink/12 px-6 py-6 sm:px-9 sm:py-8">
          <div><Kicker>Telegram export guide</Kicker><h2 id="export-guide-title" className="mt-3 font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[.95]">Export the complete chat folder.</h2><p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ink/52">One chat, one folder. Create it in Telegram Desktop, then choose that entire folder in Telescope.</p></div>
          <button type="button" onClick={onClose} aria-label="Close export guide" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ink/14 text-xl text-ink/42 transition hover:border-ink/35 hover:text-ink">×</button>
        </header>
        <ol className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-6 sm:px-9">{steps.map(([number, title, body]) => <li key={number} className="grid grid-cols-[42px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-ink/12 py-4 last:border-b-0 sm:grid-cols-[54px_190px_minmax(0,1fr)] sm:items-start sm:gap-3"><span className="font-mono text-[10px] text-accent">{number}</span><p className="font-semibold text-ink">{title}</p><p className="col-start-2 text-sm leading-relaxed text-ink/52 sm:col-start-auto">{body}</p></li>)}</ol>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 bg-shade px-6 py-5 sm:px-9"><p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-safe-deep"><Shield /> Sticker assets stay in your browser</p><button type="button" onClick={onClose} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-accent">Back to upload</button></footer>
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
  const display = stage === "phrases" ? LOCAL_LOADING_LINES[line] : stage === "receipts" ? "Preparing the receipts..." : "Your report is ready.";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 py-8 backdrop-blur-md" role="status">
      <span className="sr-only">Creating your report.</span>
      <div className="starfield rise relative flex min-h-[390px] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-white/16 bg-night px-6 py-6 text-white shadow-2xl sm:min-h-[440px] sm:px-9 sm:py-8">
        <header className="relative flex items-center justify-between border-b border-white/12 pb-5"><span className="flex items-center gap-2.5 font-display text-xl"><Logo size={22} tone="night" /> Telescope</span><span className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/35">{stage === "ready" ? "Ready when you are" : "Building your report"}</span></header>
        <div className="relative my-auto py-9">
          <div className="mb-6 flex items-center gap-4"><span className={`${stage === "phrases" ? "loading-orbit" : ""} grid h-11 w-11 place-items-center rounded-full border border-accent-lit/45 text-accent-lit`}>{stage === "ready" ? "✓" : "◎"}</span><Kicker tone="lit">{stage === "phrases" ? "Looking closer" : stage === "receipts" ? "One last thing" : "Finished"}</Kicker></div>
          <p key={`${stage}-${line}`} aria-hidden="true" className={`${stage === "phrases" && line === 0 ? "" : "loading-copy-enter"} max-w-[15ch] font-display text-[clamp(2.8rem,6vw,5.2rem)] leading-[0.9] tracking-[-0.025em] text-white`}>{display}</p>
          {stage === "ready" && <button type="button" onClick={onView} className="mt-8 inline-flex items-center gap-3 rounded-full bg-accent-lit px-7 py-3.5 text-sm font-semibold text-night transition duration-300 hover:-translate-y-1 hover:bg-white">View your report <span aria-hidden="true">→</span></button>}
        </div>
        <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/12 pt-5"><p className="max-w-[48ch] text-xs leading-relaxed text-white/42">Counted in this tab. The raw conversation stays on your machine.</p><span className="font-mono text-[8px] uppercase tracking-[0.16em] text-accent-lit">{stage === "ready" ? "Complete" : phase.note}</span></footer>
      </div>
    </div>
  );
}

function rememberForSignup(analysis: Analysis | GroupAnalysis) {
  try {
    sessionStorage.setItem("telescope:pending-analysis", JSON.stringify(analysis));
  } catch {
    // A very large derived report can exceed browser storage. Authentication
    // still proceeds; the user can rerun the local analysis after signing in.
  }
}

function GuestEndPrompt({ analysis }: { analysis: Analysis | GroupAnalysis }) {
  return (
    <div className="max-w-[980px]">
      <p className="font-mono text-[clamp(.95rem,1.5vw,1.3rem)] font-semibold uppercase tracking-[.16em] text-accent-lit">Keep the report</p>
      <h2 className="mt-5 font-display text-[clamp(3.4rem,8vw,8rem)] leading-[.86] tracking-[-.035em] text-white">Save it. Share it.<br /><span className="italic text-accent-lit">Come back to it.</span></h2>
      <p className="mt-7 max-w-[58ch] text-lg leading-relaxed text-white/60">Log in or create an account to add this report to your dashboard and generate a shareable link. It will be saved automatically as soon as Google brings you back.</p>
      <Link href="/sign-in" onClick={() => rememberForSignup(analysis)} className="mt-8 inline-flex rounded-full bg-accent-lit px-7 py-3.5 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:brightness-110">Log in or sign up to save <span className="ml-3">→</span></Link>
    </div>
  );
}

function GuestFinalPrompt({ analysis }: { analysis: Analysis | GroupAnalysis }) {
  const group = "kind" in analysis && analysis.kind === "group";
  return <div className="mt-8"><p className="mx-auto max-w-[720px] text-[clamp(1.1rem,2vw,1.5rem)] font-semibold leading-snug text-white/76">{group ? "Log in or sign up to share this with the rest of the room." : "Log in or sign up to share this with the co-star of this chaos."}</p><Link href="/sign-in" onClick={() => rememberForSignup(analysis)} className="mt-6 inline-flex items-center gap-3 rounded-full bg-accent-lit px-7 py-3.5 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:bg-white">Log in or sign up <span aria-hidden="true">→</span></Link></div>;
}

function AccountGate({ signedIn, analysis }: { signedIn: boolean; analysis: Analysis | GroupAnalysis }) {
  const group = "kind" in analysis && analysis.kind === "group";
  return (
    <NightPanel className="ai-insights-panel border border-accent-lit/45 shadow-[inset_0_0_0_1px_rgba(42,171,238,.06)]">
      <Kicker tone="lit" className="mb-3.5">Powered by AI</Kicker>
      <p className="font-display text-[23px] leading-snug text-white">
        {signedIn ? "Unlock what the numbers cannot name." : group ? "Unlock what shaped the room." : "Unlock new insights hidden in the conversation."}
      </p>
      <p className="mt-3.5 text-sm leading-relaxed text-white/60">
        {signedIn
          ? "Let AI name eras, surface recurring lore and identify the roles you each grew into."
          : group ? "Sign up to reveal recurring topics, group roles, shared lore and named eras—with evidence from the chat." : "Sign up to reveal named eras, recurring lore, topic patterns and the roles you each grew into—with evidence from the chat."}
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
    <NightPanel className="ai-insights-panel border border-accent-lit/45 shadow-[inset_0_0_0_1px_rgba(42,171,238,.06)]">
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

const REPORT_MOMENTS = [
  { eyebrow: "Rhythm", title: "When the conversation peaks", value: "23:40", detail: "The conversation was most active around 23:40.", note: "Activity · by time of day", tone: "text-white", bars: [18, 12, 8, 6, 5, 7, 11, 16, 24, 31, 38, 44, 35, 28, 32, 39, 48, 61, 73, 82, 91, 100, 72, 46] },
  { eyebrow: "Silence", title: "The gap that became a chapter", value: "41 days", detail: "Then one of you came back at 02:14.", note: "Longest silence · all time", tone: "text-side-a", bars: [84, 72, 64, 52, 30, 10, 4, 3, 3, 4, 8, 22, 48, 76, 92, 68, 54, 61, 80, 72, 58, 44, 61, 78] },
  { eyebrow: "Private language", title: "The phrase that became yours", value: "“sooo?”", detail: "312 appearances. Nowhere in the first year.", note: "Distinctive language · log-odds", tone: "text-accent-lit italic", bars: [4, 7, 12, 17, 25, 31, 36, 43, 48, 55, 63, 72, 78, 87, 96, 84, 91, 77, 88, 94, 82, 98, 91, 100] },
  { eyebrow: "Return pattern", title: "Who restarts the conversation", value: "62%", detail: "Alice restarted 62% of conversations after a meaningful silence.", note: "Re-entry · 24h threshold", tone: "text-safe-lit", bars: [63, 42, 71, 53, 80, 61, 72, 48, 66, 57, 85, 63, 76, 55, 69, 82, 61, 73, 58, 78, 65, 84, 70, 88] },
  { eyebrow: "The receipts", title: "The longest uninterrupted run", value: "17 texts", detail: "Sent before the other person replied.", note: "Monologue streak · with context", tone: "text-warn", bars: [8, 13, 18, 24, 29, 37, 45, 52, 61, 70, 79, 88, 100, 91, 83, 74, 62, 50, 43, 35, 27, 21, 16, 12] },
  { eyebrow: "AI reading", title: "The roles you grew into", value: "Archivist × Instigator", detail: "A written reading whose claims link back to the messages.", note: "Opt-in · evidence checked", tone: "text-accent-lit", bars: [42, 48, 45, 58, 54, 67, 62, 73, 70, 81, 77, 89, 85, 94, 88, 96, 91, 84, 78, 86, 74, 69, 61, 55] },
] as const;

const HERO_SAMPLE_MOMENTS = REPORT_MOMENTS.slice(0, 5);
const HERO_HEADLINE_ENDINGS = [
  "you were too close to notice.",
  "after the dust settles.",
  "through a different lens.",
  "behind the chaos.",
] as const;

function ShufflingHeroEnding() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % HERO_HEADLINE_ENDINGS.length),
      3800,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <span className="sr-only">you were too close to notice, after the dust settles, through a different lens, and behind the chaos.</span>
      <span aria-hidden="true" className="block overflow-hidden">
        <span key={HERO_HEADLINE_ENDINGS[active]} className="result-stat-enter block italic text-accent-lit">
          {HERO_HEADLINE_ENDINGS[active]}
        </span>
      </span>
    </>
  );
}

function HeroMomentVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="relative pt-5" aria-label="23:40 marked near the end of a 24-hour timeline">
        <div className="flex justify-between font-mono text-[8px] uppercase tracking-[.12em] text-white/25"><span>00:00</span><span>12:00</span><span>24:00</span></div>
        <div className="relative mt-2 h-5 border-t border-white/18">
          <span className="absolute -top-[5px] left-[98.6%] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-night bg-accent-lit ring-1 ring-accent-lit" />
          <span className="absolute right-0 top-2 font-mono text-[8px] uppercase tracking-[.12em] text-accent-lit">peak · 23:40</span>
        </div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="pt-5" aria-label="A 41-day interval between two messages">
        <div className="flex items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-white/55" /><span className="h-px flex-1 border-t border-dashed border-side-a/70" /><span className="font-mono text-[9px] uppercase tracking-[.14em] text-side-a">41 days</span><span className="h-px flex-1 border-t border-dashed border-side-a/70" /><span className="h-2.5 w-2.5 rounded-full bg-side-a" /></div>
        <div className="mt-2 flex justify-between font-mono text-[8px] uppercase tracking-[.12em] text-white/25"><span>last message</span><span>next message</span></div>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="grid grid-cols-2 gap-px bg-white/12" aria-label="The phrase appeared zero times in year one and 312 times later">
        <div className="bg-night py-3 pr-4"><span className="block font-mono text-[8px] uppercase tracking-[.13em] text-white/25">Year one</span><span className="mt-1 block font-display text-2xl text-white/45">0 uses</span></div>
        <div className="bg-night py-3 pl-4"><span className="block font-mono text-[8px] uppercase tracking-[.13em] text-accent-lit">Later</span><span className="mt-1 block font-display text-2xl text-accent-lit">312 uses</span></div>
      </div>
    );
  }

  if (index === 3) {
    return (
      <div aria-label="Conversation restarts split: Alice 62 percent, Bob 38 percent">
        <div className="flex h-2 overflow-hidden rounded-full"><span className="w-[62%] bg-safe-lit" /><span className="w-[38%] bg-white/14" /></div>
        <div className="mt-2 flex justify-between font-mono text-[8px] uppercase tracking-[.12em]"><span className="text-safe-lit">Alice · 62%</span><span className="text-white/28">Bob · 38%</span></div>
      </div>
    );
  }

  return (
    <div aria-label="Seventeen consecutive messages before a reply">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 17 }, (_, item) => <span key={item} className="h-5 min-w-0 flex-1 rounded-[3px] bg-warn/75" />)}
        <span className="ml-1 h-5 w-2.5 shrink-0 rounded-[3px] bg-white/35" />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[8px] uppercase tracking-[.12em]"><span className="text-warn">17 sent in a row</span><span className="text-white/28">reply</span></div>
    </div>
  );
}

function HeroSampleReading() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % HERO_SAMPLE_MOMENTS.length),
      4200,
    );
    return () => window.clearInterval(timer);
  }, [paused]);

  const moment = HERO_SAMPLE_MOMENTS[active];
  const next = () => setActive((current) => (current + 1) % HERO_SAMPLE_MOMENTS.length);

  return (
    <section
      aria-label="Illustrative Telescope report reading"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      className="relative h-[390px] overflow-hidden border-y border-white/14 py-5 sm:h-[400px]"
    >
      <div className="flex items-center justify-between gap-5 font-mono text-[9px] uppercase tracking-[.17em]">
        <span className="text-accent-lit">Sample reading · illustrative</span>
        <button type="button" onClick={next} className="text-white/30 transition hover:text-white focus-visible:text-white focus-visible:outline-none">
          {String(active + 1).padStart(2, "0")} / {String(HERO_SAMPLE_MOMENTS.length).padStart(2, "0")} &nbsp;→
        </button>
      </div>

      <div key={moment.eyebrow} className="result-stat-enter mt-6 grid h-[310px] grid-rows-[minmax(0,1fr)_118px] sm:h-[320px]">
        <div className="min-h-0">
          <p className="font-mono text-[9px] uppercase tracking-[.16em] text-white/38">{moment.title}</p>
          <p className={`mt-5 whitespace-nowrap font-display text-[clamp(5.6rem,12vw,9.1rem)] leading-[.7] tracking-[-.055em] ${moment.tone}`}>{moment.value}</p>
        </div>
        <div className="grid grid-rows-[52px_66px]">
          <div className="flex items-baseline justify-between gap-5 pb-4">
            <p className="line-clamp-2 text-sm leading-relaxed text-white/48">{moment.detail}</p>
            <span className="hidden shrink-0 font-mono text-[8px] uppercase tracking-[.14em] text-white/24 sm:block">{moment.note}</span>
          </div>
          <div className="flex h-[66px] flex-col justify-end overflow-hidden">
            <HeroMomentVisual index={active} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CompactHeroSampleReading() {
  const [active, setActive] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % HERO_SAMPLE_MOMENTS.length), 4200);
    return () => window.clearInterval(timer);
  }, []);

  const moment = HERO_SAMPLE_MOMENTS[active];
  return (
    <div className="rise w-full border-y border-white/14 py-4 text-left sm:max-w-[440px] lg:hidden" style={{ animationDelay: "440ms" }} aria-label="Illustrative rotating report finding">
      <div key={moment.eyebrow} className="result-stat-enter min-h-[180px] sm:min-h-0">
        <p className="font-mono text-[8px] uppercase tracking-[.15em] text-accent-lit">{moment.title}</p>
        <p className={`mt-3 font-display text-[clamp(3.4rem,12vw,5.25rem)] leading-[.78] tracking-[-.035em] sm:whitespace-nowrap ${moment.tone}`}>{moment.value}</p>
        <p className="mt-3 font-mono text-[8px] uppercase tracking-[.13em] text-white/30">{moment.note}</p>
        <div className="mt-3 min-h-[52px] text-left sm:h-[52px] sm:overflow-hidden"><HeroMomentVisual index={active} /></div>
      </div>
    </div>
  );
}

const SAMPLE_REPORT_PAGES = [
  {
    kind: "split",
    kicker: "The yapper split",
    title: "Alice sent fewer messages—and more of the words.",
    detail: "Message count and word count do not tell the same story. Alice wrote longer; Bob sent more often.",
  },
  {
    kind: "communication",
    kicker: "How you speak",
    title: "Same chat. Different dialects.",
    detail: "Emoji, stickers, voice notes and video messages reveal the formats each person reaches for when plain text is not enough.",
  },
  {
    kind: "chapters",
    kicker: "Your eras",
    title: "This conversation had chapters.",
    detail: "Changes in volume, timing and language reveal the stretches where the relationship found a different rhythm.",
  },
  {
    kind: "streak",
    kicker: "Double Texter Award",
    title: "Bob reached eight follow-ups without a reply.",
    detail: "A follow-up counts only when another unanswered message arrives at least two minutes later.",
  },
  {
    kind: "language",
    kicker: "Your language",
    title: "The phrases that sound like each of you.",
    detail: "Not simply the most common words—the expressions each person uses unusually often, and the ones that became shared language.",
  },
  {
    kind: "roles",
    kicker: "Character cards",
    title: "The roles you grew into.",
    detail: "Optional AI interpretation names repeated behaviour, then links every claim back to evidence in the conversation.",
  },
] as const;

type SampleReportKind = (typeof SAMPLE_REPORT_PAGES)[number]["kind"];

function SampleReportGraphic({ kind }: { kind: SampleReportKind }) {
  if (kind === "split") {
    const rows = [
      ["messages", "7,842", "10,584", 43],
      ["words", "68,210", "51,404", 57],
      ["characters / message", "51", "29", 64],
    ] as const;
    return <div className="space-y-5">{rows.map(([label, a, b, share]) => <div key={label}><div className="mb-2 flex items-end justify-between gap-4"><span className="text-xs text-white/46">{label}</span><span className="font-mono text-[9px]"><span className="text-side-a">{a}</span><span className="text-white/25"> / </span><span className="text-side-b">{b}</span></span></div><div className="flex h-3 overflow-hidden rounded-full bg-white/8"><span className="bg-side-a" style={{ width: `${share}%` }} /><span className="bg-side-b" style={{ width: `${100 - share}%` }} /></div></div>)}</div>;
  }

  if (kind === "communication") {
    return <div className="grid grid-cols-2 gap-6"><section className="border-t border-side-a pt-4"><p className="font-mono text-[8px] uppercase tracking-[.15em] text-side-a">Alice</p><p className="mt-3 text-[clamp(1.8rem,4vw,3.6rem)] leading-none">😭 ❤️ 🫡</p><dl className="mt-4 space-y-1.5 font-mono text-[8px] uppercase tracking-[.1em] text-white/36"><div className="flex justify-between"><dt>emoji</dt><dd className="text-white/70">1,284</dd></div><div className="flex justify-between"><dt>voice notes</dt><dd className="text-white/70">46 · 2.1h</dd></div><div className="flex justify-between"><dt>stickers</dt><dd className="text-white/70">73</dd></div></dl></section><section className="border-t border-side-b pt-4"><p className="font-mono text-[8px] uppercase tracking-[.15em] text-side-b">Bob</p><p className="mt-3 text-[clamp(1.8rem,4vw,3.6rem)] leading-none">💀 👍 🧍</p><dl className="mt-4 space-y-1.5 font-mono text-[8px] uppercase tracking-[.1em] text-white/36"><div className="flex justify-between"><dt>emoji</dt><dd className="text-white/70">642</dd></div><div className="flex justify-between"><dt>video messages</dt><dd className="text-white/70">119 · 1.4h</dd></div><div className="flex justify-between"><dt>stickers</dt><dd className="text-white/70">311</dd></div></dl></section></div>;
  }

  if (kind === "chapters") {
    const eras = [["May ’19", "New-friend messages", "18%", "bg-accent"], ["Nov ’20", "Long-distance months", "27%", "bg-safe"], ["Aug ’22", "Living in the same city", "31%", "bg-warn"], ["Jan ’25", "The everyday check-in", "24%", "bg-accent-lit"]] as const;
    return <div aria-label="Conversation timeline from May 2019 to July 2026"><div className="relative pt-5"><div className="absolute left-0 right-0 top-[25px] h-px bg-white/18" /><div className="relative flex">{eras.map(([date, name, width, color]) => <div key={name} style={{ width }} className="pr-2"><span className={`block h-3 w-3 rounded-full border-2 border-night ${color}`} /><p className="mt-3 font-mono text-[7px] uppercase tracking-[.1em] text-white/30">{date}</p><p className="mt-1 max-w-[16ch] text-[11px] leading-tight text-white/68">{name}</p></div>)}</div></div><div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-3 font-mono text-[8px] uppercase tracking-[.1em] text-white/28"><span className="h-2 w-2 rounded-full bg-white/18" /><span>Quiet stretches remain visible between eras</span><span className="ml-auto">Jul ’26</span></div></div>;
  }

  if (kind === "streak") {
    return <div><div className="flex items-center gap-1.5" aria-label="Bob sent an initial message and eight qualifying follow-ups before Alice replied"><div className="flex flex-col items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full border border-side-b/70 bg-side-b/12 font-mono text-[8px] text-side-b">0</span><span className="font-mono text-[7px] uppercase text-white/25">first</span></div><span className="mb-5 h-px flex-1 bg-side-b/35" />{Array.from({ length: 8 }, (_, index) => <div key={index} className="flex flex-col items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-side-b font-mono text-[8px] text-night">+{index + 1}</span><span className="font-mono text-[7px] uppercase text-white/25">{3 + index * 2}m</span></div>)}<span className="mb-5 h-px flex-1 border-t border-dashed border-white/25" /><div className="flex flex-col items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-side-a font-mono text-[9px] text-white">✓</span><span className="font-mono text-[7px] uppercase text-side-a">reply</span></div></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/12 pt-3 font-mono text-[8px] uppercase tracking-[.1em]"><span className="text-side-b">Bob · 9 messages total</span><span className="text-white/32">8 follow-ups · 17 minutes unanswered</span></div></div>;
  }

  if (kind === "language") {
    return <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-6"><div className="min-w-0 border-t border-side-a pt-3 sm:pt-4"><p className="font-mono text-[7px] uppercase tracking-[.15em] text-side-a sm:text-[8px]">Alice</p><p className="mt-2 font-display text-[clamp(1.25rem,5vw,3rem)] leading-[1.05] text-white sm:mt-3">“be serious”<br /><span className="text-white/60">“wait wait”</span></p></div><div className="min-w-0 border-t border-side-b pt-3 sm:pt-4"><p className="font-mono text-[7px] uppercase tracking-[.15em] text-side-b sm:text-[8px]">Bob</p><p className="mt-2 font-display text-[clamp(1.25rem,5vw,3rem)] leading-[1.05] text-white sm:mt-3">“objectively”<br /><span className="text-white/60">“hear me out”</span></p></div><div className="col-span-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/12 pt-3 sm:pt-4"><span className="font-mono text-[7px] uppercase tracking-[.14em] text-white/28 sm:text-[8px]">What became theirs</span><span className="font-display text-xl italic text-accent-lit sm:text-2xl">“tiny emergency”</span></div></div>;
  }

  return <div className="grid gap-5 sm:grid-cols-2"><article className="border-t border-side-a pt-4"><p className="font-mono text-[8px] uppercase tracking-[.15em] text-side-a">Alice · Role 01</p><h4 className="mt-2 font-display text-3xl text-white">The Archivist</h4><p className="mt-2 text-xs leading-relaxed text-white/45">Keeps the shared past retrievable, resurfacing old details exactly when they matter.</p><p className="mt-3 border-l border-white/14 pl-3 text-xs italic text-white/32">“I found the screenshot from that night.”</p></article><article className="border-t border-side-b pt-4"><p className="font-mono text-[8px] uppercase tracking-[.15em] text-side-b">Bob · Role 01</p><h4 className="mt-2 font-display text-3xl text-white">The Instigator</h4><p className="mt-2 text-xs leading-relaxed text-white/45">Turns an ordinary check-in into the beginning of another elaborate side quest.</p><p className="mt-3 border-l border-white/14 pl-3 text-xs italic text-white/32">“Okay, but what if we actually went?”</p></article></div>;
}

function ReportShowcase() {
  const [active, setActive] = useState(0);
  const [samplePaused, setSamplePaused] = useState(false);
  const [samplePhase, setSamplePhase] = useState<"waiting" | "loading" | "ready">("waiting");
  const sampleFrameRef = useRef<HTMLDivElement>(null);
  const pageCount = SAMPLE_REPORT_PAGES.length + 1;
  const moment = active === 0 ? null : SAMPLE_REPORT_PAGES[active - 1];
  const goTo = (page: number) => setActive(Math.min(pageCount - 1, Math.max(0, page)));
  const clickAdvance = (event: React.MouseEvent<HTMLDivElement>) => {
    if (samplePhase !== "ready" || (event.target as HTMLElement).closest("a,button,input,textarea,select,[role='button'],[role='dialog']")) return;
    goTo(active + 1);
  };

  useEffect(() => {
    const frame = sampleFrameRef.current;
    if (!frame || samplePhase !== "waiting") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSamplePhase("loading");
      observer.disconnect();
    }, { threshold: 0.3 });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [samplePhase]);

  useEffect(() => {
    if (samplePhase !== "loading") return;
    const ready = window.setTimeout(() => setSamplePhase("ready"), 2500);
    return () => window.clearTimeout(ready);
  }, [samplePhase]);

  useEffect(() => {
    if (samplePhase !== "ready" || samplePaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => goTo((active + 1) % pageCount), 5000);
    return () => window.clearTimeout(timer);
  }, [active, pageCount, samplePaused, samplePhase]);

  return (
    <section
      aria-label="What comes back in a Telescope report"
      className="starfield relative overflow-hidden bg-transparent px-5 py-6 text-white sm:px-10 sm:py-10 min-[1025px]:py-28 xl:px-16 2xl:px-24"
    >
      <div className="relative mx-auto grid max-w-[1500px] gap-6 sm:gap-10 lg:grid-cols-[minmax(280px,0.52fr)_minmax(0,1.48fr)] lg:items-start xl:gap-14">
        <header className="sm:border-b sm:border-white/14 sm:pb-9 lg:sticky lg:top-10 lg:border-y lg:py-9">
          <Kicker tone="lit" className="mb-4">Illustrative conversation</Kicker>
          <h2 className="max-w-[620px] font-display text-[clamp(2.5rem,4.5vw,4.8rem)] leading-[.92] tracking-[-.025em]">The conversation looks <span className="italic text-accent-lit">different from here.</span></h2>
          <p className="mt-7 max-w-[38ch] text-base leading-relaxed text-white/54">Seven pages from one fictional history—measured and interpreted the same way as your own report.</p>
        </header>
        <div ref={sampleFrameRef} onClick={clickAdvance} onMouseEnter={() => setSamplePaused(true)} onMouseLeave={() => setSamplePaused(false)} onFocusCapture={() => setSamplePaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSamplePaused(false); }} className={`flex h-[760px] min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/14 bg-white/[.035] sm:h-[780px] lg:h-[720px] ${samplePhase === "ready" && active < pageCount - 1 ? "cursor-pointer" : ""}`}>
          {samplePhase !== "ready" ? (
            <div className="grid min-h-0 flex-1 place-items-center bg-night text-white" role="status" aria-live="polite">
              <div className="flex flex-col items-center text-center">
                <Logo size={34} tone="night" />
                <p className="mt-5 font-mono text-[9px] uppercase tracking-[.2em] text-accent-lit">Opening your report</p>
                <span className="mt-4 block h-1 w-28 overflow-hidden rounded-full bg-white/12" aria-hidden="true"><span className="sample-opening-progress block h-full rounded-full bg-accent-lit" /></span>
              </div>
            </div>
          ) : <div className="sample-report-enter flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-5 border-b border-white/12 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-2.5"><Logo size={20} tone="night" /><span className="font-display text-lg text-white">Telescope</span></div>
            <span className="font-mono text-[8px] uppercase tracking-[.17em] text-white/32">Sample report · fictional data</span>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden p-6 sm:p-10 lg:p-12">
            {moment ? (
              <div key={moment.kind} className="result-stat-enter flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[.17em] text-white/30"><span>{moment.kicker}</span><span>{String(active + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}</span></div>
                <div className={`my-auto ${moment.kind === "language" ? "py-4 sm:py-6" : "py-9"}`}><h3 className={`max-w-[18ch] font-display leading-[.92] tracking-[-.025em] text-white ${moment.kind === "language" ? "text-[clamp(1.8rem,3.5vw,3.5rem)]" : "text-[clamp(2.2rem,4vw,4.25rem)]"}`}>{moment.title}</h3><p className={`max-w-[54ch] text-sm leading-relaxed text-white/48 sm:text-base ${moment.kind === "language" ? "mt-3 sm:mt-4" : "mt-6"}`}>{moment.detail}</p></div>
                <div className={`border-t border-white/12 ${moment.kind === "language" ? "pt-4" : "pt-6"}`}><SampleReportGraphic kind={moment.kind} /></div>
              </div>
            ) : (
              <div key="cover" className="result-stat-enter flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[.17em] text-white/30"><span>Conversation report</span><span>01 / {String(pageCount).padStart(2, "0")}</span></div>
                <div className="my-auto py-12">
                  <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent-lit">May 2019 — July 2026</p>
                  <h3 className="mt-6 max-w-[11ch] font-display text-[clamp(4.5rem,11vw,10rem)] leading-[.74] tracking-[-.05em] text-white">Alice <span className="italic text-accent-lit">&amp;</span> Bob</h3>
                  <p className="mt-8 max-w-[40ch] text-base leading-relaxed text-white/48 sm:text-lg">Seven years of late nights, long silences, private language, and finding the thread again.</p>
                </div>
                <div className="grid grid-cols-2 gap-px border-y border-white/12 bg-white/12 sm:grid-cols-3">
                  <div className="bg-night py-4 pr-4"><span className="block font-display text-3xl text-white">18,426</span><span className="mt-1 block font-mono text-[8px] uppercase tracking-[.14em] text-white/28">messages</span></div>
                  <div className="bg-night px-4 py-4"><span className="block font-display text-3xl text-white">7.2 years</span><span className="mt-1 block font-mono text-[8px] uppercase tracking-[.14em] text-white/28">observed</span></div>
                  <div className="hidden bg-night py-4 pl-4 sm:block"><span className="block font-display text-3xl text-white">2 people</span><span className="mt-1 block font-mono text-[8px] uppercase tracking-[.14em] text-white/28">one conversation</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-5 border-t border-white/12 px-5 py-5 sm:px-8">
            <div className="flex items-center gap-2" aria-label={`Page ${active + 1} of ${pageCount}`}>
              {Array.from({ length: pageCount }, (_, index) => <button key={index} type="button" onClick={() => goTo(index)} aria-label={`Open sample report page ${index + 1}`} aria-current={index === active ? "page" : undefined} className={`h-1.5 rounded-full transition-all ${index === active ? "w-8 bg-accent-lit" : "w-3 bg-white/18 hover:bg-white/42"}`} />)}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => goTo(active - 1)} disabled={active === 0} className="grid h-10 w-10 place-items-center rounded-full border border-white/18 text-white/55 transition hover:border-white/45 hover:text-white disabled:cursor-not-allowed disabled:opacity-20" aria-label="Previous sample report page">←</button>
              <button type="button" onClick={() => active === pageCount - 1 ? goTo(0) : goTo(active + 1)} className="inline-flex h-10 items-center gap-3 rounded-full bg-accent-lit px-5 text-sm font-semibold text-night transition hover:bg-white">{active === 0 ? "Open report" : active === pageCount - 1 ? "Replay report" : "Next page"}<span aria-hidden="true">{active === pageCount - 1 ? "↻" : "→"}</span></button>
            </div>
          </div>
          </div>}
        </div>
      </div>
    </section>
  );
}

const EXPORT_SCENES = [
  { label: "Find export", caption: "In Telegram Desktop, open the conversation and choose Export chat history from the ⋮ menu." },
  { label: "Choose JSON", caption: "Set the format to machine-readable JSON. Include stickers if you want their artwork in the report." },
  { label: "Grab the folder", caption: "When Telegram finishes, choose the complete export folder in Telescope—not only result.json." },
] as const;

function ExportWalkthrough() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const walkthroughRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const walkthrough = walkthroughRef.current;
    if (!walkthrough || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { threshold: 0.18 });
    observer.observe(walkthrough);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % EXPORT_SCENES.length), 4200);
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <section ref={walkthroughRef} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} className={`${visible ? "export-walkthrough-enter" : "opacity-0"} overflow-hidden rounded-[24px] border border-ink/12 bg-surface shadow-[0_18px_60px_rgba(14,22,33,.08)]`} aria-label="Illustrated Telegram export walkthrough">
      <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4 sm:px-6"><span className="font-mono text-[9px] uppercase tracking-[.16em] text-accent-deep">Telegram Desktop → Telescope</span><span className="font-mono text-[8px] uppercase tracking-[.14em] text-ink/35">{String(active + 1).padStart(2, "0")} / 03</span></div>
      <div className="relative flex h-[430px] overflow-hidden bg-night p-5 text-white sm:h-[360px] sm:p-7 lg:h-auto lg:aspect-[16/7]">
        <div key={active} className="result-stat-enter grid min-h-0 w-full flex-1 place-items-center">
          {active === 0 && <div className="grid h-full w-[88%] max-w-[640px] grid-cols-[28%_1fr] overflow-hidden rounded-xl border border-white/12 bg-[#172634] min-[1025px]:w-full"><div className="border-r border-white/10 p-3"><span className="block h-6 rounded-md bg-white/10" /><div className="mt-4 space-y-2">{[0,1,2,3,4].map((item) => <span key={item} className={`block h-8 rounded-md ${item === 1 ? "bg-accent-lit/18" : "bg-white/[.045]"}`} />)}</div></div><div className="relative flex flex-col"><div className="flex h-14 items-center justify-between border-b border-white/10 px-4"><div><p className="text-xs font-semibold">Alice</p><p className="mt-0.5 text-[9px] text-white/32">last seen recently</p></div><span className="grid h-8 w-8 place-items-center rounded-full bg-accent-lit text-lg text-night">⋮</span></div><div className="m-auto space-y-2 opacity-45"><span className="block h-7 w-36 rounded-full bg-side-a/45" /><span className="ml-10 block h-7 w-32 rounded-full bg-side-b/45" /></div><div className="absolute right-4 top-12 w-44 overflow-hidden rounded-lg border border-white/12 bg-[#243545] p-1 shadow-2xl"><p className="rounded-md px-3 py-2 text-[10px] text-white/55">View profile</p><p className="rounded-md bg-accent-lit px-3 py-2 text-[10px] font-semibold text-night">Export chat history</p><p className="rounded-md px-3 py-2 text-[10px] text-white/55">Clear history</p></div></div></div>}
          {active === 1 && <div className="mx-auto grid h-full w-full max-w-[440px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-white/12 bg-[#172634] p-4 min-[641px]:p-6"><div className="border-b border-white/10 pb-3 min-[641px]:pb-4"><p className="font-display text-xl min-[641px]:text-2xl">Export chat history</p><p className="mt-0.5 text-[9px] text-white/38 min-[641px]:mt-1 min-[641px]:text-[10px]">Choose what Telegram should include.</p></div><div className="min-h-0 overflow-y-auto"><div className="grid min-h-full content-center gap-2 py-2 min-[641px]:gap-3 min-[641px]:py-3"><div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 pb-2 min-[641px]:gap-3 min-[641px]:pb-3"><span className="shrink-0 text-xs text-white/62">Format</span><span className="min-w-0 rounded-full bg-accent-lit px-2 py-1 text-right font-mono text-[7px] uppercase tracking-[.08em] text-night min-[641px]:px-3 min-[641px]:text-[8px] min-[641px]:tracking-[.1em]">Machine-readable JSON ✓</span></div>{[["Photos", false], ["Video files", false], ["Stickers", true]].map(([label, checked]) => <div key={String(label)} className="flex items-center justify-between gap-3 text-xs text-white/58"><span>{label}</span><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-accent-lit bg-accent-lit text-night" : "border-white/20"}`}>{checked ? "✓" : ""}</span></div>)}</div></div><div className="flex shrink-0 justify-end border-t border-white/10 pt-2 min-[641px]:pt-3"><span className="rounded-full bg-accent-lit px-4 py-1.5 text-[11px] font-semibold text-night min-[641px]:px-5 min-[641px]:py-2 min-[641px]:text-xs">Export</span></div></div>}
          {active === 2 && <div className="grid w-[88%] max-w-[680px] items-center gap-3 min-[641px]:gap-6 min-[641px]:grid-cols-[1fr_auto_1fr] min-[1025px]:h-full min-[1025px]:w-full"><div className="rounded-xl border border-white/12 bg-[#172634] p-4 min-[641px]:p-5"><div className="flex min-w-0 items-center gap-3"><span className="shrink-0 text-3xl text-warn min-[641px]:text-4xl">▰</span><div className="min-w-0"><p className="truncate text-xs font-semibold min-[641px]:text-sm">ChatExport_2026-08-21</p><p className="mt-0.5 text-[8px] text-white/32 min-[641px]:mt-1 min-[641px]:text-[9px]">Complete Telegram export</p></div></div><div className="mt-3 space-y-1 border-t border-white/10 pt-3 font-mono text-[8px] text-white/48 min-[641px]:mt-5 min-[641px]:space-y-2 min-[641px]:pt-4 min-[641px]:text-[9px]"><p>⌑ result.json</p><p>▸ stickers/</p><p>▸ video_files/</p></div></div><span className="text-center text-xl text-accent-lit max-[640px]:rotate-90 min-[641px]:text-2xl">→</span><div className="grid min-h-[108px] place-items-center rounded-xl border-2 border-dashed border-accent-lit/65 bg-accent-lit/[.07] p-3 text-center min-[641px]:min-h-[160px] min-[641px]:p-5"><div className="flex items-center gap-3 text-left min-[641px]:block min-[641px]:text-center"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-lit text-lg text-night min-[641px]:mx-auto min-[641px]:h-12 min-[641px]:w-12 min-[641px]:text-xl">↗</span><div className="min-w-0"><p className="font-display text-xl min-[641px]:mt-4 min-[641px]:text-2xl">Choose the folder</p><p className="mt-0.5 text-[8px] leading-snug text-white/36 min-[641px]:mt-1 min-[641px]:text-[9px]">Telescope reads result.json inside it</p></div></div></div></div>}
        </div>
      </div>
      <div className="p-5 sm:p-6 lg:p-5"><p className="line-clamp-3 h-[72px] overflow-hidden text-sm leading-relaxed text-ink/62 sm:line-clamp-2 sm:h-[48px]">{EXPORT_SCENES[active].caption}</p><div className="mt-5 grid grid-cols-3 border-t border-ink/10 lg:mt-3">{EXPORT_SCENES.map((scene, index) => <button key={scene.label} type="button" aria-pressed={index === active} onClick={() => setActive(index)} className={`border-t-2 px-2 pt-3 text-left text-[10px] font-semibold transition ${index === active ? "border-accent text-ink" : "border-transparent text-ink/35 hover:text-ink/65"}`}><span className="mr-1 font-mono text-[8px] text-accent-deep">0{index + 1}</span> {scene.label}</button>)}</div></div>
    </section>
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
  const [dropHighlighted, setDropHighlighted] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const privacyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!dropHighlighted) return;
    const timer = window.setTimeout(() => setDropHighlighted(false), 3000);
    return () => window.clearTimeout(timer);
  }, [dropHighlighted]);

  useEffect(() => {
    const section = privacyRef.current;
    if (!section || privacyVisible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPrivacyVisible(true);
        observer.disconnect();
      },
      { threshold: 0.22 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [privacyVisible]);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const highlightDropZone = () => {
    setDropHighlighted(false);
    window.requestAnimationFrame(() => setDropHighlighted(true));
  };

  const returnToHero = () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollToSection("home-hero");
    window.setTimeout(highlightDropZone, reducedMotion ? 0 : 650);
  };

  return (
    <main className="min-h-dvh bg-surface">
      <div className="homepage-midnight">
      <section id="home-hero" className="starfield relative min-h-dvh scroll-mt-0 overflow-hidden bg-transparent text-white">
        <header className="relative z-10 flex h-[72px] items-center justify-between border-b border-white/12 px-5 sm:px-10 xl:px-16 2xl:px-24">
          <div className="flex items-center gap-2.5 rise">
            <Logo size={25} tone="night" />
            <span className="font-display text-[24px]">Telescope</span>
          </div>
          <div className="flex items-center gap-4">
            {viewer ? (
              <>
                <Link href={dashboardUrl()} className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/60 transition hover:text-white">
                  Dashboard
                </Link>
                <form action={signOutCurrentUser}><button className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 hover:text-white">Sign out</button></form>
              </>
            ) : (
              <Link href={applicationUrl("/sign-in")} aria-label="Log in or sign up" className="grid h-10 w-10 place-items-center text-accent-lit transition hover:text-white sm:block sm:h-auto sm:w-auto sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-[0.16em]">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.25" /><path d="M5.75 19c.55-3.25 2.7-5 6.25-5s5.7 1.75 6.25 5" strokeLinecap="round" /></svg>
                <span className="hidden sm:inline">Log in / sign up</span>
              </Link>
            )}
          </div>
        </header>

        <div className="relative z-[1] grid min-h-[calc(100dvh-72px)] items-center justify-items-start gap-6 px-5 py-6 text-left sm:gap-10 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.72fr)] lg:justify-items-stretch xl:gap-14 xl:px-16 2xl:px-24">
          <div className="relative z-10 max-w-[760px]">
            <p className="rise font-mono text-[10px] uppercase tracking-[0.2em] text-accent-lit" style={{ animationDelay: "80ms" }}>
              <span className="sm:hidden">A private lens for one chat</span>
              <span className="hidden sm:inline">A private instrument for one conversation</span>
            </p>
            <p className="rise mt-5 hidden font-display text-[clamp(4rem,8vw,8.5rem)] leading-[0.72] tracking-[-0.045em] sm:block" style={{ animationDelay: "140ms" }}>
              Telescope:
            </p>
            <h1 className="rise mt-5 max-w-[760px] font-display text-[clamp(2.5rem,4.2vw,4.8rem)] leading-[0.96] tracking-[-0.02em] text-white sm:mt-9" style={{ animationDelay: "220ms" }}>
              <span className="lg:hidden">See the conversation <span className="block italic text-accent-lit">you were too close to notice.</span></span>
              <span className="hidden lg:block">See the conversation<ShufflingHeroEnding /></span>
            </h1>
            <p className="rise mt-6 max-w-[560px] text-[16px] leading-relaxed text-white/62 sm:text-[18px]" style={{ animationDelay: "300ms" }}>
              Drop a Telegram 1-to-1 or group chat. Get its rhythms, silences, private language, and the patterns that only appear when years are seen at once.
            </p>
            <div className="rise mt-8 hidden lg:block" style={{ animationDelay: "380ms" }}>
              <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <button type="button" onClick={highlightDropZone} className="rounded-full bg-accent-lit px-6 py-3 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-night">
                  Analyze your chat
                </button>
                <button type="button" onClick={() => scrollToSection("what-comes-back")} className="rounded-full border border-white/22 px-6 py-3 text-sm font-semibold text-white/72 transition hover:-translate-y-0.5 hover:border-white/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-night">
                  See a sample report
                </button>
              </div>
              <button type="button" onClick={() => scrollToSection("privacy")} className="mt-4 inline-flex items-center gap-2 text-left text-xs text-white/42 transition hover:text-white/72 focus-visible:outline-none focus-visible:text-white">
                Wait—isn&rsquo;t this a total violation of privacy? <span aria-hidden="true" className="text-accent-lit">↓</span>
              </button>
            </div>
          </div>

          <CompactHeroSampleReading />

          <div className="rise grid w-full max-w-[560px] justify-self-start gap-5 lg:justify-self-end" style={{ animationDelay: "300ms" }}>
          <div className="hidden lg:block"><HeroSampleReading /></div>
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
            className={`drop-zone group relative grid min-h-[164px] w-full cursor-pointer gap-5 overflow-hidden rounded-[22px] border-2 px-6 py-6 text-left transition-all sm:grid-cols-[auto_1fr] sm:items-center sm:px-8 ${dropHighlighted ? "drop-zone-attention" : ""} ${
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
            <span className={`relative z-10 grid size-[clamp(2.25rem,6vw,4rem)] shrink-0 place-items-center rounded-full border transition duration-300 ${dragging ? "rotate-[-8deg] border-accent-lit bg-accent-lit text-night" : "border-accent-lit/70 bg-accent-lit/10 text-accent-lit group-hover:-translate-y-1 group-hover:bg-accent-lit group-hover:text-night"}`}>
              <span className="text-2xl">↗</span>
            </span>
            <div className="drop-zone-copy relative z-10 min-w-0">
            {phase.kind === "working" ? (
              <div><p className="font-display text-[30px] leading-tight sm:text-[36px]">{phase.note}…</p><p className="mt-2 text-xs text-white/48">Large exports can pause the tab briefly.</p></div>
            ) : (
              <div><p className="font-mono text-[9px] uppercase tracking-[0.2em] text-accent-lit">Start your analysis</p><p className="mt-2 font-display text-[30px] leading-tight sm:text-[38px]">Choose the export <span className="italic text-accent-lit">folder</span></p></div>
            )}
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-start-2">
              <span className="text-xs text-white/45">Direct or group chat · any length</span>
              <span className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.14em] text-safe-lit"><Shield /> never uploaded</span>
              <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); scrollToSection("export"); }} className="text-xs text-accent-lit underline decoration-accent-lit/35 underline-offset-4 transition hover:text-white">How do I export the folder?</button>
            </div>
          </label>

          {phase.kind === "error" && (
            <p className="mt-4 text-sm leading-relaxed text-side-a">{phase.message}</p>
          )}
          </div>
          </div>
          </div>
      </section>

      <div id="what-comes-back" className="scroll-mt-0"><ReportShowcase /></div>

      {/* privacy */}
      <section id="privacy" ref={privacyRef} className="starfield relative scroll-mt-0 overflow-hidden bg-transparent px-5 py-6 sm:px-10 sm:py-10 min-[1025px]:py-16 xl:px-16 2xl:px-24">
        <div className="relative grid gap-14 lg:grid-cols-2">
          <div className={privacyVisible ? "privacy-section-enter" : "opacity-0"}>
            <Kicker tone="lit" className="mb-5">
              The only promise that matters
            </Kicker>
            <h2 className="font-display text-[40px] leading-[1.02] text-white sm:text-[52px]">
              Local first. AI only when you ask.
            </h2>
            <p className="mt-5 max-w-[440px] text-[17px] leading-relaxed text-white/66 min-[769px]:hidden">
              Your numerical report stays on this device. AI insights are optional: the encrypted
              upload is deleted after processing, with a one-day expiry as backup.
            </p>
            <p className="mt-5 hidden max-w-[440px] text-[17px] leading-relaxed text-white/66 min-[769px]:block">
              The numerical report is built by the page you&rsquo;re looking at, on the machine
              you&rsquo;re using. Additional AI insights are a separate choice: they use a temporary,
              encrypted upload that is deleted after processing, with automatic one-day expiry as a backstop.
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
                h: "Additional AI insights are opt-in",
                b: "Unlocking AI insights temporarily uploads the raw export to an encrypted private storage, then sends a sampled corpus to OpenAI. The raw export is deleted after processing; the saved report may retain the insights and exact quotes used as evidence.",
              },
            ].map((step) => (
              <li key={step.n} className={`${privacyVisible ? "privacy-section-enter" : "opacity-0"} flex gap-4 bg-white/5 p-6`} style={{ animationDelay: `${160 + Number(step.n) * 110}ms` }}>
                <span className="font-display text-[26px] leading-none text-accent-lit">{step.n}</span>
                <div>
                  <p className="mb-1.5 font-semibold text-white">{step.h}</p>
                  <p className="text-sm leading-relaxed text-white/58">{step.b}</p>
                </div>
              </li>
            ))}
            <li className={`${privacyVisible ? "privacy-section-enter" : "opacity-0"} flex items-center gap-2.5 bg-safe/18 px-6 py-4`} style={{ animationDelay: "620ms" }}>
              <span className="block h-[7px] w-[7px] rounded-full bg-safe-lit" />
              <span className="font-mono text-[11.5px] tracking-wide text-safe-lit">
                numerical report stays local · uploaded chat is deleted after AI processing
              </span>
            </li>
          </ol>
        </div>
      </section>
      </div>

      {/* how to export */}
      <div id="export" className="scroll-mt-0 bg-shade px-5 py-6 sm:px-10 sm:py-10 min-[1025px]:flex min-[1025px]:min-h-dvh min-[1025px]:flex-col min-[1025px]:justify-center min-[1025px]:py-7 xl:px-16 2xl:px-24">
        <div className="mx-auto w-full max-w-[840px] sm:border-b sm:border-ink/12 sm:pb-8 lg:pb-6">
          <Kicker tone="deep" className="mb-3">Get the folder</Kicker>
          <h2 className="max-w-[840px] font-display text-[31px] leading-tight text-ink sm:text-[38px]">
            Telegram hands out your history if you ask nicely.
          </h2>
          <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink/65">
            Export one chat as JSON, then bring the whole folder to Telescope.
          </p>
        </div>
        <div className="mx-auto mt-7 w-full max-w-[860px] sm:mt-10 lg:mt-7">
          <ExportWalkthrough />
          <p className="mt-5 text-center font-display text-xl italic text-ink/58 lg:mt-3">First export? Telegram may make you wait 24 hours. That one&rsquo;s on them.</p>
        </div>
      </div>

      {/* final CTA */}
      <div
        className="flex flex-col items-center gap-5 px-5 py-6 text-center sm:px-10 sm:py-10 min-[1025px]:py-20 xl:px-16 2xl:px-24"
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
        <button type="button" onClick={returnToHero} className="mt-1.5">
          <Pill>Point it at a chat</Pill>
        </button>
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
                Field notes
              </Kicker>
              <Link href="/guides/export-telegram-chat" className="transition hover:text-white">Export a Telegram chat</Link>
              <Link href="/guides/chat-analysis-methodology" className="transition hover:text-white">How analysis works</Link>
              <Link href="/guides/private-chat-analysis" className="transition hover:text-white">Private chat analysis</Link>
            </div>
            <div className="flex flex-col gap-2.5 text-sm">
              <Kicker tone="faint-lit" className="mb-1">
                Terms &amp; policies
              </Kicker>
              <Link href="/terms" className="transition hover:text-white">Terms of Use</Link>
              <Link href="/privacy" className="transition hover:text-white">Privacy Policy</Link>
              <Link href="/acceptable-use" className="transition hover:text-white">Acceptable Use</Link>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-3 pt-5 font-mono text-[11px] tracking-wider text-white/40">
            <span suppressHydrationWarning>© {new Date().getFullYear()} Telescope</span>
            <span>Made for looking back</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
