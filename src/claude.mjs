// Invoking the `claude` CLI as a fast one-shot text generator.

import { execFile } from "node:child_process";

export const DEFAULT_MODEL = "sonnet";
// Reasoning effort dominates latency here: the default (high) reasoning makes a
// trivial planning call take ~17s; "low" gets the same JSON in ~5s. Override with
// COMMIT_EFFORT if you want more reasoning for tricky groupings.
export const DEFAULT_EFFORT = "low";

// Minimal system prompt replaces Claude Code's large default agent prompt — this
// is a one-shot text task, so a tiny prompt cuts both latency and tokens.
const PLANNER_SYSTEM_PROMPT =
  "You are a git commit-message planner. Output only minified JSON matching the requested shape. No prose, no code fences.";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// runClaudeCli(prompt, model, effort) -> Promise<{ status, stdout, stderr }>.
// Speed flags: --strict-mcp-config (with no --mcp-config) loads ZERO MCP servers;
// a small --system-prompt + fast --model + low --effort keep latency down.
// (--bare is deliberately NOT used — it skips the settings that hold auth.)
function runClaudeCli(prompt, model, effort) {
  return new Promise((resolve) => {
    const args = [
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
    execFile(
      "claude",
      args,
      { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        const status = error
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;
        resolve({ status, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

// callClaude(prompt, {runner, model, effort}) -> the model's text. `runner` is
// injectable for tests; it returns { status, stdout, stderr }. The CLI's JSON
// wrapper is unwrapped to its `.result`; non-wrapper output is returned as-is.
export async function callClaude(
  prompt,
  { runner, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT } = {},
) {
  const invoke = runner ?? ((text) => runClaudeCli(text, model, effort));
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
