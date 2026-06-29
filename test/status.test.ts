import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES, statusLine, withStatus } from '../src/ui/spinner.ts';

test('FRAMES is a non-empty spinner array', () => {
  assert.ok(Array.isArray(FRAMES) && FRAMES.length > 0);
});

test('statusLine formats spinner, elapsed, and label', () => {
  assert.equal(statusLine('*', 3, 'planning commits'), '  *  commit · 3s · planning commits');
});

test('statusLine falls back to a default label', () => {
  assert.match(statusLine('*', 0, ''), /commit · 0s · \S/);
});

test('withStatus returns the awaited value and skips animation off-TTY', async () => {
  const writes = [];
  const stream = { isTTY: false, write: (s) => writes.push(s) };
  const result = await withStatus('x', async () => 42, { stream });
  assert.equal(result, 42);
  assert.equal(writes.length, 0); // no spinner when not a TTY
});

test('withStatus animates on a TTY and clears the line at the end', async () => {
  const writes = [];
  const stream = { isTTY: true, write: (s) => writes.push(s) };
  await withStatus('x', () => new Promise((r) => setTimeout(r, 200)), { stream });
  assert.ok(writes.length > 0);                 // drew at least one frame
  assert.equal(writes.at(-1), '\r\x1b[2K');     // cleared the line on exit
});

test('withStatus clears the line even when the task throws', async () => {
  const writes = [];
  const stream = { isTTY: true, write: (s) => writes.push(s) };
  await assert.rejects(withStatus('x', async () => { throw new Error('boom'); }, { stream }), /boom/);
  assert.equal(writes.at(-1), '\r\x1b[2K');
});
