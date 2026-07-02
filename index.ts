#!/usr/bin/env bun

// Executable entry point. The implementation lives in ./src; this file only
// wires the CLI up and runs it.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { main } from "./src/commands/commit.ts";

// True when this file was run directly (incl. via a `commit` symlink on PATH),
// false when imported. argv[1] is resolved to its real path so a symlink still
// matches this module's file URL.
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
