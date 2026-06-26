import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../gitcommit-ai.mjs';

test('buildPrompt includes diff, file paths, log, and JSON instructions', () => {
  const prompt = buildPrompt({
    diff: 'DIFF_CONTENT',
    files: [{ status: 'M', path: 'src/a.js' }],
    log: 'abc123 feat: earlier',
  });
  assert.match(prompt, /DIFF_CONTENT/);
  assert.match(prompt, /src\/a\.js/);
  assert.match(prompt, /abc123 feat: earlier/);
  assert.match(prompt, /Conventional Commits/i);
  assert.match(prompt, /"commits"/);          // shows the required JSON shape
  assert.match(prompt, /exactly one commit/i); // the one-file-one-commit rule
});
