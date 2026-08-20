import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/app/", "/onboarding/", "/reports/", "/share/", "/sign-in/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
