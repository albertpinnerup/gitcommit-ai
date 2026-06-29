// Parsing and validating the commit plan that Claude returns. Pure — no I/O.

import type { Plan, CommitMessage } from "../types.ts";

export const VALID_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

// extractJson(text) -> the JSON value embedded in Claude's reply. Prefers a
// fenced ```json block, otherwise the first {...} span, tolerating stray prose.
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in Claude output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

// validatePlan(plan, changedPaths) -> the plan, after asserting its commits cover
// exactly the changed files (none missing, none unknown, none assigned twice).
export function validatePlan(plan: any, changedPaths: string[]): Plan {
  if (!plan || !Array.isArray(plan.commits)) {
    throw new Error('plan must have a "commits" array');
  }
  const expectedPaths = new Set(changedPaths);
  const assignedPaths = new Set<string>();
  for (const commit of plan.commits) {
    if (!Array.isArray(commit.files) || commit.files.length === 0) {
      throw new Error('each commit needs a non-empty "files" array');
    }
    if (!VALID_TYPES.includes(commit.type)) {
      throw new Error(`invalid commit type: ${JSON.stringify(commit.type)}`);
    }
    if (typeof commit.subject !== "string" || commit.subject.trim() === "") {
      throw new Error('each commit needs a non-empty "subject"');
    }
    for (const path of commit.files) {
      if (!expectedPaths.has(path))
        throw new Error(`plan references unknown file: ${path}`);
      if (assignedPaths.has(path))
        throw new Error(`file assigned to more than one commit: ${path}`);
      assignedPaths.add(path);
    }
  }
  const missing = [...expectedPaths].filter((path) => !assignedPaths.has(path));
  if (missing.length) {
    throw new Error(`changed files missing from plan: ${missing.join(", ")}`);
  }
  return plan as Plan;
}

// repairPlan(plan) -> a plan where each file appears in only one commit. Claude
// sometimes lists a multi-concern file in several commits (it wants to split the
// file's changes), but we commit whole files — so we keep each file in its FIRST
// commit, drop the later duplicates, and drop any commit left with no files.
export function repairPlan(plan: any): any {
  if (!plan || !Array.isArray(plan.commits)) return plan;
  const assignedPaths = new Set<string>();
  const commits = [];
  for (const commit of plan.commits) {
    if (!Array.isArray(commit.files)) {
      commits.push(commit);
      continue;
    }
    const files = commit.files.filter((path: string) => {
      if (assignedPaths.has(path)) return false;
      assignedPaths.add(path);
      return true;
    });
    if (files.length) commits.push({ ...commit, files });
  }
  return { ...plan, commits };
}

// normalizeRenames(plan, aliases) -> a plan where any reference to a rename's old
// path is rewritten to its new path. Git shows renames by their new path in the
// file list but by the old path in the diff, so the model sometimes references
// the old one; `aliases` maps oldPath -> newPath to reconcile that.
export function normalizeRenames(plan: any, aliases?: Map<string, string>): any {
  if (!aliases || !aliases.size || !plan || !Array.isArray(plan.commits)) {
    return plan;
  }
  const commits = plan.commits.map((commit: any) => {
    if (!Array.isArray(commit.files)) return commit;
    return {
      ...commit,
      files: commit.files.map((path: string) => aliases.get(path) ?? path),
    };
  });
  return { ...plan, commits };
}

export function parsePlan(
  rawText: string,
  changedPaths: string[],
  aliases?: Map<string, string>,
): Plan {
  return validatePlan(
    repairPlan(normalizeRenames(extractJson(rawText), aliases)),
    changedPaths,
  );
}

// parseMessage(rawText) -> a single validated commit message. Used when
// regenerating one commit's message (not a full plan).
export function parseMessage(rawText: string): CommitMessage {
  const parsed = extractJson(rawText);
  if (!VALID_TYPES.includes(parsed.type)) {
    throw new Error(`invalid commit type: ${JSON.stringify(parsed.type)}`);
  }
  if (typeof parsed.subject !== "string" || parsed.subject.trim() === "") {
    throw new Error('message needs a non-empty "subject"');
  }
  const message: CommitMessage = {
    type: parsed.type,
    subject: parsed.subject.trim(),
  };
  if (parsed.scope) message.scope = String(parsed.scope);
  if (parsed.body && String(parsed.body).trim())
    message.body = String(parsed.body).trim();
  return message;
}
