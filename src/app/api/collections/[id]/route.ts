import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to edit collections." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 20) : "";
  if (!name) return NextResponse.json({ error: "Collection name is required." }, { status: 400 });
  try {
    const changed = await prisma.collection.updateMany({ where: { id, userId: session.user.id }, data: { name } });
    if (!changed.count) return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "A collection with that name already exists." }, { status: 409 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to delete collections." }, { status: 401 });
  const { id } = await params;
  const deleted = await prisma.collection.deleteMany({ where: { id, userId: session.user.id } });
  if (!deleted.count) return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
