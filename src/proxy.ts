import { NextResponse, type NextRequest } from "next/server";

function cleanLegacyAppPath(pathname: string): string {
  const clean = pathname.slice("/app".length);
  return clean || "/";
}

export function proxy(request: NextRequest) {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configuredAppUrl || !configuredSiteUrl) return NextResponse.next();

  const appOrigin = new URL(configuredAppUrl);
  const siteOrigin = new URL(configuredSiteUrl);
  if (appOrigin.host === siteOrigin.host) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const requestHost = request.nextUrl.host;

  if (requestHost === appOrigin.host) {
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const destination = new URL(cleanLegacyAppPath(pathname), appOrigin);
      destination.search = request.nextUrl.search;
      return NextResponse.redirect(destination, 308);
    }

    const internalPath =
      pathname === "/"
        ? "/app"
        : pathname === "/new" || pathname.startsWith("/new/")
          ? `/app${pathname}`
          : pathname === "/settings" || pathname.startsWith("/settings/")
            ? `/app${pathname}`
            : null;

    if (internalPath) {
      const destination = request.nextUrl.clone();
      destination.pathname = internalPath;
      return NextResponse.rewrite(destination);
    }

    if (pathname === "/guides" || pathname.startsWith("/guides/")) {
      const destination = new URL(`${pathname}${request.nextUrl.search}`, siteOrigin);
      return NextResponse.redirect(destination, 308);
    }
  }

  if (requestHost === siteOrigin.host) {
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const destination = new URL(cleanLegacyAppPath(pathname), appOrigin);
      destination.search = request.nextUrl.search;
      return NextResponse.redirect(destination, 308);
    }

    if (
      pathname === "/sign-in" ||
      pathname === "/onboarding" ||
      pathname === "/reports" ||
      pathname.startsWith("/reports/")
    ) {
      const destination = new URL(`${pathname}${request.nextUrl.search}`, appOrigin);
      return NextResponse.redirect(destination, 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
