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
    <main className="starfield relative grid min-h-dvh overflow-hidden bg-night text-white lg:grid-cols-[1.1fr_.9fr]">
      <section className="relative z-10 flex min-h-[48dvh] flex-col justify-between border-b border-white/12 px-6 py-7 sm:px-10 lg:min-h-dvh lg:border-b-0 lg:border-r xl:px-16">
        <Link href={siteUrl} className="rise flex w-fit items-center gap-2.5">
          <Logo size={26} tone="night" />
          <span className="font-display text-2xl">Telescope</span>
        </Link>

        <div className="max-w-[650px] py-16 lg:py-8">
          <p className="rise font-mono text-[10px] uppercase tracking-[0.2em] text-accent-lit" style={{ animationDelay: "80ms" }}>Your private archive</p>
          <h1 className="rise mt-5 font-display text-[clamp(3.7rem,8vw,7.5rem)] leading-[0.82] tracking-[-0.04em]" style={{ animationDelay: "150ms" }}>
            Come back to<br /><span className="italic text-accent-lit">what you noticed.</span>
          </h1>
        </div>

        <p className="hidden max-w-[40ch] text-sm leading-relaxed text-white/45 lg:block">Save reports, create shareable links and unlock model-assisted insights. Numerical analysis remains available without an account.</p>
      </section>

      <section className="relative z-10 flex items-center px-6 py-16 sm:px-10 lg:px-14 xl:px-20">
        <div className="rise w-full max-w-[460px]" style={{ animationDelay: "240ms" }}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Log in or create an account</p>
          <h2 className="mt-4 font-display text-[38px] leading-tight sm:text-[48px]">Continue with Google.</h2>
          <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-white/55">One secure step. No password to remember, and no separate sign-up form.</p>

          <form action={signInWithGoogle} className="mt-9">
            <button className="group flex w-full items-center justify-between rounded-full bg-white px-6 py-4 text-left text-sm font-semibold text-night transition duration-300 hover:-translate-y-0.5 hover:bg-accent-lit">
              <span className="flex items-center gap-3"><GoogleMark /> Continue with Google</span>
              <span className="text-lg transition-transform group-hover:translate-x-1">→</span>
            </button>
          </form>

          <div className="mt-8 flex items-start gap-3 border-t border-white/14 pt-6 text-xs leading-relaxed text-white/42">
            <Shield />
            <p>Signing in saves completed model-assisted reports. Local analysis files are still processed in your browser.</p>
          </div>
          <Link href={siteUrl} className="mt-8 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-white/40 transition hover:text-white">← Back home</Link>
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full border border-night/15 font-sans text-xs font-bold">G</span>;
}
