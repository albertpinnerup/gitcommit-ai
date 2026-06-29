// A multi-select file list used when hand-building your own commit.

import { styles } from "./ansi.mjs";

// fileSelectReduce(state, key) -> { state } | { done, selected } | { done,
// cancelled }. Pure multi-select over state { items: [{path, on}], cursor }.
// space toggles, enter confirms (returns the checked paths), esc/ctrl-c cancel.
export function fileSelectReduce({ items, cursor }, key) {
  const count = items.length;
  if (key === "escape" || key === "ctrl-c") {
    return { done: true, cancelled: true };
  }
  if (key === "enter") {
    return {
      done: true,
      selected: items.filter((item) => item.on).map((item) => item.path),
    };
  }
  if (key === "up" || key === "k") {
    return { state: { items, cursor: (cursor - 1 + count) % count } };
  }
  if (key === "down" || key === "j") {
    return { state: { items, cursor: (cursor + 1) % count } };
  }
  if (key === " ") {
    return {
      state: {
        items: items.map((item, index) =>
          index === cursor ? { ...item, on: !item.on } : item,
        ),
        cursor,
      },
    };
  }
  return { state: { items, cursor } };
}

// renderFileSelect(state, {color}) -> the file multi-select pane text.
export function renderFileSelect({ items, cursor }, { color = true } = {}) {
  const { invert, dim, accent, bold } = styles(color);
  const lines = [bold("Pick files for the new commit"), ""];
  items.forEach((item, index) => {
    const focused = index === cursor;
    const row = `${item.on ? "[x]" : "[ ]"} ${item.path}`;
    lines.push(
      (focused ? accent("❯ ") : "  ") + (focused ? invert(` ${row} `) : ` ${row} `),
    );
  });
  lines.push("");
  lines.push(dim("↑/↓ move · space toggle · enter confirm · esc cancel"));
  return lines.join("\n");
}
