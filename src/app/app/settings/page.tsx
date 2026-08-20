"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsClient } from "./SettingsClient";
import { loadSettingsData, peekSettingsData, storeSettingsData, type SettingsData } from "./settings-data";

export default function SettingsPage() {
  const [data, setData] = useState(peekSettingsData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    void loadSettingsData().then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : "Settings could not be loaded."));
  }, [data]);

  const snapshot = useCallback((next: SettingsData) => storeSettingsData(next), []);

  return <section className="px-5 py-6 min-[640px]:py-10 sm:px-10 lg:px-14 lg:py-14 xl:px-20">
    <header className="border-b border-ink/14 pb-9 max-[640px]:hidden"><p className="font-mono text-[10px] uppercase tracking-[.17em] text-accent">Workspace</p><h1 className="mt-3 font-display text-[48px] leading-none sm:text-[66px]">Settings</h1></header>
    {data ? <SettingsClient account={data.account} initialShares={data.shares} initialCollections={data.collections} onSnapshot={snapshot} /> : error ? <div className="border-b border-ink/14 py-12"><p className="font-display text-3xl">Settings could not load.</p><button type="button" onClick={() => { setError(null); setData(null); }} className="mt-4 text-sm font-semibold text-accent">Try again</button></div> : <div className="py-10"><div className="h-8 w-44 animate-pulse bg-ink/[.05]" /><div className="mt-7 h-40 animate-pulse border-y border-ink/10 bg-gradient-to-r from-ink/[.035] to-transparent" /></div>}
  </section>;
}
