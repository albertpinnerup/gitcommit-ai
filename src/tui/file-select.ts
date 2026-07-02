// A multi-select file list used when hand-building your own commit.

export interface FileSelectItem {
  path: string;
  on: boolean;
}

export interface FileSelectState {
  items: FileSelectItem[];
  cursor: number;
}

export type FileSelectStep =
  | { state: FileSelectState }
  | { done: true; selected: string[] }
  | { done: true; cancelled: true };

// fileSelectReduce(state, key) -> the next step. space toggles, enter confirms
// (returns the checked paths), esc/ctrl-c cancel.
export function fileSelectReduce(
  { items, cursor }: FileSelectState,
  key: string,
): FileSelectStep {
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
