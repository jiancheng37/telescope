"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TELESCOPE_OPEN_REPORT_EVENT } from "./AppShell";
import { dashboardUrl } from "@/lib/app-url";

export interface DashboardConversation {
  id: string;
  participantA: string;
  participantB: string;
  createdAt: string;
  completedAt: string | null;
  firstTs: number;
  lastTs: number;
  messageCount: number;
  status: "PROCESSING" | "COMPLETE";
  aiReady: boolean;
  shared: boolean;
  sharedInsights: boolean;
  sharedMessages: boolean;
  collectionIds: string[];
}

export interface DashboardCollection { id: string; name: string; count: number }

type ShareVariant = "insights" | "messages";
const REPORTS_PER_PAGE = 5;
const COLLECTIONS_PER_PAGE = 5;

const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("en", { month: "short", year: "numeric" });

function Status({ report }: { report: DashboardConversation }) {
  if (report.status === "PROCESSING") return <span className="conversation-status text-accent" title="AI running"><i className="animate-pulse bg-accent" /><span className="max-[640px]:sr-only">AI running</span></span>;
  if (report.aiReady) return <span className="conversation-status text-safe-deep" title="AI insights ready"><i className="bg-safe-deep" /><span className="max-[640px]:sr-only">AI insights ready</span></span>;
  return <span className="conversation-status text-ink/42" title="Local report ready"><i className="bg-ink/30" /><span className="max-[640px]:sr-only">Local report ready</span></span>;
}

