import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude } from '../gitcommit-ai.mjs';

test('callClaude returns .result from the wrapper JSON', async () => {
  const runner = () => ({ status: 0, stdout: JSON.stringify({ result: 'MODEL_TEXT' }), stderr: '' });
  assert.equal(await callClaude('p', { runner }), 'MODEL_TEXT');
});

test('callClaude returns raw stdout when not wrapper JSON', async () => {
  const runner = () => ({ status: 0, stdout: '{"commits":[]}', stderr: '' });
  assert.equal(await callClaude('p', { runner }), '{"commits":[]}');
});

test('callClaude accepts an async runner', async () => {
  const runner = async () => ({ status: 0, stdout: JSON.stringify({ result: 'ASYNC_TEXT' }), stderr: '' });
  assert.equal(await callClaude('p', { runner }), 'ASYNC_TEXT');
});

test('callClaude rejects on non-zero exit', async () => {
  const runner = () => ({ status: 1, stdout: '', stderr: 'boom' });
  await assert.rejects(callClaude('p', { runner }), /claude/i);
});
