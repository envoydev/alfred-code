// Print mode has nobody at the terminal (pilot 2, 2026-09-27): a Stop block there never reaches a
// person, it only buys the model another turn - 8 of 12 `ours` cells ended on 'docs ok', and nine
// em-dash blocks re-sent finished answers. `unattended(input)` in hook-prelude.js is the one test the
// hooks share: ALFRED_CODE_UNATTENDED=1, or the transcript's last row carrying an `entrypoint` says
// `sdk-cli` (every row of a `claude -p` transcript does; an interactive one says `cli`). Both
// directions are pinned per hook through its real entry: print mode quiet, an interactive transcript
// blocked as before, and a missing, empty or garbage transcript read as interactive - a person at a
// terminal must never lose an ask to a file this hook could not read.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// C19: the session's own stack env, in either spelling, never decides a case - legacy-name
for (const k of Object.keys(process.env)) if (/^(?:ALFRED_CODE|CLAUDE_STACK)_/.test(k) || k === 'CLAUDE_DOCS_PATH') delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
const { repo, section } = require('./docs-fixture');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'unattended-'));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
const { unattended } = require('../stack/hooks/hook-prelude.js');

let n = 0;
// A transcript the way the CLI writes one: conversation rows carry `entrypoint`, the bookkeeping rows
// that close it (last-prompt, atis-latch, cost-state) carry none - measured on all 12 pilot-2 cells.
const convo = (entrypoint, text = 'ok', usage) => [
    { type: 'queue-operation', operation: 'enqueue' },
    { type: 'user', entrypoint, message: { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] } },
    { type: 'assistant', entrypoint, message: { id: `m${++n}`, role: 'assistant', content: [{ type: 'text', text }], usage: usage || { cache_read_input_tokens: 10 } } },
    { type: 'last-prompt', lastPrompt: 'fix the bug' },
    { type: 'atis-latch', atis: 1 },
];
function file(rows, tail = '')
{
    const p = path.join(TMP, `t-${++n}.jsonl`);
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '') + tail);
    return p;
}
// The five transcripts every hook is fed. `garbage` is a print-mode transcript whose LAST row is torn.
const transcripts = (text, usage) => ({
    print: file(convo('sdk-cli', text, usage)),
    interactive: file(convo('cli', text, usage)),
    missing: path.join(TMP, `absent-${++n}.jsonl`),
    empty: file([]),
    garbage: file(convo('sdk-cli', text, usage), '{"type":"assistant","entrypoint":"sdk-'),
});
const UNREADABLE = ['missing', 'empty', 'garbage'];

const run = (hook, payload, env) => spawnSync(process.execPath, [path.join(HOOKS, hook)],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')), ...(env || {}) } });

// ---------------------------------------------------------------------------------------------
// the helper
// ---------------------------------------------------------------------------------------------
test('unattended: the switch, then the last row carrying an entrypoint', () =>
{
    const t = transcripts();
    assert.strictEqual(unattended({ transcript_path: t.print }, {}), true, 'print mode: the last conversation row says sdk-cli');
    assert.strictEqual(unattended({ transcript_path: t.interactive }, {}), false, 'an interactive session says cli');
    for (const k of UNREADABLE) assert.strictEqual(unattended({ transcript_path: t[k] }, {}), false, `${k} transcript reads as interactive`);
    assert.strictEqual(unattended({}, {}), false, 'no transcript path');
    assert.strictEqual(unattended(null, {}), false, 'no input at all');
    assert.strictEqual(unattended({ transcript_path: file(['{not json', 'also not']) }, {}), false, 'a wholly garbage file');
    assert.strictEqual(unattended({ transcript_path: t.interactive }, { ALFRED_CODE_UNATTENDED: '1' }), true, 'the launch switch wins');
    for (const v of ['', '0', 'true', 'yes']) assert.strictEqual(unattended({ transcript_path: t.interactive }, { ALFRED_CODE_UNATTENDED: v }), false, `'${v}' is not the switch`);
    // A resumed session is judged by who is there NOW: the newest conversation row decides.
    assert.strictEqual(unattended({ transcript_path: file([...convo('cli'), ...convo('sdk-cli')]) }, {}), true, 'claude -p --resume of an interactive session');
    assert.strictEqual(unattended({ transcript_path: file([...convo('sdk-cli'), ...convo('cli')]) }, {}), false, 'an interactive resume of a print session');
    assert.strictEqual(unattended({ transcript_path: file([{ type: 'cost-state' }, 7, 'x']) }, {}), false, 'rows but no entrypoint anywhere');
});

test('unattended: only sdk-cli is unattended - an Agent SDK, IDE or desktop session keeps its asks', () =>
{
    // Review A, M2: an SDK launch keeps its own entrypoint (the CLI rewrites only an inherited cli to sdk-cli in
    // print mode), and a flow driven through the SDK answers its asks - a later tidy-up to startsWith('sdk-')
    // would quiet exactly those sessions.
    for (const entrypoint of ['sdk-ts', 'sdk-py', 'claude-vscode', 'claude-desktop'])
        assert.strictEqual(unattended({ transcript_path: file(convo(entrypoint)) }, {}), false, entrypoint);
});

test('unattended: a last row longer than the first read window is still read whole', () =>
{
    const big = { type: 'user', entrypoint: 'sdk-cli', message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(600 * 1024) }] } };
    assert.strictEqual(unattended({ transcript_path: file([...convo('cli'), big]) }, {}), true);
    assert.strictEqual(unattended({ transcript_path: file([...convo('sdk-cli'), { ...big, entrypoint: 'cli' }]) }, {}), false);
});

