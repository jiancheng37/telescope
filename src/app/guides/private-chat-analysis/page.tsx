import type { Metadata } from "next";
import { ArticleCta, ArticleHero, ArticleLayout } from "../GuideChrome";

export const metadata: Metadata = {
  title: "How to Analyze a Telegram Chat Privately",
  description: "Understand local-first Telegram chat analysis, what stays in your browser, and what to check before using AI or sharing a report.",
  alternates: { canonical: "/guides/private-chat-analysis" },
};

const toc = [{ href: "#local", label: "Local-first analysis" }, { href: "#account", label: "Accounts and saving" }, { href: "#ai", label: "Optional AI" }, { href: "#checklist", label: "Privacy checklist" }];

export default function PrivacyGuide() {
  return <><ArticleHero kicker="Field note 03 · Privacy" title={<>Analyze a chat without <span className="italic text-accent-lit">giving it away.</span></>} intro="Conversation exports contain names, dates, locations, private jokes, and years of context. Treat the file as sensitive before you choose any tool." meta="Privacy guide · 6 min read" /><ArticleLayout toc={toc}>
    <section id="local"><h2>Local-first means the file stays here.</h2><p className="mt-5">A browser can read and calculate over a file without uploading it. In Telescope’s local analysis, the export is parsed in the page’s memory on your device. Counts and charts are created there; the raw conversation does not need to cross the network.</p><div className="mt-7 border-l-2 border-safe bg-safe/10 px-5 py-4 text-sm leading-relaxed text-safe-deep">You can use the numerical report without an account. Closing or refreshing the tab clears that unsaved in-memory analysis.</div></section>
    <section id="account"><h2>Saving a result is different from uploading a source.</h2><p className="mt-5">When you sign in, Telescope can save the completed numerical analysis so you can return to it. That result contains aggregates and report data; it is not the original Telegram export.</p><p className="mt-5">Shared links are another separate choice. Treat every public link as something its recipient could forward, and review whether message evidence is included before sending it.</p></section>
    <section id="ai"><h2>AI reading is an explicit upload.</h2><p className="mt-5">A model cannot interpret the writing without receiving conversation content. Telescope keeps that step separate from local analysis and labels it before it happens. If you do not request AI insights, the numerical report remains usable without that upload.</p><p className="mt-5">This distinction is worth checking in any chat-analysis product: “private” can describe account access while the raw file is still processed on a server. Look for a precise explanation of where parsing occurs and which actions initiate network requests.</p></section>
    <section id="checklist"><h2>Before choosing a conversation.</h2><ol className="mt-7 border-t border-ink/16">{["Use a device you trust and remove old exports when you no longer need them.", "Check whether the tool processes the raw file locally or uploads it by default.", "Treat AI analysis as data sharing and decide whether the conversation is appropriate to send.", "Review message visibility before creating or forwarding a shared report.", "Remember that the other person did not write their messages for an analytics system."].map((step, index) => <li key={step} className="grid grid-cols-[42px_1fr] gap-4 border-b border-ink/12 py-5"><span className="font-display text-2xl text-accent-deep">{String(index + 1).padStart(2, "0")}</span><span>{step}</span></li>)}</ol></section>
    <ArticleCta title="Start with the local report." body="Choose a Telegram export folder and inspect the numerical analysis before deciding whether you want any optional AI reading." />
  </ArticleLayout></>;
}
