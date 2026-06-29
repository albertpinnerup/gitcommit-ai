// Persisting the user's model / effort / verbose choices between runs.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { Settings } from "./types.ts";

export const SETTINGS_PATH = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "gitcommit-ai",
  "settings.json",
);

// loadSettings(path) -> saved settings (partial), or {} if missing/unreadable.
export function loadSettings(path = SETTINGS_PATH): Partial<Settings> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// saveSettings(settings, path) -> true on success. Persists only the known keys
// and never throws (a read-only config dir shouldn't break committing).
export function saveSettings(settings: Settings, path = SETTINGS_PATH): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const { model, effort, verbose } = settings;
    writeFileSync(
      path,
      JSON.stringify({ model, effort, verbose }, null, 2) + "\n",
    );
    return true;
  } catch {
    return false;
  }
}
