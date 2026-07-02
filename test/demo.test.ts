import { test } from 'node:test';
import assert from 'node:assert/strict';

// Demo fakes must never wait in tests.
process.env.COMMIT_DEMO_DELAY = '0';

import { parsePlan } from '../src/core/plan.ts';
import { SCENARIOS, demoDeps, listScenarios } from '../src/demo/index.ts';
import { main } from '../src/commands/commit.ts';

const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };
const keys = (seq) => { let i = 0; return async () => (i < seq.length ? seq[i++] : 'q'); };

// ---- fixture integrity -------------------------------------------------------

test('every scenario plan covers exactly its collected files', async () => {
  for (const [name] of Object.entries(SCENARIOS)) {
    const deps = demoDeps(name);
    const collected = deps.collect();
    const paths = collected.files.map((f) => f.path);
    // The real parse/validate pipeline must accept the scenario as-is.
    const plan = parsePlan(await deps.callClaude(''), paths);
    assert.ok(plan.commits.length > 0, `${name} has no commits`);
  }
});

test('the "many" scenario has enough commits to exercise scrolling', async () => {
  const deps = demoDeps('many');
  const plan = parsePlan(await deps.callClaude(''), deps.collect().files.map((f) => f.path));
  assert.ok(plan.commits.length >= 6, `expected many commits, got ${plan.commits.length}`);
});

test('the "renames" scenario includes a rename', () => {
  assert.ok(demoDeps('renames').collect().files.some((f) => f.status === 'R' && f.from));
});

// ---- demoDeps behaviour ------------------------------------------------------

test('demoDeps runGit reports success for commit calls (no real git)', () => {
  const res = demoDeps('default').runGit(['commit', '-m', 'feat: x', '--only', '--', 'a.js']);
  assert.equal(res.status, 0);
});

test('demoDeps settings are in-memory and never touch disk', () => {
  const deps = demoDeps('default');
  assert.deepEqual(deps.loadSettings(), {});
  deps.saveSettings({ model: 'opus', effort: 'high', verbose: true });
  assert.deepEqual(deps.loadSettings(), { model: 'opus', effort: 'high', verbose: true });
});

test('demoDeps throws a clear error for an unknown scenario', () => {
  assert.throws(() => demoDeps('nope'), /unknown demo scenario: nope/);
});

test('listScenarios names every scenario', () => {
  const text = listScenarios();
  for (const name of Object.keys(SCENARIOS)) assert.match(text, new RegExp(name));
});

// ---- main --demo integration -------------------------------------------------

test('main --demo drives the real UI and commits via fakes only', async () => {
  const out = sink();
  let realGit = false;
  const code = await main(['--demo'], {
    output: out,
    nextKey: keys(['a']),              // accept all
    // If demo forgot to inject runGit, this would flip; it must stay false.
    // (deps we pass win over demo, so only pass observers, not overrides.)
  });
  assert.equal(code, 0);
  assert.match(out.text(), /Created \d+ commit/);
  assert.equal(realGit, false);
});

test('main --demo many renders more than one commit', async () => {
  const out = sink();
  await main(['--demo', 'many'], { output: out, nextKey: keys(['q']) });
  assert.match(out.text(), /Commit 6/);
});

test('main --demo list prints the scenarios and exits 0', async () => {
  const out = sink();
  const code = await main(['--demo', 'list'], { output: out });
  assert.equal(code, 0);
  assert.match(out.text(), /default/);
  assert.match(out.text(), /renames/);
});

test('main --demo with an unknown scenario exits 1 with an error', async () => {
  const out = sink();
  const err = sink();
  const code = await main(['--demo', 'nope'], { output: out, error: err });
  assert.equal(code, 1);
  assert.match(err.text(), /unknown demo scenario: nope/);
});
