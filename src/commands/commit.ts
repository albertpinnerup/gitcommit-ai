// The top-level command, written as a flat pipeline:
//   resolveSettings (pure) -> planCommits (collect + model) -> commitPlan (review + git)
// Each effectful dependency is injectable, so main() is testable end to end.

import { createInterface } from "node:readline";
import { parseArgs, HELP, type ParsedArgs } from "../cli.ts";
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
import { demoDeps, listScenarios } from "../demo/index.ts";
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

// resolveSettings(args, env, saved) -> the effective settings. Pure. Precedence:
// explicit CLI flag / env var > saved settings file > built-in default.
export function resolveSettings(
  args: ParsedArgs,
  env: Record<string, string | undefined>,
  saved: Partial<Settings>,
): Settings {
  return {
    model: args.model || env.COMMIT_MODEL || saved.model || DEFAULT_MODEL,
    effort: env.COMMIT_EFFORT || saved.effort || DEFAULT_EFFORT,
    verbose: args.verbose || saved.verbose || false,
  };
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

// renameExpander(files) -> an ExpandPath turning a rename's new path into
// [oldPath, newPath] so both ends stage in the same commit (or undefined).
function renameExpander(files: ChangedFile[]): ExpandPath | undefined {
  const renames = new Map<string, string[]>();
  for (const file of files) {
    if (file.status === "R" && file.from) renames.set(file.path, [file.from, file.path]);
  }
  return renames.size ? (path: string) => renames.get(path) ?? [path] : undefined;
}

// renameAliases(files) -> each rename's old path -> new path, so a plan that
// references the old path (as the diff shows it) is reconciled.
function renameAliases(files: ChangedFile[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const file of files) {
    if (file.status === "R" && file.from) aliases.set(file.from, file.path);
  }
  return aliases;
}

// Everything the pipeline steps need, assembled once in main().
interface Pipeline {
  args: ParsedArgs;
  deps: Deps;
  out: OutputStream;
  statusStream: OutputStream;
  git: RunGit;
  settings: Settings;
  collectChanges: () => Collected;
  generate: (prompt: string) => string | Promise<string>;
  replan: (settings: Settings, instruction?: string) => Promise<Plan | null>;
  regenerateCommit: (
    commit: PlannedCommit,
    settings: Settings,
  ) => Promise<CommitMessage | null>;
}

interface Planned {
  plan: Plan;
  files: ChangedFile[];
  expandPath?: ExpandPath;
}

// planCommits(pipeline) -> the proposed plan (or null when there's nothing to
// commit). Effectful: reads git and calls the model, but the shaping it does
// (buildPrompt -> parsePlan) is pure.
async function planCommits(pipeline: Pipeline): Promise<Planned | null> {
  const { settings, statusStream } = pipeline;
  const { diff, files, log } = pipeline.collectChanges();
  if (files.length === 0) return null;

  const prompt = buildPrompt({ diff, files, log, allowBody: settings.verbose });
  const startedAt = Date.now();
  const raw = await withStatus("planning commits", async () => pipeline.generate(prompt), {
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

  return { plan, files, expandPath: renameExpander(files) };
}

// commitPlan(planned, pipeline) -> the commits made, [] if the user committed
// nothing, or null if a non-TTY review was aborted (message already written).
// The only step that mutates git.
async function commitPlan(
  planned: Planned,
  pipeline: Pipeline,
): Promise<Committed[] | null> {
  const { plan, expandPath } = planned;
  const { args, deps, out, git, settings } = pipeline;

  if (args.apply) {
    return execute(plan, { runGit: git, expandPath }).committed;
  }

  if (deps.nextKey || (process.stdin.isTTY && deps.input === undefined)) {
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
      : { width: process.stdout.columns || 80, height: process.stdout.rows || 24 };
    try {
      const result = await interactiveReview(plan, {
        nextKey: driver.nextKey,
        readLine: driver.readLine,
        output: out,
        runGit: git,
        color: !process.env.NO_COLOR,
        settings,
        replan: pipeline.replan,
        regenerateCommit: pipeline.regenerateCommit,
        expandPath,
        ...dimensions,
      });
      // Remember the settings for next time. Persist on real runs, or when a test
      // injects saveSettings; skip otherwise so tests don't write files.
      const persist = deps.saveSettings ?? (deps.nextKey ? null : saveSettings);
      if (persist) persist(result.settings);
      return result.committed;
    } finally {
      driver.close();
    }
  }

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
    return null;
  }
  return execute(approved, { runGit: git, expandPath }).committed;
}

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const args = parseArgs(argv);
  const out = deps.output ?? process.stdout;
  const err = deps.error ?? process.stderr;
  if (args.help) {
    out.write(HELP + "\n");
    return 0;
  }

  // Demo mode: run the real pipeline against canned fixtures. The demo fakes go
  // UNDER any explicitly-injected dep, so tests still override them.
  if (args.demo) {
    if (args.demoScenario === "list") {
      out.write(listScenarios());
      return 0;
    }
    try {
      deps = { ...demoDeps(args.demoScenario), ...deps };
    } catch (error) {
      err.write(`error: ${(error as Error).message}\n`);
      return 1;
    }
  }

  const settings = resolveSettings(
    args,
    process.env,
    (deps.loadSettings ?? loadSettings)(),
  );

  // Bind the injectable effects once, then assemble the pipeline context.
  const git = deps.runGit ?? runGit;
  const collectArg = deps.runGit ? { runGit: git } : undefined;
  const doCollect = deps.collect ?? collect;
  const generate =
    deps.callClaude ?? ((prompt: string) => callClaude(prompt, settings));
  const planWith = (prompt: string, live: Settings) =>
    deps.callClaude ? deps.callClaude(prompt) : callClaude(prompt, live);

  const replan =
    deps.replan ??
    (async (live: Settings, instruction?: string): Promise<Plan | null> => {
      const collected = doCollect(collectArg);
      if (!collected.files.length) return null;
      const prompt = buildPrompt({
        diff: collected.diff,
        files: collected.files,
        log: collected.log,
        allowBody: live.verbose,
        instruction,
      });
      return parsePlan(
        await planWith(prompt, live),
        collected.files.map((file) => file.path),
        renameAliases(collected.files),
      );
    });

  const regenerateCommit =
    deps.regenerateCommit ??
    (async (commit: PlannedCommit, live: Settings): Promise<CommitMessage | null> => {
      const collected = doCollect(collectArg);
      const prompt = buildRewritePrompt(commit, collected.diff, {
        verbose: live.verbose,
      });
      return parseMessage(await planWith(prompt, live));
    });

  const pipeline: Pipeline = {
    args,
    deps,
    out,
    statusStream: deps.statusStream ?? (process.stderr as OutputStream),
    git,
    settings,
    collectChanges: () => doCollect(collectArg),
    generate,
    replan,
    regenerateCommit,
  };

  try {
    const planned = await planCommits(pipeline);
    if (!planned) {
      out.write("nothing to commit (tracked changes only)\n");
      return 0;
    }

    out.write(renderPlan(planned.plan) + "\n");
    if (args.dryRun) {
      out.write(
        "\n--- git commands (dry run) ---\n" +
          dryRunCommands(planned.plan, planned.expandPath) +
          "\n",
      );
      return 0;
    }

    const committed = await commitPlan(planned, pipeline);
    if (committed === null) return 1; // aborted; message already written
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
