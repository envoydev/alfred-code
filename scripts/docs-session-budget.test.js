// scripts/docs-session-budget.test.js - docs-session.js answers inside Claude Code's 10s hook timeout on a slow
// repository (the 2026-11-22/23 sessions, card items 1, 2 and 9: SessionStart startup, resume and compact, and Stop,
// cancelled at 10,092-10,986ms in a large checkout, 31,022ms measured cold by hand).
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repo, section } = require('./docs-fixture');

// Claude Code cancels a hook at its 10s timeout; the hook must answer well before it, node's own start included.
const HOOK_TIMEOUT_MS = 10000;
const ANSWER_WITHIN_MS = 8000;
const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.');
const WATCH = JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }] });
const DIRTY = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `src/Api/Orders/${n}.cs`);

// A git that behaves like a cold, large checkout: each work-tree walk takes 3s, a batch hash outruns the engine's 5s
// git timeout, and each single-file hash takes 1s - the shape that cancelled the hook in Speech-Direct.
function slowGit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slow-git-'));
  const real = require('node:child_process').execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'git'), [
    '#!/bin/sh',
    'case " $* " in',
    '  *" --stdin-paths "*) sleep 6 </dev/null >/dev/null 2>&1 ;;',
    '  *" hash-object "*) sleep 1 </dev/null >/dev/null 2>&1 ;;',
    '  *" --others "*|*" -co "*|*" status "*) sleep 3 </dev/null >/dev/null 2>&1 ;;',
    'esac',
    `exec "${real}" "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  return { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` }, rm: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const ctx = (out) => { try { return JSON.parse(out.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
// Run the hook as Claude Code does: cancelled at its timeout, its output then thrown away.
const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'docs-session.js');
function claudeHook(r, payload, extra = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_DOCS_VERSIONING: '', ...extra };
  const at = Date.now();
  const out = require('node:child_process').spawnSync(process.execPath, [HOOK], { cwd: r.root, input: JSON.stringify(payload), encoding: 'utf8', env, timeout: HOOK_TIMEOUT_MS });
  const cancelled = out.signal !== null;
  return { out: cancelled ? { stdout: '' } : out, ms: Date.now() - at, cancelled };
}
const slowRows = (r, sid) => {
  const file = path.join(r.root, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((row) => row.kind === 'slow');
};

function slowRepo() {
  const files = { 'src/Api/Program.cs': 'app.Run();\n' };
  for (const f of DIRTY) files[f] = 'class X {}\n';
  const r = repo({ files, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': 'Api -> Domain. Orders own refunds.\n', 'watch.json': WATCH } });
  for (const f of DIRTY) r.write(f, 'class X { int Changed; }\n');
  return r;
}

const skip = process.platform === 'win32' && 'the slow git stand-in is a shell script, which Windows does not run as git';

test('a cold start on a slow checkout answers inside the hook timeout and still sends the docs map (A1)', { skip }, () => {
  const r = slowRepo();
  const git = slowGit();
  try {
    const sid = 'budget-start-1';
    const { out, ms, cancelled } = claudeHook(r, { hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }, git.env);
    assert.ok(!cancelled && ms < ANSWER_WITHIN_MS, `SessionStart took ${ms}ms - Claude Code cancels it at ${HOOK_TIMEOUT_MS}ms`);
    assert.match(ctx(out), /Orders own refunds/, 'the orientation map reaches the session');
    assert.match(ctx(out), /ran out of its time/, 'the session is told the git-derived lines were left out');
    const rows = slowRows(r, sid);
    assert.strictEqual(rows.length, 1, 'one ledger row names the slow script');
    assert.strictEqual(rows[0].hook, 'docs-session.js');
    assert.strictEqual(rows[0].event, 'SessionStart');
  } finally { git.rm(); r.rm(); }
});

test('a compaction after a cancelled start answers inside the hook timeout (A2)', { skip }, () => {
  const r = slowRepo();
  const git = slowGit();
  try {
    const sid = 'budget-compact-1';
    claudeHook(r, { hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }, git.env);
    for (const source of ['compact', 'resume']) {
      const { out, ms, cancelled } = claudeHook(r, { hook_event_name: 'SessionStart', session_id: sid, source }, git.env);
      assert.ok(!cancelled && ms < ANSWER_WITHIN_MS, `SessionStart:${source} took ${ms}ms`);
      assert.match(ctx(out), /Orders own refunds/, `the map reaches the session after a ${source}`);
    }
  } finally { git.rm(); r.rm(); }
});

test('a Stop on a slow checkout answers inside the hook timeout (A9)', { skip }, () => {
  const r = slowRepo();
  const git = slowGit();
  try {
    const sid = 'budget-stop-1';
    r.hook({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup' });
    r.hook({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Bash', tool_input: { command: 'npm run generate' } });
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const { ms, cancelled } = claudeHook(r, { hook_event_name: 'Stop', session_id: sid, stop_hook_active: false }, git.env);
    assert.ok(!cancelled && ms < ANSWER_WITHIN_MS, `Stop took ${ms}ms - Claude Code cancels it at ${HOOK_TIMEOUT_MS}ms`);
    assert.ok(slowRows(r, sid).some((row) => row.event === 'Stop'), 'the slow Stop is named in the ledger');
  } finally { git.rm(); r.rm(); }
});

// The side review of 2026-11-23: a start the budget cut has no snapshot, and with none the Stop check never asks - in a
// checkout that starts slow every time it would never ask at all.
test('after a slow start the first tool call takes the snapshot, so the Stop docs check still asks', { skip }, () => {
  const r = slowRepo();
  const git = slowGit();
  try {
    const sid = 'budget-deferred-1';
    claudeHook(r, { hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }, git.env);
    // the first call runs on a warm cache: plain git
    r.hook({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Read', tool_input: { file_path: path.join(r.root, 'src/Api/Program.cs') } });
    r.hook({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Bash', tool_input: { command: 'npm run generate' } });
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const out = r.hook({ hook_event_name: 'Stop', session_id: sid, stop_hook_active: false });
    assert.match(out.stdout, /"decision":"block"/, 'the Stop docs check asks');
    assert.match(JSON.parse(out.stdout).reason, /you changed src\/Api\/Program\.cs/);
    assert.doesNotMatch(JSON.parse(out.stdout).reason, /Orders\/a\.cs/, 'what was dirty before the session is not its change');
  } finally { git.rm(); r.rm(); }
});

test('no snapshot is taken once the session has written: the baseline would hold its own change', { skip }, () => {
  const r = slowRepo();
  const git = slowGit();
  try {
    const sid = 'budget-deferred-2';
    claudeHook(r, { hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }, git.env);
    r.hook({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Bash', tool_input: { command: 'npm run generate' } }, git.env);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    r.hook({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Read', tool_input: { file_path: path.join(r.root, 'src/Api/Program.cs') } });
    const out = r.hook({ hook_event_name: 'Stop', session_id: sid, stop_hook_active: false });
    assert.strictEqual(out.stdout, '', 'a snapshot taken after the write would hide it, so none is taken and nothing is asked');
  } finally { git.rm(); r.rm(); }
});

test('a fast checkout keeps the full start block and writes no slow row', { skip }, () => {
  const r = slowRepo();
  try {
    const sid = 'budget-fast-1';
    const out = r.hook({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup' });
    assert.match(ctx(out), /Orders own refunds/);
    assert.doesNotMatch(ctx(out), /ran out of its time/);
    assert.deepStrictEqual(slowRows(r, sid), []);
  } finally { r.rm(); }
});
