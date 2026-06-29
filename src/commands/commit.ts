// The top-level command: collect changes, plan, review, then commit.

import { createInterface } from "node:readline";
import { parseArgs, HELP } from "../cli.ts";
import { parsePlan, parseMessage } from "../core/plan.ts";
import { buildPrompt, buildRewritePrompt } from "../ai/prompts.ts";
import { collect } from "../git/status.ts";
import { runGit } from "../git/run.ts";
import { execute, expandPaths } from "../git/commit.ts";
import { callClaude, DEFAULT_MODEL, DEFAULT_EFFORT } from "../ai/claude.ts";
import { withStatus } from "../ui/spinner.ts";
import { renderPlan, reviewGate, interactiveReview } from "../ui/review.ts";
import { makeRawKeyDriver, type KeyDriver } from "../ui/raw-input.ts";
import { loadSettings, saveSettings } from "../config.ts";
import type {
  Plan,
  PlannedCommit,
  CommitMessage,
  ChangedFile,
  Collected,
  Committed,
  Settings,
  RunGit,
  ExpandPath,
  OutputStream,
} from "../types.ts";

export interface Deps {
  output?: OutputStream;
  error?: OutputStream;
  statusStream?: OutputStream;
  collect?: (options?: { runGit?: RunGit }) => Collected;
  callClaude?: (prompt: string) => string | Promise<string>;
  runGit?: RunGit;
  loadSettings?: () => Partial<Settings>;
  saveSettings?: (settings: Settings) => unknown;
  replan?: (settings: Settings, instruction?: string) => Promise<Plan | null>;
  regenerateCommit?: (
    commit: PlannedCommit,
    settings: Settings,
  ) => Promise<CommitMessage | null>;
  nextKey?: () => Promise<string>;
  readLine?: (prompt: string, initial?: string) => Promise<string | null>;
  input?: () => Promise<string>;
}

// dryRunCommands(plan, expandPath) -> the exact git commands a real run would run.
function dryRunCommands(plan: Plan, expandPath?: ExpandPath): string {
  return plan.commits
    .map((commit) => {
      const paths = expandPaths(commit.files, expandPath).join(" ");
      return `git commit -m ${JSON.stringify(commit.subject)} --only -- ${paths}`;
    })
    .join("\n");
}

// renameExpander(files) -> an ExpandPath that turns a rename's new path into
// [oldPath, newPath] so both ends are staged in the same commit (or undefined
// when there are no renames).
function renameExpander(files: ChangedFile[]): ExpandPath | undefined {
  const renames = new Map<string, string[]>();
  for (const file of files) {
    if (file.status === "R" && file.from) renames.set(file.path, [file.from, file.path]);
  }
  return renames.size ? (path: string) => renames.get(path) ?? [path] : undefined;
}