// ---------------------------------------------------------------------------------------------
// guard-answer-length - blocks nothing at Stop in print mode, length or em-dash
// ---------------------------------------------------------------------------------------------
test('guard-answer-length: print mode blocks neither the em-dash nor the wall; interactive still does', () =>
{
    const dash = 'Fixed it — the build is green.';
    const t = transcripts(dash);
    const stop = (tp, text = dash) => run('guard-answer-length.js', { hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: text }).status;
    assert.strictEqual(stop(t.print), 0, 'an em-dash in print mode');
    assert.strictEqual(stop(t.interactive), 2, 'the same answer at a terminal');
    for (const k of UNREADABLE) assert.strictEqual(stop(t[k]), 2, `${k} transcript: the em-dash block stands`);
    const wall = 'This sentence exists only to burn prose characters against the cap. '.repeat(40);
    const w = transcripts(wall);
    assert.strictEqual(stop(w.print, wall), 0, 'a wall of text in print mode');
    assert.strictEqual(stop(w.interactive, wall), 2, 'the same wall at a terminal');
    assert.strictEqual(run('guard-answer-length.js', { hook_event_name: 'Stop', transcript_path: t.interactive, last_assistant_message: dash }, { ALFRED_CODE_UNATTENDED: '1' }).status, 0, 'the launch switch');
});

// ---------------------------------------------------------------------------------------------
// guard-stop-contract - no prose-question block, no 'next step pending' block, no fresh-session offer
// ---------------------------------------------------------------------------------------------
test('guard-stop-contract: print mode holds no prose question and no pending close; interactive still does', () =>
{
    for (const text of ['Both work. Which one should we ship?', 'The refactor is done. Pushing it is the next step, whenever you are ready.'])
    {
        const t = transcripts(text);
        const stop = (tp) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: text }).status;
        assert.strictEqual(stop(t.print), 0, `print mode: ${text}`);
        assert.strictEqual(stop(t.interactive), 2, `terminal: ${text}`);
        for (const k of UNREADABLE) assert.strictEqual(stop(t[k]), 2, `${k} transcript: ${text}`);
    }
});

test('guard-stop-contract: print mode makes no fresh-session offer; interactive still does', () =>
{
    const floorAnd = (entrypoint) => [
        { type: 'assistant', entrypoint, message: { id: `f${++n}`, content: [{ type: 'text', text: 'the first turn' }], usage: { cache_creation_input_tokens: 20000 } } },
        ...convo(entrypoint, 'I applied the change and the suite is green.', { cache_read_input_tokens: 500000 }),
    ];
    const stop = (tp) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: tp });
    const terminal = stop(file(floorAnd('cli')));
    assert.strictEqual(terminal.status, 2, 'past the trigger at a terminal');
    assert.match(terminal.stderr, /fresh session/i);
    assert.strictEqual(stop(file(floorAnd('sdk-cli'))).status, 0, 'past the trigger with nobody there');
});

test('guard-stop-contract: the credential rotation ask stays in print mode - it protects something', () =>
{
    const text = 'Done. You should rotate the API key that was printed above.';
    const t = transcripts(text);
    const r = run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: t.print, last_assistant_message: text });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /credential/i);
});

