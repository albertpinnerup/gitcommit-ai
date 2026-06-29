import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collect, assertRepoState } from '../src/git/status.ts';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gca-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir });
  g('init', '-q');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return { dir, g };
}

test('collect returns diff, tracked files, and log; ignores untracked', () => {
  const { dir } = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');     // modify tracked
  writeFileSync(join(dir, 'untracked.txt'), 'x\n');    // untracked -> excluded
  const result = collect({ runGit: (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }});
  assert.deepEqual(result.files, [{ status: 'M', path: 'a.txt' }]);
  assert.match(result.diff, /\+two/);
  assert.match(result.log, /init/);
  rmSync(dir, { recursive: true, force: true });
});

test('assertRepoState throws outside a repo', () => {
  assert.throws(() => assertRepoState({ runGit: () => ({ status: 128, stdout: '', stderr: 'not a git repo' }) }), /git repo/i);
});
