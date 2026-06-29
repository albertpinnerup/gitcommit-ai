// The top-level command: collect changes, plan, review, then commit.

import { createInterface } from "node:readline";
import { parseArgs, HELP } from "./cli-args.mjs";
import { parsePlan, parseMessage } from "./plan.mjs";
import { buildPrompt, buildRewritePrompt } from "./prompt.mjs";
import { collect, runGit, execute } from "./git.mjs";
import { callClaude, DEFAULT_MODEL, DEFAULT_EFFORT } from "./claude.mjs";
import { withStatus } from "./status-bar.mjs";
import { renderPlan, reviewGate, interactiveReview } from "./review.mjs";
import { makeRawKeyDriver } from "./raw-input.mjs";
import { loadSettings, saveSettings } from "./settings-store.mjs";

// dryRunCommands(plan) -> the exact git commands a real run would execute.
function dryRunCommands(plan) {
  return plan.commits
    .map(
      (commit) =>
        `git reset -q && git add -- ${commit.files.join(" ")} && git commit -m ${JSON.stringify(commit.subject)}`,
    )
    .join("\n");
}

export async function main(argv, deps = {}) {
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
  const initialSettings = { model, effort, verbose };

  const doCollect = deps.collect ?? collect;
  const collectArg = deps.runGit ? { runGit: deps.runGit } : undefined;
  const doClaude =
    deps.callClaude ?? ((prompt) => callClaude(prompt, { model, effort }));
  const git = deps.runGit ?? runGit;
  const statusStream = deps.statusStream ?? process.stderr;

  // Run a prompt against the model using the live (possibly user-changed) settings.
  const planWith = (prompt, settings) =>
    deps.callClaude
      ? deps.callClaude(prompt)
      : callClaude(prompt, { model: settings.model, effort: settings.effort });

  // Re-plan from scratch with current settings (grouping may change).
  const replan =
    deps.replan ??
    (async (settings, instruction) => {
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
      );
    });

  // Rewrite one commit's message for its files (keeps grouping).
  const regenerateCommit =
    deps.regenerateCommit ??
    (async (commit, settings) => {
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

    const prompt = buildPrompt({ diff, files, log, allowBody: verbose });
    const startedAt = Date.now();
    const raw = await withStatus("planning commits", () => doClaude(prompt), {
      stream: statusStream,
    });
    const plan = parsePlan(
      raw,
      files.map((file) => file.path),
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
        "\n--- git commands (dry run) ---\n" + dryRunCommands(plan) + "\n",
      );
      return 0;
    }

    let committed;
    if (args.apply) {
      committed = execute(plan, { runGit: git }).committed;
    } else if (deps.nextKey || (process.stdin.isTTY && deps.input === undefined)) {
      // Interactive arrow-key gate (real TTY, or injected keys for tests).
      const driver = deps.nextKey
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
          ...dimensions,
        });
        committed = result.committed;
        // Remember the settings for next time. Persist on real runs, or when a
        // test injects saveSettings; skip otherwise so tests don't write files.
        const persist =
          deps.saveSettings ?? (deps.nextKey ? null : saveSettings);
        if (persist) persist(result.settings);
      } finally {
        driver.close();
      }
    } else {
      // Line-based fallback for piped / non-TTY input.
      let input = deps.input;
      let readlineInterface;
      if (!input) {
        readlineInterface = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        input = () => new Promise((resolve) => readlineInterface.question("", resolve));
      }
      const approved = await reviewGate(plan, { input, output: out });
      if (readlineInterface) readlineInterface.close();
      if (!approved) {
        out.write("aborted — nothing committed\n");
        return 1;
      }
      committed = execute(approved, { runGit: git }).committed;
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
    err.write(`error: ${error.message}\n`);
    return 1;
  }
}
