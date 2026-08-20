import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to manage sharing." }, { status: 401 });
  const { id: shareId } = await params;
  const separator = shareId.lastIndexOf(":");
  const id = separator === -1 ? shareId : shareId.slice(0, separator);
  const variant = separator === -1 ? "public" : shareId.slice(separator + 1);
  const result = await prisma.report.updateMany({ where: { id, userId: session.user.id }, data: variant === "messages" ? { shareMessagesToken: null, sharedEvidence: Prisma.DbNull } : { shareToken: null } });
  if (!result.count) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
