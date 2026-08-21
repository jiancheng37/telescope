import type { Metadata } from "next";
import { ArticleHero, ArticleLayout } from "@/app/guides/GuideChrome";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Telescope handles conversation exports, reports, account data, and optional AI analysis.",
  alternates: { canonical: "/privacy" },
};

const toc = [
  { href: "#overview", label: "The short version" },
  { href: "#collect", label: "What we collect" },
  { href: "#local", label: "Local analysis" },
  { href: "#ai", label: "Optional AI" },
  { href: "#retention", label: "Storage and deletion" },
  { href: "#providers", label: "Service providers" },
  { href: "#choices", label: "Your choices" },
  { href: "#updates", label: "Policy updates" },
];

export default function PrivacyPage() {
  return <>
    <ArticleHero kicker="Terms & policies · 02" title={<>Privacy, without the <span className="italic text-accent-lit">fog.</span></>} intro="A precise account of what stays in your browser, what is uploaded only when you ask for AI insights, and what remains in a saved report." meta="Effective 21 August 2026" />
    <ArticleLayout toc={toc}>
      <section id="overview"><h2>The short version.</h2><p className="mt-5">The ordinary numerical report is calculated in your browser. Your raw Telegram export is not uploaded for that analysis. Signing in lets you save the computed report, not the complete export.</p><div className="mt-7 border-l-2 border-safe bg-safe/10 px-5 py-4 text-sm leading-relaxed text-safe-deep">Only requesting additional AI insights starts a server upload. That choice is separate, labelled, and optional.</div></section>
      <section id="collect"><h2>What Telescope collects.</h2><p className="mt-5">If you sign in with Google, Telescope receives basic account information such as your name, email address, and profile image, together with the identifiers needed to maintain your account and session. Telescope never receives your Google password.</p><p className="mt-5">When you save a report, Telescope stores its computed analysis and report settings. If you request AI insights, the saved report may also include AI output and exact message excerpts selected as evidence. Telescope may process limited technical, security, rate-limit, and error information needed to operate and protect the service.</p></section>
      <section id="local"><h2>Local means in this tab.</h2><p className="mt-5">For numerical analysis, the browser reads the selected export into memory and performs the calculations on your device. Closing or refreshing the page clears an unsaved in-memory analysis. If you are signed in and choose to save, the resulting aggregates and report data are stored with your account; the full source export is not.</p></section>
      <section id="ai"><h2>AI insight is an explicit upload.</h2><p className="mt-5">When you request additional AI insights, the browser uploads the raw export directly to private encrypted cloud storage through a short-lived upload link. A processing worker downloads and reparses it, then sends a sampled selection of conversation text to OpenAI to produce the requested insight.</p><p className="mt-5">Telescope does not use your conversation to train its own model. OpenAI states that API inputs and outputs are not used to train its models by default unless the API customer opts in. OpenAI may retain API content for safety and abuse monitoring under its own data controls; read <a href="https://platform.openai.com/docs/models/default-usage-policies-by-endpoint" target="_blank" rel="noreferrer">OpenAI’s current API data controls</a> for details.</p></section>
      <section id="retention"><h2>Kept only for its job.</h2><p className="mt-5">Telescope deletes the raw cloud export after successful AI processing or after a final processing failure. A storage lifecycle rule removes any raw export that remains within one day as a backstop. The generated AI output and exact excerpts used as evidence may remain in the saved report until you delete that report or your account.</p><p className="mt-5">Saved reports and collections remain associated with your account until you delete them. Public share links remain usable until you revoke them or delete the underlying report. Operational logs and backups may persist for limited periods where reasonably necessary for security, recovery, and legal compliance.</p></section>
      <section id="providers"><h2>The services involved.</h2><p className="mt-5">Telescope uses service providers to run the product: Google for sign-in; hosting and database providers for the website, accounts, and saved reports; Amazon Web Services for optional AI upload and processing infrastructure; OpenAI for optional AI insights; Upstash for rate limiting; and Sentry for error monitoring.</p><p className="mt-5">These providers process information only for the relevant service function and under their own terms and privacy commitments. Telescope may also disclose information when required by law, to protect people or the service, or as part of a business transfer subject to appropriate safeguards. Telescope does not sell conversation content.</p></section>
      <section id="choices"><h2>You remain in control.</h2><p className="mt-5">You can use local numerical analysis without an account, decline AI insights, choose whether message evidence appears on a shared report, revoke share links, delete reports and collections, or delete your entire account from Settings.</p><p className="mt-5">Depending on where you live, you may also have legal rights to access, correct, delete, restrict, or receive a copy of personal information. The in-product account controls are the fastest way to remove stored Telescope data.</p></section>
      <section id="updates"><h2>If this policy changes.</h2><p className="mt-5">This policy may change as Telescope’s features, providers, or legal obligations develop. Material changes will be reflected here with a new effective date. Review this page when you want the current description of how the service handles data.</p></section>
    </ArticleLayout>
  </>;
}