// renameAliases(files) -> a map of each rename's old path -> new path, so a plan
// that references the old path (as it appears in the diff) is reconciled.
function renameAliases(files: ChangedFile[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const file of files) {
    if (file.status === "R" && file.from) aliases.set(file.from, file.path);
  }
  return aliases;
}

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const args = parseArgs(argv);
  const out = deps.output ?? process.stdout;
  const err = deps.error ?? process.stderr;
  if (args.help) {
    out.write(HELP + "\n");
    return 0;
  }

  // Precedence: explicit CLI flag / env > saved settings > built-in default.
  const saved = (deps.loadSettings ?? loadSettings)();
  const model =
    args.model || process.env.COMMIT_MODEL || saved.model || DEFAULT_MODEL;
  const effort = process.env.COMMIT_EFFORT || saved.effort || DEFAULT_EFFORT;
  const verbose = args.verbose || saved.verbose || false;
  const initialSettings: Settings = { model, effort, verbose };

  const doCollect = deps.collect ?? collect;
  const collectArg = deps.runGit ? { runGit: deps.runGit } : undefined;
  const doClaude =
    deps.callClaude ?? ((prompt: string) => callClaude(prompt, { model, effort }));
  const git = deps.runGit ?? runGit;
  const statusStream = deps.statusStream ?? (process.stderr as OutputStream);

  // Run a prompt against the model using the live (possibly user-changed) settings.
  const planWith = (prompt: string, settings: Settings) =>
    deps.callClaude
      ? deps.callClaude(prompt)
      : callClaude(prompt, { model: settings.model, effort: settings.effort });

  // Re-plan from scratch with current settings (grouping may change).
  const replan =
    deps.replan ??
    (async (settings: Settings, instruction?: string): Promise<Plan | null> => {
      const collected = doCollect(collectArg);
      if (!collected.files.length) return null;
      const prompt = buildPrompt({
        diff: collected.diff,
        files: collected.files,
        log: collected.log,
        allowBody: settings.verbose,
        instruction,
      });
      return parsePlan(
        await planWith(prompt, settings),
        collected.files.map((file) => file.path),
        renameAliases(collected.files),
      );
    });

  // Rewrite one commit's message for its files (keeps grouping).
  const regenerateCommit =
    deps.regenerateCommit ??
    (async (commit: PlannedCommit, settings: Settings): Promise<CommitMessage | null> => {
      const collected = doCollect(collectArg);
      const prompt = buildRewritePrompt(commit, collected.diff, {
        verbose: settings.verbose,
      });
      return parseMessage(await planWith(prompt, settings));
    });

  try {
    const { diff, files, log } = doCollect(
      deps.runGit ? { runGit: git } : undefined,
    );
    if (files.length === 0) {
      out.write("nothing to commit (tracked changes only)\n");
      return 0;
    }
    const expandPath = renameExpander(files);

    const prompt = buildPrompt({ diff, files, log, allowBody: verbose });
    const startedAt = Date.now();
    const raw = await withStatus("planning commits", async () => doClaude(prompt), {
      stream: statusStream,
    });
    const plan = parsePlan(
      raw,
      files.map((file) => file.path),
      renameAliases(files),
    );

    // Per-run timing readout on the status stream (TTY only, so pipes stay clean).
    if (statusStream.isTTY) {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const count = plan.commits.length;
      statusStream.write(
        `  planned ${count} commit${count === 1 ? "" : "s"} in ${seconds}s\n`,
      );
    }

    out.write(renderPlan(plan) + "\n");
    if (args.dryRun) {
      out.write(
        "\n--- git commands (dry run) ---\n" +
          dryRunCommands(plan, expandPath) +
          "\n",
      );
      return 0;
    }

    let committed: Committed[];
    if (args.apply) {
      committed = execute(plan, { runGit: git, expandPath }).committed;
    } else if (deps.nextKey || (process.stdin.isTTY && deps.input === undefined)) {
      // Interactive arrow-key gate (real TTY, or injected keys for tests).
      const driver: KeyDriver = deps.nextKey
        ? {
            nextKey: deps.nextKey,
            readLine: deps.readLine ?? (async () => ""),
            close: () => {},
          }
        : makeRawKeyDriver(process.stdin, process.stdout);
      const dimensions = deps.nextKey
        ? {}
        : {
            width: process.stdout.columns || 80,
            height: process.stdout.rows || 24,
          };
      try {
        const result = await interactiveReview(plan, {
          nextKey: driver.nextKey,
          readLine: driver.readLine,
          output: out,
          runGit: git,
          color: !process.env.NO_COLOR,
          settings: initialSettings,
          replan,
          regenerateCommit,
          expandPath,
          ...dimensions,
        });
        committed = result.committed;
        // Remember the settings for next time. Persist on real runs, or when a
        // test injects saveSettings; skip otherwise so tests don't write files.
        const persist = deps.saveSettings ?? (deps.nextKey ? null : saveSettings);
        if (persist) persist(result.settings);
      } finally {
        driver.close();
      }
    } else {
      // Line-based fallback for piped / non-TTY input.
      let input = deps.input;
      let readlineInterface: ReturnType<typeof createInterface> | undefined;
      if (!input) {
        readlineInterface = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const rl = readlineInterface;
        input = () => new Promise<string>((resolve) => rl.question("", resolve));
      }
      const approved = await reviewGate(plan, { input, output: out });
      if (readlineInterface) readlineInterface.close();
      if (!approved) {
        out.write("aborted — nothing committed\n");
        return 1;
      }
      committed = execute(approved, { runGit: git, expandPath }).committed;
    }

    if (!committed.length) {
      out.write("\nnothing committed\n");
      return 1;
    }
    out.write(
      `\nCreated ${committed.length} commit(s):\n` +
        committed.map((commit) => `  • ${commit.subject}`).join("\n") +
        "\n",
    );
    return 0;
  } catch (error) {
    err.write(`error: ${(error as Error).message}\n`);
    return 1;
  }
}
