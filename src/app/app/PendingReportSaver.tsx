"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "telescope:pending-analysis";

export function PendingReportSaver() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const pending = sessionStorage.getItem(STORAGE_KEY);
    if (!pending) return;
    started.current = true;

    void fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pending,
    }).then(async (response) => {
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage(body?.error ?? "Your report could not be saved.");
        return;
      }
      sessionStorage.removeItem(STORAGE_KEY);
      setMessage("Report saved to your dashboard.");
      router.refresh();
    }).catch(() => {
      setMessage("Your report could not be saved.");
    });
  }, [router]);

  if (!message) return null;
  return <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-night px-5 py-3 text-sm text-white shadow-xl">{message}</div>;
}
