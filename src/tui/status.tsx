/** @jsxImportSource @opentui/react */
// Busy line shown while a claude call runs. Replaces the nanospinner path
// inside the interactive app (spinner.ts remains only for non-interactive
// modes). Ticks elapsed seconds itself.

import { useEffect, useState } from "react";
import { theme } from "./theme.ts";

export function statusText(elapsedSeconds: number, label: string): string {
  return `commit · ${elapsedSeconds}s · ${label || "working…"}`;
}

export function Status({ label, startedAt }: { label: string; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <text fg={theme.accent}>{statusText(elapsed, label)}</text>;
}
