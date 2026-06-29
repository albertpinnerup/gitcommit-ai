import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlan, reviewGate } from '../gitcommit-ai.mjs';

function lineSource(lines) {
  let i = 0;
  return async () => (i < lines.length ? lines[i++] : 'q');
}
const sink = () => { const buf = []; return { write: (s) => buf.push(s), text: () => buf.join('') }; };

const PLAN = { commits: [
  { files: ['a.js'], type: 'feat', subject: 'add a' },
  { files: ['b.js'], type: 'fix', subject: 'fix b' },
]};

test('renderPlan shows each message and its files', () => {
  const text = renderPlan(PLAN);
  assert.match(text, /feat: add a/);
  assert.match(text, /a\.js/);
  assert.match(text, /fix: fix b/);
});

test('reviewGate approve-all returns the plan', async () => {
  const out = sink();
  const result = await reviewGate(PLAN, { input: lineSource(['a']), output: out });
  assert.deepEqual(result, PLAN);
});

test('reviewGate quit returns null', async () => {
  const result = await reviewGate(PLAN, { input: lineSource(['q']), output: sink() });
  assert.equal(result, null);
});

test('reviewGate skip drops a commit then approves', async () => {
  const result = await reviewGate(PLAN, { input: lineSource(['s 2', 'a']), output: sink() });
  assert.equal(result.commits.length, 1);
  assert.equal(result.commits[0].subject, 'add a');
});

test('reviewGate edit replaces a subject', async () => {
  const result = await reviewGate(PLAN, { input: lineSource(['e 1', 'renamed subject', 'a']), output: sink() });
  assert.equal(result.commits[0].subject, 'renamed subject');
});

test('reviewGate autoApply returns plan without input', async () => {
  const result = await reviewGate(PLAN, { autoApply: true, output: sink() });
  assert.deepEqual(result, PLAN);
});
