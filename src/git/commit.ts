// Turning an approved plan into real git commits.

import { runGit } from "./run.ts";
import { formatCommitMessage } from "../core/message.ts";
import type {
  PlannedCommit,
  Plan,
  Committed,
  RunGit,
  ExpandPath,
} from "../types.ts";

interface ExecuteOptions {
  runGit?: RunGit;
  expandPath?: ExpandPath;
}

// expandPaths(files, expandPath) -> the real git paths to stage. `expandPath`
// maps one logical path to one or more git paths (a rename's new path expands to
// [oldPath, newPath] so the deletion and addition land in the same commit).
export function expandPaths(files: string[], expandPath?: ExpandPath): string[] {
  if (!expandPath) return files;
  return files.flatMap((path) => expandPath(path));
}

// executeOne(commit, {runGit, expandPath}) -> the committed summary. Commits
// exactly this commit's files using `git commit --only`, which takes their
// working-tree content WITHOUT touching the rest of the index (so any changes you
// staged by hand survive). Throws on git failure, leaving the repo for inspection.
export function executeOne(
  commit: PlannedCommit,
  { runGit: git = runGit, expandPath }: ExecuteOptions = {},
): Committed {
  const paths = expandPaths(commit.files, expandPath);
  const message = formatCommitMessage(commit);
  const [subject, ...bodyParagraphs] = message.split("\n\n");

  const commitArgs = ["commit", "-m", subject];
  if (bodyParagraphs.length) commitArgs.push("-m", bodyParagraphs.join("\n\n"));
  commitArgs.push("--only", "--", ...paths);

  const committed = git(commitArgs);
  if (committed.status !== 0) {
    const detail = (committed.stderr || committed.stdout || "").trim();
    throw new Error(`git commit failed: ${detail || "unknown error"}`);
  }
  return { subject, files: commit.files };
}

// execute(plan, {runGit, expandPath}) -> the committed summaries, in plan order.
export function execute(
  plan: Plan,
  { runGit: git = runGit, expandPath }: ExecuteOptions = {},
): { committed: Committed[] } {
  const committed: Committed[] = [];
  for (const commit of plan.commits) {
    committed.push(executeOne(commit, { runGit: git, expandPath }));
  }
  return { committed };
}
