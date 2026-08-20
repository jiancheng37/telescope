import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * Nothing to configure.
 *
 * Large Telegram exports bypass Next.js: the signed-in app creates an analysis
 * job, then the browser uploads directly to private S3. The ECS worker owns the
 * LLM pipeline, so there is no request-body limit to raise in this deployment.
 */
const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
