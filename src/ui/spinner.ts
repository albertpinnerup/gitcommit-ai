// A spinner + elapsed-time status line shown while a slow task runs, backed by
// the nanospinner library.

import { createSpinner } from "nanospinner";
import type { OutputStream } from "../types.ts";

// statusLine(elapsedSeconds, label) -> the text shown next to the spinner frame.
export function statusLine(elapsedSeconds: number, label: string): string {
  return `commit · ${elapsedSeconds}s · ${label || "working…"}`;
}

// withStatus(label, task, {stream}) -> runs the async `task` while animating a
// nanospinner status line on `stream` (default stderr). Only animates on a TTY,
// and always clears the line when the task settles, success or failure. The task
// must be non-blocking (await-able) for the spinner to actually tick.
export async function withStatus<T>(
  label: string,
  task: () => Promise<T>,
  { stream = process.stderr as OutputStream }: { stream?: OutputStream } = {},
): Promise<T> {
  if (!stream.isTTY) return task();
  const startedAt = Date.now();
  const spinner = createSpinner(statusLine(0, label), {
    stream: stream as unknown as NodeJS.WriteStream,
    color: "cyan",
  }).start();
  // nanospinner animates the frame; tick the elapsed-seconds label ourselves.
  const ticker = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    spinner.update({ text: statusLine(elapsedSeconds, label) });
  }, 1000);
  if (typeof ticker.unref === "function") ticker.unref();
  try {
    return await task();
  } finally {
    clearInterval(ticker);
    spinner.stop();
  }
}
