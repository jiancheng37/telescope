import type { Metadata } from "next";
import { ArticleHero, ArticleLayout } from "@/app/guides/GuideChrome";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "Rules for using Telescope safely and responsibly.",
  alternates: { canonical: "/acceptable-use" },
};

const toc = [
  { href: "#principle", label: "The principle" },
  { href: "#content", label: "Conversation content" },
  { href: "#service", label: "Service integrity" },
  { href: "#sharing", label: "Sharing reports" },
  { href: "#enforcement", label: "Enforcement" },
];

export default function AcceptableUsePage() {
  return <>
    <ArticleHero kicker="Terms & policies · 03" title={<>Acceptable <span className="italic text-accent-lit">use.</span></>} intro="Telescope is built for reflection, not surveillance. These boundaries protect the people inside a conversation and the service around it." meta="Effective 21 August 2026" />
    <ArticleLayout toc={toc}>
      <section id="principle"><h2>Look back responsibly.</h2><p className="mt-5">Use Telescope only for conversations you are entitled to access and process. A technically accessible export is not automatically one you have permission to analyse or disclose.</p></section>
      <section id="content"><h2>Respect the people in the chat.</h2><p className="mt-5">Do not use Telescope to invade privacy, stalk, harass, threaten, discriminate against, exploit, or deceive another person. Do not submit unlawfully obtained content or material that violates intellectual property, confidentiality, data protection, or other rights.</p><p className="mt-5">Do not use a report as the sole basis for a high-impact decision about another person. Numerical patterns and AI interpretations can miss context and should not be presented as objective psychological, medical, legal, employment, credit, housing, or eligibility assessments.</p></section>
      <section id="service"><h2>Do not damage the instrument.</h2><p className="mt-5">Do not introduce malicious code, probe for vulnerabilities without written permission, interfere with availability, access another account, scrape the service at unreasonable volume, bypass safeguards or rate limits, reverse engineer protected parts of the service, or automate access in a way that burdens Telescope or other users.</p></section>
      <section id="sharing"><h2>A shared link is a disclosure.</h2><p className="mt-5">Before sharing, review the report and any exact message evidence it contains. Do not publish private or identifying material without the rights and permissions required to do so. Assume anyone with a public link can copy or forward what they see.</p></section>
      <section id="enforcement"><h2>When a boundary is crossed.</h2><p className="mt-5">Telescope may limit, suspend, or end access, revoke public links, or preserve and disclose relevant information when reasonably necessary to investigate misuse, protect people or the service, or comply with law. Enforcement will be proportionate where circumstances allow.</p><p className="mt-5">This policy forms part of the <a href="/terms">Terms of Use</a>.</p></section>
    </ArticleLayout>
  </>;
}
