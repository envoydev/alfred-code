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
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// C19: the session's own stack env never decides a case
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
// The runner's own entrypoint (cli in an interactive session, sdk-cli under claude -p) never decides a case.
delete process.env.CLAUDE_CODE_ENTRYPOINT;
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

test('unattended: CLAUDE_CODE_ENTRYPOINT decides first, the transcript only when it is unset', () =>
{
    // Review A, M8: the 2.1.283 CLI sets it to sdk-cli in print mode (rewriting an inherited cli) and keeps an SDK
    // launch's own value - O(1), immune to a torn row, and right for a resumed session before its first new row.
    const t = transcripts();
    assert.strictEqual(unattended({ transcript_path: t.interactive }, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), true, 'claude -p --resume of an interactive session');
    assert.strictEqual(unattended({}, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), true, 'no transcript needed');
    assert.strictEqual(unattended({ transcript_path: t.garbage }, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), true, 'a torn row no longer matters');
    assert.strictEqual(unattended({ transcript_path: t.print }, { CLAUDE_CODE_ENTRYPOINT: 'cli' }), false, 'an interactive resume of a print session');
    assert.strictEqual(unattended({ transcript_path: t.print }, { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }), false, 'an SDK launch keeps its asks');
    assert.strictEqual(unattended({ transcript_path: t.print }, { CLAUDE_CODE_ENTRYPOINT: '' }), true, 'empty is unset - the transcript decides');
    assert.strictEqual(unattended({ transcript_path: t.interactive }, { CLAUDE_CODE_ENTRYPOINT: 'cli', ALFRED_CODE_UNATTENDED: '1' }), true, 'the launch switch still wins');
});

test('guard-answer-length: the env route quiets the Stop block with no transcript at all, and cli keeps it', () =>
{
    const dash = 'Fixed it \u2014 the build is green.';
    const t = transcripts(dash);
    const stop = (tp, entrypoint) => run('guard-answer-length.js', { hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: dash }, { CLAUDE_CODE_ENTRYPOINT: entrypoint }).status;
    assert.strictEqual(stop(t.missing, 'sdk-cli'), 0, 'print mode by the env alone');
    assert.strictEqual(stop(t.print, 'cli'), 2, 'a person at the terminal, whatever the transcript says');
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

// ---------------------------------------------------------------------------------------------
// guard-stop-contract's credential branch (pilot 3, A1): it reads what the MODEL saw, and in print mode
// it logs instead of replacing the final answer
// ---------------------------------------------------------------------------------------------
// A planted credential, fake by construction: the SHAPE is what the branch reads, never a value.
const JWT = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJub3RpY2VzIn0', 'c2lnbmF0dXJlLW9ubHktYS1zaGFwZQ'].join('.');
// A tool result row the way the 2.1.283 CLI writes it: `message` (what the model is sent) before the
// CLI's own stored copy, `toolUseResult` - an Edit's whole `originalFile` among it.
const toolRow = (entrypoint, sent, stored) => ({
    type: 'user', entrypoint, uuid: `u${++n}`,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: sent }] },
    toolUseResult: { filePath: 'appsettings.Development.json', originalFile: stored, contentNotInModelContext: true },
});
const exposed = (entrypoint, close) => [
    ...convo(entrypoint, 'working on it'),
    toolRow(entrypoint, `{"Notices":{"Gateway":{"ServiceToken":"${JWT}"}}}`, 'unchanged'),
    { type: 'assistant', entrypoint, message: { id: `m${++n}`, role: 'assistant', content: [{ type: 'text', text: close }], usage: { cache_read_input_tokens: 10 } } },
];
const CLOSE = 'Added DueSoonDays to the worker settings; the suite is green.';
const credentialStop = (rows, env, session = `s${++n}`, close = CLOSE) =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'cred-'));
    const tp = file(rows);
    const r = run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: session, cwd: root, transcript_path: tp, last_assistant_message: close },
        { CLAUDE_PROJECT_DIR: root, ...(env || {}) });
    const ledger = path.join(root, '.alfred', 'docs', 'hook-blocks', `${session}.jsonl`);
    const rows_ = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    return { ...r, rows: rows_, root, tp, session };
};

