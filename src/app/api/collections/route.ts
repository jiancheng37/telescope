import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to create collections." }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "Collection name is required." }, { status: 400 });
  try {
    const collection = await prisma.collection.create({ data: { userId: session.user.id, name }, select: { id: true, name: true } });
    return NextResponse.json({ ...collection, count: 0 }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A collection with that name already exists." }, { status: 409 });
  }
}
