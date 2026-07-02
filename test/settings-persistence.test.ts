import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings } from '../src/config.ts';
import { main, resolveSettings } from '../src/commands/commit.ts';
import { parseArgs } from '../src/cli.ts';

test('resolveSettings: CLI/env > saved > default', () => {
  // defaults when nothing is set
  assert.deepEqual(
    resolveSettings(parseArgs([]), {}, {}),
    { model: 'claude-sonnet-4-6', effort: 'low', verbose: false },
  );
  // saved values fill in over defaults
  assert.deepEqual(
    resolveSettings(parseArgs([]), {}, { model: 'opus', effort: 'high', verbose: true }),
    { model: 'opus', effort: 'high', verbose: true },
  );
  // CLI flag and env var win over saved
  assert.deepEqual(
    resolveSettings(parseArgs(['--model', 'haiku']), { COMMIT_EFFORT: 'medium' }, { model: 'opus', effort: 'high' }),
    { model: 'haiku', effort: 'medium', verbose: false },
  );
  // -v turns verbose on
  assert.equal(resolveSettings(parseArgs(['-v']), {}, {}).verbose, true);
});

test('saveSettings then loadSettings round-trips the known keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gca-cfg-'));
  const path = join(dir, 'nested', 'settings.json'); // nested dir is created
  assert.equal(saveSettings({ model: 'opus', effort: 'high', verbose: true, junk: 1 }, path), true);
  assert.deepEqual(loadSettings(path), { model: 'opus', effort: 'high', verbose: true });
  rmSync(dir, { recursive: true, force: true });
});

test('loadSettings returns {} when the file is missing or invalid', () => {
  assert.deepEqual(loadSettings(join(tmpdir(), 'definitely-not-here-12345.json')), {});
});

test('saveSettings never throws on an unwritable path', () => {
  assert.equal(saveSettings({ model: 'x' }, '/this/path/cannot/exist/settings.json'), false);
});

// ---- main wiring ------------------------------------------------------------

const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };
const FAKE_COLLECT = () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }], log: 'l' });
const FAKE_CLAUDE = () => JSON.stringify({ commits: [{ files: ['a.js'], type: 'feat', subject: 'add a' }] });

test('main uses saved verbose for the initial plan (asks Claude for a body)', async () => {
  let promptSeen = '';
  const callClaude = (prompt) => { promptSeen = prompt; return FAKE_CLAUDE(); };
  await main(['--dry-run'], {
    collect: FAKE_COLLECT,
    callClaude,
    output: sink(),
    loadSettings: () => ({ verbose: true }), // saved verbose
  });
  assert.match(promptSeen, /short body/i);    // verbose body rule reached the prompt
});

test('main persists the final settings after an interactive session', async () => {
  let savedWith;
  const runGit = () => ({ status: 0, stdout: '', stderr: '' });
  await main([], {
    collect: () => ({ diff: 'd', files: [{ status: 'M', path: 'a.js' }, { status: 'M', path: 'b.js' }], log: 'l' }),
    callClaude: () => JSON.stringify({ commits: [
      { files: ['a.js'], type: 'feat', subject: 'a' },
      { files: ['b.js'], type: 'fix', subject: 'b' },
    ]}),
    output: sink(),
    runGit,
    nextKey: (() => { const seq = ['a']; let i = 0; return async () => (i < seq.length ? seq[i++] : 'q'); })(),
    loadSettings: () => ({ model: 'opus', effort: 'high', verbose: true }),
    saveSettings: (s) => { savedWith = s; },
  });
  assert.deepEqual(savedWith, { model: 'opus', effort: 'high', verbose: true });
});
