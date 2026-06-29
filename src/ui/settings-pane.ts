// The in-picker settings pane: cycle model / effort / verbose.

import { styles } from "./ansi.ts";
import type { Settings } from "../types.ts";

export const SETTING_MODELS = ["sonnet", "opus", "haiku"];
export const SETTING_EFFORTS = ["low", "medium", "high"];
const SETTING_FIELDS = ["model", "effort", "verbose"] as const;

export interface SettingsPaneState {
  settings: Settings;
  cursor: number;
}

export type SettingsStep = { state: SettingsPaneState } | { done: true };

// cycle(list, current, direction) -> the next/previous value, wrapping around.
function cycle(list: string[], current: string, direction: number): string {
  const currentIndex = list.indexOf(current);
  const nextIndex =
    ((currentIndex === -1 ? 0 : currentIndex) + direction + list.length) %
    list.length;
  return list[nextIndex];
}

// settingsReduce(state, key) -> the next step. up/down pick a field, left/right
// change it (verbose toggles), esc/enter/c/q close.
export function settingsReduce(
  { settings, cursor }: SettingsPaneState,
  key: string,
): SettingsStep {
  const fieldCount = SETTING_FIELDS.length;
  if (["escape", "enter", "ctrl-c", "c", "q"].includes(key)) {
    return { done: true };
  }
  if (key === "up" || key === "k") {
    return { state: { settings, cursor: (cursor - 1 + fieldCount) % fieldCount } };
  }
  if (key === "down" || key === "j") {
    return { state: { settings, cursor: (cursor + 1) % fieldCount } };
  }
  if (key === "left" || key === "right") {
    const direction = key === "right" ? 1 : -1;
    const field = SETTING_FIELDS[cursor];
    const updated = { ...settings };
    if (field === "model")
      updated.model = cycle(SETTING_MODELS, settings.model, direction);
    else if (field === "effort")
      updated.effort = cycle(SETTING_EFFORTS, settings.effort, direction);
    else if (field === "verbose") updated.verbose = !settings.verbose;
    return { state: { settings: updated, cursor } };
  }
  return { state: { settings, cursor } };
}

// renderSettings(state, {color}) -> the settings pane text.
export function renderSettings(
  { settings, cursor }: SettingsPaneState,
  { color = true }: { color?: boolean } = {},
): string {
  const { invert, dim, accent, bold } = styles(color);
  const rows: [string, string][] = [
    ["model", settings.model],
    ["effort", settings.effort],
    ["verbose", settings.verbose ? "on" : "off"],
  ];
  const lines = [bold("Settings"), ""];
  rows.forEach(([field, value], index) => {
    const focused = index === cursor;
    const marker = focused ? accent("❯ ") : "  ";
    const label = (field + ":").padEnd(9);
    lines.push(marker + label + (focused ? invert(` ${value} `) : ` ${value} `));
  });
  lines.push("");
  lines.push(
    dim("↑/↓ field · ←/→ change · esc close — then r/R to regenerate"),
  );
  return lines.join("\n");
}
