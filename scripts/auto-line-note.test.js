'use strict';
// C16 (session audit 2026-11-27, N01): a real close listed an 'Auto:' line that said auto-run answered an ask, and the hook
// ledger held no auto-answer row for it. The Stop path counts the reply's 'auto: ... ->' lines outside code blocks against the
// entries of `detail.answers` on the auto-answer rows since the run marker's start (the session start with no marker), and adds
// ONE note when the lines outnumber them. The note is context: exit 0, no `decision: block`.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-line-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
delete process.env.CLAUDE_PROJECT_DIR;
process.chdir(TMP);

const NOTE = 'no auto-run answer is on record for this - say what really happened';
let n = 0;
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// One project, one session; `marker` is the run marker's start (ms) or null, `rowsAt` the auto-answer rows as [ms, answers].
function stop(reply, { marker = null, rows = [], typedAfterRows = false } = {})
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    const sid = `s${++n}`;
    const blocks = path.join(root, '.alfred', 'statistics', 'hook-blocks');
    const sessions = path.join(root, '.alfred', 'state', 'sessions');
    fs.mkdirSync(blocks, { recursive: true });
    fs.mkdirSync(sessions, { recursive: true });
    if (marker !== null) fs.writeFileSync(path.join(sessions, `AUTO-RUN-${sid}`), `skill: task-solve\nprompt: abc\nat: ${iso(marker)}\n`);
    if (rows.length) fs.writeFileSync(path.join(blocks, `${sid}.jsonl`), rows.map(([at, answers]) => JSON.stringify({ ts: iso(at), hook: 'guard-stop-contract.js', event: 'PreToolUse',
        tool: 'AskUserQuestion', mode: 'auto', kind: 'auto-answer', reason: 'auto-mode: answered with the Recommended option', detail: { answers } })).join('\n') + '\n');
    const t = path.join(TMP, `t-${n}.jsonl`);
    const at = iso(Date.now() - 60000);
    const lines = [{ type: 'user', timestamp: at, message: { role: 'user', content: 'go' } }];
    if (typedAfterRows) lines.push({ type: 'user', timestamp: at, message: { role: 'user', content: 'why did you pick that?' } });
    lines.push({ type: 'assistant', timestamp: at, message: { id: `m${n}`, role: 'assistant', content: [{ type: 'text', text: reply }] } });
    fs.writeFileSync(t, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', cwd: root,
        input: JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd: root, transcript_path: t, last_assistant_message: reply }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) } });
    let context = '';
    try { context = (JSON.parse(r.stdout).hookSpecificOutput || {}).additionalContext || ''; } catch { /* no JSON: no note */ }
    return { r, context, out: r.stdout };
}
const now = Date.now();
const ONE = { 'Which?': 'Commit now (Recommended)' };

test('a quoted auto line with no ledger row gets the note (C16, N01)', () =>
{
    const { r, context } = stop("Fixed the lint run.\n\nAuto: 'Commit now?' -> 'Commit now (Recommended)'\n");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(context.includes(NOTE), `note: ${context}`);
});

test('an unquoted lowercase auto line with no row gets the note', () =>
{
    const { r, context } = stop('Fixed the lint run.\n\nauto: Commit now? -> Commit now\n');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(context.includes(NOTE));
});

test('a line with a row in the window gets none', () =>
{
    const { r, context, out } = stop("Fixed the lint run.\n\nAuto: 'Which?' -> 'Commit now (Recommended)'\n", { marker: now - 2 * HOUR, rows: [[now - HOUR, ONE]] });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(context, '', out);
});

test('two lines and one row with one answer get the note', () =>
{
    const { context } = stop("Fixed.\n\nAuto: 'Which?' -> 'A'\nAuto: 'Next?' -> 'B'\n", { marker: now - 2 * HOUR, rows: [[now - HOUR, ONE]] });
    assert.ok(context.includes(NOTE));
});

test('two lines and one row with two answers get none (one row holds a whole ask)', () =>
{
    const { context } = stop("Fixed.\n\nAuto: 'Which?' -> 'A'\nAuto: 'Next?' -> 'B'\n", { marker: now - 2 * HOUR, rows: [[now - HOUR, { 'Which?': 'A', 'Next?': 'B' }]] });
    assert.strictEqual(context, '');
});

test('three lines and one row with three answers get none (Review Focus)', () =>
{
    const { context } = stop("Fixed.\n\nAuto: 'a?' -> 'A'\nAuto: 'b?' -> 'B'\nAuto: 'c?' -> 'C'\n", { marker: now - 2 * HOUR, rows: [[now - HOUR, { 'a?': 'A', 'b?': 'B', 'c?': 'C' }]] });
    assert.strictEqual(context, '');
});

test('a row from before the run marker only gets the note', () =>
{
    const { context } = stop("Fixed.\n\nAuto: 'Which?' -> 'A'\n", { marker: now - HOUR, rows: [[now - 3 * HOUR, ONE]] });
    assert.ok(context.includes(NOTE));
});

test('with no run marker a row anywhere in the session counts', () =>
{
    const { context } = stop("Fixed.\n\nAuto: 'Which?' -> 'A'\n", { rows: [[now - 30 * HOUR, ONE]] });
    assert.strictEqual(context, '');
});

test('a mid-run typed question between the row and the close gets none', () =>
{
    const { context } = stop("Fixed.\n\nAuto: 'Which?' -> 'A'\n", { marker: now - 2 * HOUR, rows: [[now - HOUR, ONE]], typedAfterRows: true });
    assert.strictEqual(context, '');
});

test("'auto:' inside a code block gets none", () =>
{
    const { r, context } = stop("Fixed. The close format is:\n\n```\nAuto: 'Which?' -> 'A'\n```\n");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(context, '');
});

test('a reply with no auto line gets none', () =>
{
    assert.strictEqual(stop('Fixed the lint run. Nothing else changed.\n').context, '');
});

test('the note is context, never a block', () =>
{
    const { r, out } = stop("Fixed.\n\nAuto: 'Which?' -> 'A'\n");
    assert.strictEqual(r.status, 0);
    const o = JSON.parse(out);
    assert.strictEqual(o.decision, undefined);
    assert.strictEqual(o.hookSpecificOutput.hookEventName, 'Stop');
});

test('unrecordedAutoLines counts lines against answers, not rows (the exported check)', () =>
{
    const { unrecordedAutoLines } = require(HOOK);
    const row = (answers) => ({ kind: 'auto-answer', detail: { answers } });
    assert.strictEqual(unrecordedAutoLines("Auto: 'q?' -> 'a'", []), true);
    assert.strictEqual(unrecordedAutoLines('auto: a -> b\nAuto: c -> d', [row({ x: '1', y: '2' })]), false);
    assert.strictEqual(unrecordedAutoLines('auto: a -> b\nAuto: c -> d', [row({ x: '1' })]), true);
    assert.strictEqual(unrecordedAutoLines('auto: a -> b', [{ kind: 'auto-ask-waits' }]), true);
    assert.strictEqual(unrecordedAutoLines('```\nauto: a -> b\n```', []), false);
    assert.strictEqual(unrecordedAutoLines('no such line', []), false);
});
