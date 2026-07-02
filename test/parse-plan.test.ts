import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { extractJson, validatePlan, parsePlan, parseMessage, repairPlan } from '../src/core/plan.ts';

test('repairPlan keeps a duplicated file in its first commit and drops emptied commits', () => {
  const plan = { commits: [
    { files: ['a.js', 'shared.js'], type: 'feat', subject: 'a' },
    { files: ['shared.js'], type: 'test', subject: 'b' },        // dup -> becomes empty -> dropped
    { files: ['c.js'], type: 'docs', subject: 'c' },
  ]};
  const repaired = repairPlan(plan);
  assert.deepEqual(repaired.commits.map((commit) => commit.files), [['a.js', 'shared.js'], ['c.js']]);
});

test('parsePlan no longer throws when a file is listed in two commits', () => {
  const raw = JSON.stringify({ commits: [
    { files: ['big.js'], type: 'feat', subject: 'feature' },
    { files: ['big.js'], type: 'test', subject: 'tests' },
  ]});
  const plan = parsePlan(raw, ['big.js']);
  assert.equal(plan.commits.length, 1);
  assert.deepEqual(plan.commits[0].files, ['big.js']);
});

test('parsePlan reconciles a rename old path via aliases (diff shows the old path)', () => {
  const raw = JSON.stringify({ commits: [
    { files: ['src/old.mjs'], type: 'refactor', subject: 'rename to ts' },
  ]});
  const aliases = new Map([['src/old.mjs', 'src/new.ts']]);
  const plan = parsePlan(raw, ['src/new.ts'], aliases);
  assert.deepEqual(plan.commits[0].files, ['src/new.ts']);
});

test('parseMessage extracts a single validated message', () => {
  const m = parseMessage('{"type":"feat","scope":"cli","subject":"add flag","body":"why"}');
  assert.deepEqual(m, { type: 'feat', scope: 'cli', subject: 'add flag', body: 'why' });
});

test('parseMessage omits empty scope/body and trims subject', () => {
  assert.deepEqual(parseMessage('{"type":"fix","subject":"  bug  ","body":""}'), { type: 'fix', subject: 'bug' });
});

test('parseMessage rejects an invalid type or missing subject', () => {
  assert.throws(() => parseMessage('{"type":"banana","subject":"x"}'), /type/i);
  assert.throws(() => parseMessage('{"type":"feat","subject":""}'), /subject/i);
});

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
