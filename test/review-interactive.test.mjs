import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  decodeKeys, editorReduce, renderReview, interactiveReview, executeOne,
  settingsReduce, renderSettings, fileSelectReduce, renderFileSelect,
} from '../gitcommit-ai.mjs';

const PLAN = { commits: [
  { files: ['a.js'], type: 'feat', subject: 'add a' },
  { files: ['b.js'], type: 'fix', subject: 'fix b' },
]};

// ---- decodeKeys --------------------------------------------------------------

test('decodeKeys maps arrows, enter, ctrl-c, and plain chars', () => {
  assert.deepEqual(decodeKeys('\x1b[A'), ['up']);
  assert.deepEqual(decodeKeys('\x1b[B'), ['down']);
  assert.deepEqual(decodeKeys('\r'), ['enter']);
  assert.deepEqual(decodeKeys('\n'), ['enter']);
  assert.deepEqual(decodeKeys('\x03'), ['ctrl-c']);
  assert.deepEqual(decodeKeys('a'), ['a']);
  assert.deepEqual(decodeKeys('\x1b[Bq'), ['down', 'q']);
});

test('decodeKeys maps backspace, escape, home, and end', () => {
  assert.deepEqual(decodeKeys('\x7f'), ['backspace']);
  assert.deepEqual(decodeKeys('\x08'), ['backspace']);
  assert.deepEqual(decodeKeys('\x1b'), ['escape']);
  assert.deepEqual(decodeKeys('\x1b[H'), ['home']);
  assert.deepEqual(decodeKeys('\x1b[F'), ['end']);
  assert.deepEqual(decodeKeys('\x1b[3~'), ['delete']);
});

test('editorReduce inserts, backspaces, and moves the cursor', () => {
  let s = { buf: 'add a', pos: 5 };
  s = editorReduce(s, 'backspace').state;          // 'add '
  assert.deepEqual(s, { buf: 'add ', pos: 4 });
  s = editorReduce(s, 'b').state;                  // 'add b'
  assert.deepEqual(s, { buf: 'add b', pos: 5 });
  s = editorReduce(s, 'home').state;
  assert.equal(s.pos, 0);
  s = editorReduce(s, 'right').state;
  assert.equal(s.pos, 1);
  s = editorReduce(s, 'X').state;                  // insert at pos 1 -> 'aXdd b'
  assert.deepEqual(s, { buf: 'aXdd b', pos: 2 });
});

test('editorReduce: enter accepts, escape and ctrl-c cancel', () => {
  assert.deepEqual(editorReduce({ buf: 'hi', pos: 2 }, 'enter'), { done: true, value: 'hi' });
  assert.equal(editorReduce({ buf: 'hi', pos: 2 }, 'escape').cancelled, true);
  assert.equal(editorReduce({ buf: 'hi', pos: 2 }, 'ctrl-c').cancelled, true);
});

// ---- renderReview ------------------------------------------------------------

test('renderReview numbers commits and marks the focused one', () => {
  const text = renderReview({ commits: PLAN.commits, cursor: 1, committed: [] }, { color: false });
  const lines = text.split('\n');
  // numbered labels are present
  assert.match(text, /Commit 1/);
  assert.match(text, /Commit 2/);
  // focus marker sits on the focused commit's label row (Commit 2), not Commit 1
  const c1 = lines.find((l) => l.includes('Commit 1'));
  const c2 = lines.find((l) => l.includes('Commit 2'));
  assert.ok(!c1.includes('❯'));
  assert.ok(c2.includes('❯'));
  assert.match(text, /enter accept/i);
  assert.match(text, /regen/i);
  assert.match(text, /settings/i);
  assert.match(text, /quit/i);
});

test('renderReview truncates long lines to width so they never wrap', () => {
  const long = { commits: [{ files: ['x'], type: 'feat', subject: 'x'.repeat(200) }], cursor: 0, committed: [] };
  const text = renderReview(long, { color: false, width: 40 });
  for (const line of text.split('\n')) {
    assert.ok(line.length <= 40, `line exceeds width: ${line.length}`);
  }
  assert.match(text, /…/); // truncation marker present
});

