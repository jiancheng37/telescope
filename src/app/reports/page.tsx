import { redirect } from "next/navigation";
import { dashboardUrl } from "@/lib/app-url";

export default function ReportsPage() {
  redirect(dashboardUrl());
}
