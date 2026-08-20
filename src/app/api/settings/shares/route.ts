import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to manage sharing." }, { status: 401 });
  const result = await prisma.report.updateMany({ where: { userId: session.user.id, OR: [{ shareToken: { not: null } }, { shareMessagesToken: { not: null } }] }, data: { shareToken: null, shareMessagesToken: null, sharedEvidence: Prisma.DbNull } });
  return NextResponse.json({ revoked: result.count });
}
