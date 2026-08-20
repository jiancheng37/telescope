import { auth } from "@/auth";
import { redirect } from "next/navigation";
import HomeClient from "./HomeClient";

export default async function Page() {
  const session = await auth();
  if (session?.user?.id) redirect("/app");

  return <HomeClient viewer={null} />;
}
