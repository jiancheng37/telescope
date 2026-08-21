import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, Pill } from "@/ui/primitives";

export function GuideHeader() {
  return (
    <header className="starfield relative z-10 flex h-[72px] items-center justify-between overflow-hidden border-b border-white/12 bg-night px-5 text-white sm:px-10 xl:px-16">
      <Link href="/" className="relative flex items-center gap-2.5">
        <Logo size={25} tone="night" />
        <span className="font-display text-[24px]">Telescope</span>
      </Link>
      <nav aria-label="Guide navigation" className="relative flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.16em]">
        <Link href="/guides" className="text-white/55 transition hover:text-white">Field notes</Link>
        <Link href="/#drop" className="text-accent-lit transition hover:text-white">Analyze a chat</Link>
      </nav>
    </header>
  );
}

export function GuideFooter() {
  return (
    <footer className="starfield relative overflow-hidden bg-night px-5 py-14 text-white sm:px-10 xl:px-16">
      <div className="relative mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-8 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2.5"><Logo size={24} tone="night" /><span className="font-display text-2xl">Telescope</span></div>
          <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-white/48">An instrument for reading your own messages. Not affiliated with Telegram.</p>
        </div>
        <Link href="/#home-hero"><Pill tone="hollow-night">Point it at a chat →</Pill></Link>
      </div>
    </footer>
  );
}

export function ArticleHero({ kicker, title, intro, meta }: { kicker: string; title: ReactNode; intro: string; meta: string }) {
  return (
    <section className="starfield relative overflow-hidden bg-night px-5 pb-20 text-white sm:px-10 sm:pb-28 xl:px-16">
      <div className="relative mx-auto max-w-[1180px] border-l border-white/12 pt-16 pl-5 sm:pt-24 sm:pl-10">
        <p className="rise font-mono text-[10px] uppercase tracking-[0.2em] text-accent-lit">{kicker}</p>
        <h1 className="rise mt-7 max-w-[980px] font-display text-[clamp(3.4rem,8vw,7.8rem)] leading-[0.84] tracking-[-0.04em]" style={{ animationDelay: "80ms" }}>{title}</h1>
        <div className="rise mt-10 grid gap-5 border-t border-white/14 pt-6 md:grid-cols-[minmax(0,620px)_1fr]" style={{ animationDelay: "150ms" }}>
          <p className="text-lg leading-relaxed text-white/65">{intro}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/32 md:text-right">{meta}</p>
        </div>
      </div>
    </section>
  );
}

export function ArticleLayout({ children, toc }: { children: ReactNode; toc: Array<{ href: string; label: string }> }) {
  return (
    <div className="bg-surface px-5 py-16 sm:px-10 sm:py-24 xl:px-16">
      <div className="mx-auto grid max-w-[1180px] gap-14 lg:grid-cols-[220px_minmax(0,720px)] lg:justify-between">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">On this page</p>
          <nav className="mt-5 flex flex-col border-t border-ink/14 text-sm" aria-label="On this page">
            {toc.map((item, index) => <a key={item.href} href={item.href} className="group flex gap-3 border-b border-ink/10 py-3.5 text-ink/55 transition hover:text-ink"><span className="font-mono text-[10px] text-ink/28">{String(index + 1).padStart(2, "0")}</span><span>{item.label}</span></a>)}
          </nav>
        </aside>
        <article className="min-w-0 space-y-16 [&_a]:text-accent-deep [&_a]:underline [&_a]:underline-offset-4 [&_h2]:scroll-mt-8 [&_h2]:font-display [&_h2]:text-[clamp(2.3rem,5vw,4rem)] [&_h2]:leading-[.95] [&_h3]:font-display [&_h3]:text-2xl [&_li]:leading-relaxed [&_p]:text-[16px] [&_p]:leading-[1.8] [&_p]:text-ink/72">
          {children}
        </article>
      </div>
    </div>
  );
}

export function ArticleCta({ title, body }: { title: string; body: string }) {
  return (
    <section className="border-y border-ink/14 py-10">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">Try it with your history</p>
      <h2 className="mt-4">{title}</h2>
      <p className="mt-5 max-w-[55ch]">{body}</p>
      <Link href="/#home-hero" className="mt-7 inline-flex no-underline"><Pill>Analyze a Telegram chat →</Pill></Link>
    </section>
  );
}
