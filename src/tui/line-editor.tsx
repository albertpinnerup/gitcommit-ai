/** @jsxImportSource @opentui/react */
// Modal single-line editor: prefilled input, enter saves, escape cancels.
// Body editing keeps the caller-side "\n"-escaping convention from the old
// editor (the caller converts, this component is newline-agnostic).

import type { KeyEvent } from "@opentui/core";
import { toKey } from "./keys.ts";
import { theme } from "./theme.ts";

export function LineEditor({
  prompt, initial, onSave, onCancel,
}: {
  prompt: string;
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.dim}>{prompt}</text>
      <input
        value={initial}
        focused
        onSubmit={(v: any) => onSave(v)}
        onKeyDown={(key: KeyEvent) => {
          if (toKey(key) === "escape") onCancel();
        }}
      />
      <text fg={theme.dim}>enter save · esc cancel</text>
    </box>
  );
}
