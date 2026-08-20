import type { NextConfig } from "next";

/**
 * Nothing to configure.
 *
 * Large Telegram exports bypass Next.js: the signed-in app creates an analysis
 * job, then the browser uploads directly to private S3. The ECS worker owns the
 * LLM pipeline, so there is no request-body limit to raise in this deployment.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
