/** @jsxImportSource @opentui/react */
// The one React root of the interactive picker. Owns all app state; a single
// useKeyboard routes normalized key tokens to the active screen's handler.
// Screens themselves are pure views.

import { useState, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { toKey } from "./keys.ts";
import { ReviewScreen } from "./review-screen.tsx";
import { SettingsScreen } from "./settings-screen.tsx";
import { FileSelectScreen } from "./file-select-screen.tsx";
import { LineEditor } from "./line-editor.tsx";
import { Status } from "./status.tsx";
import { theme } from "./theme.ts";
import { settingsReduce, type SettingsPaneState } from "./settings.ts";
import { fileSelectReduce, type FileSelectState } from "./file-select.ts";
import { formatCommitMessage } from "../core/message.ts";
import type {
  Plan, PlannedCommit, CommitMessage, Committed, Settings,
} from "../types.ts";

export interface AppDeps {
  commitOne: (commit: PlannedCommit) => Committed;
  replan: (settings: Settings, instruction?: string) => Promise<Plan | null>;
  regenerateCommit: (commit: PlannedCommit, settings: Settings) => Promise<CommitMessage | null>;
}

export interface AppResult {
  committed: Committed[];
  settings: Settings;
}

type Screen =
  | { name: "review" }
  | { name: "settings"; pane: SettingsPaneState }
  | { name: "files"; state: FileSelectState }
  | { name: "edit"; kind: "message" | "body" | "newCommit" | "instruction"; initial: string; selectedFiles?: string[] }
  | { name: "regenAll" }
  | { name: "busy"; label: string; startedAt: number };

export function App({
  plan, settings: initialSettings, deps, height, width, onDone,
}: {
  plan: Plan;
  settings: Settings;
  deps: AppDeps;
  height: number;
  width: number;
  onDone: (result: AppResult) => void;
}) {
  const [commits, setCommits] = useState<PlannedCommit[]>(plan.commits);
  const [cursor, setCursor] = useState(0);
  const [committed, setCommitted] = useState<Committed[]>([]);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [screen, setScreen] = useState<Screen>({ name: "review" });
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  const clampCursor = (next: PlannedCommit[]) =>
    setCursor((c) => Math.max(0, Math.min(c, next.length - 1)));

  const finish = (done: Committed[]) => {
    if (finished.current) return;
    finished.current = true;
    onDone({ committed: done, settings });
  };

  const commitAt = (index: number): void => {
    const record = deps.commitOne(commits[index]);
    const nextCommits = commits.filter((_, i) => i !== index);
    const nextCommitted = [...committed, record];
    setCommits(nextCommits);
    setCommitted(nextCommitted);
    clampCursor(nextCommits);
    if (nextCommits.length === 0) finish(nextCommitted);
  };

  const busy = (label: string) => setScreen({ name: "busy", label, startedAt: Date.now() });

  // Replace a commit's message but keep its files (regeneration drops any
  // header override) — mirrors applyMessage in the old loop.
  const applyMessage = (index: number, message: CommitMessage | null) => {
    if (!message) return;
    setCommits((current) =>
      current.map((c, i) => (i === index ? { ...message, files: c.files } : c)),
    );
  };

  const runRegenerateOne = async () => {
    setError(null);
    try {
      busy("regenerating this commit");
      const message = await deps.regenerateCommit(commits[cursor], settings);
      applyMessage(cursor, message);
      setScreen({ name: "review" });
    } catch (err) {
      setError((err as Error).message);
      setScreen({ name: "review" });
    }
  };

  const runReplanWithInstruction = async (instruction: string) => {
    if (!instruction.trim()) return;
    setError(null);
    try {
      busy("re-planning with your guidance");
      const next = await deps.replan(settings, instruction.trim());
      if (next && next.commits.length) { setCommits(next.commits); setCursor(0); }
      setScreen({ name: "review" });
    } catch (err) {
      setError((err as Error).message);
      setScreen({ name: "review" });
    }
  };

  const runRegroup = async () => {
    setError(null);
    try {
      busy("regenerating (regrouping)");
      const next = await deps.replan(settings);
      if (next && next.commits.length) { setCommits(next.commits); setCursor(0); }
      setScreen({ name: "review" });
    } catch (err) {
      setError((err as Error).message);
      setScreen({ name: "review" });
    }
  };

  const runRewriteAll = async () => {
    setError(null);
    const snapshot = commits;
    try {
      for (let index = 0; index < snapshot.length; index++) {
        busy(`regenerating message ${index + 1}/${snapshot.length}`);
        applyMessage(index, await deps.regenerateCommit(snapshot[index], settings));
      }
      setScreen({ name: "review" });
    } catch (err) {
      setError((err as Error).message);
      setScreen({ name: "review" });
    }
  };

  const handleReviewKey = (key: string) => {
    const count = commits.length;
    if (key === "up" || key === "k") setCursor((c) => (c - 1 + count) % count);
    else if (key === "down" || key === "j") setCursor((c) => (c + 1) % count);
    else if (key === "q" || key === "ctrl-c") finish(committed);
    else if (key === "s") {
      const next = commits.filter((_, i) => i !== cursor);
      setCommits(next);
      clampCursor(next);
      if (next.length === 0) finish(committed);
    } else if (key === "enter") commitAt(cursor);
    else if (key === "a") {
      // Commit all synchronously in list order.
      let done = [...committed];
      for (const commit of commits) done = [...done, deps.commitOne(commit)];
      setCommits([]);
      setCommitted(done);
      finish(done);
    } else if (key === "c") {
      setScreen({ name: "settings", pane: { settings, cursor: 0 } });
    } else if (key === "e") {
      const current = formatCommitMessage(commits[cursor]).split("\n")[0];
      setScreen({ name: "edit", kind: "message", initial: current });
    } else if (key === "E") {
      const current = (commits[cursor].body || "").replace(/\n/g, "\\n");
      setScreen({ name: "edit", kind: "body", initial: current });
    } else if (key === "n") {
      const focusedFiles = new Set(commits[cursor]?.files ?? []);
      const allFiles = commits.flatMap((commit) => commit.files);
      setScreen({
        name: "files",
        state: { items: allFiles.map((path) => ({ path, on: focusedFiles.has(path) })), cursor: 0 },
      });
    }
    else if (key === "p") setScreen({ name: "edit", kind: "instruction", initial: "" });
    else if (key === "R") void runRegenerateOne();
    else if (key === "r") setScreen({ name: "regenAll" });
  };

  const handleFilesKey = (key: string, state: FileSelectState) => {
    const step = fileSelectReduce(state, key);
    if (!("done" in step)) { setScreen({ name: "files", state: step.state }); return; }
    if ("cancelled" in step || step.selected.length === 0) { setScreen({ name: "review" }); return; }
    const seed = commits[cursor] ? formatCommitMessage(commits[cursor]).split("\n")[0] : "";
    setScreen({ name: "edit", kind: "newCommit", initial: seed, selectedFiles: step.selected });
  };

  const handleSettingsKey = (key: string, pane: SettingsPaneState) => {
    const step = settingsReduce(pane, key);
    if ("done" in step) {
      // Adopt the pane's latest settings when closing.
      setSettings(pane.settings);
      setScreen({ name: "review" });
    } else {
      setScreen({ name: "settings", pane: step.state });
    }
  };

  useKeyboard((event) => {
    const key = toKey(event);
    if (finished.current) return;
    // When LineEditor is active it owns its keys (escape via onKeyDown); don't
    // let the App-level router intercept them.
    if (screen.name === "edit") return;
    if (screen.name === "review") handleReviewKey(key);
    else if (screen.name === "settings") handleSettingsKey(key, screen.pane);
    else if (screen.name === "files") handleFilesKey(key, screen.state);
    else if (screen.name === "regenAll") {
      if (key === "g") void runRegroup();
      else if (key === "m") void runRewriteAll();
      else if (key === "escape") setScreen({ name: "review" });
    }
    else if (screen.name === "busy") { /* ignore keys while busy */ }
  });

  if (screen.name === "settings") return <SettingsScreen state={screen.pane} />;
  if (screen.name === "files") return <FileSelectScreen state={screen.state} />;
  if (screen.name === "busy") return <Status label={screen.label} startedAt={screen.startedAt} />;
  if (screen.name === "regenAll") {
    return <text>  regenerate all — [g] regroup · [m] messages only · esc cancel</text>;
  }
  if (screen.name === "edit") {
    const prompts: Record<string, string> = {
      message: "  edit message (enter save · esc cancel): ",
      body: "  edit body — \\n for line break (enter save · esc cancel): ",
      newCommit: "  message for the new commit (enter save · esc cancel): ",
      instruction: "  tell Claude what to change (enter · esc cancel): ",
    };
    const save = (value: string) => {
      const { kind, selectedFiles } = screen;
      if (kind === "message" && value.trim()) {
        setCommits(commits.map((c, i) => (i === cursor ? { ...c, header: value.trim() } : c)));
      } else if (kind === "body") {
        const body = value.replace(/\\n/g, "\n").trim();
        setCommits(commits.map((c, i) => (i === cursor ? { ...c, body: body || undefined } : c)));
      } else if (kind === "newCommit" && value.trim() && selectedFiles) {
        const chosen = new Set(selectedFiles);
        const rest = commits
          .map((c) => ({ ...c, files: c.files.filter((f) => !chosen.has(f)) }))
          .filter((c) => c.files.length > 0);
        setCommits([{ files: selectedFiles, header: value.trim() }, ...rest]);
        setCursor(0);
      } else if (kind === "instruction") {
        void runReplanWithInstruction(value);
        return; // runReplanWithInstruction handles screen transitions
      }
      setScreen({ name: "review" });
    };
    return (
      <LineEditor
        prompt={prompts[screen.kind]}
        initial={screen.initial}
        onSave={save}
        onCancel={() => setScreen({ name: "review" })}
      />
    );
  }
  return (
    <box flexDirection="column">
      {error && <text fg={theme.offColor}>{error}</text>}
      <ReviewScreen
        commits={commits}
        cursor={cursor}
        committed={committed}
        settings={settings}
        height={error ? height - 1 : height}
        width={width}
      />
    </box>
  );
}
