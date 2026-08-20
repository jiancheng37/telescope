"use client";

import { useEffect } from "react";

export function PreferenceHydrator() {
  useEffect(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as { reducedMotion?: boolean; largerText?: boolean; dashboardDark?: boolean };
      document.documentElement.classList.toggle("telescope-reduce-motion", Boolean(preferences.reducedMotion));
      document.documentElement.classList.toggle("telescope-large-text", Boolean(preferences.largerText));
      document.documentElement.classList.toggle("telescope-dashboard-dark", preferences.dashboardDark !== false);
    } catch { /* Browser preferences are optional. */ }
  }, []);
  return null;
}
