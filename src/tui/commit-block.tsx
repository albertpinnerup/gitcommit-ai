/** @jsxImportSource @opentui/react */
// One commit in the review list: label row, subject (highlighted when
// focused), optional dim body lines, files row.

import { formatCommitMessage } from "../core/message.ts";
import { theme } from "./theme.ts";
import type { PlannedCommit } from "../types.ts";

export function CommitBlock({
  commit, index, focused,
}: { commit: PlannedCommit; index: number; focused: boolean }) {
  const lines = formatCommitMessage(commit).split("\n");
  const subject = lines[0];
  const body = lines.slice(1).filter((line) => line.trim() !== "");
  return (
    <box style={{ flexDirection: "column" }}>
      <text>
        <span fg={focused ? theme.accent : theme.dim}>
          {focused ? "❯ " : "  "}Commit {index + 1}
        </span>
      </text>
      <text>
        {"     "}
        {focused
          ? <span fg={theme.focusFg} bg={theme.focusBg}> {subject} </span>
          : <span> {subject} </span>}
      </text>
      {body.map((line, i) => (
        <text key={i} fg={theme.dim}>{"       " + line}</text>
      ))}
      <text fg={theme.dim}>{"     files: " + commit.files.join(", ")}</text>
    </box>
  );
}
