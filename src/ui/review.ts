// Reviewing the proposed plan: a plain-text renderer + line-based gate (for
// pipes) and the interactive arrow-key picker (for a real terminal).

import { styles, clampToWidth } from "./ansi.ts";
import { formatCommitMessage } from "../core/message.ts";
import { executeOne } from "../git/commit.ts";
import { runGit } from "../git/run.ts";
import { withStatus } from "./spinner.ts";
import { settingsReduce, renderSettings } from "./settings-pane.ts";
import {
  fileSelectReduce,
  renderFileSelect,
  type FileSelectState,
} from "./file-select.ts";
import { DEFAULT_MODEL, DEFAULT_EFFORT } from "../ai/claude.ts";
import type {
  Plan,
  PlannedCommit,
  CommitMessage,
  Committed,
  Settings,
  RunGit,
  ExpandPath,
  OutputStream,
} from "../types.ts";
import chalk from "chalk";
import figlet from "figlet";

const LEGEND_NAV = "↑/↓ move · enter accept · a accept all · s skip · q quit";
const LEGEND_EDIT =
  "n new · p ask claude · e msg · E body · r regen all · R regen one · c settings";

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

interface RenderReviewState {
  commits: PlannedCommit[];
  cursor: number;
  committed: Committed[];
}

interface RenderReviewOptions {
  color?: boolean;
  width?: number;
  height?: number;
  settings?: Settings;
}

// renderReview(state, opts) -> the full picker panel text (no cursor moves). The
// focused commit gets a marker + inverse video. Lines are clamped to `width` so
// they never wrap; blocks are windowed to `height` so the panel always fits with
// the focused commit visible. width/height omitted -> no clamp/window.
export function renderReview(
  { commits, cursor, committed }: RenderReviewState,
  { color = true, width, height, settings }: RenderReviewOptions = {},
): string {
  const { invert, dim, bold, paint, banner } = styles(color);
  const clip = (text: string, indent = 0) =>
    clampToWidth(text, width ? width - indent : 0);

  // The title: one array element per terminal row, so clip applies per line
  // and title.length matches real rows for the height math below.
  const art = figlet.textSync("AI-commit", {
    font: "epic",
    horizontalLayout: "full",
  });
  const artRows: string[] = [];
  for (const row of art.split("\n")) {
    if (row.trim() === "") continue; // figlet pads with space-only rows
    artRows.push(clip(row));
  }
  let title = banner(artRows);
  title.push(""); // margin below the title, counted like the rest

  const header: string[] = [];
  if (settings) {
    const model = paint(chalk.yellow)(settings.model);
    const effort = paint(chalk.red)(settings.effort);
    const verbose = paint(settings.verbose ? chalk.green : chalk.magenta)(
      settings.verbose ? "verbose" : "subject-only",
    );
    header.push(dim(clip("Settings")));
    header.push(clip(dim("──────────────────────────────")));
    header.push(clip(dim("Model:") + " " + model));
    header.push(clip(dim("Effort:") + " " + effort));
    header.push(clip(dim("Verbose:") + " " + verbose));
    header.push(clip(dim("──────────────────────────────")));
  }
  if (committed.length) {
    header.push(
      dim(
        clip(
          `✓ committed ${committed.length}: ${committed.map((commit) => commit.subject).join(", ")}`,
        ),
      ),
    );
  }
  // Blank line below the header (its "margin-bottom"). Counted in the height
  // math below via header.length, so windowing stays correct.
  if (header.length) header.push("");
  const footer = ["", dim(clip(LEGEND_NAV)), dim(clip(LEGEND_EDIT))];

  // Each block is: label row, subject row (highlighted when focused), any body
  // lines (dimmed), then the files row. Body lines make blocks variable-height.
  const blocks = commits.map((commit, index) => {
    const focused = index === cursor;
    const label = `Commit ${index + 1}`;
    const rows = [
      (focused ? bold("❯ ") : "  ") + (focused ? bold(label) : dim(label)),
    ];
    const messageLines = formatCommitMessage(commit).split("\n");
    const subjectLine = clip(messageLines[0], 7); // 5-space indent + 2 pad spaces
    rows.push(
      "     " + (focused ? invert(` ${subjectLine} `) : ` ${subjectLine} `),
    );
    for (const bodyLine of messageLines.slice(1)) {
      if (bodyLine.trim() === "") continue; // skip the subject/body separator
      rows.push("       " + dim(clip(bodyLine, 7)));
    }
    rows.push("     " + dim(clip("files: " + commit.files.join(", "), 5)));
    return rows;
  });

  // Window the (variable-height) blocks to fit `height`, keeping the focused
  // commit visible by greedily growing a window outward from the cursor.
  let visibleBlocks = blocks;
  let hiddenAbove = 0;
  let hiddenBelow = 0;
  if (height && blocks.length > 0) {
    const blockHeights = blocks.map((block) => block.length);
    // The title is decoration: drop it when the terminal is too short to fit
    // it alongside the header, footer, hints, and the focused commit.
    const chrome = header.length + footer.length + 2 + blockHeights[cursor];
    if (title.length + chrome > height) title = [];
    const available = Math.max(
      1,
      height - title.length - header.length - footer.length - 2,
    ); // -2 for ↑/↓ hints
    let start = cursor;
    let end = cursor + 1;
    let used = blockHeights[cursor];
    for (;;) {
      let grew = false;
      if (end < blocks.length && used + blockHeights[end] <= available) {
        used += blockHeights[end++];
        grew = true;
      }
      if (start > 0 && used + blockHeights[start - 1] <= available) {
        used += blockHeights[--start];
        grew = true;
      }
      if (!grew) break;
    }
    visibleBlocks = blocks.slice(start, end);
    hiddenAbove = start;
    hiddenBelow = blocks.length - end;
  }

  const lines = [...title, ...header];
  if (hiddenAbove) lines.push(dim(`  ↑ ${hiddenAbove} more`));
  for (const block of visibleBlocks) lines.push(...block);
  if (hiddenBelow) lines.push(dim(`  ↓ ${hiddenBelow} more`));
  lines.push(...footer);
  return lines.join("\n");
}

