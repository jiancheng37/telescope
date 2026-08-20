import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingFlow } from "./OnboardingFlow";
import type { Metadata } from "next";
import { applicationUrl, dashboardUrl } from "@/lib/app-url";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(applicationUrl("/sign-in"));
  const profile = await prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } });
  if (profile?.reportName) redirect(dashboardUrl());
  return <OnboardingFlow suggestedName={session.user.name ?? ""} />;
}
