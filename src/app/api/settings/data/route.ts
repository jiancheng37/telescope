import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to manage your data." }, { status: 401 });
  const body = await request.json().catch(() => null) as { scope?: unknown } | null;
  if (body?.scope === "reports") {
    const result = await prisma.report.deleteMany({ where: { userId: session.user.id } });
    return NextResponse.json({ deleted: result.count });
  }
  if (body?.scope === "collections") {
    const result = await prisma.collection.deleteMany({ where: { userId: session.user.id } });
    return NextResponse.json({ deleted: result.count });
  }
  return NextResponse.json({ error: "Unknown deletion scope." }, { status: 400 });
}
