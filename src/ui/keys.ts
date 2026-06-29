// Decoding raw terminal bytes into normalized key tokens.

// CSI escape sequences (ESC [ …) map to these named keys.
const CSI_KEYS: Record<string, string> = {
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
export function decodeKeys(input: string): string[] {
  const keys: string[] = [];
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
