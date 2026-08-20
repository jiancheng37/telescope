import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl, changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl}/guides`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/guides/export-telegram-chat`, changeFrequency: "yearly", priority: 0.8 },
    { url: `${siteUrl}/guides/chat-analysis-methodology`, changeFrequency: "yearly", priority: 0.7 },
    { url: `${siteUrl}/guides/private-chat-analysis`, changeFrequency: "yearly", priority: 0.7 },
  ];
}
