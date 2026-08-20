"use client";

import { useEffect, useState } from "react";
import { TELESCOPE_REPORT_NAME_EVENT } from "../AppShell";
import { invalidateDashboardData } from "../dashboard-data";
import type { SettingsData } from "./settings-data";

const SETTINGS_KEY = "telescope:preferences";
const SHARES_PER_PAGE = 5;
type Preferences = { autoAi: boolean; reducedMotion: boolean; largerText: boolean; confirmSharing: boolean; dashboardDark: boolean };
const defaults: Preferences = { autoAi: false, reducedMotion: false, largerText: false, confirmSharing: true, dashboardDark: true };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="settings-switch"><span /></button>;
}

function SettingRow({ title, copy, control }: { title: string; copy: string; control: React.ReactNode }) {
  return <div className="grid gap-4 border-b border-ink/12 py-5 sm:grid-cols-[1fr_auto] sm:items-center"><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-[64ch] text-xs leading-relaxed text-ink/48">{copy}</p></div>{control}</div>;
}

export function SettingsClient({ account, initialShares, initialCollections, onSnapshot }: { account: SettingsData["account"]; initialShares: SettingsData["shares"]; initialCollections: SettingsData["collections"]; onSnapshot?: (data: SettingsData) => void }) {
  const [preferences, setPreferences] = useState(defaults);
  const [shares, setShares] = useState(initialShares);
  const [shareQuery, setShareQuery] = useState("");
  const [sharePage, setSharePage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [reportName, setReportName] = useState(account.reportName);
  const [savedReportName, setSavedReportName] = useState(account.reportName);
  const [collections, setCollections] = useState(initialCollections);
  const [collectionNames, setCollectionNames] = useState<Record<string, string>>(() => Object.fromEntries(initialCollections.map((collection) => [collection.id, collection.name])));
  const normalisedShareQuery = shareQuery.trim().toLocaleLowerCase();
  const visibleShares = shares.filter((share) => !normalisedShareQuery || share.names.toLocaleLowerCase().includes(normalisedShareQuery) || share.privacy?.toLocaleLowerCase().includes(normalisedShareQuery));
  const sharePageCount = Math.max(1, Math.ceil(visibleShares.length / SHARES_PER_PAGE));
  const currentSharePage = Math.min(sharePage, sharePageCount);
  const paginatedShares = visibleShares.slice((currentSharePage - 1) * SHARES_PER_PAGE, currentSharePage * SHARES_PER_PAGE);

  useEffect(() => {
    try { setPreferences({ ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Preferences> }); } catch { /* Defaults remain available. */ }
  }, []);
  useEffect(() => { setSharePage(1); }, [shareQuery]);
  useEffect(() => { if (sharePage > sharePageCount) setSharePage(sharePageCount); }, [sharePage, sharePageCount]);
  useEffect(() => { onSnapshot?.({ account: { ...account, reportName: savedReportName }, shares, collections }); }, [account, collections, onSnapshot, savedReportName, shares]);
  const update = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    document.documentElement.classList.toggle("telescope-reduce-motion", next.reducedMotion);
    document.documentElement.classList.toggle("telescope-large-text", next.largerText);
  };
  const scrollToSection = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const id = event.currentTarget.hash.slice(1);
    const section = document.getElementById(id);
    if (!section) return;
    window.history.replaceState(null, "", `#${id}`);
    section.scrollIntoView({ behavior: preferences.reducedMotion ? "auto" : "smooth", block: "start" });
  };
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 2500); };
  const revoke = async (id?: string) => {
    setWorking(id ?? "all-shares");
    try {
      const response = await fetch(id ? `/api/settings/shares/${id}` : "/api/settings/shares", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setShares((current) => id ? current.filter((share) => share.id !== id) : []);
      flash(id ? "Share link revoked." : "All share links revoked.");
    } catch { flash("The share link could not be revoked."); }
    finally { setWorking(null); }
  };
  const clearBrowserData = () => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("telescope:") && key !== SETTINGS_KEY);
    keys.forEach((key) => localStorage.removeItem(key));
    flash(`Cleared ${keys.length} browser-only item${keys.length === 1 ? "" : "s"}.`);
  };
  const saveReportName = async () => {
    if (!reportName.trim()) return;
    setWorking("report-name");
    try {
      const response = await fetch("/api/settings/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportName }) });
      const body = await response.json().catch(() => null) as { reportName?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The name could not be saved.");
      if (body?.reportName) { setReportName(body.reportName); setSavedReportName(body.reportName); window.dispatchEvent(new CustomEvent(TELESCOPE_REPORT_NAME_EVENT, { detail: body.reportName })); }
      flash("Report name updated.");
    } catch (error) { flash(error instanceof Error ? error.message : "The name could not be saved."); }
    finally { setWorking(null); }
  };
  const saveCollectionName = async (id: string) => {
    const name = collectionNames[id]?.trim().slice(0, 20);
    if (!name) return;
    setWorking(`collection:${id}`);
    try {
      const response = await fetch(`/api/collections/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The collection could not be renamed.");
      setCollections((current) => current.map((collection) => collection.id === id ? { ...collection, name } : collection));
      setCollectionNames((current) => ({ ...current, [id]: name }));
      invalidateDashboardData();
      flash("Collection renamed.");
    } catch (error) { flash(error instanceof Error ? error.message : "The collection could not be renamed."); }
    finally { setWorking(null); }
  };
  const deleteCollection = async (id: string) => {
    const collection = collections.find((item) => item.id === id);
    if (!collection || !window.confirm(`Delete “${collection.name}”? Its reports will remain saved.`)) return;
    setWorking(`delete-collection:${id}`);
    try {
      const response = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setCollections((current) => current.filter((item) => item.id !== id));
      setCollectionNames((current) => { const next = { ...current }; delete next[id]; return next; });
      invalidateDashboardData();
      flash("Collection deleted. Reports are untouched.");
    } catch { flash("The collection could not be deleted."); }
    finally { setWorking(null); }
  };
  const deleteScope = async (scope: "reports" | "collections") => {
    const noun = scope === "reports" ? "all saved reports" : "all collections";
    if (!window.confirm(`Delete ${noun}?${scope === "collections" ? " Your reports will remain." : " This cannot be undone."}`)) return;
    setWorking(scope);
    try {
      const response = await fetch("/api/settings/data", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope }) });
      if (!response.ok) throw new Error();
      if (scope === "reports") setShares([]);
      if (scope === "collections") { setCollections([]); setCollectionNames({}); invalidateDashboardData(); }
      flash(scope === "reports" ? "All reports deleted." : "All collections deleted. Reports are untouched.");
    } catch { flash(`Could not delete ${noun}.`); }
    finally { setWorking(null); }
  };
  const deleteAccount = async () => {
    const confirmation = window.prompt('Type DELETE to permanently remove your Telescope account and all saved data.');
    if (confirmation !== "DELETE") return;
    setWorking("account");
    try {
      const response = await fetch("/api/settings/account", { method: "DELETE" });
      if (!response.ok) throw new Error();
      localStorage.removeItem(SETTINGS_KEY);
      window.location.assign("/");
    } catch { setWorking(null); flash("Your account could not be deleted."); }
  };

  return <div className="settings-layout py-10 max-[640px]:pt-0">
    <nav className="settings-index"><a href="#account" onClick={scrollToSection}>Account</a><a href="#defaults" onClick={scrollToSection}>Report defaults</a><a href="#collections" onClick={scrollToSection}>Collections</a><a href="#privacy" onClick={scrollToSection}>Privacy & storage</a><a href="#sharing" onClick={scrollToSection}>Shared links</a><a href="#accessibility" onClick={scrollToSection}>Accessibility</a><a href="#danger" onClick={scrollToSection}>Danger zone</a></nav>
    <div className="min-w-0 space-y-14">
      <section id="account" className="scroll-mt-8"><p className="settings-kicker">Account</p><h2 className="settings-title">Your identity.</h2><div className="mt-6 flex items-center gap-4 border-y border-ink/14 py-5">{account.image ? <img src={account.image} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" /> : <span className="grid h-12 w-12 place-items-center rounded-full bg-night font-display text-xl text-white">{account.name.slice(0, 1)}</span>}<div><p className="font-semibold">{account.name}</p><p className="mt-1 text-sm text-ink/45">{account.email}</p></div></div><div className="mt-6 grid gap-3 border-b border-ink/12 pb-6 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-sm font-semibold">Your name in reports<span className="mt-1 block text-xs font-normal leading-relaxed text-ink/45">Shown in full throughout owned and shared reports. This does not change your Google profile.</span><input value={reportName} onChange={(event) => setReportName(event.target.value)} maxLength={20} className="mt-3 w-full border-b border-ink/20 bg-transparent py-2 font-display text-2xl outline-none focus:border-accent" /><span aria-live="polite" className="mt-2 block text-right font-mono text-[9px] font-normal uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - reportName.length)} characters left</span></label><button type="button" disabled={!reportName.trim() || working === "report-name" || reportName.trim() === savedReportName} onClick={() => void saveReportName()} className="settings-save-name rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-35">Save name</button></div><p className="mt-3 text-xs text-ink/40">Google is used only to authenticate your account. Telescope never receives your Google password.</p></section>

      <section id="defaults" className="scroll-mt-8"><p className="settings-kicker">Report defaults</p><h2 className="settings-title">How new analyses begin.</h2><div className="mt-5 border-t border-ink/12"><SettingRow title="Generate AI insights automatically" copy="Preselect AI insights when you confirm the participants in a new report." control={<Toggle label="Generate AI insights automatically" checked={preferences.autoAi} onChange={(autoAi) => update({ autoAi })} />} /><SettingRow title="Confirm before creating a share link" copy="Keep an extra moment of confirmation before a report becomes accessible by link." control={<Toggle label="Confirm before sharing" checked={preferences.confirmSharing} onChange={(confirmSharing) => update({ confirmSharing })} />} /></div><p className="mt-4 text-xs leading-relaxed text-ink/42">Sticker artwork requires no preference: Telescope detects it automatically whenever it exists in the selected export folder.</p></section>

      <section id="collections" className="scroll-mt-8"><p className="settings-kicker">Collections</p><h2 className="settings-title">Manage your groups.</h2><p className="mt-4 max-w-[58ch] text-sm leading-relaxed text-ink/48">Rename or delete the collections used to organise conversations. Names can be up to 20 characters. Deleting one never deletes its reports.</p>{collections.length ? <div className="mt-6 border-t border-ink/14">{collections.map((collection) => <div key={collection.id} className="grid gap-3 border-b border-ink/12 py-4 sm:grid-cols-[1fr_auto] sm:items-end"><label className="text-xs font-semibold text-ink/48"><span className="mb-2 block">{collection.count} conversation{collection.count === 1 ? "" : "s"}</span><input value={collectionNames[collection.id] ?? collection.name} maxLength={20} onChange={(event) => setCollectionNames((current) => ({ ...current, [collection.id]: event.target.value }))} className="w-full border-b border-ink/18 bg-transparent py-2 font-display text-2xl text-ink outline-none transition focus:border-accent" /><span aria-live="polite" className="mt-2 block text-right font-mono text-[9px] uppercase tracking-[.1em] text-ink/38">{Math.max(0, 20 - (collectionNames[collection.id] ?? collection.name).length)} characters left</span></label><div className="flex items-center gap-3"><button type="button" disabled={!collectionNames[collection.id]?.trim() || collectionNames[collection.id]?.trim() === collection.name || working === `collection:${collection.id}`} onClick={() => void saveCollectionName(collection.id)} className="rounded-full border border-ink/16 px-5 py-2.5 text-sm font-semibold transition hover:border-accent hover:text-accent disabled:opacity-30">Save</button><button type="button" disabled={working === `delete-collection:${collection.id}`} onClick={() => void deleteCollection(collection.id)} className="px-2 py-2.5 text-sm font-semibold text-side-a disabled:opacity-35">Delete</button></div></div>)}</div> : <p className="mt-6 border-y border-ink/14 py-7 text-sm text-ink/45">You have not created any collections yet.</p>}</section>

      <section id="privacy" className="scroll-mt-8"><p className="settings-kicker">Privacy & storage</p><h2 className="settings-title">What lives where.</h2><dl className="mt-6 border-t border-ink/14 text-sm"><div className="grid gap-2 border-b border-ink/12 py-4 sm:grid-cols-[170px_1fr]"><dt className="font-semibold">Raw export</dt><dd className="text-ink/50">Read locally for numerical analysis and never stored with your report.</dd></div><div className="grid gap-2 border-b border-ink/12 py-4 sm:grid-cols-[170px_1fr]"><dt className="font-semibold">Saved report</dt><dd className="text-ink/50">Numerical results and completed AI findings are stored in your account.</dd></div><div className="grid gap-2 border-b border-ink/12 py-4 sm:grid-cols-[170px_1fr]"><dt className="font-semibold">Browser only</dt><dd className="text-ink/50">Sticker artwork, quote context, and temporary evidence stay in this browser.</dd></div></dl><button type="button" onClick={clearBrowserData} className="mt-5 rounded-full border border-ink/16 px-5 py-2.5 text-sm font-semibold transition hover:border-accent hover:text-accent">Clear browser-only report data</button></section>

      <section id="sharing" className="scroll-mt-8"><div className="flex items-end justify-between gap-4"><div><p className="settings-kicker">Shared links</p><h2 className="settings-title">Reports visible by link.</h2></div>{shares.length > 1 && <button type="button" disabled={working === "all-shares"} onClick={() => void revoke()} className="text-xs font-semibold text-side-a">Revoke all</button>}</div>{shares.length ? <><label className="mt-6 flex items-center gap-3 border-y border-ink/14"><span className="text-ink/28">⌕</span><input value={shareQuery} onChange={(event) => setShareQuery(event.target.value)} placeholder="Search shared reports or privacy type" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink/32" /><span className="shrink-0 font-mono text-[8px] uppercase tracking-[.1em] text-ink/35">{visibleShares.length} of {shares.length}</span></label>{visibleShares.length ? <><ol className="max-h-[420px] overflow-y-auto border-b border-ink/14 pr-2">{paginatedShares.map((share) => <li key={share.id} className="grid gap-3 border-b border-ink/12 py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-display text-2xl">{share.names}</p><p className="mt-1 font-mono text-[8px] uppercase tracking-[.1em] text-ink/34">{share.privacy ? `${share.privacy} · ` : ""}Shared {new Date(share.createdAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}</p></div><div className="flex gap-4"><button type="button" onClick={() => navigator.clipboard.writeText(new URL(share.path, window.location.origin).toString()).then(() => flash("Link copied."))} className="text-xs font-semibold text-accent">Copy link</button><button type="button" disabled={working === share.id} onClick={() => void revoke(share.id)} className="text-xs font-semibold text-side-a">Revoke</button></div></li>)}</ol>{sharePageCount > 1 && <nav aria-label="Shared link pages" className="flex items-center justify-between gap-4 border-b border-ink/14 py-4"><button type="button" disabled={currentSharePage === 1} onClick={() => setSharePage((current) => Math.max(1, current - 1))} className="text-xs font-semibold text-accent transition hover:text-ink disabled:text-ink/25">← Previous</button><span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink/38">Page {currentSharePage} of {sharePageCount}</span><button type="button" disabled={currentSharePage === sharePageCount} onClick={() => setSharePage((current) => Math.min(sharePageCount, current + 1))} className="text-xs font-semibold text-accent transition hover:text-ink disabled:text-ink/25">Next →</button></nav>}</> : <p className="border-b border-ink/14 py-7 text-sm text-ink/45">No shared reports match “{shareQuery.trim()}”.</p>}</> : <p className="mt-6 border-y border-ink/14 py-8 text-sm text-ink/45">No reports currently have an active public link.</p>}</section>

      <section id="accessibility" className="scroll-mt-8"><p className="settings-kicker">Accessibility</p><h2 className="settings-title">Adjust the experience.</h2><div className="mt-5 border-t border-ink/12"><SettingRow title="Reduce motion" copy="Minimise report transitions, entrances, and decorative movement." control={<Toggle label="Reduce motion" checked={preferences.reducedMotion} onChange={(reducedMotion) => update({ reducedMotion })} />} /><SettingRow title="Larger interface text" copy="Increase the base text size throughout Telescope on this browser." control={<Toggle label="Larger interface text" checked={preferences.largerText} onChange={(largerText) => update({ largerText })} />} /></div></section>

      <section id="danger" className="scroll-mt-8 border-t border-side-a/30 pt-9"><p className="font-mono text-[9px] uppercase tracking-[.15em] text-side-a">Danger zone</p><h2 className="settings-title">Permanent actions.</h2><div className="mt-6 divide-y divide-side-a/15 border-y border-side-a/20"><SettingRow title="Delete all collections" copy="Removes your organisation structure. Reports remain saved and become Unsorted." control={<button type="button" disabled={working === "collections"} onClick={() => void deleteScope("collections")} className="text-sm font-semibold text-side-a">Delete collections</button>} /><SettingRow title="Delete all reports" copy="Permanently removes every report, AI reading, and active share link." control={<button type="button" disabled={working === "reports"} onClick={() => void deleteScope("reports")} className="text-sm font-semibold text-side-a">Delete reports</button>} /><SettingRow title="Delete Telescope account" copy="Removes the account and all associated reports, collections, sessions, and links." control={<button type="button" disabled={working === "account"} onClick={() => void deleteAccount()} className="rounded-full bg-side-a px-4 py-2 text-sm font-semibold text-white">Delete account</button>} /></div></section>
    </div>
    {notice && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-night px-5 py-3 text-sm text-white shadow-xl">{notice}</div>}
  </div>;
}
