"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/ui/primitives";
import { signOutCurrentUser } from "@/app/actions/auth";
import { loadSettingsData } from "./settings/settings-data";

export const TELESCOPE_REPORT_NAME_EVENT = "telescope:report-name";
export const TELESCOPE_OPEN_REPORT_EVENT = "telescope:open-report";

const links = [{ href: "/app", label: "Dashboard" }, { href: "/app/new", label: "New analysis" }, { href: "/app/settings", label: "Settings" }];

const AppIdentityContext = createContext<{ name: string } | null>(null);

export function useAppIdentity() {
  const identity = useContext(AppIdentityContext);
  if (!identity) throw new Error("useAppIdentity must be used within AppShell.");
  return identity;
}

export function AppShell({ initialName, children }: { initialName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [name, setName] = useState(initialName);
  const identity = useMemo(() => ({ name }), [name]);
  const [pending, setPending] = useState<string | null>(null);
  const [openingReport, setOpeningReport] = useState(false);
  const [dark, setDark] = useState(false);
  const [compactMenuOpen, setCompactMenuOpen] = useState(false);
  useEffect(() => {
    setPending(null);
    setOpeningReport(false);
    setCompactMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    const receive = (event: Event) => setName((event as CustomEvent<string>).detail);
    window.addEventListener(TELESCOPE_REPORT_NAME_EVENT, receive);
    return () => window.removeEventListener(TELESCOPE_REPORT_NAME_EVENT, receive);
  }, []);
  useEffect(() => {
    const receive = () => setOpeningReport(true);
    window.addEventListener(TELESCOPE_OPEN_REPORT_EVENT, receive);
    return () => window.removeEventListener(TELESCOPE_OPEN_REPORT_EVENT, receive);
  }, []);
  useEffect(() => {
    const restoreDashboard = () => setOpeningReport(false);
    window.addEventListener("popstate", restoreDashboard);
    window.addEventListener("pageshow", restoreDashboard);
    return () => {
      window.removeEventListener("popstate", restoreDashboard);
      window.removeEventListener("pageshow", restoreDashboard);
    };
  }, []);
  useEffect(() => { setDark(document.documentElement.classList.contains("telescope-dashboard-dark")); }, []);
  useEffect(() => { void loadSettingsData().catch(() => undefined); }, []);
  useEffect(() => {
    if (!compactMenuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setCompactMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [compactMenuOpen]);
  if (pathname !== "/app" && !pathname.startsWith("/app/")) return null;
  if (openingReport) return <div className="fixed inset-0 z-[100] grid place-items-center bg-night text-white"><div className="flex flex-col items-center text-center"><Logo /><p className="mt-5 font-mono text-[9px] uppercase tracking-[.2em] text-accent-lit">Opening your report</p><span className="mt-4 block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-lit" /></div></div>;

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("telescope-dashboard-dark", next);
    try {
      const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as Record<string, unknown>;
      localStorage.setItem("telescope:preferences", JSON.stringify({ ...preferences, dashboardDark: next }));
    } catch { /* Theme persistence is optional when storage is unavailable. */ }
  };

  return <AppIdentityContext.Provider value={identity}><main onClickCapture={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return; const href = event.target.closest("a")?.getAttribute("href"); if (href?.startsWith("/reports/")) setOpeningReport(true); }} className="app-shell min-h-dvh bg-surface text-ink transition-colors duration-300 min-[1024px]:grid min-[1024px]:grid-cols-[240px_1fr]">
    {compactMenuOpen && <button type="button" aria-label="Close navigation" onClick={() => setCompactMenuOpen(false)} className="fixed inset-0 z-40 bg-night/28 backdrop-blur-[2px] min-[1024px]:hidden" />}
    <aside className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-ink/12 bg-surface px-5 transition-colors duration-300 min-[1024px]:h-dvh min-[1024px]:flex-col min-[1024px]:items-stretch min-[1024px]:border-b-0 min-[1024px]:border-r min-[1024px]:px-7 min-[1024px]:py-7">
      <div><Link href="/app" prefetch onClick={() => setPending("/app")} className="flex items-center gap-2.5 min-[1024px]:mb-5"><Logo /><span className="font-display text-2xl">Telescope</span></Link><nav className="hidden border-t border-ink/12 pt-5 font-mono text-[10px] uppercase tracking-[.15em] min-[1024px]:block">{links.map((link) => { const active = link.href === "/app" ? pathname === "/app" : pathname.startsWith(link.href); return <Link key={link.href} href={link.href} prefetch onClick={() => setPending(link.href)} className={`flex items-center justify-between py-2 transition ${active ? "text-accent" : "text-ink/42 hover:text-ink"}`}>{link.label}{pending === link.href && !active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}</Link>; })}</nav></div>
      <div className="flex items-center gap-2 min-[1024px]:hidden">{pathname !== "/app/new" && <Link href="/app/new" prefetch onClick={() => setPending("/app/new")} aria-label="Analyze a conversation" title="Analyze a conversation" className="group grid h-10 w-10 place-items-center rounded-full bg-accent text-xl font-medium leading-none text-night shadow-[0_7px_20px_rgba(42,171,238,.2)] transition hover:-translate-y-0.5 hover:bg-accent-lit min-[768px]:hidden"><span aria-hidden="true" className="transition-transform duration-200 group-hover:rotate-90">+</span></Link>}<button type="button" aria-label={dark ? "Use light dashboard" : "Use dark dashboard"} aria-pressed={dark} onClick={toggleDark} className="grid h-10 w-10 place-items-center rounded-full border border-ink/16 text-ink/55 transition hover:border-accent hover:text-accent">{dark ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth="1.7"><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth="1.7"><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4a8.3 8.3 0 1 0 11.2 11.2Z" /></svg>}</button><button type="button" aria-label={compactMenuOpen ? "Close dashboard navigation" : "Open dashboard navigation"} aria-expanded={compactMenuOpen} onClick={() => setCompactMenuOpen((open) => !open)} className="relative grid h-10 w-10 place-items-center rounded-full border border-ink/16 transition hover:border-accent hover:text-accent"><span className={`absolute h-px w-4 bg-current transition duration-200 ${compactMenuOpen ? "rotate-45" : "-translate-y-[3px]"}`} /><span className={`absolute h-px w-4 bg-current transition duration-200 ${compactMenuOpen ? "-rotate-45" : "translate-y-[3px]"}`} /></button></div>
      <div className="hidden min-[1024px]:block"><button type="button" role="switch" aria-checked={dark} aria-label="Toggle dashboard dark mode" onClick={toggleDark} className="mb-5 flex w-full items-center justify-between border-b border-ink/12 pb-5 text-ink/45 transition hover:text-ink"><span className="font-mono text-[9px] uppercase tracking-[.14em]">Dark mode</span><span className={`relative h-6 w-11 rounded-full border transition ${dark ? "border-accent bg-accent" : "border-ink/18 bg-ink/8"}`}><span className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-200 ${dark ? "translate-x-5" : "translate-x-0"}`} /></span></button><p className="max-w-[180px] truncate text-[13px] leading-tight text-ink/62">{name}</p><form action={signOutCurrentUser} className="mt-3"><button className="font-mono text-[9px] uppercase tracking-[.14em] text-ink/35 transition hover:text-ink">Sign out</button></form></div>
      {compactMenuOpen && <section className="rise absolute inset-x-0 top-full border-b border-ink/12 bg-surface px-5 pb-6 pt-2 shadow-2xl min-[1024px]:hidden" aria-label="Dashboard navigation"><nav className="border-t border-ink/12">{links.map((link, index) => { const active = link.href === "/app" ? pathname === "/app" : pathname.startsWith(link.href); return <Link key={link.href} href={link.href} prefetch onClick={() => setPending(link.href)} className={`grid grid-cols-[32px_1fr_auto] items-center gap-3 border-b border-ink/10 py-4 transition hover:text-accent ${active ? "text-accent" : "text-ink"}`}><span className="font-mono text-[9px] text-ink/28">0{index + 1}</span><span className="font-display text-2xl">{link.label}</span><span className="font-mono text-[9px] uppercase tracking-[.1em]">{active ? "Current" : "→"}</span></Link>; })}</nav><div className="mt-5 flex items-center justify-between gap-5 pt-5"><p className="min-w-0 truncate text-sm font-semibold text-ink/62">{name}</p><form action={signOutCurrentUser}><button className="rounded-full border border-ink/14 px-4 py-2 text-xs font-semibold text-ink/48 transition hover:border-ink/35 hover:text-ink">Sign out</button></form></div></section>}
    </aside>
    <div className="min-w-0">{children}</div>
  </main></AppIdentityContext.Provider>;
}
