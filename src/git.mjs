// Git plumbing: running git, guarding the repo state, collecting changes, and
// executing the approved commits.

import { spawnSync } from "node:child_process";
import { getChangedFiles, formatCommitMessage } from "./commit-message.mjs";

// runGit(args, {cwd}) -> { status, stdout, stderr }. The single place we shell
// out to git; injectable everywhere else so the logic stays testable.
export function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// assertRepoState({runGit}) -> throws if we are not on a branch in a clean,
// non-merging git work tree.
export function assertRepoState({ runGit: git = runGit } = {}) {
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

// collect({runGit}) -> { diff, files, log } describing the tracked changes.
export function collect({ runGit: git = runGit } = {}) {
  assertRepoState({ runGit: git });
  const diff = git(["diff", "HEAD", "--"]).stdout;
  const status = git(["status", "--porcelain"]).stdout;
  const files = getChangedFiles(status);
  const log = git(["log", "-n", "20", "--oneline"]).stdout;
  return { diff, files, log };
}

// executeOne(commit, {runGit}) -> { subject, files }. Stages exactly this
// commit's files (after clearing the index) and commits them. Throws on any
// git failure so a half-finished run leaves the repo untouched for inspection.
export function executeOne(commit, { runGit: git = runGit } = {}) {
  const reset = git(["reset", "-q"]);
  if (reset.status !== 0) throw new Error(`git reset failed: ${reset.stderr}`);

  const add = git(["add", "--", ...commit.files]);
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);

  const message = formatCommitMessage(commit);
  const [subject, ...bodyParagraphs] = message.split("\n\n");
  const commitArgs = ["commit", "-m", subject];
  if (bodyParagraphs.length) commitArgs.push("-m", bodyParagraphs.join("\n\n"));

  const committed = git(commitArgs);
  if (committed.status !== 0)
    throw new Error(`git commit failed: ${committed.stderr}`);
  return { subject, files: commit.files };
}

// execute(plan, {runGit}) -> { committed } after committing every plan entry.
export function execute(plan, { runGit: git = runGit } = {}) {
  const committed = [];
  for (const commit of plan.commits) {
    committed.push(executeOne(commit, { runGit: git }));
  }
  return { committed };
}