test('renderReview windows a long list to height and keeps the cursor visible', () => {
  const commits = Array.from({ length: 40 }, (_, i) => ({ files: [`f${i}.js`], type: 'feat', subject: `commit ${i}` }));
  const text = renderReview({ commits, cursor: 20, committed: [] }, { color: false, width: 80, height: 12 });
  const lines = text.split('\n');
  assert.ok(lines.length <= 12, `panel taller than height: ${lines.length}`);
  assert.match(text, /feat: commit 20/);  // focused commit is on screen
  assert.match(text, /↑ \d+ more/);        // hidden-above indicator
  assert.match(text, /↓ \d+ more/);        // hidden-below indicator
});

test('renderReview with an empty commit list and a height shows no negative hints', () => {
  const text = renderReview({ commits: [], cursor: 0, committed: [{ subject: 'feat: x', files: ['a'] }] }, { color: false, width: 80, height: 20 });
  assert.doesNotMatch(text, /-\d+ more/);
  assert.doesNotMatch(text, /↓ -/);
});

test('renderReview shows the body lines of a verbose commit', () => {
  const commits = [{ files: ['a.js'], type: 'feat', subject: 'add x', body: 'line one\nline two' }];
  const text = renderReview({ commits, cursor: 0, committed: [] }, { color: false });
  assert.match(text, /feat: add x/);
  assert.match(text, /line one/);
  assert.match(text, /line two/);
});

test('renderReview shows committed progress', () => {
  const text = renderReview(
    { commits: [PLAN.commits[1]], cursor: 0, committed: [{ subject: 'add a', files: ['a.js'] }] },
    { color: false },
  );
  assert.match(text, /committed 1/i);
});

// ---- interactiveReview (injected keys + fake git) ----------------------------

function fakeGit() {
  const subjects = [];
  const runGit = (args) => {
    if (args[0] === 'commit') subjects.push(args[2]); // the -m <subject>
    return { status: 0, stdout: '', stderr: '' };
  };
  return { runGit, subjects };
}
function keys(seq) { let i = 0; return async () => (i < seq.length ? seq[i++] : 'q'); }
const sink = () => { const b = []; return { write: (s) => b.push(s), text: () => b.join('') }; };

test('interactiveReview: enter commits only the focused commit', async () => {
  const { runGit, subjects } = fakeGit();
  const res = await interactiveReview(PLAN, { nextKey: keys(['enter', 'q']), output: sink(), runGit });
  assert.deepEqual(subjects, ['feat: add a']);
  assert.equal(res.committed.length, 1);
});

test('interactiveReview: arrow down then enter commits the second', async () => {
  const { runGit, subjects } = fakeGit();
  await interactiveReview(PLAN, { nextKey: keys(['down', 'enter', 'q']), output: sink(), runGit });
  assert.deepEqual(subjects, ['fix: fix b']);
});

test('interactiveReview: a accepts all remaining in order', async () => {
  const { runGit, subjects } = fakeGit();
  const res = await interactiveReview(PLAN, { nextKey: keys(['a']), output: sink(), runGit });
  assert.deepEqual(subjects, ['feat: add a', 'fix: fix b']);
  assert.equal(res.committed.length, 2);
});

test('interactiveReview: s skips a commit without committing it', async () => {
  const { runGit, subjects } = fakeGit();
  await interactiveReview(PLAN, { nextKey: keys(['s', 'enter', 'q']), output: sink(), runGit });
  assert.deepEqual(subjects, ['fix: fix b']); // first dropped, second committed
});

