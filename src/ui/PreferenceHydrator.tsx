"use client";

import { useEffect } from "react";

export function PreferenceHydrator() {
  useEffect(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem("telescope:preferences") ?? "{}") as { reducedMotion?: boolean; largerText?: boolean };
      document.documentElement.classList.toggle("telescope-reduce-motion", Boolean(preferences.reducedMotion));
      document.documentElement.classList.toggle("telescope-large-text", Boolean(preferences.largerText));
    } catch { /* Browser preferences are optional. */ }
  }, []);
  return null;
}
