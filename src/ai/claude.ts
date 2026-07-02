// Invoking the `claude` CLI as a fast one-shot text generator.

import type { GitResult } from "../types.ts";

// Pinned model IDs, not tier aliases ("sonnet"): an alias resolves to whatever
// the installed claude CLI considers current, so behaviour would silently change
// when the CLI updates. Bump these deliberately when new versions release.
export const DEFAULT_MODEL = "claude-sonnet-4-6";
// Reasoning effort dominates latency here: the default (high) reasoning makes a
// trivial planning call take ~17s; "low" gets the same JSON in ~5s. Override with
// COMMIT_EFFORT if you want more reasoning for tricky groupings.
export const DEFAULT_EFFORT = "low";

// Minimal system prompt replaces Claude Code's large default agent prompt — this
// is a one-shot text task, so a tiny prompt cuts both latency and tokens.
const PLANNER_SYSTEM_PROMPT =
  "You are a git commit-message planner. Output only minified JSON matching the requested shape. No prose, no code fences.";

// A runner returns the raw process result; injectable for tests.
export type ClaudeRunner = (prompt: string) => GitResult | Promise<GitResult>;

interface CallClaudeOptions {
  runner?: ClaudeRunner;
  model?: string;
  effort?: string;
}

// runClaudeCli(prompt, model, effort) -> the process result. Speed flags:
// --strict-mcp-config (with no --mcp-config) loads ZERO MCP servers; a small
// --system-prompt + fast --model + low --effort keep latency down. (--bare is
// deliberately NOT used — it skips the settings that hold auth.)
async function runClaudeCli(
  prompt: string,
  model: string,
  effort: string,
): Promise<GitResult> {
  const args = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "json",
    "--strict-mcp-config",
    "--model",
    model,
    "--system-prompt",
    PLANNER_SYSTEM_PROMPT,
    "--effort",
    effort,
  ];
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { status, stdout, stderr };
  } catch (error) {
    return { status: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

// callClaude(prompt, {runner, model, effort}) -> the model's text. The CLI's JSON
// wrapper is unwrapped to its `.result`; non-wrapper output is returned as-is.
export async function callClaude(
  prompt: string,
  { runner, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT }: CallClaudeOptions = {},
): Promise<string> {
  const invoke: ClaudeRunner =
    runner ?? ((text) => runClaudeCli(text, model, effort));
  const result = await invoke(prompt);
  if (result.status !== 0) {
    throw new Error(
      `claude CLI failed: ${(result.stderr || "").trim() || "unknown error"}`,
    );
  }
  try {
    const wrapper = JSON.parse(result.stdout);
    if (wrapper && typeof wrapper.result === "string") return wrapper.result;
  } catch {
    /* not the CLI's wrapper JSON — fall through and return raw stdout */
  }
  return result.stdout;
}
