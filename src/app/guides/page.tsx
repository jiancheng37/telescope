import type { Metadata } from "next";
import Link from "next/link";
import { ArticleHero } from "./GuideChrome";

export const metadata: Metadata = {
  title: "Telegram Conversation Guides",
  description: "Practical guides to exporting, understanding, and privately analyzing your Telegram conversation history.",
  alternates: { canonical: "/guides" },
};

const guides = [
  { n: "01", href: "/guides/export-telegram-chat", label: "Export", title: "How to export a Telegram chat as JSON", copy: "The exact Desktop steps, which options matter, and what to do with the folder afterward.", time: "5 min" },
  { n: "02", href: "/guides/chat-analysis-methodology", label: "Method", title: "What Telegram chat analysis can actually measure", copy: "A plain-language map of rhythms, silences, language signals, and the limits of interpretation.", time: "7 min" },
  { n: "03", href: "/guides/private-chat-analysis", label: "Privacy", title: "How to analyze a chat without giving it away", copy: "What local-first processing means, what stays on your machine, and when data can leave it.", time: "6 min" },
] as const;

export default function GuidesPage() {
  return (
    <>
      <ArticleHero kicker="Telescope field notes" title={<>Read the archive.<br /><span className="italic text-accent-lit">Keep the context.</span></>} intro="Practical notes for getting a Telegram history out, reading its patterns responsibly, and keeping private conversation private." meta="Three guides · independently useful" />
      <section className="bg-surface px-5 py-16 sm:px-10 sm:py-24 xl:px-16">
        <div className="mx-auto max-w-[1180px] border-t border-ink/18">
          {guides.map((guide) => (
            <Link key={guide.href} href={guide.href} className="group grid gap-4 border-b border-ink/14 py-9 sm:grid-cols-[50px_120px_minmax(0,1fr)_70px] sm:items-start sm:py-12">
              <span className="font-mono text-[10px] text-ink/30">{guide.n}</span>
              <span className="font-mono text-[10px] uppercase tracking-[.18em] text-accent-deep">{guide.label}</span>
              <span><span className="block max-w-[700px] font-display text-[clamp(2rem,4vw,3.5rem)] leading-[.95] transition-transform duration-300 group-hover:translate-x-2">{guide.title}</span><span className="mt-4 block max-w-[58ch] text-sm leading-relaxed text-ink/55">{guide.copy}</span></span>
              <span className="font-mono text-[10px] text-ink/35 sm:text-right">{guide.time} ↗</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
