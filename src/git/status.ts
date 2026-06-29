// Reading the repo's state: parsing `git status`, guarding it's safe to commit,
// and collecting the tracked changes to plan over.

import { runGit } from "./run.ts";
import type { ChangedFile, Collected, RunGit } from "../types.ts";

// getChangedFiles(porcelain) -> tracked changes only. Untracked entries are
// dropped. A rename stays a SINGLE entry keyed by its new path (with `from` = the
// old path) so it can't be split across commits; both paths are staged together
// at commit time (see expandPaths in commit.ts).
export function getChangedFiles(porcelain: string): ChangedFile[] {
  const changedFiles: ChangedFile[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    const statusCode = line.slice(0, 2);
    const path = line.slice(3);
    if (statusCode === "??") continue; // untracked
    if (statusCode[0] === "R" || statusCode[1] === "R") {
      const [oldPath, newPath] = path.split(" -> ");
      changedFiles.push({ status: "R", path: newPath, from: oldPath });
      continue;
    }
    const status = statusCode.trim()[0] || "M";
    changedFiles.push({ status, path });
  }
  return changedFiles;
}

// assertRepoState({runGit}) -> throws unless we are on a branch in a clean,
// non-merging git work tree.
export function assertRepoState({ runGit: git = runGit }: { runGit?: RunGit } = {}): void {
  const insideWorkTree = git(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.status !== 0 || insideWorkTree.stdout.trim() !== "true") {
    throw new Error("not inside a git repo");
  }
  const branch = git(["symbolic-ref", "-q", "HEAD"]);
  if (branch.status !== 0) {
    throw new Error("detached HEAD — checkout a branch before committing");
  }
  const mergeHead = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (mergeHead.status === 0) {
    throw new Error("repository is mid-merge — resolve it first");
  }
}

// collect({runGit}) -> the tracked changes to plan over.
export function collect({ runGit: git = runGit }: { runGit?: RunGit } = {}): Collected {
  assertRepoState({ runGit: git });
  const diff = git(["diff", "HEAD", "--"]).stdout;
  const status = git(["status", "--porcelain"]).stdout;
  const files = getChangedFiles(status);
  const log = git(["log", "-n", "20", "--oneline"]).stdout;
  return { diff, files, log };
}
