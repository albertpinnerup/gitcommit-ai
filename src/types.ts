// Shared domain types used across the codebase.

// A single planned commit. `type`/`subject` are present for model-generated
// commits; `header` is a verbatim first-line override (from manual edits / the
// hand-built `n` commit). `from` carries a rename's old path is on ChangedFile.
export interface PlannedCommit {
  files: string[];
  type?: string;
  scope?: string;
  subject?: string;
  body?: string;
  header?: string;
}

export interface Plan {
  commits: PlannedCommit[];
}

// A single validated commit message (used when regenerating one commit).
export interface CommitMessage {
  type: string;
  scope?: string;
  subject: string;
  body?: string;
}

// A tracked change from `git status`. `from` is set for renames (old path).
export interface ChangedFile {
  status: string;
  path: string;
  from?: string;
}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type RunGit = (args: string[], options?: { cwd?: string }) => GitResult;

// Maps one logical path to the real git paths to stage (renames expand to two).
export type ExpandPath = (path: string) => string[];

export interface Collected {
  diff: string;
  files: ChangedFile[];
  log: string;
}

export interface Committed {
  subject: string;
  files: string[];
}

export interface Settings {
  model: string;
  effort: string;
  verbose: boolean;
}

// A writable text sink (process.stdout/stderr or a test double).
export interface OutputStream {
  write(text: string): unknown;
  isTTY?: boolean;
}
