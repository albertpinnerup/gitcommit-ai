import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChangedFiles, formatCommitMessage } from '../gitcommit-ai.mjs';

test('getChangedFiles parses modified and deleted, drops untracked', () => {
  const porcelain = ' M src/a.js\n D src/b.js\n?? new.txt\n';
  assert.deepEqual(getChangedFiles(porcelain), [
    { status: 'M', path: 'src/a.js' },
    { status: 'D', path: 'src/b.js' },
  ]);
});

test('getChangedFiles expands a rename into old and new paths', () => {
  const porcelain = 'R  old.js -> new.js\n';
  assert.deepEqual(getChangedFiles(porcelain), [
    { status: 'D', path: 'old.js' },
    { status: 'A', path: 'new.js' },
  ]);
});

test('getChangedFiles ignores blank lines', () => {
  assert.deepEqual(getChangedFiles('\n M a\n\n'), [{ status: 'M', path: 'a' }]);
});

test('formatCommitMessage with scope and body', () => {
  const msg = formatCommitMessage({ type: 'feat', scope: 'auth', subject: 'add login', body: 'why' });
  assert.equal(msg, 'feat(auth): add login\n\nwhy');
});

test('formatCommitMessage without scope or body', () => {
  assert.equal(formatCommitMessage({ type: 'fix', subject: 'bug' }), 'fix: bug');
});
