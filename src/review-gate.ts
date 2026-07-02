// Plain-text plan renderer and line-based review gate for non-interactive
// (piped / --dry-run) paths.

import { formatCommitMessage } from "./core/message.ts";
import type { Plan, OutputStream } from "./types.ts";

// renderPlan(plan) -> plain numbered text of every commit (used for --dry-run
// and the non-interactive gate).
export function renderPlan(plan: Plan): string {
  return plan.commits
    .map((commit, index) => {
      const message = formatCommitMessage(commit)
        .split("\n")
        .map((line) => "    " + line)
        .join("\n");
      return `Commit ${index + 1}:\n${message}\n    files: ${commit.files.join(", ")}`;
    })
    .join("\n\n");
}

interface ReviewGateOptions {
  input: () => Promise<string>;
  output?: OutputStream;
  autoApply?: boolean;
}

// reviewGate(plan, {input, output, autoApply}) -> the approved plan or null.
// A simple line-based prompt for piped / non-TTY input.
export async function reviewGate(
  plan: Plan,
  { input, output, autoApply }: ReviewGateOptions,
): Promise<Plan | null> {
  const out = output ?? process.stdout;
  if (autoApply) return plan;
  const commits = plan.commits.slice();
  for (;;) {
    out.write("\n" + renderPlan({ commits }) + "\n");
    out.write("\n[a]pprove all / [e]dit <n> / [s]kip <n> / [q]uit: ");
    const answer = ((await input()) || "q").trim();
    const [command, numberText] = answer.split(/\s+/);
    const index = Number(numberText) - 1;
    if (command === "a") return { ...plan, commits };
    if (command === "q") return null;
    if (command === "s" && commits[index]) {
      commits.splice(index, 1);
      if (!commits.length) return null;
      continue;
    }
    if (command === "e" && commits[index]) {
      out.write(`new subject for commit ${index + 1}: `);
      const subject = ((await input()) || "").trim();
      if (subject) commits[index] = { ...commits[index], subject };
      continue;
    }
    out.write("unrecognized choice\n");
  }
}
