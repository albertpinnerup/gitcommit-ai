// Decoding raw terminal bytes into key tokens, and a pure single-line editor.

// CSI escape sequences (ESC [ …) map to these named keys.
const CSI_KEYS = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  "1~": "home",
  "4~": "end",
  "3~": "delete",
};

// decodeKeys(input) -> normalized key tokens. Pure, so it is unit-testable
// without a terminal. Handles CSI sequences (arrows/home/end), enter, ctrl-c,
// escape, backspace, and plain characters.
export function decodeKeys(input) {
  const keys = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "\x1b" && input[index + 1] === "[") {
      // CSI: ESC [ <params> <final letter or ~>
      let scan = index + 2;
      let params = "";
      while (scan < input.length && !/[A-Za-z~]/.test(input[scan])) {
        params += input[scan];
        scan++;
      }
      const finalByte = input[scan] ?? "";
      const token = CSI_KEYS[params + finalByte] || CSI_KEYS[finalByte];
      if (token) keys.push(token);
      index = scan + 1;
      continue;
    }
    if (char === "\x1b") keys.push("escape");
    else if (char === "\r" || char === "\n") keys.push("enter");
    else if (char === "\x03") keys.push("ctrl-c");
    else if (char === "\x7f" || char === "\x08") keys.push("backspace");
    else keys.push(char);
    index++;
  }
  return keys;
}

// editorReduce(state, key) -> { state } | { done, value } | { done, cancelled }.
// Pure single-line text editor over state { text, cursor }. enter accepts,
// escape/ctrl-c cancel, backspace/left/right/home/end edit, printable chars
// insert at the cursor.
export function editorReduce({ text, cursor }, key) {
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
