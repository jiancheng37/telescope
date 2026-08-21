import type { ReactNode } from "react";
import { GuideFooter, GuideHeader } from "@/app/guides/GuideChrome";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main>
      <GuideHeader />
      {children}
      <GuideFooter />
    </main>
  );
}
