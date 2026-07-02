/** @jsxImportSource @opentui/react */
// Pure view of the settings pane. Key handling lives in App, which routes
// tokens through settingsReduce.

import { theme } from "./theme.ts";
import type { SettingsPaneState } from "./settings.ts";

const FIELDS = ["model", "effort", "verbose"] as const;

export function SettingsScreen({ state }: { state: SettingsPaneState }) {
  const { settings, cursor } = state;
  const values: Record<(typeof FIELDS)[number], string> = {
    model: settings.model,
    effort: settings.effort,
    verbose: settings.verbose ? "on" : "off",
  };
  const badge = (field: string, value: string) => {
    if (field === "model") {
      const style = theme.model[value];
      return style ? <span fg={style.fg} bg={style.bg}> {value} </span> : <span>{value}</span>;
    }
    if (field === "effort") {
      return <span fg={theme.effortColor[value] ?? theme.accent}> {value} </span>;
    }
    return <span fg={value === "on" ? theme.onColor : theme.offColor}> {value} </span>;
  };
  return (
    <box style={{ flexDirection: "column" }}>
      <text>Settings</text>
      <text> </text>
      {FIELDS.map((field, index) => (
        <text key={field}>
          <span fg={theme.accent}>{index === cursor ? "❯ " : "  "}</span>
          {(field + ":").padEnd(9)}
          {badge(field, values[field])}
        </text>
      ))}
      <text> </text>
      <text fg={theme.dim}>↑/↓ field · ←/→ change · esc close — then r/R to regenerate</text>
    </box>
  );
}
