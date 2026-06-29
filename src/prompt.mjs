// Building the prompts sent to Claude for full-plan and single-commit requests.

const MAX_DIFF_CHARS = 12000;

// buildPrompt({diff, files, log, allowBody, instruction}) -> the planner prompt
// asking Claude to group all changed files into logical commits.
export function buildPrompt({
  diff,
  files,
  log,
  allowBody = false,
  maxDiffChars = MAX_DIFF_CHARS,
  instruction,
}) {
  const fileList = files.map((file) => `${file.status}\t${file.path}`).join("\n");

  let trimmedDiff = diff;
  let truncationNote = "";
  if (maxDiffChars && trimmedDiff.length > maxDiffChars) {
    trimmedDiff = trimmedDiff.slice(0, maxDiffChars);
    truncationNote = `\n…(diff truncated at ${maxDiffChars} chars — rely on the file list above for grouping)`;
  }

  const bodyRule = allowBody
    ? '- Include a short body (1-3 lines) in the "body" field for EVERY commit, explaining the why.'
    : '- Do NOT include a body — give a subject only and omit the "body" field.';
  const commitShape = allowBody
    ? '{ "files": ["path"], "type": "feat", "scope": "optional", "subject": "...", "body": "..." }'
    : '{ "files": ["path"], "type": "feat", "scope": "optional", "subject": "..." }';
  const guidance =
    instruction && instruction.trim()
      ? `\n- IMPORTANT — follow this user instruction about grouping/wording: ${instruction.trim()}`
      : "";

  return `You are a git commit planner. Group the following CHANGED FILES into one or
more logical commits and write a Conventional Commits message for each.

Rules:
- A file is committed whole, so it belongs to EXACTLY ONE commit. Never list the
  same file in more than one commit — if a file mixes concerns, pick the single
  best-fitting commit for it. Do not invent file paths.
- Use Conventional Commits: type(scope): subject. Valid types: feat, fix, docs,
  style, refactor, perf, test, build, ci, chore, revert. Keep subject <= 72 chars,
  imperative mood, no trailing period.
- Order commits so prerequisite changes come first.
${bodyRule}${guidance}

Respond with ONLY a JSON object of this exact shape (the example is pretty-printed
for readability — your output must be MINIFIED on a single line, no markdown, no
code fences, no extra whitespace):
{
  "commits": [
    ${commitShape}
  ]
}

CHANGED FILES (git status code + path):
${fileList}

RECENT HISTORY (for style reference):
${log}

DIFF:
${trimmedDiff}${truncationNote}
`;
}

// buildRewritePrompt(commit, diff, {verbose}) -> a prompt to rewrite a SINGLE
// commit's message for its files (used by per-commit and messages-only regen).
export function buildRewritePrompt(
  commit,
  diff,
  { verbose = false, maxDiffChars = MAX_DIFF_CHARS } = {},
) {
  let trimmedDiff = diff;
  if (maxDiffChars && trimmedDiff.length > maxDiffChars) {
    trimmedDiff = trimmedDiff.slice(0, maxDiffChars) + "\n…(diff truncated)";
  }
  const bodyRule = verbose
    ? 'Include a short body (1-3 lines) in the "body" field explaining the why.'
    : 'Do NOT include a body — give a subject only and omit the "body" field.';

  return `Write a single Conventional Commits message for the change to THESE FILES:
${commit.files.map((file) => "- " + file).join("\n")}

Rules: type(scope): subject. Valid types: feat, fix, docs, style, refactor, perf,
test, build, ci, chore, revert. Subject <= 72 chars, imperative, no trailing period.
${bodyRule}

Respond with ONLY minified JSON on a single line (no markdown, no code fences):
{"type":"feat","scope":"optional","subject":"...","body":"optional"}

DIFF (focus only on the files listed above):
${trimmedDiff}
`;
}
