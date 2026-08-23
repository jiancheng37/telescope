import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to view identity settings." }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { telegramSenderId: true } });
  return NextResponse.json({ telegramSenderId: user?.telegramSenderId ?? null });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to save Telegram identity." }, { status: 401 });
  const body = await request.json().catch(() => null) as { telegramSenderId?: unknown } | null;
  const telegramSenderId = typeof body?.telegramSenderId === "string" ? body.telegramSenderId.trim().slice(0, 100) : "";
  if (!/^user\d+$/.test(telegramSenderId)) return NextResponse.json({ error: "That Telegram sender ID is invalid." }, { status: 400 });
  await prisma.user.update({ where: { id: session.user.id }, data: { telegramSenderId } });
  return NextResponse.json({ telegramSenderId });
}
