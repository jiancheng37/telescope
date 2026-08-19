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
  useEffect(() => { setPending(null); }, [pathname]);
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
  useEffect(() => { void loadSettingsData().catch(() => undefined); }, []);
  if (pathname !== "/app" && !pathname.startsWith("/app/")) return null;
  if (openingReport) return <div className="fixed inset-0 z-[100] grid place-items-center bg-night text-white"><div className="flex flex-col items-center text-center"><Logo /><p className="mt-5 font-mono text-[9px] uppercase tracking-[.2em] text-accent-lit">Opening your report</p><span className="mt-4 block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-lit" /></div></div>;

  return <AppIdentityContext.Provider value={identity}><main onClickCapture={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return; const href = event.target.closest("a")?.getAttribute("href"); if (href?.startsWith("/reports/")) setOpeningReport(true); }} className="min-h-dvh bg-surface text-ink lg:grid lg:grid-cols-[240px_1fr]">
    <aside className="flex items-center justify-between border-b border-ink/12 px-5 py-5 lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:items-stretch lg:border-b-0 lg:border-r lg:px-7 lg:py-7">
      <div><Link href="/app" prefetch onClick={() => setPending("/app")} className="flex items-center gap-2.5"><Logo /><span className="font-display text-2xl">Telescope</span></Link><nav className="mt-12 hidden border-t border-ink/12 pt-5 font-mono text-[10px] uppercase tracking-[.15em] lg:block">{links.map((link) => { const active = link.href === "/app" ? pathname === "/app" : pathname.startsWith(link.href); return <Link key={link.href} href={link.href} prefetch onClick={() => setPending(link.href)} className={`flex items-center justify-between py-2 transition ${active ? "text-accent" : "text-ink/42 hover:text-ink"}`}>{link.label}{pending === link.href && !active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}</Link>; })}</nav></div>
      <div className="flex items-center gap-4 lg:block"><p className="max-w-[180px] truncate text-[13px] leading-tight text-ink/62">{name}</p><form action={signOutCurrentUser}><button className="font-mono text-[9px] uppercase tracking-[.14em] text-ink/35 transition hover:text-ink lg:mt-3">Sign out</button></form></div>
    </aside>
    <div className="min-w-0">{children}</div>
  </main></AppIdentityContext.Provider>;
}
