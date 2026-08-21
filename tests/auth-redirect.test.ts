import { afterEach, describe, expect, it } from "vitest";
import { trustedAuthRedirect } from "@/lib/auth-redirect";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

describe("trustedAuthRedirect", () => {
  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });

  it("allows sign-out to return from the app host to the marketing site", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.telescope.ink";
    process.env.NEXT_PUBLIC_SITE_URL = "https://telescope.ink";
    expect(
      trustedAuthRedirect({
        url: "https://telescope.ink",
        baseUrl: "https://app.telescope.ink",
      }),
    ).toBe("https://telescope.ink/");
  });

  it("allows relative callbacks on the current Auth.js origin", () => {
    expect(trustedAuthRedirect({ url: "/settings", baseUrl: "https://app.telescope.ink" })).toBe(
      "https://app.telescope.ink/settings",
    );
  });

  it("rejects redirects to any other origin", () => {
    expect(
      trustedAuthRedirect({ url: "https://example.com/phishing", baseUrl: "https://app.telescope.ink" }),
    ).toBe("https://app.telescope.ink");
  });
});
