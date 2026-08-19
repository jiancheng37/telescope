import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingFlow } from "./OnboardingFlow";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const profile = await prisma.user.findUnique({ where: { id: session.user.id }, select: { reportName: true } });
  if (profile?.reportName) redirect("/app");
  return <OnboardingFlow suggestedName={session.user.name ?? ""} />;
}
