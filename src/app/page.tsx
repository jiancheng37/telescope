import { auth } from "@/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/site-url";
import { dashboardUrl } from "@/lib/app-url";
import HomeClient from "./HomeClient";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Telescope",
  url: siteUrl,
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any modern web browser",
  description:
    "A private, local-first Telegram conversation analyzer that reveals chat rhythms, silences, language, and relationship patterns.",
  featureList: [
    "Local in-browser Telegram chat analysis",
    "Conversation rhythm and silence analysis",
    "Distinctive language and message pattern insights",
    "Optional evidence-checked AI reading",
  ],
};

export default async function Page() {
  const session = await auth();
  if (session?.user?.id) redirect(dashboardUrl());

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeClient viewer={null} />
    </>
  );
}
