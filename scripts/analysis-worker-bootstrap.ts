import nextEnv from "@next/env";

// ECS provides runtime variables directly. Local development instead loads the
// same .env.development.local precedence as `next dev` before worker imports
// instantiate Prisma and AWS clients.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

await import("./analysis-worker");
