// Wiring the canned scenarios into the injectable Deps of main(). Everything
// here is a fake: no `claude` CLI call, no real git, no settings file. The
// production UI runs unchanged against these — demo mode is not a separate code
// path, just a different set of effects.

import { SCENARIOS, DEFAULT_SCENARIO } from "./fixtures.ts";
import type { Deps } from "../commands/commit.ts";
import type {
  Plan,
  PlannedCommit,
  CommitMessage,
  Collected,
  Settings,
  GitResult,
} from "../types.ts";

export { SCENARIOS } from "./fixtures.ts";

// A small artificial latency so the "planning commits" spinner is visible.
// Overridable via COMMIT_DEMO_DELAY (ms); 0 (or an invalid value) disables it.
function demoDelay(): Promise<void> {
  const raw = process.env.COMMIT_DEMO_DELAY;
  const ms = raw === undefined ? 350 : Number(raw);
  return Number.isFinite(ms) && ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

// listScenarios() -> a human-readable list for `commit --demo list`.
export function listScenarios(): string {
  const rows = Object.entries(SCENARIOS).map(
    ([name, scenario]) => `  ${name.padEnd(9)} ${scenario.description}`,
  );
  return `Demo scenarios (commit --demo <name>):\n${rows.join("\n")}\n`;
}

// demoDeps(name) -> the fake effects for main(). Throws on an unknown name.
export function demoDeps(name: string = DEFAULT_SCENARIO): Deps {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown demo scenario: ${name}`);

  const collected: Collected = {
    diff: "diff --git a/demo b/demo\n@@ demo @@\n+ (demo mode)\n",
    files: scenario.files,
    log: "0182b57 feat(ui): demo\n49b415f build(deps): demo\n",
  };

  // In-memory settings, so a demo run never reads or writes the real config.
  let stored: Partial<Settings> = {};

  return {
    collect: () => collected,

    // Return the plan as JSON so the real parsePlan pipeline still runs.
    callClaude: async () => {
      await demoDelay();
      return JSON.stringify(scenario.plan);
    },

    // A lightly varied plan so r / p / settings-triggered replans visibly change.
    replan: async (_settings: Settings, instruction?: string): Promise<Plan | null> => {
      await demoDelay();
      return {
        commits: scenario.plan.commits.map((commit) => ({
          ...commit,
          subject: instruction
            ? `${commit.subject} (${instruction})`.slice(0, 72)
            : `${commit.subject} (regrouped)`,
        })),
      };
    },

    // A varied message so R visibly changes the focused commit.
    regenerateCommit: async (commit: PlannedCommit): Promise<CommitMessage | null> => {
      await demoDelay();
      return { ...scenario.regen, subject: `${scenario.regen.subject} [${commit.files[0]}]` };
    },

    // A no-op git that reports success, so accepting is safe to run anywhere.
    runGit: (): GitResult => ({ status: 0, stdout: "", stderr: "" }),

    loadSettings: () => stored,
    saveSettings: (settings: Settings) => {
      stored = { ...settings };
      return true;
    },
  };
}
