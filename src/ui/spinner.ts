// A spinner + elapsed-time status line shown while a slow task runs.

import type { OutputStream } from "../types.ts";

export const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// statusLine(frame, elapsedSeconds, label) -> the visible text (no CR/clear).
export function statusLine(frame: string, elapsedSeconds: number, label: string): string {
  return `  ${frame}  commit · ${elapsedSeconds}s · ${label || "working…"}`;
}

// withStatus(label, task, {stream}) -> runs the async `task` while animating a
// status line on `stream` (default stderr). Only animates on a TTY, and always
// clears the line when the task settles, success or failure. The task must be
// non-blocking (await-able) for the spinner to actually tick.
export async function withStatus<T>(
  label: string,
  task: () => Promise<T>,
  { stream = process.stderr as OutputStream }: { stream?: OutputStream } = {},
): Promise<T> {
  const animate = !!stream.isTTY;
  const startedAt = Date.now();
  let frameIndex = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;
  if (animate) {
    ticker = setInterval(() => {
      frameIndex = (frameIndex + 1) % FRAMES.length;
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const spinner = `\x1b[36m${FRAMES[frameIndex]}\x1b[0m`;
      stream.write("\r\x1b[2K" + statusLine(spinner, elapsedSeconds, label));
    }, 80);
    if (typeof ticker.unref === "function") ticker.unref();
  }
  try {
    return await task();
  } finally {
    if (animate) {
      clearInterval(ticker);
      stream.write("\r\x1b[2K");
    }
  }
}
