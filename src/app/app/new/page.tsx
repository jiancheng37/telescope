import { redirect } from "next/navigation";
import { auth } from "@/auth";
import HomeClient, { type Viewer } from "@/app/HomeClient";

export default async function NewAnalysisPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const viewer: NonNullable<Viewer> = {
    name: session.user.name ?? session.user.email ?? "You",
    image: session.user.image ?? null,
    reports: [],
  };

  return <HomeClient viewer={viewer} startView="workspace" />;
}
