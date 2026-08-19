import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "./AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const profile = await prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } });
  if (!profile?.reportName) redirect("/onboarding");
  return <AppShell initialName={profile.reportName}>{children}</AppShell>;
}
