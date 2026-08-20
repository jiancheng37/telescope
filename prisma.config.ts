import * as nextEnv from "@next/env";
import { defineConfig, env } from "prisma/config";

const { loadEnvConfig } = nextEnv;

// Prisma CLI runs outside Next.js. Explicit migration scripts set NODE_ENV so
// the CLI reads .env.development.local locally and production secrets in CI.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Runtime traffic uses the pooled URL; migrations need a direct connection.
  // Falling back keeps local setups created before DIRECT_URL was introduced
  // usable until they add the second credential.
  datasource: { url: process.env.DIRECT_URL ?? env("DATABASE_URL") },
});
