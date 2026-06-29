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

test('buildPrompt omits bodies by default and allows them with allowBody', () => {
  const base = { diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' };
  assert.match(buildPrompt(base), /Do NOT include a body/i);
  assert.match(buildPrompt({ ...base, allowBody: true }), /short body/i);
});

test('buildPrompt truncates an oversized diff and notes it', () => {
  const big = 'x'.repeat(50000);
  const prompt = buildPrompt({ diff: big, files: [{ status: 'M', path: 'a.js' }], log: 'l', maxDiffChars: 12000 });
  assert.ok(prompt.length < 20000, 'diff was not truncated');
  assert.match(prompt, /diff truncated at 12000 chars/);
});
