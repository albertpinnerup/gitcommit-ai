// A raw-mode TTY driver: turns keystrokes into tokens and runs a line editor.
// Kept thin — the testable logic lives in keys.ts and editor.ts.

import { decodeKeys } from "./keys.ts";
import { editorReduce, type EditorState } from "./editor.ts";

export interface KeyDriver {
  nextKey(): Promise<string>;
  readLine(prompt: string, initial?: string): Promise<string | null>;
  close(): void;
}

// makeRawKeyDriver(input, output) -> a KeyDriver. Switches the terminal into the
// alternate screen + raw mode and exposes nextKey / readLine / close.
export function makeRawKeyDriver(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): KeyDriver {
  const wasRaw = !!input.isRaw;
  if (input.setRawMode) input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  output.write("\x1b[?1049h\x1b[?25l"); // enter alt screen, hide cursor

  const pendingKeys: string[] = [];
  const waitingResolvers: Array<(key: string) => void> = [];
  const onData = (chunk: string) => {
    for (const key of decodeKeys(chunk)) {
      const resolve = waitingResolvers.shift();
      if (resolve) resolve(key);
      else pendingKeys.push(key);
    }
  };
  input.on("data", onData);

  const nextKey = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = pendingKeys.shift();
      if (queued !== undefined) resolve(queued);
      else waitingResolvers.push(resolve);
    });

  // Single-line editor, pre-filled with `initial`, fully editable, with enter to
  // save and esc/ctrl-c to cancel. Stays in raw mode and drives editor.ts.
  const readLine = (prompt: string, initial = ""): Promise<string | null> =>
    new Promise((resolve) => {
      input.removeListener("data", onData);
      let editorState: EditorState = { text: initial, cursor: initial.length };
      const render = () => {
        output.write(
          "\x1b[H\x1b[J" +
            prompt +
            editorState.text +
            `\x1b[1;${prompt.length + editorState.cursor + 1}H`,
        );
      };
      output.write("\x1b[?25h"); // show cursor while typing
      render();
      const onEditorData = (chunk: string) => {
        for (const key of decodeKeys(chunk)) {
          const step = editorReduce(editorState, key);
          if ("done" in step) {
            input.removeListener("data", onEditorData);
            output.write("\x1b[?25l"); // hide cursor again
            input.on("data", onData);
            resolve("cancelled" in step ? null : step.value);
            return;
          }
          editorState = step.state;
        }
        render();
      };
      input.on("data", onEditorData);
    });

  const close = () => {
    input.removeListener("data", onData);
    output.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt screen
    if (input.setRawMode) input.setRawMode(wasRaw);
    input.pause();
  };

  return { nextKey, readLine, close };
}