test('guard-stop-contract: a credential only the CLI stored (an Edit\'s originalFile) is no exposure', () =>
{
    // Pilot 3, ours guard-02 r1 and r2: the secret guard kept the planted JWT out of the model's context, and the
    // only copy in the transcript was `toolUseResult.originalFile` of the Edit that added DueSoonDays - never sent
    // to the model. The rotation ask fired on it anyway and, in print mode, replaced the final summary.
    for (const entrypoint of ['cli', 'sdk-cli'])
    {
        const rows = [...convo(entrypoint, 'working on it'),
            toolRow(entrypoint, 'The file appsettings.Development.json has been updated.', `{"Notices":{"Gateway":{"ServiceToken":"${JWT}"}}}`),
            { type: 'assistant', entrypoint, message: { id: `m${++n}`, role: 'assistant', content: [{ type: 'text', text: CLOSE }], usage: { cache_read_input_tokens: 10 } } }];
        const r = credentialStop(rows);
        assert.strictEqual(r.status, 0, `${entrypoint}: ${r.stderr}`);
        assert.deepStrictEqual(r.rows.filter((row) => row.kind === 'rotate-ask'), [], `${entrypoint}: no row either`);
    }
});

test('guard-stop-contract: a torn row is judged only up to the CLI\'s stored copy', () =>
{
    // Past 64MB the scan window cuts its first row, and a row still being written is torn at the end: the CLI writes
    // `message` before `toolUseResult`, so the text before the stored copy is what the model was sent.
    const head = (sent, stored) => `{"type":"user","entrypoint":"cli","message":{"role":"user","content":[{"type":"tool_result","content":"${sent}"}]},"toolUseResult":{"originalFile":"${stored}`;
    const stop = (torn) => run('guard-stop-contract.js', { hook_event_name: 'Stop', transcript_path: file(convo('cli', 'ok'), torn), last_assistant_message: CLOSE });
    assert.strictEqual(stop(head('updated', `token ${JWT}`)).status, 0, 'the shape only in the stored copy');
    assert.strictEqual(stop(head(`token ${JWT}`, 'x')).status, 2, 'the shape in what was sent');
});

test('guard-stop-contract: a credential the model DID see still ends an interactive or SDK turn in the rotate ask', () =>
{
    for (const entrypoint of ['cli', 'sdk-ts', 'sdk-py'])
    {
        const r = credentialStop(exposed(entrypoint, CLOSE));
        assert.strictEqual(r.status, 2, entrypoint);
        assert.match(r.stderr, /Rotate it now/, entrypoint);
        assert.ok(!r.stderr.includes(JWT), 'the value is never repeated back');
    }
    // The env decides first: an SDK launch keeps its ask even over a transcript written by print mode.
    assert.strictEqual(credentialStop(exposed('sdk-cli', CLOSE), { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }).status, 2, 'sdk-ts by the env');
    // Pilot 3, ecc guard-02: the model read the JWT 250-300KB before the turn ended - outside the old 256KB
    // tail, which caught those cells only through the Edit's stored copy near the end.
    const [head, ...rest] = exposed('cli', CLOSE).slice(-2);
    const long = [...convo('cli', 'working on it'), head,
        ...Array.from({ length: 40 }, () => toolRow('cli', 'y'.repeat(9000), 'unchanged')), ...rest];
    assert.strictEqual(credentialStop(long).status, 2, 'an exposure 360KB before the close');
});

