"use client";

import HomeClient, { type Viewer } from "@/app/HomeClient";
import { useAppIdentity } from "../AppShell";

export default function NewAnalysisPage() {
  const { name } = useAppIdentity();
  const viewer: NonNullable<Viewer> = { name, image: null, reports: [] };

  return <HomeClient viewer={viewer} startView="workspace" />;
}
