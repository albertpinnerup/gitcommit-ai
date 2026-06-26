import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, validatePlan, parsePlan } from '../gitcommit-ai.mjs';

test('extractJson strips code fences and surrounding prose', () => {
  const text = 'Sure!\n```json\n{"commits":[]}\n```\nDone.';
  assert.deepEqual(extractJson(text), { commits: [] });
});

test('extractJson handles bare JSON', () => {
  assert.deepEqual(extractJson('{"commits":[]}'), { commits: [] });
});

test('extractJson throws when no JSON object present', () => {
  assert.throws(() => extractJson('no json here'), /no JSON/i);
});

test('validatePlan accepts a plan whose files exactly cover the change set', () => {
  const plan = { commits: [
    { files: ['a.js'], type: 'feat', subject: 'add a' },
    { files: ['b.js'], type: 'fix', subject: 'fix b' },
  ]};
  assert.equal(validatePlan(plan, ['a.js', 'b.js']), plan);
});

test('validatePlan rejects a missing file', () => {
  const plan = { commits: [{ files: ['a.js'], type: 'feat', subject: 'a' }] };
  assert.throws(() => validatePlan(plan, ['a.js', 'b.js']), /b\.js/);
});

test('validatePlan rejects an unknown file', () => {
  const plan = { commits: [{ files: ['a.js', 'z.js'], type: 'feat', subject: 'a' }] };
  assert.throws(() => validatePlan(plan, ['a.js']), /z\.js/);
});

test('validatePlan rejects a file in two commits', () => {
  const plan = { commits: [
    { files: ['a.js'], type: 'feat', subject: 'a' },
    { files: ['a.js'], type: 'fix', subject: 'a again' },
  ]};
  assert.throws(() => validatePlan(plan, ['a.js']), /more than one/i);
});

test('validatePlan rejects an invalid type', () => {
  const plan = { commits: [{ files: ['a.js'], type: 'banana', subject: 'a' }] };
  assert.throws(() => validatePlan(plan, ['a.js']), /type/i);
});

test('validatePlan rejects an empty subject', () => {
  const plan = { commits: [{ files: ['a.js'], type: 'feat', subject: '' }] };
  assert.throws(() => validatePlan(plan, ['a.js']), /subject/i);
});

test('parsePlan composes extract + validate', () => {
  const text = '```json\n{"commits":[{"files":["a.js"],"type":"feat","subject":"a"}]}\n```';
  const plan = parsePlan(text, ['a.js']);
  assert.equal(plan.commits.length, 1);
});
