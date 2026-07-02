import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildRewritePrompt } from '../src/ai/prompts.ts';

test('buildRewritePrompt targets one commit\'s files and requests a single message', () => {
  const p = buildRewritePrompt({ files: ['src/a.js', 'src/b.js'], type: 'feat', subject: 'x' }, 'DIFFTEXT');
  assert.match(p, /src\/a\.js/);
  assert.match(p, /src\/b\.js/);
  assert.match(p, /DIFFTEXT/);
  assert.match(p, /"subject"/);          // single-message JSON shape
  assert.doesNotMatch(p, /"commits"/);   // not a full plan
  assert.match(p, /Do NOT include a body/i);
});

test('buildRewritePrompt asks for a body when verbose', () => {
  const p = buildRewritePrompt({ files: ['a.js'] }, 'd', { verbose: true });
  assert.match(p, /Include a short body/i);
});

test('buildPrompt embeds a user instruction when given', () => {
  const base = { diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' };
  assert.doesNotMatch(buildPrompt(base), /user instruction/i);
  assert.match(buildPrompt({ ...base, instruction: 'put tests in their own commit' }), /put tests in their own commit/);
});

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
