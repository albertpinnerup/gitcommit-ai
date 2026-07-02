import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLine, withStatus } from '../src/ui/spinner.ts';

test('statusLine formats elapsed and label', () => {
  assert.equal(statusLine(3, 'planning commits'), 'commit · 3s · planning commits');
});

test('statusLine falls back to a default label', () => {
  assert.match(statusLine(0, ''), /commit · 0s · \S/);
});

test('withStatus returns the awaited value and skips the spinner off-TTY', async () => {
  const writes = [];
  const stream = { isTTY: false, write: (s) => writes.push(s) };
  const result = await withStatus('x', async () => 42, { stream });
  assert.equal(result, 42);
  assert.equal(writes.length, 0); // no spinner when not a TTY
});

test('withStatus rethrows when the task throws (off-TTY)', async () => {
  const stream = { isTTY: false, write: () => {} };
  await assert.rejects(
    withStatus('x', async () => { throw new Error('boom'); }, { stream }),
    /boom/,
  );
});

test('withStatus drives nanospinner on the given TTY stream and returns the value', async () => {
  const writes = [];
  const stream = { isTTY: true, columns: 80, write: (s) => writes.push(s) };
  const result = await withStatus(
    'planning',
    () => new Promise((r) => setTimeout(() => r(7), 30)),
    { stream },
  );
  assert.equal(result, 7);
  assert.ok(writes.some((w) => w.includes('planning'))); // rendered the label
});