test('interactiveReview: e pre-fills the full header and lets you change the tag', async () => {
  const { runGit, subjects } = fakeGit();
  let seenInitial;
  const readLine = async (_prompt, initial) => { seenInitial = initial; return 'feat(upgrade): add a'; };
  await interactiveReview(PLAN, { nextKey: keys(['e', 'enter', 'q']), readLine, output: sink(), runGit });
  assert.equal(seenInitial, 'feat: add a');                // pre-filled with the whole tag+subject
  assert.deepEqual(subjects, ['feat(upgrade): add a']);    // edited tag is what gets committed
});

test('interactiveReview: cancelling an edit (null) keeps the original message', async () => {
  const { runGit, subjects } = fakeGit();
  const readLine = async () => null;              // user pressed esc
  await interactiveReview(PLAN, { nextKey: keys(['e', 'enter', 'q']), readLine, output: sink(), runGit });
  assert.deepEqual(subjects, ['feat: add a']);    // unchanged
});

// Capture the full `git commit` arg list (subject + optional body) per commit.
function commitArgsRecorder() {
  const calls = [];
  const runGit = (args) => {
    if (args[0] === 'commit') calls.push(args.slice(1));
    return { status: 0, stdout: '', stderr: '' };
  };
  return { runGit, calls };
}

test('interactiveReview: E adds a body to a subject-only commit', async () => {
  const { runGit, calls } = commitArgsRecorder();
  let seenInitial;
  const readLine = async (_p, initial) => { seenInitial = initial; return 'because reasons'; };
  await interactiveReview(
    { commits: [{ files: ['a.js'], type: 'feat', subject: 'add a' }] },
    { nextKey: keys(['E', 'enter', 'q']), readLine, output: sink(), runGit },
  );
  assert.equal(seenInitial, '');  // no prior body
  assert.deepEqual(calls[0], ['-m', 'feat: add a', '-m', 'because reasons']);
});

test('interactiveReview: E pre-fills an existing body with literal \\n and restores newlines', async () => {
  const { runGit, calls } = commitArgsRecorder();
  let seenInitial;
  const readLine = async (_p, initial) => { seenInitial = initial; return 'one\\ntwo'; };
  await interactiveReview(
    { commits: [{ files: ['a.js'], type: 'feat', subject: 'x', body: 'old one\nold two' }] },
    { nextKey: keys(['E', 'enter', 'q']), readLine, output: sink(), runGit },
  );
  assert.equal(seenInitial, 'old one\\nold two');           // existing body shown single-line
  assert.deepEqual(calls[0], ['-m', 'feat: x', '-m', 'one\ntwo']); // \n converted to real newline
});

test('interactiveReview: E with empty input clears the body', async () => {
  const { runGit, calls } = commitArgsRecorder();
  await interactiveReview(
    { commits: [{ files: ['a.js'], type: 'feat', subject: 'x', body: 'remove me' }] },
    { nextKey: keys(['E', 'enter', 'q']), readLine: async () => '', output: sink(), runGit },
  );
  assert.deepEqual(calls[0], ['-m', 'feat: x']); // no -m body
});

test('interactiveReview: E cancel (null) keeps the existing body', async () => {
  const { runGit, calls } = commitArgsRecorder();
  await interactiveReview(
    { commits: [{ files: ['a.js'], type: 'feat', subject: 'x', body: 'keep me' }] },
    { nextKey: keys(['E', 'enter', 'q']), readLine: async () => null, output: sink(), runGit },
  );
  assert.deepEqual(calls[0], ['-m', 'feat: x', '-m', 'keep me']);
});

test('interactiveReview: q with nothing committed returns empty', async () => {
  const { runGit, subjects } = fakeGit();
  const res = await interactiveReview(PLAN, { nextKey: keys(['q']), output: sink(), runGit });
  assert.deepEqual(subjects, []);
  assert.equal(res.committed.length, 0);
});

// ---- settings pane ----------------------------------------------------------

