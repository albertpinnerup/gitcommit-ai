// A raw-mode TTY driver: turns keystrokes into tokens and runs a line editor.
// Kept thin — the testable logic lives in keys.mjs and review.mjs.

import { decodeKeys, editorReduce } from "./keys.mjs";

// makeRawKeyDriver(input, output) -> { nextKey, readLine, close }. Switches the
// terminal into the alternate screen + raw mode and exposes:
//   nextKey()              -> Promise<keyToken>
//   readLine(prompt, init) -> Promise<string | null>  (null = cancelled)
//   close()               -> restore the terminal
export function makeRawKeyDriver(input = process.stdin, output = process.stdout) {
  const wasRaw = !!input.isRaw;
  if (input.setRawMode) input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  output.write("\x1b[?1049h\x1b[?25l"); // enter alt screen, hide cursor

  const pendingKeys = [];
  const waitingResolvers = [];
  const onData = (chunk) => {
    for (const key of decodeKeys(chunk)) {
      if (waitingResolvers.length) waitingResolvers.shift()(key);
      else pendingKeys.push(key);
    }
  };
  input.on("data", onData);

  const nextKey = () =>
    new Promise((resolve) => {
      if (pendingKeys.length) resolve(pendingKeys.shift());
      else waitingResolvers.push(resolve);
    });

  // Single-line editor, pre-filled with `initial`, fully editable, with enter to
  // save and esc/ctrl-c to cancel. Stays in raw mode and drives keys.mjs.
  const readLine = (prompt, initial = "") =>
    new Promise((resolve) => {
      input.removeListener("data", onData);
      let editorState = { text: initial, cursor: initial.length };
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
      const onEditorData = (chunk) => {
        for (const key of decodeKeys(chunk)) {
          const step = editorReduce(editorState, key);
          if (step.done) {
            input.removeListener("data", onEditorData);
            output.write("\x1b[?25l"); // hide cursor again
            input.on("data", onData);
            resolve(step.cancelled ? null : step.value);
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
