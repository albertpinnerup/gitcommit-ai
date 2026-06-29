// Reading git's status output and rendering a commit object into message text.

// getChangedFiles(porcelain) -> [{ status, path }] for tracked changes only.
// Untracked entries are dropped; a rename is expanded into a delete of the old
// path plus an add of the new one, so both ends are committed.
export function getChangedFiles(porcelain) {
  const changedFiles = [];
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    const statusCode = line.slice(0, 2);
    const path = line.slice(3);
    if (statusCode === "??") continue; // untracked
    if (statusCode[0] === "R" || statusCode[1] === "R") {
      const [oldPath, newPath] = path.split(" -> ");
      changedFiles.push({ status: "D", path: oldPath });
      changedFiles.push({ status: "A", path: newPath });
      continue;
    }
    const status = statusCode.trim()[0] || "M";
    changedFiles.push({ status, path });
  }
  return changedFiles;
}

// formatCommitMessage(commit) -> the full commit message text. `header` is a
// verbatim override of the first line (used when the user edits the whole
// tag+subject, e.g. "feat(review): x" -> "feat(upgrade): x").
export function formatCommitMessage({ type, scope, subject, body, header }) {
  const firstLine =
    header != null
      ? header
      : scope
        ? `${type}(${scope}): ${subject}`
        : `${type}: ${subject}`;
  return body && body.trim() ? `${firstLine}\n\n${body.trim()}` : firstLine;
}
