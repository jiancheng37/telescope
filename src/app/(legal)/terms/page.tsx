import type { Metadata } from "next";
import { ArticleHero, ArticleLayout } from "@/app/guides/GuideChrome";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms that govern your use of Telescope.",
  alternates: { canonical: "/terms" },
};

const toc = [
  { href: "#agreement", label: "Your agreement" },
  { href: "#service", label: "The service" },
  { href: "#content", label: "Your content" },
  { href: "#accounts", label: "Accounts and sharing" },
  { href: "#acceptable-use", label: "Acceptable use" },
  { href: "#disclaimers", label: "Disclaimers" },
  { href: "#changes", label: "Changes and ending use" },
];

export default function TermsPage() {
  return <>
    <ArticleHero kicker="Terms & policies · 01" title={<>Terms of <span className="italic text-accent-lit">use.</span></>} intro="The ground rules for using Telescope, uploading a conversation, saving a report, and sharing what comes back." meta="Effective 21 August 2026" />
    <ArticleLayout toc={toc}>
      <section id="agreement"><h2>A clear agreement.</h2><p className="mt-5">By accessing or using Telescope, you agree to these Terms and the <a href="/privacy">Privacy Policy</a>. If you use Telescope for someone else or for an organisation, you confirm that you have authority to accept these Terms for them.</p><p className="mt-5">You must be legally able to enter this agreement where you live. If you cannot, do not use the service without the involvement and permission of a parent, guardian, or other authorised person.</p></section>
      <section id="service"><h2>An instrument, not an authority.</h2><p className="mt-5">Telescope turns supported conversation exports into numerical analysis and, when you explicitly request it, additional AI-generated insights. Results may be incomplete, inaccurate, or open to interpretation. They are not statements of fact, professional advice, or a substitute for your own judgment.</p><p className="mt-5">The service may change, pause, or discontinue features as it develops. We do not promise that Telescope will always be available, error-free, or compatible with every export.</p></section>
      <section id="content"><h2>The conversation remains yours.</h2><p className="mt-5">You retain your rights in content you provide. You give Telescope only the limited permission needed to process that content, generate the features you request, save a report when you choose to, and display it to people you deliberately share it with.</p><p className="mt-5">A conversation normally includes another person’s words. You are responsible for having the rights and permissions needed to process, save, and share it. Choose chats thoughtfully, avoid unnecessary sensitive material, and do not use Telescope to violate another person’s privacy or rights.</p></section>
      <section id="accounts"><h2>Your account. Your links.</h2><p className="mt-5">Keep access to your Google account and Telescope session secure. Activity performed through your account is your responsibility unless caused by Telescope itself.</p><p className="mt-5">A report link can be forwarded by anyone who receives it. You are responsible for deciding whether to create or send a link and whether to include message evidence. You can revoke a shared link or delete a saved report from your account.</p></section>
      <section id="acceptable-use"><h2>Use it with care.</h2><p className="mt-5">You may not use Telescope to break the law, invade someone’s privacy, harass or exploit another person, process content you have no right to use, distribute malware, probe or disrupt the service, evade access or rate limits, or help others do any of those things.</p><p className="mt-5">The fuller rules are in the <a href="/acceptable-use">Acceptable Use Policy</a>.</p></section>
      <section id="disclaimers"><h2>What we can promise—and what we cannot.</h2><p className="mt-5">Telescope is provided on an “as is” and “as available” basis to the extent permitted by applicable law. We disclaim implied warranties where the law allows, including merchantability, fitness for a particular purpose, and non-infringement.</p><p className="mt-5">To the extent permitted by applicable law, Telescope is not liable for indirect, incidental, special, consequential, or punitive loss, or for loss arising from your interpretation, disclosure, or use of a report. Nothing in these Terms excludes rights or liability that cannot legally be excluded.</p></section>
      <section id="changes"><h2>If these terms change.</h2><p className="mt-5">We may update these Terms when the service or legal requirements change. The effective date above will change with them. Continuing to use Telescope after updated Terms take effect means you accept the revised Terms.</p><p className="mt-5">You can stop using Telescope at any time and delete saved reports, collections, and your account in Settings. We may suspend access when reasonably necessary to protect people, the service, or comply with law.</p></section>
    </ArticleLayout>
  </>;
}
