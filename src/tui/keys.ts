// Normalizes OpenTUI keyboard events into the app's key-token vocabulary
// (the same tokens the pre-rewrite reducers consumed), so reducers stay pure
// and framework-free. Adjust ONLY this file if OpenTUI's event shape differs.

export interface KeyLike {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

const PASSTHROUGH = new Set(["up", "down", "left", "right", "escape", "backspace"]);

export function toKey(key: KeyLike): string {
  const name = key.name ?? "";
  if (key.ctrl && name === "c") return "ctrl-c";
  if (name === "return" || name === "enter") return "enter";
  if (name === "space") return " ";
  if (PASSTHROUGH.has(name)) return name;
  if (key.sequence && key.sequence.length === 1) return key.sequence;
  return name;
}
