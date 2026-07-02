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
import { settingsReduce, type SettingsPaneState } from "./settings.ts";
import type { FileSelectState } from "./file-select.ts";
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
    }
    // e/E/n/p/r/R are added in Tasks 10–11.
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
    // files / regenAll / busy handlers arrive in Tasks 10–11.
  });

  if (screen.name === "settings") return <SettingsScreen state={screen.pane} />;
  if (screen.name === "files") return <FileSelectScreen state={screen.state} />;
  if (screen.name === "busy") return <Status label={screen.label} startedAt={screen.startedAt} />;
  if (screen.name === "edit") {
    return (
      <LineEditor
        prompt=""
        initial={screen.initial}
        onSave={() => setScreen({ name: "review" })}
        onCancel={() => setScreen({ name: "review" })}
      />
    );
  }
  return (
    <ReviewScreen
      commits={commits}
      cursor={cursor}
      committed={committed}
      settings={settings}
      height={height}
      width={width}
    />
  );
}