export function DashboardWorkspace({ initialReports, initialCollections, onSnapshot }: { initialReports: DashboardConversation[]; initialCollections: DashboardCollection[]; onSnapshot?: (reports: DashboardConversation[], collections: DashboardCollection[]) => void }) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [collections, setCollections] = useState(initialCollections);
  const [collection, setCollection] = useState<string>("all");
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collectionPickerQuery, setCollectionPickerQuery] = useState("");
  const [collectionPickerPage, setCollectionPickerPage] = useState(1);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DashboardConversation | null>(null);
  const [names, setNames] = useState<[string, string]>(["", ""]);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [sharing, setSharing] = useState<DashboardConversation | null>(null);
  const [collectionEditor, setCollectionEditor] = useState<{ kind: "create" | "rename"; collection?: DashboardCollection } | null>(null);
  const [collectionName, setCollectionNameState] = useState("");
  const setCollectionName = (value: string) => setCollectionNameState(value.slice(0, 20));
  const [collectionPeopleDraft, setCollectionPeopleDraft] = useState<string[]>([]);
  const [collectionPeopleQuery, setCollectionPeopleQuery] = useState("");
  const [organising, setOrganising] = useState<DashboardConversation | null>(null);
  const [membershipDraft, setMembershipDraft] = useState<string[]>([]);
  const [addingToCollection, setAddingToCollection] = useState<DashboardCollection | null>(null);
  const [addingDraft, setAddingDraft] = useState<string[]>([]);
  const [addingQuery, setAddingQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return reports
      .filter((report) => !needle || report.participantA.toLocaleLowerCase().includes(needle))
      .filter((report) => collection === "all" || (collection === "unsorted" ? report.collectionIds.length === 0 : report.collectionIds.includes(collection)));
  }, [collection, query, reports]);
  const pageCount = Math.max(1, Math.ceil(visible.length / REPORTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const paginatedVisible = visible.slice((currentPage - 1) * REPORTS_PER_PAGE, currentPage * REPORTS_PER_PAGE);
  const selectedCustomCollection = collections.find((item) => item.id === collection);
  const normalisedCollectionPickerQuery = collectionPickerQuery.trim().toLocaleLowerCase();
  const visibleCollections = collections.filter((item) => !normalisedCollectionPickerQuery || item.name.toLocaleLowerCase().includes(normalisedCollectionPickerQuery));
  const collectionPickerPageCount = Math.max(1, Math.ceil(visibleCollections.length / COLLECTIONS_PER_PAGE));
  const currentCollectionPickerPage = Math.min(collectionPickerPage, collectionPickerPageCount);
  const paginatedCollections = visibleCollections.slice((currentCollectionPickerPage - 1) * COLLECTIONS_PER_PAGE, currentCollectionPickerPage * COLLECTIONS_PER_PAGE);
  const addableReports = addingToCollection ? reports.filter((report) => !report.collectionIds.includes(addingToCollection.id)) : [];
  const normalisedAddingQuery = addingQuery.trim().toLocaleLowerCase();
  const visibleAddableReports = addableReports.filter((report) => !normalisedAddingQuery || report.participantA.toLocaleLowerCase().includes(normalisedAddingQuery));
  useEffect(() => { onSnapshot?.(reports, collections); }, [collections, onSnapshot, reports]);
  useEffect(() => { setPage(1); }, [collection, query]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  useEffect(() => {
    if (!collectionPickerOpen) return;
    setCollectionPickerQuery("");
    setCollectionPickerPage(1);
  }, [collectionPickerOpen]);
  useEffect(() => { setCollectionPickerPage(1); }, [collectionPickerQuery]);
  useEffect(() => { if (collectionPickerPage > collectionPickerPageCount) setCollectionPickerPage(collectionPickerPageCount); }, [collectionPickerPage, collectionPickerPageCount]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-conversation-menu]")) return;
      setMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menu]);

  useEffect(() => {
    if (!sharing) return;
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && working !== sharing.id) setSharing(null); };
    document.addEventListener("keydown", dismissOnEscape);
    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [sharing, working]);
  useEffect(() => {
    if (!collectionPickerOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setCollectionPickerOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [collectionPickerOpen]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 2400); };
  const share = async (report: DashboardConversation, variant: ShareVariant = "insights") => {
    if (!report.shared) {
      try {
        const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as { confirmSharing?: boolean };
        if (preferences.confirmSharing !== false && !window.confirm("Create a public link to this report? Anyone with the link can view it.")) return;
      } catch {
        if (!window.confirm("Create a public link to this report? Anyone with the link can view it.")) return;
      }
    }
    setWorking(report.id);
    try {
      let evidence: { doubleTextMessages?: unknown; extremeEvidence?: unknown } | undefined;
      if (variant === "messages") {
        try {
          const doubleTextMessages = localStorage.getItem(`telescope:double-text:${report.id}`);
          const extremeEvidence = localStorage.getItem(`telescope:extremes:${report.id}`);
          evidence = {
            ...(doubleTextMessages ? { doubleTextMessages: JSON.parse(doubleTextMessages) as unknown } : {}),
            ...(extremeEvidence ? { extremeEvidence: JSON.parse(extremeEvidence) as unknown } : {}),
          };
        } catch {
          // The AI excerpts can still be shared if optional local receipts are unavailable.
        }
      }
      const response = await fetch(`/api/reports/${report.id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeMessages: variant === "messages", evidence }),
      });
      if (!response.ok) throw new Error();
      const { path } = await response.json() as { path: string };
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setReports((current) => current.map((item) => item.id === report.id ? {
        ...item,
        shared: true,
        sharedInsights: variant === "insights" ? true : item.sharedInsights,
        sharedMessages: variant === "messages" ? true : item.sharedMessages,
      } : item));
      setSharing(null);
      flash(variant === "messages" ? "Link with messages copied." : "Insights-only link copied.");
    } catch { flash("The share link could not be created."); }
    finally { setWorking(null); setMenu(null); }
  };
  const saveRename = async () => {
    if (!renaming || !names[0].trim() || !names[1].trim()) return;
    const participantA = names[0].trim().slice(0, 20);
    const participantB = names[1].trim().slice(0, 20);
    setWorking(renaming.id);
    try {
      const response = await fetch(`/api/reports/${renaming.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantA, participantB }) });
      if (!response.ok) throw new Error();
      setReports((current) => current.map((item) => item.id === renaming.id ? { ...item, participantA, participantB } : item));
      setRenaming(null); flash("Conversation renamed."); router.refresh();
    } catch { flash("The conversation could not be renamed."); }
    finally { setWorking(null); }
  };
  const remove = async (report: DashboardConversation) => {
    if (!window.confirm(`Delete the report for ${report.participantA}? This cannot be undone.`)) return;
    setWorking(report.id);
    try {
      const response = await fetch(`/api/reports/${report.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setReports((current) => current.filter((item) => item.id !== report.id));
      flash("Conversation deleted.");
    } catch { flash("The conversation could not be deleted."); }
    finally { setWorking(null); setMenu(null); }
  };

  const saveCollection = async () => {
    if (!collectionEditor || !collectionName.trim()) return;
    const name = collectionName.trim().slice(0, 20);
    const target = collectionEditor.collection;
    setWorking(target?.id ?? "new-collection");
    try {
      const response = await fetch(target ? `/api/collections/${target.id}` : "/api/collections", { method: target ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await response.json().catch(() => null) as { id?: string; name?: string; count?: number; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Collection could not be saved.");
      if (target) {
        setCollections((current) => current.map((item) => item.id === target.id ? { ...item, name } : item));
        setCollectionEditor(null);
        flash("Collection renamed.");
      } else {
        if (!body?.id) throw new Error("Collection could not be saved.");
        const collectionId = body.id;
        const selected = reports.filter((report) => collectionPeopleDraft.includes(report.id));
        const membershipResults = await Promise.all(selected.map(async (report) => {
          try {
            const membershipResponse = await fetch(`/api/reports/${report.id}/collections`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionIds: [...report.collectionIds, collectionId] }) });
            return membershipResponse.ok ? report.id : null;
          } catch { return null; }
        }));
        const addedIds = new Set(membershipResults.filter((id): id is string => Boolean(id)));
        setReports((current) => current.map((report) => addedIds.has(report.id) ? { ...report, collectionIds: [...report.collectionIds, collectionId] } : report));
        setCollections((current) => [...current, { id: collectionId, name: body.name ?? collectionName.trim(), count: addedIds.size }]);
        setCollection(collectionId);
        setCollectionEditor(null);
        setCollectionPeopleDraft([]);
        flash(addedIds.size === selected.length ? "Collection created." : `Collection created. ${selected.length - addedIds.size} ${selected.length - addedIds.size === 1 ? "person" : "people"} could not be added.`);
      }
    } catch (error) { flash(error instanceof Error ? error.message : "Collection could not be saved."); }
    finally { setWorking(null); }
  };
  const saveMemberships = async () => {
    if (!organising) return;
    setWorking(organising.id);
    try {
      const response = await fetch(`/api/reports/${organising.id}/collections`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionIds: membershipDraft }) });
      if (!response.ok) throw new Error();
      const previous = organising.collectionIds;
      setReports((current) => current.map((report) => report.id === organising.id ? { ...report, collectionIds: membershipDraft } : report));
      setCollections((current) => current.map((item) => ({ ...item, count: item.count - Number(previous.includes(item.id)) + Number(membershipDraft.includes(item.id)) })));
      setOrganising(null); flash("Collections updated.");
    } catch { flash("Collections could not be updated."); }
    finally { setWorking(null); }
  };


  const addSelectedToCollection = async () => {
    if (!addingToCollection || !addingDraft.length) return;
    const selected = reports.filter((report) => addingDraft.includes(report.id) && !report.collectionIds.includes(addingToCollection.id));
    if (!selected.length) return;
    const collectionId = addingToCollection.id;
    setWorking(`add:${collectionId}`);
    try {
      const responses = await Promise.all(selected.map((report) => fetch(`/api/reports/${report.id}/collections`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collectionIds: [...report.collectionIds, collectionId] }),
      })));
      if (responses.some((response) => !response.ok)) throw new Error();
      const selectedIds = new Set(selected.map((report) => report.id));
      setReports((current) => current.map((report) => selectedIds.has(report.id) ? { ...report, collectionIds: [...report.collectionIds, collectionId] } : report));
      setCollections((current) => current.map((item) => item.id === collectionId ? { ...item, count: item.count + selected.length } : item));
      setAddingToCollection(null);
      setAddingDraft([]);
      setAddingQuery("");
      flash(`${selected.length} conversation${selected.length === 1 ? "" : "s"} added.`);
    } catch { flash("The conversations could not be added."); }
    finally { setWorking(null); }
  };

  const removeReportFromCollection = async (report: DashboardConversation) => {
    if (collection === "all" || collection === "unsorted" || !report.collectionIds.includes(collection)) return;
    const collectionId = collection;
    setWorking(`remove:${report.id}`);
    try {
      const collectionIds = report.collectionIds.filter((id) => id !== collectionId);
      const response = await fetch(`/api/reports/${report.id}/collections`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionIds }) });
      if (!response.ok) throw new Error();
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, collectionIds } : item));
      setCollections((current) => current.map((item) => item.id === collectionId ? { ...item, count: Math.max(0, item.count - 1) } : item));
      flash(`${report.participantA} removed from the collection.`);
    } catch { flash("The conversation could not be removed from this collection."); }
    finally { setWorking(null); }
  };

  return <>
    <div className="mt-8 border-b border-ink/14 pb-4 max-[640px]:mt-0">
      <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden"><button type="button" aria-pressed={collection === "all"} onClick={() => setCollection("all")} className={`collection-tab ${collection === "all" ? "collection-tab-active" : ""}`}>All <span>{reports.length}</span></button><button type="button" aria-pressed={collection === "unsorted"} onClick={() => setCollection("unsorted")} className={`collection-tab ${collection === "unsorted" ? "collection-tab-active" : ""}`}>Unsorted <span>{reports.filter((report) => !report.collectionIds.length).length}</span></button><button type="button" title={selectedCustomCollection?.name} aria-haspopup="dialog" aria-expanded={collectionPickerOpen} onClick={() => setCollectionPickerOpen(true)} className={`collection-tab collection-picker-tab justify-between min-[768px]:max-w-[280px] ${selectedCustomCollection ? "collection-tab-active" : ""}`}><span className="text-left leading-tight !text-current">{selectedCustomCollection ? `${selectedCustomCollection.name.slice(0, 12)}${selectedCustomCollection.name.length > 12 ? "…" : ""}` : "Collection"}</span><svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current" strokeWidth="1.5"><path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg></button><button type="button" aria-label="Create a new collection" title="New collection" onClick={() => { setCollectionName(""); setCollectionPeopleDraft([]); setCollectionPeopleQuery(""); setCollectionEditor({ kind: "create" }); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-ink/24 text-lg text-ink/48 transition hover:border-accent hover:text-accent">+</button></div>
    </div>
    <div className="border-b border-ink/14 py-4">
      <label className="flex items-center gap-3"><span className="text-ink/28">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-ink/32" /></label>
    </div>

    <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3 max-[640px]:mt-4"><h2 className="font-display text-[30px]">Conversations</h2><div className="flex items-center gap-4">{collection !== "all" && collection !== "unsorted" && <button type="button" onClick={() => { setAddingDraft([]); setAddingQuery(""); setAddingToCollection(collections.find((item) => item.id === collection) ?? null); }} className="text-xs font-semibold text-accent transition hover:text-ink">+ Add</button>}<span className="font-mono text-[10px] text-ink/35">{visible.length} of {reports.length}</span></div></div>
    {visible.length ? <><ol className="mt-4 border-t border-ink/14">{paginatedVisible.map((report, index) => <li key={report.id} onDoubleClick={(event) => { if (event.target instanceof Element && event.target.closest("a, button, input, label")) return; window.dispatchEvent(new Event(TELESCOPE_OPEN_REPORT_EVENT)); router.push(`/reports/${report.id}`); }} className="conversation-row relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-ink/14 py-4 min-[640px]:grid-cols-[42px_minmax(0,1fr)_auto] min-[640px]:gap-4 min-[640px]:py-6">
      <span className="hidden font-mono text-[9px] text-ink/25 min-[640px]:block">{String((currentPage - 1) * REPORTS_PER_PAGE + index + 1).padStart(2, "0")}</span>
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-[640px]:gap-x-4"><Link href={`/reports/${report.id}`} className="truncate font-display text-[1.5rem] leading-none transition hover:text-accent min-[640px]:text-[clamp(1.65rem,3vw,2.5rem)]">{report.participantA}</Link><Status report={report} /></div><p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[8px] uppercase tracking-[.1em] text-ink/36 min-[640px]:mt-3 min-[640px]:gap-x-5"><span>{date(report.firstTs)} — {date(report.lastTs)}</span><span>{report.messageCount.toLocaleString()} messages</span><span className="max-[640px]:hidden">Updated {new Date(report.completedAt ?? report.createdAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}</span>{report.shared && <span className="text-accent">Shared</span>}</p></div>
      <div data-conversation-menu className="flex items-center gap-1.5 min-[640px]:gap-2"><Link href={`/reports/${report.id}`} className="hidden rounded-full border border-ink/14 px-4 py-2 text-xs font-semibold transition hover:border-accent hover:text-accent min-[640px]:block">Open</Link><button type="button" aria-label="Conversation actions" aria-expanded={menu === report.id} onClick={() => setMenu(menu === report.id ? null : report.id)} className="grid h-9 w-9 place-items-center rounded-full border border-ink/14 text-ink/45 transition hover:border-ink/40 hover:text-ink">•••</button></div>
      {menu === report.id && <div data-conversation-menu className="absolute bottom-16 right-0 z-30 w-52 overflow-hidden rounded-2xl border border-ink/12 bg-surface p-2 text-sm shadow-2xl"><Link href={dashboardUrl("/new")} className="block rounded-xl px-3 py-2.5 hover:bg-shade">Refresh with newer export</Link>{!report.aiReady && report.status !== "PROCESSING" && <Link href={`/reports/${report.id}?insights=1`} className="block rounded-xl px-3 py-2.5 hover:bg-shade">Unlock AI insights</Link>}<button type="button" onClick={() => { setMembershipDraft(report.collectionIds); setOrganising(report); setMenu(null); }} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-shade">Add to collections</button><button type="button" disabled={working === report.id} onClick={() => { if (report.aiReady) { setSharing(report); setMenu(null); } else { void share(report); } }} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-shade">{report.shared ? "Copy share link" : "Share report"}</button><button type="button" onClick={() => { setNames([report.participantA, report.participantB]); setRenaming(report); setMenu(null); }} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-shade">Rename people</button>{collection !== "all" && collection !== "unsorted" && <button type="button" disabled={working === `remove:${report.id}`} onClick={() => { setMenu(null); void removeReportFromCollection(report); }} className="block w-full rounded-xl px-3 py-2.5 text-left text-side-a hover:bg-shade disabled:opacity-35">Remove from collection</button>}<button type="button" disabled={working === report.id} onClick={() => void remove(report)} className="block w-full rounded-xl px-3 py-2.5 text-left text-side-a hover:bg-shade">Delete report</button></div>}
    </li>)}</ol>{pageCount > 1 && <nav aria-label="Conversation pages" className="flex items-center justify-between gap-4 border-b border-ink/14 py-5"><button type="button" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="text-xs font-semibold text-accent transition hover:text-ink disabled:text-ink/25">← Previous</button><span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink/38">Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="text-xs font-semibold text-accent transition hover:text-ink disabled:text-ink/25">Next →</button></nav>}</> : <div className="mt-4 border-y border-ink/14 py-14"><p className="font-display text-3xl">No conversations match.</p><p className="mt-2 text-sm text-ink/48">Try another search or clear the current filter.</p></div>}

    {collectionPickerOpen && <div className="fixed inset-0 z-[75] flex items-end bg-night/68 backdrop-blur-sm min-[768px]:items-center min-[768px]:justify-center min-[768px]:p-5" role="dialog" aria-modal="true" aria-labelledby="collection-picker-title" onClick={(event) => { if (event.target === event.currentTarget) setCollectionPickerOpen(false); }}>
      <section className="rise max-h-[82dvh] w-full overflow-y-auto rounded-t-[26px] bg-surface px-5 pb-7 pt-5 shadow-2xl min-[768px]:max-w-lg min-[768px]:rounded-[26px] min-[768px]:p-7">
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-ink/14 min-[768px]:hidden" />
        <div className="flex items-end justify-between gap-5"><div><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">Collections</p><h3 id="collection-picker-title" className="mt-2 font-display text-4xl">Choose a collection.</h3></div><button type="button" onClick={() => setCollectionPickerOpen(false)} aria-label="Close collection chooser" className="grid h-9 w-9 place-items-center rounded-full border border-ink/14 text-lg text-ink/45">×</button></div>
        {collections.length ? <>
          <label className="mt-6 flex items-center gap-3 border-y border-ink/14"><span className="text-ink/28">⌕</span><input autoFocus value={collectionPickerQuery} onChange={(event) => setCollectionPickerQuery(event.target.value)} placeholder="Search collections" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink/32" /><span className="shrink-0 font-mono text-[8px] uppercase tracking-[.1em] text-ink/35">{visibleCollections.length} of {collections.length}</span></label>
          {visibleCollections.length ? <><div className="border-b border-ink/14">{paginatedCollections.map((item) => <button key={item.id} type="button" title={item.name} onClick={() => { setCollection(item.id); setCollectionPickerOpen(false); }} className={`flex w-full min-w-0 items-center justify-between gap-5 border-b border-ink/10 py-4 text-left last:border-b-0 ${collection === item.id ? "text-accent" : "text-ink"}`}><span className="min-w-0 flex-1 whitespace-normal break-words font-display text-2xl leading-tight">{item.name}</span><span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{item.count} · {collection === item.id ? "Selected" : "Choose"}</span></button>)}</div>{collectionPickerPageCount > 1 && <nav aria-label="Collection pages" className="flex items-center justify-between gap-4 border-b border-ink/14 py-4"><button type="button" disabled={currentCollectionPickerPage === 1} onClick={() => setCollectionPickerPage((current) => Math.max(1, current - 1))} className="text-xs font-semibold text-accent transition hover:text-ink disabled:text-ink/25">← Previous</button><span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink/38">Page {currentCollectionPickerPage} of {collectionPickerPageCount}</span><button type="button" disabled={currentCollectionPickerPage === collectionPickerPageCount} onClick={() => setCollectionPickerPage((current) => Math.min(collectionPickerPageCount, current + 1))} className="text-xs font-semibold text-accent transition hover:text-ink disabled:text-ink/25">Next →</button></nav>}</> : <p className="border-b border-ink/14 py-6 text-sm text-ink/45">No collections match “{collectionPickerQuery.trim()}”.</p>}
        </> : <p className="mt-6 border-y border-ink/14 py-6 text-sm text-ink/45">No collections yet. Use the + button to create one.</p>}
      </section>
    </div>}
    {renaming && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) setRenaming(null); }}><section className="w-full max-w-lg rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">Rename conversation</p><h3 className="mt-3 font-display text-4xl">Who is in this chat?</h3><div className="mt-6 grid gap-3 sm:grid-cols-2"><label><input value={names[0]} maxLength={20} onChange={(event) => setNames([event.target.value, names[1]])} aria-label="Conversation partner name" className="w-full rounded-xl border border-ink/14 bg-transparent px-4 py-3 outline-none focus:border-accent" /><span className="mt-2 block text-right font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - names[0].length)} characters left</span></label><label><input value={names[1]} maxLength={20} onChange={(event) => setNames([names[0], event.target.value])} aria-label="Your name" className="w-full rounded-xl border border-ink/14 bg-transparent px-4 py-3 outline-none focus:border-accent" /><span className="mt-2 block text-right font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - names[1].length)} characters left</span></label></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setRenaming(null)} className="px-4 py-2 text-sm text-ink/48">Cancel</button><button type="button" disabled={working === renaming.id || !names[0].trim() || !names[1].trim()} onClick={() => void saveRename()} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save names</button></div></section></div>}
    {collectionEditor && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-night/72 px-5 py-8 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) { setCollectionEditor(null); setCollectionPeopleDraft([]); setCollectionPeopleQuery(""); } }}><form onSubmit={(event) => { event.preventDefault(); void saveCollection(); }} className="my-auto w-full max-w-md rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">{collectionEditor.kind === "create" ? "New collection" : "Rename collection"}</p><h3 className="mt-3 font-display text-4xl">Give it a name.</h3><input autoFocus value={collectionName} maxLength={20} onChange={(event) => setCollectionName(event.target.value)} placeholder="Close friends" className="mt-6 w-full rounded-xl border border-ink/14 bg-transparent px-4 py-3 outline-none focus:border-accent" /><p aria-live="polite" className="mt-2 text-right font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - collectionName.length)} characters left</p>{collectionEditor.kind === "create" && <div className="mt-7"><div className="flex items-baseline justify-between gap-4"><div><p className="text-sm font-semibold">Add people</p><p className="mt-1 text-xs text-ink/45">Optional—you can change this later.</p></div><span className="font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{collectionPeopleDraft.length} selected</span></div>{reports.length ? <><label className="mt-4 flex items-center gap-3 border-b border-ink/14"><span className="text-ink/28">⌕</span><input value={collectionPeopleQuery} onChange={(event) => setCollectionPeopleQuery(event.target.value)} placeholder="Search people" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-ink/32" /></label><div className="max-h-[32vh] overflow-y-auto border-b border-ink/14">{reports.filter((report) => report.participantA.toLocaleLowerCase().includes(collectionPeopleQuery.trim().toLocaleLowerCase())).map((report) => <label key={report.id} className="flex cursor-pointer items-center justify-between border-b border-ink/10 py-3 last:border-b-0"><span className="font-display text-xl">{report.participantA}</span><input type="checkbox" checked={collectionPeopleDraft.includes(report.id)} onChange={(event) => setCollectionPeopleDraft((current) => event.target.checked ? [...current, report.id] : current.filter((id) => id !== report.id))} className="h-4 w-4 accent-[var(--color-accent)]" /></label>)}{!reports.some((report) => report.participantA.toLocaleLowerCase().includes(collectionPeopleQuery.trim().toLocaleLowerCase())) && <p className="py-5 text-sm text-ink/45">No people match that search.</p>}</div></> : <p className="mt-3 border-y border-ink/14 py-4 text-sm text-ink/45">Your saved conversations will appear here.</p>}</div>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => { setCollectionEditor(null); setCollectionPeopleDraft([]); setCollectionPeopleQuery(""); }} className="px-4 py-2 text-sm text-ink/48">Cancel</button><button type="submit" disabled={!collectionName.trim() || working !== null} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save collection</button></div></form></div>}
    {organising && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) setOrganising(null); }}><section className="w-full max-w-lg rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">Organise conversation</p><h3 className="mt-3 font-display text-4xl">Choose collections.</h3><p className="mt-2 text-sm text-ink/48">Your conversation with {organising.participantA} can appear in more than one.</p>{collections.length ? <div className="mt-6 border-y border-ink/14">{collections.map((item) => <label key={item.id} className="flex cursor-pointer items-center justify-between border-b border-ink/10 py-3 last:border-b-0"><span className="text-sm">{item.name}</span><input type="checkbox" checked={membershipDraft.includes(item.id)} onChange={(event) => setMembershipDraft((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="h-4 w-4 accent-[var(--color-accent)]" /></label>)}</div> : <p className="mt-6 border-y border-ink/14 py-5 text-sm text-ink/45">Create a collection first, then return here.</p>}<div className="mt-6 flex justify-between gap-3"><button type="button" onClick={() => { setOrganising(null); setCollectionName(""); setCollectionPeopleDraft([organising.id]); setCollectionPeopleQuery(""); setCollectionEditor({ kind: "create" }); }} className="text-sm text-accent">+ New collection</button><div className="flex gap-3"><button type="button" onClick={() => setOrganising(null)} className="px-3 py-2 text-sm text-ink/48">Cancel</button><button type="button" disabled={working === organising.id} onClick={() => void saveMemberships()} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save</button></div></div></section></div>}
    {addingToCollection && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) { setAddingToCollection(null); setAddingDraft([]); setAddingQuery(""); } }}><section className="w-full max-w-lg rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">{addingToCollection.name}</p><h3 className="mt-3 font-display text-4xl">Add conversations.</h3><p className="mt-2 text-sm text-ink/48">Select as many saved conversations as you want, then add them together.</p><span className="mt-2 hidden font-mono text-[9px] uppercase tracking-[.12em] text-ink/40 max-[640px]:block">{addingDraft.length} selected</span>{addableReports.length ? <><label className="mt-2 flex items-center gap-3 border-y border-ink/14 min-[640px]:mt-5"><span className="text-ink/28">⌕</span><input autoFocus value={addingQuery} onChange={(event) => setAddingQuery(event.target.value)} placeholder="Search conversations" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink/32" /><span className="shrink-0 font-mono text-[8px] uppercase tracking-[.1em] text-ink/35">{visibleAddableReports.length} of {addableReports.length}</span></label><div className="max-h-[36vh] overflow-y-auto border-b border-ink/14">{visibleAddableReports.map((report) => { const selected = addingDraft.includes(report.id); return <button key={report.id} type="button" aria-pressed={selected} disabled={working === `add:${addingToCollection.id}`} onClick={() => setAddingDraft((current) => selected ? current.filter((id) => id !== report.id) : [...current, report.id])} className={`flex w-full items-center justify-between border-b border-ink/10 py-4 text-left transition last:border-b-0 hover:text-accent disabled:opacity-40 ${selected ? "text-accent" : ""}`}><span className="font-display text-2xl">{report.participantA}</span><span className={`grid h-6 w-6 place-items-center rounded-full border text-xs transition ${selected ? "border-accent bg-accent text-night" : "border-ink/20 text-transparent"}`}>✓</span></button>; })}{!visibleAddableReports.length && <p className="py-7 text-sm text-ink/45">No conversations match “{addingQuery.trim()}”.</p>}</div></> : <p className="mt-6 border-y border-ink/14 py-7 text-sm text-ink/45">Every saved conversation is already here.</p>}<div className="mt-6 flex items-center justify-between gap-4"><span className="hidden font-mono text-[9px] uppercase tracking-[.12em] text-ink/40 min-[640px]:block">{addingDraft.length} selected</span><div className="ml-auto flex gap-3"><button type="button" onClick={() => { setAddingToCollection(null); setAddingDraft([]); setAddingQuery(""); }} className="px-4 py-2.5 text-sm text-ink/48">Cancel</button><button type="button" disabled={!addingDraft.length || working === `add:${addingToCollection.id}`} onClick={() => void addSelectedToCollection()} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-night disabled:opacity-35">Add</button></div></div></section></div>}
    {sharing && <div className="fixed inset-0 z-[80] grid place-items-center bg-night/78 px-5 py-8 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="dashboard-share-title" onClick={(event) => { if (event.target === event.currentTarget && working !== sharing.id) setSharing(null); }}><section className="w-full max-w-[560px] rounded-[26px] border border-white/14 bg-night p-6 text-white shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-5"><div><p className="font-mono text-[9px] uppercase tracking-[.16em] text-accent-lit">Share privacy</p><h3 id="dashboard-share-title" className="mt-3 font-display text-[clamp(2.25rem,6vw,3.8rem)] leading-[.92]">Choose how to share.</h3><p className="mt-4 text-sm leading-relaxed text-white/52">Report with {sharing.participantA}. Both links include the analysis; only one reveals the quoted messages behind the AI insights.</p></div><button type="button" disabled={working === sharing.id} onClick={() => setSharing(null)} aria-label="Close sharing options" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/16 text-xl text-white/50 transition hover:border-white/40 hover:text-white disabled:opacity-35">×</button></div><div className="mt-7 border-y border-white/14"><button type="button" disabled={working === sharing.id} onClick={() => void share(sharing, "insights")} className="group flex w-full items-center justify-between gap-6 border-b border-white/12 py-5 text-left transition hover:text-accent-lit disabled:cursor-wait disabled:opacity-45"><span><span className="block text-sm font-semibold">Insights only</span><span className="mt-1 block text-xs leading-relaxed text-white/42">Hide direct quotations and message context.</span></span><span className="shrink-0 font-mono text-[9px] uppercase tracking-[.12em] text-safe-lit group-hover:text-accent-lit">{sharing.sharedInsights ? "Copy link" : "Create link"} →</span></button><button type="button" disabled={working === sharing.id} onClick={() => void share(sharing, "messages")} className="group flex w-full items-center justify-between gap-6 py-5 text-left transition hover:text-accent-lit disabled:cursor-wait disabled:opacity-45"><span><span className="block text-sm font-semibold">Include private messages</span><span className="mt-1 block text-xs leading-relaxed text-white/42">Show quotations and message context used as evidence.</span></span><span className="shrink-0 font-mono text-[9px] uppercase tracking-[.12em] text-accent-lit">{sharing.sharedMessages ? "Copy link" : "Create link"} →</span></button></div><p className="mt-4 font-mono text-[8px] uppercase tracking-[.11em] text-white/30">Anyone with the selected link can open it</p></section></div>}
    {notice && <div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-night px-5 py-3 text-sm text-white shadow-xl">{notice}</div>}
  </>;
}