test('settingsReduce navigates fields and cycles values', () => {
  let s = { settings: { model: 'sonnet', effort: 'low', verbose: false }, cursor: 0 };
  s = settingsReduce(s, 'right').state;                 // model: sonnet -> opus
  assert.equal(s.settings.model, 'opus');
  s = settingsReduce(s, 'left').state;                  // back to sonnet
  assert.equal(s.settings.model, 'sonnet');
  s = settingsReduce(s, 'down').state;                  // focus effort
  s = settingsReduce(s, 'right').state;                 // low -> medium
  assert.equal(s.settings.effort, 'medium');
  s = settingsReduce(s, 'down').state;                  // focus verbose
  s = settingsReduce(s, 'right').state;                 // toggle on
  assert.equal(s.settings.verbose, true);
  assert.equal(settingsReduce(s, 'escape').done, true); // esc closes
  assert.equal(settingsReduce(s, 'enter').done, true);
});

test('renderSettings shows fields, focus marker, and a hint', () => {
  const text = renderSettings({ settings: { model: 'opus', effort: 'high', verbose: true }, cursor: 1 }, { color: false });
  assert.match(text, /model:.*opus/);
  assert.match(text, /effort:.*high/);
  assert.match(text, /verbose:.*on/);
  const effortLine = text.split('\n').find((l) => l.includes('effort'));
  assert.ok(effortLine.includes('❯'));   // cursor on effort row
});

test('renderReview shows current settings when provided', () => {
  const text = renderReview(
    { commits: PLAN.commits, cursor: 0, committed: [] },
    { color: false, settings: { model: 'opus', effort: 'low', verbose: true } },
  );
  assert.match(text, /settings: opus · low · verbose/);
});

// ---- file multi-select + add-your-own / instruct-claude ---------------------

test('fileSelectReduce toggles, navigates, and confirms the checked paths', () => {
  let s = { items: [{ path: 'a', on: true }, { path: 'b', on: false }], cursor: 0 };
  s = fileSelectReduce(s, 'down').state;            // focus b
  s = fileSelectReduce(s, ' ').state;               // toggle b on
  assert.deepEqual(fileSelectReduce(s, 'enter'), { done: true, selected: ['a', 'b'] });
  assert.deepEqual(fileSelectReduce(s, 'escape'), { done: true, cancelled: true });
});

test('renderFileSelect shows checkboxes and a hint', () => {
  const text = renderFileSelect({ items: [{ path: 'a.js', on: true }, { path: 'b.js', on: false }], cursor: 0 }, { color: false });
  assert.match(text, /\[x\] a\.js/);
  assert.match(text, /\[ \] b\.js/);
  assert.match(text, /space toggle/);
});

test('interactiveReview: n builds your own commit, moving files and dropping empties', async () => {
  const { runGit, subjects } = fakeGit();
  // start focused on commit 1 (a.js). open n -> b.js is also offered; toggle it on
  // (down to b, space), confirm (enter), type a message, then accept all.
  const readLine = async () => 'chore: my own grouping';
  // file-select: cursor starts at 0 (a.js, on). down->b.js, space toggle on, enter.
  const seq = ['n', 'down', ' ', 'enter', /* message editor */ 'a'];
  let i = 0;
  const nextKey = async () => (i < seq.length ? seq[i++] : 'q');
  const res = await interactiveReview(
    { commits: [
      { files: ['a.js'], type: 'feat', subject: 'one' },
      { files: ['b.js'], type: 'fix', subject: 'two' },
    ]},
    { nextKey, readLine, output: sink(), runGit },
  );
  // both files now in a single hand-written commit; the two originals are gone
  assert.deepEqual(subjects, ['chore: my own grouping']);
  assert.equal(res.committed.length, 1);
  assert.deepEqual(res.committed[0].files, ['a.js', 'b.js']);
});

