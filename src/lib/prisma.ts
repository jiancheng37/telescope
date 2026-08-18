import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Bump the development cache key when a regenerated client changes shape. A
// Next.js dev process survives module reloads, so the previous `prisma` global
// could otherwise keep serving the pre-sharing client until a manual restart.
const globalForPrisma = globalThis as unknown as { prismaWithSharing?: PrismaClient };

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export const prisma = globalForPrisma.prismaWithSharing ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaWithSharing = prisma;