interface InteractiveReviewOptions {
  nextKey: () => Promise<string>;
  readLine?: (prompt: string, initial?: string) => Promise<string | null>;
  output?: OutputStream;
  runGit?: RunGit;
  color?: boolean;
  width?: number;
  height?: number;
  settings?: Settings;
  replan?: (settings: Settings, instruction?: string) => Promise<Plan | null>;
  regenerateCommit?: (
    commit: PlannedCommit,
    settings: Settings,
  ) => Promise<CommitMessage | null>;
  expandPath?: ExpandPath;
}

// interactiveReview(plan, opts) drives the arrow-key gate. nextKey()/readLine()
// are injectable so the loop is testable without raw-mode stdin. Commits happen
// incrementally via executeOne. Returns { committed, settings }.
export async function interactiveReview(
  plan: Plan,
  {
    nextKey,
    readLine,
    output,
    runGit: git = runGit,
    color = true,
    width,
    height,
    settings = { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, verbose: false },
    replan,
    regenerateCommit,
    expandPath,
  }: InteractiveReviewOptions,
): Promise<{ committed: Committed[]; settings: Settings }> {
  const out = output ?? process.stdout;
  const edit =
    readLine ?? (async (_prompt: string, initial?: string) => initial ?? "");
  let commits = plan.commits.slice();
  let cursor = 0;
  let activeSettings: Settings = { ...settings };
  const committed: Committed[] = [];

  // Redraw by homing the cursor and clearing to end of screen, then reprinting.
  const draw = () => {
    const text = renderReview(
      { commits, cursor, committed },
      { color, width, height, settings: activeSettings },
    );
    out.write("\x1b[H\x1b[J" + text + "\n");
  };
  // Transient notice (model calls are slow); cleared by the next draw().
  const notify = (message: string) =>
    out.write("\x1b[H\x1b[J" + message + "\n");

  const commitFocused = (index: number) => {
    committed.push(executeOne(commits[index], { runGit: git, expandPath }));
    commits.splice(index, 1);
    if (cursor >= commits.length) cursor = Math.max(0, commits.length - 1);
  };

  // Replace a commit's message but keep its files (a regenerated message drops
  // any prior header override).
  const applyMessage = (index: number, message: CommitMessage | null) => {
    if (message) commits[index] = { ...message, files: commits[index].files };
  };

  draw();
  while (commits.length > 0) {
    const key = await nextKey();
    const count = commits.length;
    try {
      if (key === "up" || key === "k") cursor = (cursor - 1 + count) % count;
      else if (key === "down" || key === "j") cursor = (cursor + 1) % count;
      else if (key === "q" || key === "ctrl-c") break;
      else if (key === "s") {
        commits.splice(cursor, 1);
        if (cursor >= commits.length) cursor = Math.max(0, commits.length - 1);
      } else if (key === "e") {
        // Pre-fill with the full header (tag + subject) so the user can change
        // the tag too. The edited line is stored verbatim as a header override.
        const current = formatCommitMessage(commits[cursor]).split("\n")[0];
        const edited = await edit(
          "  edit message (enter save · esc cancel): ",
          current,
        );
        if (edited != null && edited.trim()) {
          commits[cursor] = { ...commits[cursor], header: edited.trim() };
        }
      } else if (key === "E") {
        // Edit the body. The editor is single-line, so newlines are shown/typed
        // as a literal "\n" and converted back on save. Empty clears the body.
        const current = (commits[cursor].body || "").replace(/\n/g, "\\n");
        const edited = await edit(
          "  edit body — \\n for line break (enter save · esc cancel): ",
          current,
        );
        if (edited != null) {
          const body = edited.replace(/\\n/g, "\n").trim();
          commits[cursor] = { ...commits[cursor], body: body || undefined };
        }
      } else if (key === "enter") {
        commitFocused(cursor);
      } else if (key === "a") {
        while (commits.length) commitFocused(0);
      } else if (key === "n") {
        await addOwnCommit();
      } else if (key === "p" && replan) {
        await askClaudeToReplan(replan);
      } else if (key === "c") {
        await runSettingsPane();
      } else if (key === "R" && regenerateCommit) {
        notify("  regenerating this commit…");
        applyMessage(
          cursor,
          await withStatus(
            "regenerating this commit",
            () => regenerateCommit(commits[cursor], activeSettings),
            { stream: out },
          ),
        );
      } else if (key === "r" && (replan || regenerateCommit)) {
        await regenerateAll();
      }
    } catch (error) {
      out.write(`\nerror: ${(error as Error).message}\n`);
      break;
    }
    draw();
  }
  return { committed, settings: activeSettings };

  // --- key handlers that need their own sub-loops -------------------------

  // n: pick files (seeded from the focused commit), then write a message. Chosen
  // files move into the new commit and any emptied commit is dropped.
  async function addOwnCommit() {
    const focusedFiles = new Set(commits[cursor]?.files ?? []);
    const allFiles = commits.flatMap((commit) => commit.files);
    let selectState: FileSelectState = {
      items: allFiles.map((path) => ({ path, on: focusedFiles.has(path) })),
      cursor: 0,
    };
    let selectedFiles: string[] | null = null;
    for (;;) {
      out.write(
        "\x1b[H\x1b[J" + renderFileSelect(selectState, { color }) + "\n",
      );
      const step = fileSelectReduce(selectState, await nextKey());
      if ("done" in step) {
        selectedFiles = "cancelled" in step ? null : step.selected;
        break;
      }
      selectState = step.state;
    }
    if (!selectedFiles || !selectedFiles.length) return;

    const seed = commits[cursor]
      ? formatCommitMessage(commits[cursor]).split("\n")[0]
      : "";
    const message = await edit(
      "  message for the new commit (enter save · esc cancel): ",
      seed,
    );
    if (message == null || !message.trim()) return;

    const chosenFiles = new Set(selectedFiles);
    commits = commits
      .map((commit) => ({
        ...commit,
        files: commit.files.filter((file) => !chosenFiles.has(file)),
      }))
      .filter((commit) => commit.files.length > 0);
    commits.unshift({ files: selectedFiles, header: message.trim() });
    cursor = 0;
  }

  // p: type a natural-language instruction, then re-plan the whole list with it.
  async function askClaudeToReplan(
    runReplan: (
      settings: Settings,
      instruction?: string,
    ) => Promise<Plan | null>,
  ) {
    const instruction = await edit(
      "  tell Claude what to change (enter · esc cancel): ",
      "",
    );
    if (instruction == null || !instruction.trim()) return;
    out.write("\x1b[H\x1b[J");
    const newPlan = await withStatus(
      "re-planning with your guidance",
      () => runReplan(activeSettings, instruction.trim()),
      { stream: out },
    );
    if (newPlan && newPlan.commits.length) {
      commits = newPlan.commits.slice();
      cursor = 0;
    }
  }

  // c: stage model/effort/verbose changes; regeneration applies them.
  async function runSettingsPane() {
    let paneState = { settings: activeSettings, cursor: 0 };
    for (;;) {
      out.write("\x1b[H\x1b[J" + renderSettings(paneState, { color }) + "\n");
      const step = settingsReduce(paneState, await nextKey());
      if ("done" in step) break;
      paneState = step.state;
    }
    activeSettings = paneState.settings;
  }

  // r: regenerate everything — regroup (g) or rewrite messages only (m).
  async function regenerateAll() {
    notify("  regenerate all — [g] regroup · [m] messages only · esc cancel");
    const choice = await nextKey();
    if (choice === "g" && replan) {
      out.write("\x1b[H\x1b[J");
      const newPlan = await withStatus(
        "regenerating (regrouping)",
        () => replan(activeSettings),
        { stream: out },
      );
      if (newPlan && newPlan.commits.length) {
        commits = newPlan.commits.slice();
        cursor = 0;
      }
    } else if (choice === "m" && regenerateCommit) {
      for (let index = 0; index < commits.length; index++) {
        out.write("\x1b[H\x1b[J");
        applyMessage(
          index,
          await withStatus(
            `regenerating message ${index + 1}/${commits.length}`,
            () => regenerateCommit(commits[index], activeSettings),
            { stream: out },
          ),
        );
      }
    }
  }
}
