// A pure single-line text editor used for editing messages, bodies, and prompts.

export interface EditorState {
  text: string;
  cursor: number;
}

export type EditorStep =
  | { state: EditorState }
  | { done: true; value: string }
  | { done: true; cancelled: true };

// editorReduce(state, key) -> the next step. enter accepts, escape/ctrl-c cancel,
// backspace/left/right/home/end edit, printable chars insert at the cursor.
export function editorReduce({ text, cursor }: EditorState, key: string): EditorStep {
  switch (key) {
    case "enter":
      return { done: true, value: text };
    case "escape":
    case "ctrl-c":
      return { done: true, cancelled: true };
    case "backspace":
      return cursor > 0
        ? {
            state: {
              text: text.slice(0, cursor - 1) + text.slice(cursor),
              cursor: cursor - 1,
            },
          }
        : { state: { text, cursor } };
    case "left":
      return { state: { text, cursor: Math.max(0, cursor - 1) } };
    case "right":
      return { state: { text, cursor: Math.min(text.length, cursor + 1) } };
    case "home":
      return { state: { text, cursor: 0 } };
    case "end":
      return { state: { text, cursor: text.length } };
    default:
      if (typeof key === "string" && key.length === 1 && key >= " ") {
        return {
          state: {
            text: text.slice(0, cursor) + key + text.slice(cursor),
            cursor: cursor + 1,
          },
        };
      }
      return { state: { text, cursor } };
  }
}
