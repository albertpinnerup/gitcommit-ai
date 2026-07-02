// Command-line argument parsing and the --help text.

export interface ParsedArgs {
  dryRun: boolean;
  apply: boolean;
  help: boolean;
  verbose: boolean;
  model: string | null;
  demo: boolean;
  demoScenario: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const modelIndex = argv.indexOf("--model");
  // --demo takes an optional scenario name as the next token; a following flag
  // (starts with "-") is left alone, so bare `--demo` means the default scenario.
  const demoIndex = argv.indexOf("--demo");
  const demoNext = demoIndex !== -1 ? argv[demoIndex + 1] : undefined;
  return {
    dryRun: argv.includes("--dry-run"),
    apply: argv.includes("--apply") || argv.includes("-a"),
    help: argv.includes("-h") || argv.includes("--help"),
    verbose:
      argv.includes("-v") ||
      argv.includes("--verbose") ||
      argv.includes("--body"),
    model: modelIndex !== -1 ? (argv[modelIndex + 1] ?? null) : null,
    demo: demoIndex !== -1,
    demoScenario:
      demoNext && !demoNext.startsWith("-") ? demoNext : "default",
  };
}

export const HELP = `commit — group tracked changes into logical commits via Claude

Usage: commit [--dry-run] [-a | --apply] [-v | --verbose] [--model <m>] [-h | --help]

  --dry-run        Show the plan and the git commands that would run; change nothing.
  -a, --apply      Skip the review gate and execute the proposed plan.
  -v, --verbose    Add a short body to each commit (default: subject-only, faster).
  --model <m>      Model for planning (default: sonnet; or set COMMIT_MODEL).
  --demo [name]    Drive the UI with canned fixtures — no tokens, no git.
                   Use "--demo list" to see scenarios. (COMMIT_DEMO_DELAY ms.)
  -h, --help       Show this help.

In the interactive picker you can also change the model/effort/verbose settings
(c), regenerate all commits (r) or just the focused one (R) — no need to restart.`;
