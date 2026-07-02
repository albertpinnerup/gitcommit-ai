// Canned scenarios that drive the UI in --demo mode. Each scenario is plain
// data: the tracked changes to "collect", the plan to render, and the message a
// single-commit regenerate returns. `files` must list EXACTLY the paths the
// plan's commits reference (validatePlan is strict), so the real parse pipeline
// accepts each scenario unchanged.

import type { ChangedFile, Plan, CommitMessage } from "../types.ts";

export interface DemoScenario {
  description: string;
  files: ChangedFile[];
  plan: Plan;
  regen: CommitMessage;
}

export const SCENARIOS: Record<string, DemoScenario> = {
  default: {
    description: "a realistic 3-commit plan (the common case)",
    files: [
      { status: "M", path: "src/auth/session.ts" },
      { status: "M", path: "src/auth/login.ts" },
      { status: "M", path: "README.md" },
      { status: "A", path: "src/utils/date.ts" },
      { status: "A", path: "test/date.test.ts" },
    ],
    plan: {
      commits: [
        {
          files: ["src/auth/session.ts", "src/auth/login.ts"],
          type: "feat",
          scope: "auth",
          subject: "refresh sessions before they expire",
        },
        {
          files: ["src/utils/date.ts", "test/date.test.ts"],
          type: "feat",
          scope: "utils",
          subject: "add relative-time formatter",
        },
        { files: ["README.md"], type: "docs", subject: "document the date helper" },
      ],
    },
    regen: { type: "feat", subject: "reworked demo commit" },
  },

  single: {
    description: "one commit",
    files: [{ status: "M", path: "src/config.ts" }],
    plan: {
      commits: [
        { files: ["src/config.ts"], type: "fix", scope: "config", subject: "fall back to defaults when env is unset" },
      ],
    },
    regen: { type: "fix", subject: "reworked demo commit" },
  },

  many: {
    description: "~8 commits (tests list scrolling / height clamp)",
    files: Array.from({ length: 8 }, (_, i) => ({ status: "M", path: `src/module-${i}.ts` }) as ChangedFile),
    plan: {
      commits: Array.from({ length: 8 }, (_, i) => ({
        files: [`src/module-${i}.ts`],
        type: (["feat", "fix", "refactor", "chore"] as const)[i % 4],
        subject: `update module ${i}`,
      })),
    },
    regen: { type: "refactor", subject: "reworked demo commit" },
  },

  renames: {
    description: "includes a rename (tests rename handling / path display)",
    files: [
      { status: "R", path: "src/api/client.ts", from: "src/client.ts" },
      { status: "M", path: "src/api/index.ts" },
      { status: "D", path: "src/legacy.ts" },
    ],
    plan: {
      commits: [
        { files: ["src/api/client.ts", "src/api/index.ts"], type: "refactor", scope: "api", subject: "move client under api/" },
        { files: ["src/legacy.ts"], type: "chore", subject: "remove the legacy module" },
      ],
    },
    regen: { type: "refactor", subject: "reworked demo commit" },
  },

  long: {
    description: "long subjects and multi-line bodies (tests wrapping / clamp)",
    files: [
      { status: "M", path: "src/pipeline.ts" },
      { status: "M", path: "src/really/deeply/nested/path/to/a/module/with/a/long/name.ts" },
    ],
    plan: {
      commits: [
        {
          files: ["src/pipeline.ts"],
          type: "refactor",
          scope: "pipeline",
          subject:
            "rework the whole planning pipeline so that every stage is individually injectable and testable end to end",
          body:
            "The pipeline previously baked its effects in.\n" +
            "This splits it into resolveSettings, planCommits, and commitPlan.\n" +
            "Each step now takes its dependencies explicitly, which makes the\n" +
            "review gate and the git layer swappable for demo and test runs.",
        },
        {
          files: ["src/really/deeply/nested/path/to/a/module/with/a/long/name.ts"],
          type: "chore",
          subject: "touch a file with an unusually long path to test truncation",
        },
      ],
    },
    regen: {
      type: "refactor",
      subject: "reworked with a deliberately long regenerated subject line to see how it wraps",
      body: "A regenerated body.\nWith more than one line.",
    },
  },
};

export const DEFAULT_SCENARIO = "default";
