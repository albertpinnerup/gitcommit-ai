/** @jsxImportSource @opentui/react */
// Shown while the model plans commits — the interactive replacement for the
// nanospinner status line.

import { useState } from "react";
import { Status } from "./status.tsx";

export function PlanningScreen() {
  const [startedAt] = useState(Date.now());
  return <Status label="planning commits" startedAt={startedAt} />;
}