// ---------------------------------------------------------------------------------------------
// guard-fresh-session-start - offers nothing in print mode; the user-only skill guard stays
// ---------------------------------------------------------------------------------------------
test('guard-fresh-session-start: print mode offers no fresh session before a run; interactive still does', () =>
{
    const hot = (entrypoint) => [
        { type: 'assistant', entrypoint, message: { id: `h${++n}`, content: [{ type: 'text', text: 'the first turn' }], usage: { cache_creation_input_tokens: 20000 } } },
        ...convo(entrypoint, 'ok', { cache_read_input_tokens: 450000 }),
    ];
    const call = (tp) => run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'alfred-loop-quality' }, transcript_path: tp }).status;
    assert.strictEqual(call(file(hot('cli'))), 2, 'an orchestration run on carried history, at a terminal');
    assert.strictEqual(call(file(hot('sdk-cli'))), 0, 'the same run with nobody there');
    assert.strictEqual(call(file(hot('sdk-cli').concat([]), '{"type":"assist')), 2, 'a torn last row reads as interactive');
});

test('guard-fresh-session-start: after a compaction print mode gets the pointer only, never the ask', () =>
{
    const compact = (tp) => { const r = run('guard-fresh-session-start.js', { hook_event_name: 'SessionStart', source: 'compact', transcript_path: tp }); try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
    const t = transcripts();
    assert.match(compact(t.interactive), /AUTO-COMPACTED/, 'a person is asked');
    assert.doesNotMatch(compact(t.print), /AUTO-COMPACTED|AskUserQuestion/, 'nobody to ask');
    for (const k of UNREADABLE) assert.match(compact(t[k]), /AUTO-COMPACTED/, `${k} transcript`);
});

test('guard-fresh-session-start: the user-only skill is still denied in print mode', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'skills-'));
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'users-own'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'users-own', 'SKILL.md'), '---\nname: users-own\ndescription: x\ndisable-model-invocation: true\n---\nbody\n');
    const r = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'users-own' }, transcript_path: transcripts().print }, { CLAUDE_PROJECT_DIR: root });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /disable-model-invocation/);
});

// ---------------------------------------------------------------------------------------------
// docs-session - no source-root hold and no Stop FINISH ask in print mode
// ---------------------------------------------------------------------------------------------
const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.');
const denied = (out) => /"permissionDecision":"deny"/.test(out.stdout);

test('docs-session: print mode is never held before its first source change; interactive still is', () =>
{
    const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
    try
    {
        const t = transcripts();
        const edit = (tp) => r.hook({ hook_event_name: 'PreToolUse', session_id: `u-${process.pid}-${++n}`, tool_name: 'Edit', tool_input: { file_path: 'src/Api/Orders/Refund.cs' }, transcript_path: tp });
        assert.ok(!denied(edit(t.print)), 'print mode');
        assert.ok(denied(edit(t.interactive)), 'at a terminal');
        for (const k of UNREADABLE) assert.ok(denied(edit(t[k])), `${k} transcript`);
        // The shell route runs the same hook in-process through the dispatcher.
        const shell = (tp) => spawnSync(process.execPath, [path.join(HOOKS, 'shell-guards.js')], { cwd: r.root, encoding: 'utf8',
            input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: `u-${process.pid}-${++n}`, tool_name: 'Bash', tool_input: { command: 'echo x > src/Api/Orders/Refund.cs' }, transcript_path: tp, cwd: r.root }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_DOCS_VERSIONING: '' } });
        assert.ok(!/docs not read yet/i.test(shell(t.print).stdout), 'print mode, shell route');
        assert.match(shell(t.interactive).stdout, /Docs not read yet/, 'at a terminal, shell route');
    }
    finally { r.rm(); }
});

test('docs-session: print mode ends without the FINISH ask; interactive still gets it', () =>
{
    const WATCH = JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }] });
    for (const [kind, blocks] of [['print', false], ['interactive', true], ['missing', true], ['empty', true], ['garbage', true]])
    {
        const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH } });
        try
        {
            const s = `u-${process.pid}-${++n}`;
            const tp = transcripts()[kind];
            r.hook({ hook_event_name: 'SessionStart', session_id: s, transcript_path: tp });
            r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
            const out = r.hook({ hook_event_name: 'Stop', session_id: s, stop_hook_active: false, transcript_path: tp });
            assert.strictEqual(/"decision":"block"/.test(out.stdout), blocks, `${kind} transcript`);
        }
        finally { r.rm(); }
    }
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
