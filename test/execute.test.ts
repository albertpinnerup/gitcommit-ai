import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execute } from '../src/git/commit.ts';
import { runGit } from '../src/git/run.ts';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gca-exec-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t.t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a\n'); writeFileSync(join(dir, 'b.txt'), 'b\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  return { dir, g };
}

test('execute creates one commit per plan entry with the right files', () => {
  const { dir, g } = makeRepo();
  writeFileSync(join(dir, 'a.txt'), 'a2\n');
  writeFileSync(join(dir, 'b.txt'), 'b2\n');
  const runGit = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const plan = { commits: [
    { files: ['a.txt'], type: 'feat', subject: 'change a' },
    { files: ['b.txt'], type: 'fix', subject: 'change b' },
  ]};
  const result = execute(plan, { runGit });
  assert.equal(result.committed.length, 2);
  const log = g('log', '--oneline').stdout;
  assert.match(log, /change a/);
  assert.match(log, /change b/);
  // the HEAD commit (change b) touched exactly b.txt
  const show = g('show', '--name-only', '--format=%s', 'HEAD').stdout;
  assert.match(show, /change b/);
  assert.match(show, /b\.txt/);
  assert.doesNotMatch(show, /a\.txt/);
  rmSync(dir, { recursive: true, force: true });
});

test('runGit returns a failed GitResult instead of throwing when git is unreachable', () => {
  // Manipulate Bun.spawnSync to throw ENOENT (mimics missing binary)
  const originalSpawnSync = (global as any).Bun.spawnSync;
  (global as any).Bun.spawnSync = () => {
    throw new Error('ENOENT: no such file or directory, spawn git');
  };
  try {
    const result = runGit(['status']);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.length > 0);
  } finally {
    (global as any).Bun.spawnSync = originalSpawnSync;
  }
});
