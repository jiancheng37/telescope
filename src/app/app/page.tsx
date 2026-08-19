"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DashboardWorkspace, type DashboardCollection, type DashboardConversation } from "./DashboardWorkspace";
import { invalidateDashboardData, loadDashboardData, peekDashboardData, storeDashboardData } from "./dashboard-data";
import { PendingReportSaver } from "./PendingReportSaver";

export default function DashboardPage() {
  const [data, setData] = useState(peekDashboardData);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data) return;
    void loadDashboardData().then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : "Dashboard data could not be loaded."));
  }, [data]);
  useEffect(() => {
    const invalidate = () => { invalidateDashboardData(); setData(null); };
    window.addEventListener("telescope:dashboard-invalidate", invalidate);
    return () => window.removeEventListener("telescope:dashboard-invalidate", invalidate);
  }, []);
  const snapshot = useCallback((reports: DashboardConversation[], collections: DashboardCollection[]) => { storeDashboardData({ reports, collections }); }, []);

  return <>
    <PendingReportSaver />
    <section className="px-5 py-10 sm:px-10 lg:px-14 lg:py-14 xl:px-20">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-ink/14 pb-9"><div><p className="font-mono text-[10px] uppercase tracking-[.17em] text-accent">Workspace</p><h1 className="mt-3 font-display text-[48px] leading-none sm:text-[66px]">Your analyses</h1></div><Link href="/app/new" prefetch className="rounded-full bg-night px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-accent">Analyze a conversation</Link></header>
      {data ? <DashboardWorkspace initialReports={data.reports} initialCollections={data.collections} onSnapshot={snapshot} /> : error ? <div className="mt-8 border-y border-ink/14 py-12"><p className="font-display text-3xl">The dashboard could not load.</p><button type="button" onClick={() => { setError(null); setData(null); }} className="mt-4 text-sm font-semibold text-accent">Try again</button></div> : <div className="mt-8 space-y-5" aria-label="Loading conversations">{[0,1,2].map((item) => <div key={item} className="h-20 animate-pulse border-b border-ink/10 bg-gradient-to-r from-ink/[.035] to-transparent" />)}</div>}
    </section>
  </>;
}
