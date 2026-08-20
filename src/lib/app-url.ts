const configuredAppOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

/** Public dashboard URL. Falls back to the legacy path during local development. */
export function dashboardUrl(path = ""): string {
  const suffix = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return configuredAppOrigin ? `${configuredAppOrigin}${suffix}` : `/app${suffix}`;
}

/** Public URL for app-owned routes that never had an /app prefix. */
export function applicationUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return configuredAppOrigin ? `${configuredAppOrigin}${suffix}` : suffix;
}
