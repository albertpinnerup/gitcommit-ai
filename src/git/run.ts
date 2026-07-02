// The single place we shell out to git. Injected everywhere else so the rest of
// the codebase stays free of process spawning and easy to test.

import type { GitResult } from "../types.ts";

export function runGit(args: string[], options: { cwd?: string } = {}): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