test('guard-stop-contract: print mode logs a real exposure once and leaves the final answer intact', () =>
{
    // Pilot 3: with nobody at the terminal the rotation ask only replaced the final summary ('AskUserQuestion is
    // disabled this session, so asking directly: rotate them now...'). The exposure is still recorded.
    const session = `print-${++n}`;
    const logDir = fs.mkdtempSync(path.join(TMP, 'credlog-'));
    const first = credentialStop(exposed('sdk-cli', CLOSE), { ALFRED_CODE_HOOK_LOG_DIR: logDir }, session);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(first.stderr, '', 'nothing reaches the model');
    const logged = first.rows.filter((row) => row.kind === 'rotate-ask');
    assert.strictEqual(logged.length, 1, 'one ledger row');
    assert.strictEqual(logged[0].mode, 'unattended');
    assert.match(logged[0].reason, /credential/);
    assert.ok(!JSON.stringify(first.rows).includes(JWT), 'the row carries no value');
    // A second Stop of the same session on the same exposure writes no second row.
    const second = run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: session, cwd: first.root, transcript_path: first.tp, last_assistant_message: CLOSE },
        { CLAUDE_PROJECT_DIR: first.root, ALFRED_CODE_HOOK_LOG_DIR: logDir });
    assert.strictEqual(second.status, 0);
    const all = fs.readFileSync(path.join(first.root, '.alfred', 'docs', 'hook-blocks', `${session}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(all.filter((row) => row.kind === 'rotate-ask').length, 1, 'one row per exposure, not per Stop');
    // The launch switch and the env are print mode too; a close that names rotation is logged, not held.
    assert.strictEqual(credentialStop(exposed('cli', CLOSE), { ALFRED_CODE_UNATTENDED: '1' }).status, 0, 'the launch switch');
    assert.strictEqual(credentialStop(exposed('cli', CLOSE), { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }).status, 0, 'the env');
    const rotateClose = 'Done. You should rotate the API key that was printed above.';
    const named = credentialStop(convo('sdk-cli', rotateClose), {}, `s${++n}`, rotateClose);
    assert.strictEqual(named.status, 0, 'a close naming rotation');
    assert.strictEqual(named.rows.filter((row) => row.kind === 'rotate-ask').length, 1);
});

test('guard-stop-contract: an Edit\'s stored copy after an answered rotate ask is no new exposure', () =>
{
    const answered = { type: 'user', entrypoint: 'cli', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ta', content: 'Your questions have been answered: "Rotate it now?"="Acknowledge and defer"' }] } };
    const filler = { type: 'user', entrypoint: 'cli', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tf', content: 'x'.repeat(9000) }] } };
    const rows = [...exposed('cli', 'ok'), answered, filler,
        toolRow('cli', 'The file appsettings.Development.json has been updated.', `{"ServiceToken":"${JWT}"}`), ...convo('cli', CLOSE)];
    assert.strictEqual(credentialStop(rows).status, 0);
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
    const call = (tp) => run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'loop-quality' }, transcript_path: tp }).status;
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

// Review A, M3: every quieted block or offer leaves ONE 'mode: unattended' row, as stop-contract and docs-session do,
// so a print-mode run can still count what it skipped (pilot 2: nine em-dash blocks). Nothing skipped, no row.
const ledger = (sid) => { try { return fs.readFileSync(path.join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'docs', 'hook-blocks', `${sid}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
test('guard-answer-length: a Stop block skipped in print mode leaves one unattended row, a clean answer none', () =>
{
    const dash = 'Fixed it \u2014 the build is green.';
    const t = transcripts(dash);
    const sid = `al-${process.pid}-${++n}`;
    assert.strictEqual(run('guard-answer-length.js', { hook_event_name: 'Stop', session_id: sid, transcript_path: t.print, last_assistant_message: dash }).status, 0);
    const rows = ledger(sid);
    assert.strictEqual(rows.length, 1, JSON.stringify(rows));
    assert.strictEqual(rows[0].mode, 'unattended');
    assert.strictEqual(rows[0].hook, 'guard-answer-length.js');
    assert.strictEqual(rows[0].kind, 'em-dash');
    const clean = `al-${process.pid}-${++n}`;
    assert.strictEqual(run('guard-answer-length.js', { hook_event_name: 'Stop', session_id: clean, transcript_path: t.print, last_assistant_message: 'Fixed - the build is green.' }).status, 0);
    assert.deepStrictEqual(ledger(clean), [], 'nothing was skipped');
});

test('guard-fresh-session-start: an offer skipped in print mode leaves one unattended row, none under the trigger', () =>
{
    const at = (entrypoint, ctx) => file([
        { type: 'assistant', entrypoint, message: { id: `h${++n}`, content: [{ type: 'text', text: 'the first turn' }], usage: { cache_creation_input_tokens: 20000 } } },
        ...convo(entrypoint, 'ok', { cache_read_input_tokens: ctx }),
    ]);
    const call = (sid, tp) => run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Skill', tool_input: { skill: 'loop-quality' }, transcript_path: tp }).status;
    const hot = `fs-${process.pid}-${++n}`;
    assert.strictEqual(call(hot, at('sdk-cli', 450000)), 0);
    const rows = ledger(hot);
    assert.strictEqual(rows.length, 1, JSON.stringify(rows));
    assert.strictEqual(rows[0].mode, 'unattended');
    assert.strictEqual(rows[0].hook, 'guard-fresh-session-start.js');
    const cold = `fs-${process.pid}-${++n}`;
    assert.strictEqual(call(cold, at('sdk-cli', 30000)), 0);
    assert.deepStrictEqual(ledger(cold), [], 'under the trigger nothing was offered, so nothing was skipped');
    const compact = `fs-${process.pid}-${++n}`;
    run('guard-fresh-session-start.js', { hook_event_name: 'SessionStart', source: 'compact', session_id: compact, transcript_path: transcripts().print });
    assert.strictEqual(ledger(compact).filter((r) => r.mode === 'unattended').length, 1, 'the compaction offer skipped');
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
