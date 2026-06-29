// Rendering a commit into its message text. Pure — no I/O.

import type { PlannedCommit } from "../types.ts";

// formatCommitMessage(commit) -> the full commit message text. `header` is a
// verbatim override of the first line (used when the user edits the whole
// tag+subject, e.g. "feat(review): x" -> "feat(upgrade): x").
export function formatCommitMessage({
  type,
  scope,
  subject,
  body,
  header,
}: PlannedCommit): string {
  const firstLine =
    header != null
      ? header
      : scope
        ? `${type}(${scope}): ${subject}`
        : `${type}: ${subject}`;
  return body && body.trim() ? `${firstLine}\n\n${body.trim()}` : firstLine;
}
