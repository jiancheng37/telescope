import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to manage sharing." }, { status: 401 });
  const result = await prisma.report.updateMany({ where: { userId: session.user.id, shareToken: { not: null } }, data: { shareToken: null } });
  return NextResponse.json({ revoked: result.count });
}
