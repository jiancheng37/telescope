import type { Metadata } from "next";
import { ArticleCta, ArticleHero, ArticleLayout } from "../GuideChrome";

export const metadata: Metadata = {
  title: "Telegram Chat Analysis Methodology",
  description: "Learn what conversation statistics can measure, how Telescope analyzes Telegram chats, and where interpretation should stop.",
  alternates: { canonical: "/guides/chat-analysis-methodology" },
};

const toc = [{ href: "#measure", label: "What can be measured" }, { href: "#meaning", label: "Numbers and meaning" }, { href: "#language", label: "Language signals" }, { href: "#limits", label: "Limits" }];

export default function MethodologyGuide() {
  return <><ArticleHero kicker="Field note 02 · Method" title={<>What chat analysis can <span className="italic text-accent-lit">actually measure.</span></>} intro="A conversation leaves a statistical shape. The useful work is describing that shape without pretending it explains the whole relationship." meta="Methodology · 7 min read" /><ArticleLayout toc={toc}>
    <section id="measure"><h2>Messages become events in time.</h2><p className="mt-5">Each message has a sender, timestamp, content, and sometimes a reply or media type. From those facts, analysis can count volume, compare active hours, group messages into sessions, identify long silences, and measure who tends to restart after a meaningful gap.</p><div className="mt-8 grid gap-px overflow-hidden rounded-xl bg-ink/14 sm:grid-cols-3">{[["Rhythm", "When messages happen"], ["Reciprocity", "How turns and sessions move"], ["Language", "Which words become distinctive"]].map(([title, copy]) => <div key={title} className="bg-shade p-5"><p className="font-display text-2xl text-ink">{title}</p><p className="mt-2 text-sm">{copy}</p></div>)}</div></section>
    <section id="meaning"><h2>A gap is a duration, not a verdict.</h2><p className="mt-5">Forty quiet days can be measured exactly. Why they happened cannot. Travel, another messaging app, an in-person life, conflict, or simple drift can produce the same number.</p><p className="mt-5">Telescope separates calculation from interpretation. The local report states measured patterns. Optional AI writing can suggest a reading, but its claims are checked against quotations and should still be treated as interpretation—not diagnosis or fact.</p></section>
    <section id="language"><h2>Distinctive does not mean frequent.</h2><p className="mt-5">The most common words in almost every chat are ordinary connective words. More revealing language is often disproportionately used by one person, concentrated in one era, or unusually common inside this conversation.</p><p className="mt-5">That is why useful analysis compares rates rather than simply producing a word cloud. It can surface recurring phrases, vocabulary shifts, question patterns, message lengths, and language that appears only after the conversation has developed.</p></section>
    <section id="limits"><h2>The archive has edges.</h2><ul className="mt-6 space-y-4 border-t border-ink/14 pt-5"><li><strong>Deleted messages are absent.</strong> The export cannot measure what is no longer there.</li><li><strong>Other channels are invisible.</strong> Calls, in-person time, and conversations elsewhere change the meaning of the record.</li><li><strong>Media has less text.</strong> A sticker or voice note registers as an event but cannot always contribute the same linguistic detail.</li><li><strong>Metrics are not moral scores.</strong> More messages, faster replies, or more restarts do not automatically mean greater care.</li></ul></section>
    <ArticleCta title="Use the numbers as a way back in." body="A good report makes the archive easier to revisit. It does not claim to know more than the messages can support." />
  </ArticleLayout></>;
}