test('interactiveReview: p re-plans with the typed instruction', async () => {
  const { runGit, subjects } = fakeGit();
  let seenInstruction;
  const replan = async (_settings, instruction) => {
    seenInstruction = instruction;
    return { commits: [{ files: ['a.js', 'b.js'], type: 'refactor', subject: 'regrouped per request' }] };
  };
  const readLine = async () => 'merge everything into one commit';
  await interactiveReview(
    { commits: [{ files: ['a.js'], type: 'feat', subject: 'x' }, { files: ['b.js'], type: 'fix', subject: 'y' }] },
    { nextKey: keys(['p', 'a']), readLine, output: sink(), runGit, replan },
  );
  assert.equal(seenInstruction, 'merge everything into one commit');
  assert.deepEqual(subjects, ['refactor: regrouped per request']);
});

// ---- regeneration -----------------------------------------------------------

test('interactiveReview: R regenerates the focused commit, keeping its files', async () => {
  const { runGit, subjects } = fakeGit();
  let askedFor;
  const regenerateCommit = async (commit) => { askedFor = commit.files; return { type: 'refactor', subject: 'reworked a' }; };
  await interactiveReview(PLAN, {
    nextKey: keys(['R', 'enter', 'q']), output: sink(), runGit, regenerateCommit,
  });
  assert.deepEqual(askedFor, ['a.js']);          // regen was asked about the focused commit's files
  assert.deepEqual(subjects, ['refactor: reworked a']); // new message committed
});

test('interactiveReview: r then g re-plans (regroup) via replan', async () => {
  const { runGit, subjects } = fakeGit();
  const replan = async () => ({ commits: [{ files: ['a.js', 'b.js'], type: 'feat', subject: 'merged' }] });
  await interactiveReview(PLAN, {
    nextKey: keys(['r', 'g', 'a']), output: sink(), runGit, replan,
  });
  assert.deepEqual(subjects, ['feat: merged']);  // regrouped into one commit, then accept-all
});

test('interactiveReview: r then m rewrites each message, keeping grouping', async () => {
  const { runGit, subjects } = fakeGit();
  let calls = 0;
  const regenerateCommit = async (commit) => { calls++; return { type: 'chore', subject: `redone ${commit.files[0]}` }; };
  await interactiveReview(PLAN, {
    nextKey: keys(['r', 'm', 'a']), output: sink(), runGit, regenerateCommit,
  });
  assert.equal(calls, 2);                         // both commits' messages regenerated
  assert.deepEqual(subjects, ['chore: redone a.js', 'chore: redone b.js']);
});

test('interactiveReview: c opens settings, change flows into regeneration', async () => {
  const { runGit } = fakeGit();
  let seenVerbose;
  const regenerateCommit = async (_c, s) => { seenVerbose = s.verbose; return { type: 'fix', subject: 'x' }; };
  // c -> focus verbose (down,down) -> toggle (right) -> close (esc) -> R regen -> q
  await interactiveReview(PLAN, {
    nextKey: keys(['c', 'down', 'down', 'right', 'escape', 'R', 'q']),
    output: sink(), runGit, regenerateCommit,
    settings: { model: 'sonnet', effort: 'low', verbose: false },
  });
  assert.equal(seenVerbose, true);  // the toggled setting reached the regen callback
});

// ---- executeOne against a real repo ------------------------------------------

test('executeOne commits exactly one commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gca-one-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t.t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a\n'); writeFileSync(join(dir, 'b.txt'), 'b\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  writeFileSync(join(dir, 'a.txt'), 'a2\n'); writeFileSync(join(dir, 'b.txt'), 'b2\n');
  const runGit = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const out = executeOne({ files: ['a.txt'], type: 'feat', subject: 'change a' }, { runGit });
  assert.equal(out.subject, 'feat: change a'); // reports the actual committed header
  const show = g('show', '--name-only', '--format=%s', 'HEAD').stdout;
  assert.match(show, /change a/);
  assert.match(show, /a\.txt/);
  assert.doesNotMatch(show, /b\.txt/); // b.txt left uncommitted
  rmSync(dir, { recursive: true, force: true });
});
