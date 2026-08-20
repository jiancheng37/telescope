import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

describe("app subdomain routing", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://telescope.ink";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.telescope.ink";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it.each([
    ["/", "/app"],
    ["/new", "/app/new"],
    ["/settings", "/app/settings"],
  ])("rewrites app.telescope.ink%s internally to %s", (publicPath, internalPath) => {
    const response = proxy(new NextRequest(`https://app.telescope.ink${publicPath}`));
    expect(response.headers.get("x-middleware-rewrite")).toBe(`https://app.telescope.ink${internalPath}`);
  });

  it("redirects the old marketing-site dashboard URL", () => {
    const response = proxy(new NextRequest("https://telescope.ink/app/new?from=old"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.telescope.ink/new?from=old");
  });

  it("canonicalizes legacy /app URLs on the app host", () => {
    const response = proxy(new NextRequest("https://app.telescope.ink/app/settings"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.telescope.ink/settings");
  });

  it("moves account-owned routes off the marketing host", () => {
    const response = proxy(new NextRequest("https://telescope.ink/reports/abc?insights=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.telescope.ink/reports/abc?insights=1");
  });

  it("keeps local development unchanged without an app URL", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const response = proxy(new NextRequest("http://localhost:3000/app"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
