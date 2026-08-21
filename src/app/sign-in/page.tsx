import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInWithGoogle } from "@/app/actions/auth";
import { Logo, Shield } from "@/ui/primitives";
import type { Metadata } from "next";
import { dashboardUrl } from "@/lib/app-url";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect(dashboardUrl());

  return (
    <main className="starfield relative min-h-dvh overflow-hidden bg-night text-white">
      <section className="relative z-10 flex min-h-dvh flex-col px-6 py-7 sm:px-10 min-[1025px]:hidden">
        <Link href={siteUrl} className="rise flex w-fit items-center gap-2.5">
          <Logo size={26} tone="night" />
          <span className="font-display text-2xl">Telescope</span>
        </Link>
        <div className="my-auto flex w-full max-w-[640px] flex-col gap-9 self-center py-12">
          <div className="order-2">
            <p className="rise font-mono text-[10px] uppercase tracking-[0.2em] text-accent-lit" style={{ animationDelay: "80ms" }}>Your private archive</p>
            <h1 className="rise mt-4 font-display text-[clamp(3.25rem,8vw,5.7rem)] leading-[0.84] tracking-[-0.04em]" style={{ animationDelay: "150ms" }}>
              Come back to<br /><span className="italic text-accent-lit">what you noticed.</span>
            </h1>
          </div>
          <div className="rise order-1 border-b border-white/14 pb-9" style={{ animationDelay: "210ms" }}>
            <AuthPanel showSupporting={false} />
          </div>
          <AccountBenefits compact />
        </div>
      </section>

      <div className="relative z-10 hidden min-h-dvh grid-cols-[1.1fr_.9fr] min-[1025px]:grid">
        <section className="flex min-h-dvh flex-col border-r border-white/12 px-14 py-7 xl:px-16">
          <Link href={siteUrl} className="rise flex w-fit items-center gap-2.5">
            <Logo size={26} tone="night" />
            <span className="font-display text-2xl">Telescope</span>
          </Link>
          <div className="my-auto max-w-[650px] py-8">
            <p className="rise font-mono text-[10px] uppercase tracking-[0.2em] text-accent-lit" style={{ animationDelay: "80ms" }}>Your private archive</p>
            <h1 className="rise mt-5 font-display text-[clamp(3.7rem,8vw,7.5rem)] leading-[0.82] tracking-[-0.04em]" style={{ animationDelay: "150ms" }}>
              Come back to<br /><span className="italic text-accent-lit">what you noticed.</span>
            </h1>
            <AccountBenefits />
          </div>
        </section>
        <section className="flex items-center px-14 py-16 xl:px-20">
          <div className="rise w-full max-w-[460px]" style={{ animationDelay: "240ms" }}><AuthPanel /></div>
        </section>
      </div>
    </main>
  );
}

function AccountBenefits({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={`${compact ? "rise order-3" : "rise mt-10 max-w-[570px]"} border-t border-white/16`} style={{ animationDelay: "210ms" }} aria-label="Account benefits">
      {["Save your reports", "Create shareable links", "Unlock AI insights"].map((benefit) => (
        <li key={benefit} className={`flex items-center border-b border-white/14 font-display leading-none text-white/82 ${compact ? "gap-3 py-3 text-[clamp(1.3rem,4vw,1.75rem)]" : "gap-4 py-4 text-[clamp(1.55rem,3vw,2.35rem)]"}`}>
          <span aria-hidden="true" className="text-[.72em] text-accent-lit">→</span>
          <span>{benefit}</span>
        </li>
      ))}
    </ul>
  );
}

function AuthPanel({ showSupporting = true }: { showSupporting?: boolean }) {
  return (
    <>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-lit">Log in or create an account</p>
      <h2 className="mt-4 font-display text-[38px] leading-tight sm:text-[48px]">Continue with Google.</h2>
      <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-white/55">One secure step. No password to remember, and no separate sign-up form.</p>
      <form action={signInWithGoogle} className="mt-8">
        <button className="group flex w-full items-center justify-between rounded-full bg-white px-6 py-4 text-left text-sm font-semibold text-night transition duration-300 hover:-translate-y-0.5 hover:bg-accent-lit">
          <span className="flex items-center gap-3"><GoogleMark /> Continue with Google</span>
          <span className="text-lg transition-transform group-hover:translate-x-1">→</span>
        </button>
      </form>
      {showSupporting && <>
        <div className="mt-7 flex items-start gap-3 border-t border-white/14 pt-5 text-xs leading-relaxed text-white/42">
          <Shield />
          <p>Signing in saves completed model-assisted reports. Local analysis files are still processed in your browser.</p>
        </div>
        <Link href={siteUrl} className="mt-7 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 transition hover:text-white">← Back home</Link>
      </>}
    </>
  );
}

function GoogleMark() {
  return <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full border border-night/15 font-sans text-xs font-bold">G</span>;
}
