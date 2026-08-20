import type { ReactNode } from "react";
import { GuideFooter, GuideHeader } from "./GuideChrome";

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return <main><GuideHeader />{children}<GuideFooter /></main>;
}
