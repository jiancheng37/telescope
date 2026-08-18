import { auth } from "@/auth";
import HomeClient, { type Viewer } from "./HomeClient";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export default async function Page() {
  const session = await auth();
  let viewer: Viewer = null;

  if (session?.user?.id) {
    const reports = await prisma.report.findMany({
        where: { userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, title: true, participantA: true, participantB: true, createdAt: true },
      });
    viewer = {
      name: session.user.name ?? session.user.email ?? "You",
      image: session.user.image ?? null,
      reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  }

  return <HomeClient viewer={viewer} />;
}
