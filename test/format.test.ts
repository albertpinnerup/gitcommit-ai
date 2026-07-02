import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { getChangedFiles } from '../src/git/status.ts';
import { formatCommitMessage } from '../src/core/message.ts';

test('getChangedFiles parses modified and deleted, drops untracked', () => {
  const porcelain = ' M src/a.js\n D src/b.js\n?? new.txt\n';
  assert.deepEqual(getChangedFiles(porcelain), [
    { status: 'M', path: 'src/a.js' },
    { status: 'D', path: 'src/b.js' },
  ]);
});

test('getChangedFiles keeps a rename as one entry keyed by the new path', () => {
  const porcelain = 'R  old.js -> new.js\n';
  assert.deepEqual(getChangedFiles(porcelain), [
    { status: 'R', path: 'new.js', from: 'old.js' },
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

test('formatCommitMessage header override replaces the tag+subject line', () => {
  assert.equal(
    formatCommitMessage({ type: 'feat', scope: 'review', subject: 'x', header: 'feat(upgrade): x' }),
    'feat(upgrade): x',
  );
  assert.equal(
    formatCommitMessage({ type: 'feat', subject: 'x', header: 'docs: x', body: 'why' }),
    'docs: x\n\nwhy',
  );
});
