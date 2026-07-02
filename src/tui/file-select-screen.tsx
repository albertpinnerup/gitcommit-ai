/** @jsxImportSource @opentui/react */
// Pure view of the file multi-select used when hand-building a commit (n).

import { theme } from "./theme.ts";
import type { FileSelectState } from "./file-select.ts";

export function FileSelectScreen({ state }: { state: FileSelectState }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg={theme.accent}>Pick files for the new commit</text>
      <text> </text>
      {state.items.map((item, index) => {
        const focused = index === state.cursor;
        const row = `${item.on ? "[x]" : "[ ]"} ${item.path}`;
        return (
          <text key={item.path}>
            <span fg={theme.accent}>{focused ? "❯ " : "  "}</span>
            {focused
              ? <span fg={theme.focusFg} bg={theme.focusBg}> {row} </span>
              : <span> {row} </span>}
          </text>
        );
      })}
      <text> </text>
      <text fg={theme.dim}>↑/↓ move · space toggle · enter confirm · esc cancel</text>
    </box>
  );
}
