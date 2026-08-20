"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo, Shield } from "@/ui/primitives";

const steps = [
  { kicker: "Welcome to Telescope", title: <>One conversation.<br /><span className="italic text-accent-lit">Seen all at once.</span></>, body: "Telescope turns a Telegram chat into a private, click-through story about its rhythms, language, eras and lore." },
  { kicker: "Private by design", title: <>The numbers stay<br /><span className="italic text-safe-lit">on your machine.</span></>, body: "Your raw export is analysed locally. Only computed reports are saved; AI insights are a separate choice that clearly tells you when the conversation is sent for reading." },
] as const;

export function OnboardingFlow({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const finish = async () => {
    if (!name.trim()) return;
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/settings/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportName: name }) });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error ?? "Your name could not be saved."); }
      router.push("/app"); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Your name could not be saved."); setWorking(false); }
  };
  const naming = step === steps.length;
  return <main className="starfield relative min-h-dvh overflow-hidden bg-night text-white"><header className="relative z-10 flex h-[74px] items-center justify-between border-b border-white/12 px-5 sm:px-10 xl:px-16"><div className="flex items-center gap-2.5"><Logo size={25} tone="night" /><span className="font-display text-2xl">Telescope</span></div><span className="font-mono text-[9px] uppercase tracking-[.16em] text-white/35">Set up your workspace</span></header>
    <section className="relative z-10 grid min-h-[calc(100dvh-74px)] items-center px-5 py-10 sm:px-10 xl:px-16"><div key={step} className="rise mx-auto w-full max-w-[1080px]">
      {!naming ? <><p className="font-mono text-[11px] uppercase tracking-[.2em] text-accent-lit">{steps[step].kicker}</p><h1 className="mt-6 max-w-[920px] font-display text-[clamp(3.6rem,9vw,8.5rem)] leading-[.82] tracking-[-.045em]">{steps[step].title}</h1><p className="mt-8 max-w-[620px] text-[clamp(1rem,1.8vw,1.25rem)] leading-relaxed text-white/58">{steps[step].body}</p>{step === 1 && <p className="mt-5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.13em] text-safe-lit"><Shield /> Raw exports are never stored</p>}</> : <><p className="font-mono text-[11px] uppercase tracking-[.2em] text-accent-lit">Your name</p><h1 className="mt-6 max-w-[820px] font-display text-[clamp(3.4rem,8vw,7.4rem)] leading-[.84] tracking-[-.04em]">How should you appear in your reports?</h1><p className="mt-6 max-w-[580px] text-lg leading-relaxed text-white/55">Use the full name you want Telescope to show. You can change it later in Settings without changing your Google account.</p><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void finish(); }} maxLength={20} placeholder="Your name" className="mt-8 w-full max-w-[620px] border-b border-white/25 bg-transparent py-4 font-display text-[clamp(2rem,5vw,4rem)] text-white outline-none placeholder:text-white/18 focus:border-accent-lit" /><p aria-live="polite" className="mt-2 max-w-[620px] text-right font-mono text-[9px] uppercase tracking-[.1em] text-white/38">{Math.max(0, 20 - name.length)} characters left</p>{error && <p className="mt-4 text-sm text-side-a">{error}</p>}</>}
      <footer className="mt-12 flex items-center justify-between border-t border-white/12 pt-6"><div className="flex gap-2">{[0,1,2].map((item) => <span key={item} className={`h-1 rounded-full transition-all ${item === step ? "w-10 bg-accent-lit" : "w-5 bg-white/16"}`} />)}</div><div className="flex items-center gap-4">{step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="text-sm text-white/45 hover:text-white">Back</button>}{naming ? <button type="button" disabled={!name.trim() || working} onClick={() => void finish()} className="rounded-full bg-accent-lit px-7 py-3 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:bg-white disabled:opacity-35">{working ? "Creating workspace…" : "Enter Telescope"}</button> : <button type="button" onClick={() => setStep((current) => current + 1)} className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-night transition hover:-translate-y-0.5 hover:bg-accent-lit">Continue →</button>}</div></footer>
    </div></section>
  </main>;
}
