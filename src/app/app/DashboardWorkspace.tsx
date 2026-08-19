"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  collectionIds: string[];
}

export interface DashboardCollection { id: string; name: string; count: number }

const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("en", { month: "short", year: "numeric" });

function Status({ report }: { report: DashboardConversation }) {
  if (report.status === "PROCESSING") return <span className="conversation-status text-accent"><i className="animate-pulse bg-accent" />AI running</span>;
  if (report.aiReady) return <span className="conversation-status text-safe-deep"><i className="bg-safe-deep" />AI insights ready</span>;
  return <span className="conversation-status text-ink/42"><i className="bg-ink/30" />Local report ready</span>;
}

export function DashboardWorkspace({ initialReports, initialCollections, onSnapshot }: { initialReports: DashboardConversation[]; initialCollections: DashboardCollection[]; onSnapshot?: (reports: DashboardConversation[], collections: DashboardCollection[]) => void }) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [collections, setCollections] = useState(initialCollections);
  const [collection, setCollection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DashboardConversation | null>(null);
  const [names, setNames] = useState<[string, string]>(["", ""]);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [collectionEditor, setCollectionEditor] = useState<{ kind: "create" | "rename"; collection?: DashboardCollection } | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [organising, setOrganising] = useState<DashboardConversation | null>(null);
  const [membershipDraft, setMembershipDraft] = useState<string[]>([]);
  const [draggedReportId, setDraggedReportId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [addingToCollection, setAddingToCollection] = useState<DashboardCollection | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return reports
      .filter((report) => !needle || report.participantA.toLocaleLowerCase().includes(needle))
      .filter((report) => collection === "all" || (collection === "unsorted" ? report.collectionIds.length === 0 : report.collectionIds.includes(collection)));
  }, [collection, query, reports]);

  useEffect(() => { onSnapshot?.(reports, collections); }, [collections, onSnapshot, reports]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 2400); };
  const share = async (report: DashboardConversation) => {
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
      const response = await fetch(`/api/reports/${report.id}/share`, { method: "POST" });
      if (!response.ok) throw new Error();
      const { path } = await response.json() as { path: string };
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, shared: true } : item));
      flash("Share link copied.");
    } catch { flash("The share link could not be created."); }
    finally { setWorking(null); setMenu(null); }
  };
  const saveRename = async () => {
    if (!renaming || !names[0].trim() || !names[1].trim()) return;
    setWorking(renaming.id);
    try {
      const response = await fetch(`/api/reports/${renaming.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantA: names[0].trim(), participantB: names[1].trim() }) });
      if (!response.ok) throw new Error();
      setReports((current) => current.map((item) => item.id === renaming.id ? { ...item, participantA: names[0].trim(), participantB: names[1].trim() } : item));
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
    const target = collectionEditor.collection;
    setWorking(target?.id ?? "new-collection");
    try {
      const response = await fetch(target ? `/api/collections/${target.id}` : "/api/collections", { method: target ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: collectionName.trim() }) });
      const body = await response.json().catch(() => null) as { id?: string; name?: string; count?: number; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Collection could not be saved.");
      if (target) setCollections((current) => current.map((item) => item.id === target.id ? { ...item, name: collectionName.trim() } : item));
      else if (body?.id) { setCollections((current) => [...current, { id: body.id!, name: body.name ?? collectionName.trim(), count: 0 }]); setCollection(body.id); }
      setCollectionEditor(null); flash(target ? "Collection renamed." : "Collection created.");
    } catch (error) { flash(error instanceof Error ? error.message : "Collection could not be saved."); }
    finally { setWorking(null); }
  };
  const deleteCollection = async (item: DashboardCollection) => {
    if (!window.confirm(`Delete “${item.name}”? Its reports will not be deleted.`)) return;
    setWorking(item.id);
    try {
      const response = await fetch(`/api/collections/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setCollections((current) => current.filter((entry) => entry.id !== item.id));
      setReports((current) => current.map((report) => ({ ...report, collectionIds: report.collectionIds.filter((id) => id !== item.id) })));
      if (collection === item.id) setCollection("all");
      flash("Collection removed. Reports are untouched.");
    } catch { flash("The collection could not be removed."); }
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

  const addReportToCollection = async (reportId: string, collectionId: string) => {
    const report = reports.find((item) => item.id === reportId);
    if (!report || report.collectionIds.includes(collectionId)) return;
    setWorking(reportId);
    try {
      const collectionIds = [...report.collectionIds, collectionId];
      const response = await fetch(`/api/reports/${reportId}/collections`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionIds }) });
      if (!response.ok) throw new Error();
      setReports((current) => current.map((item) => item.id === reportId ? { ...item, collectionIds } : item));
      setCollections((current) => current.map((item) => item.id === collectionId ? { ...item, count: item.count + 1 } : item));
      setAddingToCollection(null);
      flash(`${report.participantA} added to the collection.`);
    } catch { flash("The conversation could not be added."); }
    finally { setWorking(null); setDraggedReportId(null); setDropTarget(null); }
  };

  return <>
    <div className="mt-8 border-y border-ink/14 py-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => setCollection("all")} className={`collection-tab ${collection === "all" ? "collection-tab-active" : ""}`}>All <span>{reports.length}</span></button>
        <button type="button" onClick={() => setCollection("unsorted")} className={`collection-tab ${collection === "unsorted" ? "collection-tab-active" : ""}`}>Unsorted <span>{reports.filter((report) => !report.collectionIds.length).length}</span></button>
        {collections.map((item) => <div key={item.id} onDragOver={(event) => { if (!draggedReportId) return; event.preventDefault(); setDropTarget(item.id); }} onDragLeave={() => setDropTarget((current) => current === item.id ? null : current)} onDrop={(event) => { event.preventDefault(); const reportId = event.dataTransfer.getData("text/plain") || draggedReportId; if (reportId) void addReportToCollection(reportId, item.id); }} className={`group/collection flex shrink-0 rounded-full transition ${dropTarget === item.id ? "bg-accent/12 ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}><button type="button" onClick={() => setCollection(item.id)} className={`collection-tab ${collection === item.id ? "collection-tab-active" : ""}`}>{item.name} <span>{item.count}</span></button>{collection === item.id && <div className="ml-1 flex"><button type="button" aria-label={`Rename ${item.name}`} onClick={() => { setCollectionName(item.name); setCollectionEditor({ kind: "rename", collection: item }); }} className="px-1.5 text-xs text-ink/35 hover:text-ink">✎</button><button type="button" aria-label={`Delete ${item.name}`} disabled={working === item.id} onClick={() => void deleteCollection(item)} className="px-1.5 text-xs text-ink/25 hover:text-side-a">×</button></div>}</div>)}
        <button type="button" onClick={() => { setCollectionName(""); setCollectionEditor({ kind: "create" }); }} className="ml-1 shrink-0 rounded-full border border-dashed border-ink/20 px-3 py-2 font-mono text-[8px] uppercase tracking-[.1em] text-ink/45 transition hover:border-accent hover:text-accent">+ New collection</button>
      </div>
    </div>
    <div className="border-b border-ink/14 py-4">
      <label className="flex items-center gap-3"><span className="text-ink/28">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-ink/32" /></label>
    </div>

    <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-display text-[30px]">Conversations</h2><div className="flex items-center gap-4">{collection !== "all" && collection !== "unsorted" && <button type="button" onClick={() => setAddingToCollection(collections.find((item) => item.id === collection) ?? null)} className="text-xs font-semibold text-accent transition hover:text-ink">+ Add conversation</button>}<span className="font-mono text-[10px] text-ink/35">{visible.length} of {reports.length}</span></div></div>
    {visible.length ? <ol className="mt-4 border-t border-ink/14">{visible.map((report, index) => <li key={report.id} draggable onDragStart={(event) => { setDraggedReportId(report.id); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", report.id); }} onDragEnd={() => { setDraggedReportId(null); setDropTarget(null); }} className={`conversation-row relative grid cursor-grab gap-4 border-b border-ink/14 py-6 transition-opacity active:cursor-grabbing sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:items-center ${draggedReportId === report.id ? "opacity-35" : ""}`}>
      <span className="font-mono text-[9px] text-ink/25">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-4 gap-y-2"><Link href={`/reports/${report.id}`} className="truncate font-display text-[clamp(1.65rem,3vw,2.5rem)] leading-none transition hover:text-accent">{report.participantA}</Link><Status report={report} /></div><p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[8px] uppercase tracking-[.1em] text-ink/36"><span>{date(report.firstTs)} — {date(report.lastTs)}</span><span>{report.messageCount.toLocaleString()} messages</span><span>Updated {new Date(report.completedAt ?? report.createdAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}</span>{report.shared && <span className="text-accent">Shared</span>}</p></div>
      <div className="flex items-center gap-2"><Link href={`/reports/${report.id}`} className="rounded-full border border-ink/14 px-4 py-2 text-xs font-semibold transition hover:border-accent hover:text-accent">Open</Link><button type="button" aria-label="Conversation actions" onClick={() => setMenu(menu === report.id ? null : report.id)} className="grid h-9 w-9 place-items-center rounded-full border border-ink/14 text-ink/45 transition hover:border-ink/40 hover:text-ink">•••</button></div>
      {menu === report.id && <div className="absolute bottom-16 right-0 z-30 w-52 overflow-hidden rounded-2xl border border-ink/12 bg-surface p-2 text-sm shadow-2xl" onMouseLeave={() => setMenu(null)}><Link href="/app/new" className="block rounded-xl px-3 py-2.5 hover:bg-shade">Refresh with newer export</Link>{!report.aiReady && report.status !== "PROCESSING" && <Link href={`/reports/${report.id}?insights=1`} className="block rounded-xl px-3 py-2.5 hover:bg-shade">Unlock AI insights</Link>}<button type="button" onClick={() => { setMembershipDraft(report.collectionIds); setOrganising(report); setMenu(null); }} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-shade">Add to collections</button><button type="button" disabled={working === report.id} onClick={() => void share(report)} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-shade">{report.shared ? "Copy share link" : "Share report"}</button><button type="button" onClick={() => { setNames([report.participantA, report.participantB]); setRenaming(report); setMenu(null); }} className="block w-full rounded-xl px-3 py-2.5 text-left hover:bg-shade">Rename people</button><button type="button" disabled={working === report.id} onClick={() => void remove(report)} className="block w-full rounded-xl px-3 py-2.5 text-left text-side-a hover:bg-shade">Delete report</button></div>}
    </li>)}</ol> : <div className="mt-4 border-y border-ink/14 py-14"><p className="font-display text-3xl">No conversations match.</p><p className="mt-2 text-sm text-ink/48">Try another search or clear the current filter.</p></div>}

    {renaming && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) setRenaming(null); }}><section className="w-full max-w-lg rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">Rename conversation</p><h3 className="mt-3 font-display text-4xl">Who is in this chat?</h3><div className="mt-6 grid gap-3 sm:grid-cols-2"><input value={names[0]} onChange={(event) => setNames([event.target.value, names[1]])} className="rounded-xl border border-ink/14 bg-transparent px-4 py-3 outline-none focus:border-accent" /><input value={names[1]} onChange={(event) => setNames([names[0], event.target.value])} className="rounded-xl border border-ink/14 bg-transparent px-4 py-3 outline-none focus:border-accent" /></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setRenaming(null)} className="px-4 py-2 text-sm text-ink/48">Cancel</button><button type="button" disabled={working === renaming.id || !names[0].trim() || !names[1].trim()} onClick={() => void saveRename()} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save names</button></div></section></div>}
    {collectionEditor && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) setCollectionEditor(null); }}><form onSubmit={(event) => { event.preventDefault(); void saveCollection(); }} className="w-full max-w-md rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">{collectionEditor.kind === "create" ? "New collection" : "Rename collection"}</p><h3 className="mt-3 font-display text-4xl">Give it a name.</h3><input autoFocus value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="Close friends" className="mt-6 w-full rounded-xl border border-ink/14 bg-transparent px-4 py-3 outline-none focus:border-accent" /><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setCollectionEditor(null)} className="px-4 py-2 text-sm text-ink/48">Cancel</button><button type="submit" disabled={!collectionName.trim() || working !== null} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save collection</button></div></form></div>}
    {organising && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) setOrganising(null); }}><section className="w-full max-w-lg rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">Organise conversation</p><h3 className="mt-3 font-display text-4xl">Choose collections.</h3><p className="mt-2 text-sm text-ink/48">Your conversation with {organising.participantA} can appear in more than one.</p>{collections.length ? <div className="mt-6 border-y border-ink/14">{collections.map((item) => <label key={item.id} className="flex cursor-pointer items-center justify-between border-b border-ink/10 py-3 last:border-b-0"><span className="text-sm">{item.name}</span><input type="checkbox" checked={membershipDraft.includes(item.id)} onChange={(event) => setMembershipDraft((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="h-4 w-4 accent-[var(--color-accent)]" /></label>)}</div> : <p className="mt-6 border-y border-ink/14 py-5 text-sm text-ink/45">Create a collection first, then return here.</p>}<div className="mt-6 flex justify-between gap-3"><button type="button" onClick={() => { setOrganising(null); setCollectionName(""); setCollectionEditor({ kind: "create" }); }} className="text-sm text-accent">+ New collection</button><div className="flex gap-3"><button type="button" onClick={() => setOrganising(null)} className="px-3 py-2 text-sm text-ink/48">Cancel</button><button type="button" disabled={working === organising.id} onClick={() => void saveMemberships()} className="rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save</button></div></div></section></div>}
    {addingToCollection && <div className="fixed inset-0 z-50 grid place-items-center bg-night/72 px-5 backdrop-blur-sm" onClick={(event) => { if (event.target === event.currentTarget) setAddingToCollection(null); }}><section className="w-full max-w-lg rounded-[24px] bg-surface p-7 shadow-2xl"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-accent">{addingToCollection.name}</p><h3 className="mt-3 font-display text-4xl">Add a conversation.</h3><p className="mt-2 text-sm text-ink/48">Choose a saved conversation to place in this collection.</p><div className="mt-6 max-h-[44vh] overflow-y-auto border-y border-ink/14">{reports.filter((report) => !report.collectionIds.includes(addingToCollection.id)).map((report) => <button key={report.id} type="button" disabled={working === report.id} onClick={() => void addReportToCollection(report.id, addingToCollection.id)} className="flex w-full items-center justify-between border-b border-ink/10 py-4 text-left last:border-b-0 hover:text-accent disabled:opacity-40"><span className="font-display text-2xl">{report.participantA}</span><span className="font-mono text-[9px] uppercase tracking-[.12em]">Add +</span></button>)}{reports.every((report) => report.collectionIds.includes(addingToCollection.id)) && <p className="py-7 text-sm text-ink/45">Every saved conversation is already here.</p>}</div><div className="mt-6 flex justify-end"><button type="button" onClick={() => setAddingToCollection(null)} className="rounded-full border border-ink/14 px-5 py-2.5 text-sm font-semibold">Done</button></div></section></div>}
    {notice && <div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-night px-5 py-3 text-sm text-white shadow-xl">{notice}</div>}
  </>;
}
