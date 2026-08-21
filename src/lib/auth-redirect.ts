import { siteUrl } from "@/lib/site-url";

/** Allow Auth.js to cross only between Telescope's trusted public and app origins. */
export function trustedAuthRedirect({ url, baseUrl }: { url: string; baseUrl: string }): string {
  const destination = new URL(url, baseUrl);
  const marketingUrl = process.env.NEXT_PUBLIC_SITE_URL ?? siteUrl;
  const allowedOrigins = new Set([baseUrl, new URL(marketingUrl).origin]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) allowedOrigins.add(new URL(appUrl).origin);
  return allowedOrigins.has(destination.origin) ? destination.toString() : baseUrl;
}
