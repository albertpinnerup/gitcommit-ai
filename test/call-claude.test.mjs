import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude } from '../gitcommit-ai.mjs';

test('callClaude returns .result from the wrapper JSON', () => {
  const runner = () => ({ status: 0, stdout: JSON.stringify({ result: 'MODEL_TEXT' }), stderr: '' });
  assert.equal(callClaude('p', { runner }), 'MODEL_TEXT');
});

test('callClaude returns raw stdout when not wrapper JSON', () => {
  const runner = () => ({ status: 0, stdout: '{"commits":[]}', stderr: '' });
  assert.equal(callClaude('p', { runner }), '{"commits":[]}');
});

test('callClaude throws on non-zero exit', () => {
  const runner = () => ({ status: 1, stdout: '', stderr: 'boom' });
  assert.throws(() => callClaude('p', { runner }), /claude/i);
});
