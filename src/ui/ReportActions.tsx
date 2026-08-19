"use client";

import { useState } from "react";

export function ReportActions({ reportId, publicPath }: { reportId?: string; publicPath?: string }) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "error">("idle");

  const share = async () => {
    if (!publicPath) {
      try {
        const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as { confirmSharing?: boolean };
        if (preferences.confirmSharing !== false && !window.confirm("Create a public link to this report? Anyone with the link can view it.")) return;
      } catch {
        if (!window.confirm("Create a public link to this report? Anyone with the link can view it.")) return;
      }
    }
    setState("working");
    try {
      let path = publicPath;
      if (!path && reportId) {
        const response = await fetch(`/api/reports/${reportId}/share`, { method: "POST" });
        if (!response.ok) throw new Error("Could not create link");
        path = ((await response.json()) as { path: string }).path;
      }
      if (!path) throw new Error("Save this report before sharing it");
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setState("copied");
      window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="report-actions flex flex-wrap gap-3">
      {(reportId || publicPath) && <button type="button" onClick={share} disabled={state === "working"} className="report-action-button">▣ <span>{state === "copied" ? "Link copied" : state === "error" ? "Try sharing again" : state === "working" ? "Creating link" : "Share report"}</span></button>}
    </div>
  );
}
