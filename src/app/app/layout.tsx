import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "./AppShell";
import type { Metadata } from "next";
import { applicationUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect(applicationUrl("/sign-in"));
  const profile = await prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } });
  if (!profile?.reportName) redirect(applicationUrl("/onboarding"));
  return <AppShell initialName={profile.reportName}>{children}</AppShell>;
}
