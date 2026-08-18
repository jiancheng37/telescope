import type { NextConfig } from "next";

/**
 * Nothing to configure.
 *
 * The export is only uploaded for the optional LLM pass, and it goes to a route
 * handler (`src/app/api/wrapped/route.ts`), which streams the request body with no
 * size cap of its own — so there is no `bodySizeLimit` to raise here. That setting
 * governs server actions, which this app doesn't use. Whatever limit a deployment
 * imposes is the platform's, and belongs in the platform's config.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
