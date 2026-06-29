// The single place we shell out to git. Injected everywhere else so the rest of
// the codebase stays free of process spawning and easy to test.

import { spawnSync } from "node:child_process";
import type { GitResult } from "../types.ts";

export function runGit(args: string[], options: { cwd?: string } = {}): GitResult {
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
