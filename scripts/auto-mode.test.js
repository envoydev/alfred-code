// auto-mode (the user's ruling, 2026-10-14): `--auto-mode` on a task, capture, loop or issue call runs it unattended (the flag and the capture family since 2026-10-17). The fresh-session
// hook writes the AUTO stamp naming the session before the run's first step, the stop contract answers each ask that
// marks one Recommended option and sends a Stop back to the run until its close deletes the stamp, and the installer
// seeds each model's auto-compact window at its fresh-session trigger, because Claude Code reads that key at session
// start only (measured 2026-10-14: written mid-session it changed nothing; set before the start it compacted at 76k of
// a 100k window). Every hook case runs through the hook's real entry.
'use strict';
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

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-mode-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
delete process.env.CLAUDE_PROJECT_DIR;
const { approvalStamp, autoStampLive } = require('../stack/hooks/hook-prelude.js');
const settings = require('../scripts/install/settings.js');
const { valueHash, renderLedger, readLedger } = require('../scripts/install/stamp.js');

let n = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    // 2.8.0 layout: the stamp lives in <data root>/state/approvals/; `legacy` is the pre-2.8.0 flow/ one a 2.7.0 copy writes
    const approvals = path.join(root, '.alfred', 'state', 'approvals');
    fs.mkdirSync(approvals, { recursive: true });
    return { root, gate: path.join(approvals, 'APPROVAL'), legacy: path.join(root, '.alfred', 'docs', 'flow', 'APPROVAL'), blocks: path.join(root, '.alfred', 'statistics', 'hook-blocks') };
}
// An interactive transcript: the first message's context, then the newest one's.
function transcript(rows = [], model = 'claude-opus-5-5', ctx = 30000)
{
    const p = path.join(TMP, `t-${++n}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    const base = [
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'go' }] } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_creation_input_tokens: 20000 } } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: ctx } } },
    ];
    fs.writeFileSync(p, [...base, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
const run = (hook, payload, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, hook)],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: env.ALFRED_CODE_HOOK_LOG_DIR || fs.mkdtempSync(path.join(TMP, 'log-')), ...env } });
const rows = (p, sid) => { try { return fs.readFileSync(path.join(p.blocks, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
const autoStamp = (p, sid, extra = '') => fs.writeFileSync(p.gate, `AUTO - "/loop-code-quality --auto-mode"\nsession: ${sid}\nskill: loop-code-quality\n${extra}`);

// ---------------------------------------------------------------------------------------------
// the stamp
// ---------------------------------------------------------------------------------------------
test('auto-mode stamp: one naming its session is that session\'s for the whole run, and never another\'s', () =>
{
    const p = project();
    const t = transcript();
    const env = { CLAUDE_PROJECT_DIR: p.root };
    autoStamp(p, 'sess-a');
    assert.strictEqual(autoStampLive({ session_id: 'sess-a', transcript_path: t }, env), true, 'its own session');
    assert.strictEqual(autoStampLive({ session_id: 'sess-b', transcript_path: t }, env), false, 'another session in the same project');
    assert.strictEqual(autoStampLive({ transcript_path: t }, env), false, 'a payload with no session');
    const old = (Date.now() - 30 * 3600 * 1000) / 1000;
    fs.utimesSync(p.gate, old, old);
    assert.strictEqual(autoStampLive({ session_id: 'sess-a', transcript_path: t }, env), true, 'past the 8h a hand-written stamp gets - an unattended loop outlives it');
    const week = (Date.now() - 8 * 24 * 3600 * 1000) / 1000;
    fs.utimesSync(p.gate, week, week);
    assert.strictEqual(autoStampLive({ session_id: 'sess-a', transcript_path: t }, env), false, 'a week is the backstop for a run that died without its close');
    // a hand-written stamp keeps its rules: 8h, and never older than the transcript
    fs.writeFileSync(p.gate, 'AUTO - "take every recommendation"\n');
    assert.strictEqual(autoStampLive({ session_id: 'sess-b', transcript_path: t }, env), true, 'a hand-written stamp is no one session\'s');
    fs.utimesSync(p.gate, old, old);
    assert.strictEqual(autoStampLive({ session_id: 'sess-b', transcript_path: t }, env), false, 'and lives 8h');
    assert.deepStrictEqual(Object.keys(approvalStamp({ session_id: 'x' }, env)).sort(), ['file', 'first', 'live', 'mtimeMs', 'session', 'skill']);
    assert.strictEqual(approvalStamp({ session_id: 'x' }, { CLAUDE_PROJECT_DIR: fs.mkdtempSync(path.join(TMP, 'none-')) }), null, 'no stamp');
});

test('auto-mode stamp: a hand-written stamp a 2.7.0 skill copy put in the legacy flow/ is still read, the new path first (2.8.0)', () =>
{
    const p = project();
    const t = transcript();
    const env = { CLAUDE_PROJECT_DIR: p.root };
    fs.mkdirSync(path.dirname(p.legacy), { recursive: true });
    fs.writeFileSync(p.legacy, 'AUTO - "take every recommendation"\n');
    const legacy = approvalStamp({ session_id: 'sess-a', transcript_path: t }, env);
    assert.strictEqual(legacy.file, p.legacy, 'only the legacy one exists');
    assert.strictEqual(autoStampLive({ session_id: 'sess-a', transcript_path: t }, env), true);
    autoStamp(p, 'sess-b');
    assert.strictEqual(approvalStamp({ session_id: 'sess-a', transcript_path: t }, env).file, p.gate, 'the new one wins when both exist');
    assert.strictEqual(autoStampLive({ session_id: 'sess-a', transcript_path: t }, env), false, 'and it names another session');
});

// ---------------------------------------------------------------------------------------------
// the start: guard-fresh-session-start.js
// ---------------------------------------------------------------------------------------------
const expand = (p, sid, prompt, t, extra = {}) => run('guard-fresh-session-start.js', {
    hook_event_name: 'UserPromptExpansion', session_id: sid, cwd: p.root, transcript_path: t, expansion_type: 'slash_command',
    command_name: prompt.slice(1).split(' ')[0], command_args: prompt.split(' ').slice(1).join(' '), prompt, ...extra,
}, { CLAUDE_PROJECT_DIR: p.root });
const context = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };

test('auto-mode start: the typed command writes the stamp before the run, and the fresh-session offer never fires', () =>
{
    const p = project();
    // 450k of a 1M window over a 20k first message: the size offer is due, and without the word it is made
    const big = transcript([], 'claude-opus-5-5', 450000);
    const plain = expand(p, 's1', '/loop-code-quality src/', big);
    assert.match(context(plain), /Do NOT start the run yet/, 'the offer, without auto-mode');
    assert.ok(!fs.existsSync(p.gate), 'and no stamp');
    const auto = expand(p, 's2', '/loop-code-quality --auto-mode src/', big);
    assert.strictEqual(auto.status, 0);
    const said = context(auto);
    assert.match(said, /^auto-mode is ON for this \/loop-code-quality run/);
    assert.doesNotMatch(said, /Do NOT start the run yet/, 'the offer is never made under auto-mode');
    for (const rule of [/\(Recommended\) option/, /Do not end a turn between steps/, /never push, merge, deploy or send anything out/, /fresh-session hand-off is never taken/,
        /never write an APPROVED or AUTO line over it/, /an unpushed commit is a Leftovers line/, /delete \.alfred\/state\/approvals\/APPROVAL: that ends auto-mode/])
        assert.match(said, rule);
    const stamp = fs.readFileSync(p.gate, 'utf8');
    assert.match(stamp, /^AUTO - "\/loop-code-quality --auto-mode src\/"\nsession: s2\nskill: loop-code-quality\nat: \d{4}-/, '--auto-mode writes its stamp to state/approvals/APPROVAL');
    assert.ok(!fs.existsSync(p.legacy), 'and nothing to the legacy flow/');
    assert.ok(rows(p, 's2').some((r) => r.mode === 'auto' && r.kind === 'auto-start'), 'one auto-start row');
    // a second flow in the same run rides the live stamp: its words and time stay
    const before = fs.readFileSync(p.gate, 'utf8');
    assert.match(context(expand(p, 's2', '/task-solve --auto-mode fix the cache', big)), /auto-mode is ON for this \/task-solve run/);
    assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), before, 'the live stamp is kept');
    // another session's stamp is never overwritten while that session is still RUNNING (its own transcript, beside this
    // one, written in the last 10 minutes - audit 2026-10-20 hooks minor list, narrowed after a side review): this run
    // asks as usual, the banner says why and how to take over, and a refused row is written
    const live = path.join(path.dirname(big), 's2.jsonl');
    fs.writeFileSync(live, '{}\n');
    const refused = context(expand(p, 's3', '/task-solve-cross --auto-mode', big));
    assert.doesNotMatch(refused, /auto-mode is ON/);
    assert.match(refused, /auto-mode did NOT start: another session \(s2\) is running a stamped run in this checkout right now, and \.alfred\/state\/approvals\/APPROVAL is its approval - finish or stop that run, or delete \.alfred\/state\/approvals\/APPROVAL to take over/);
    assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), before, 'the running session\'s stamp is left as it is');
    assert.ok(rows(p, 's3').some((r) => r.kind === 'auto-start-refused'), 'one refused row');
    // the session went quiet (a finished run, or the one a fresh-session hand-off came from): the new start takes over
    const quiet = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(live, quiet, quiet);
    assert.match(context(expand(p, 's3', '/task-solve-cross --auto-mode', big)), /auto-mode is ON for this \/task-solve-cross run/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: s3\n/);
    // no transcript for the stamp's session at all (another machine's, or cleared): no live run, replaced
    fs.writeFileSync(p.gate, 'AUTO - "/task-solve --auto-mode x"\nsession: gone-session\nskill: task-solve\nat: 2026-10-20T00:00:00Z\n');
    assert.match(context(expand(p, 's4', '/task-solve --auto-mode y', big)), /auto-mode is ON/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: s4\n/);
    fs.rmSync(live, { force: true });
});

test('auto-mode start: a task, capture, loop or issue, only the exact `--auto-mode` as the FIRST word, never a seat, and the model\'s Skill call only on the user\'s typed auto-mode command', () =>
{
    const t = transcript();
    const none = (prompt, extra) => { const p = project(); const r = expand(p, 'sx', prompt, t, extra); return !fs.existsSync(p.gate) && !/auto-mode is ON/.test(context(r)); };
    // the bare word of 2.4.0-2.5.0 starts nothing: the flag is `--auto-mode` (the user's ruling, 2026-10-17)
    assert.ok(none('/task-solve auto-mode fix it'), 'the bare word, on a task');
    assert.ok(none('/capture-architecture auto-mode'), 'and on a capture');
    assert.ok(none('/loop-code-quality --automode'), 'the flag is exact');
    assert.ok(none('/loop-code-quality -auto-mode'), 'two dashes');
    assert.ok(none('/loop-code-quality --auto-modes'), 'and whole');
    assert.ok(none('/loop-code-quality --no-auto-mode'), 'no prefix');
    // the word starts a run only as the first word after the command (the user's ruling, 2026-10-15)
    assert.ok(none('/task-solve fix the auto-mode banner wording'), 'inside the task text it is the task');
    assert.ok(none('/task-solve fix the --auto-mode flag wording'), 'the flag inside the task text is the task');
    assert.ok(none('/loop-code-quality src/ --auto-mode'), 'and trailing it starts nothing');
    assert.ok(none('/loop-code-quality --auto-mode', { agent_id: 'seat-1' }), 'a seat never starts one');
    assert.ok(none('/loop-code-quality --auto-mode', { session_id: '' }), 'no session, nothing to name');
    const p = project();
    assert.match(context(expand(p, 'sy', '/alfred-code:loop-test-coverage --AUTO-MODE', t)), /auto-mode is ON/, 'a scoped name, any case');
    // a capture command runs it too (the user's ruling, 2026-10-17)
    const cap = project();
    assert.match(context(expand(cap, 'sc', '/capture-architecture --auto-mode', t)), /auto-mode is ON for this \/capture-architecture run/);
    assert.match(fs.readFileSync(cap.gate, 'utf8'), /^AUTO - "\/capture-architecture --auto-mode"\nsession: sc\nskill: capture-architecture\n/);
    // an issue command runs it too (the user's ruling, 2026-10-15), the word on its own line as typed in a real session
    const iss = project();
    assert.match(context(expand(iss, 'si', '/issue-diagnoser --auto-mode\n\nthe login 500', t)), /auto-mode is ON for this \/issue-diagnoser run/);
    assert.match(fs.readFileSync(iss.gate, 'utf8'), /^AUTO - "\/issue-diagnoser --auto-mode the login 500"\nsession: si\nskill: issue-diagnoser\n/);
    // the model's own Skill call, with the word in its args: it starts auto-mode only when the user's newest TYPED prompt
    // is a task, capture, loop or issue command opening with the flag (audit HK04; the prose route left on 2026-10-15)
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text }] } });
    const skillCall = (skill, args, tp, sid = 'sz') => { const pr = project(); const r = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill',
        tool_input: { skill, args }, session_id: sid, cwd: pr.root, transcript_path: tp }, { CLAUDE_PROJECT_DIR: pr.root }); return { pr, r }; };
    const asked = transcript([typed('/task-design --auto-mode the cache plan')]);
    const { pr: q, r: call } = skillCall('task-design', '--auto-mode the cache plan', asked);
    assert.strictEqual(call.status, 0, call.stderr);
    assert.strictEqual(JSON.parse(call.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(context(call), /auto-mode is ON for this \/task-design run/);
    assert.match(fs.readFileSync(q.gate, 'utf8'), /^AUTO - "\/task-design --auto-mode the cache plan"\nsession: sz\n/);
    // a slash command's own row carries the word in its args markup - the shape a real transcript stores
    const cmdRow = (name, args) => typed(`<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`);
    assert.match(context(skillCall('task-implement', '--auto-mode', transcript([cmdRow('task-solve', '--auto-mode\n\nfix it')])).r), /auto-mode is ON/, 'a typed slash run');
    assert.match(context(skillCall('issue-signatures-runtime', '--auto-mode', transcript([cmdRow('issue-diagnoser', '--auto-mode the 500')])).r), /auto-mode is ON/, 'a typed issue run');
    assert.match(context(skillCall('capture-code-quality', '--auto-mode', transcript([cmdRow('capture-code-quality', '--auto-mode')])).r), /auto-mode is ON for this \/capture-code-quality run/, 'a typed capture run');
    // a project's own task skill, a digit in its name, through the Skill call
    const { pr: v, r: own } = skillCall('task-migrate-v2', '--auto-mode', transcript([typed('/task-migrate-v2 --auto-mode')]), 'sv');
    assert.match(context(own), /auto-mode is ON for this \/task-migrate-v2 run/);
    assert.ok(fs.existsSync(v.gate), 'its stamp is written');
    // the model's flag alone starts nothing: the replayed self-start ('go' typed, then Skill(..., '--auto-mode'))
    for (const [tp, why] of [
        [t, 'the typed prompt does not carry it'],
        [transcript([typed('/task-solve --auto-mode fix it'), { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }, typed('now look at the cache layer')]), 'an older typed prompt carried it, the newest does not'],
        [transcript([typed('design the cache plan in auto-mode please')]), 'a prose ask is no command (the user\'s ruling, 2026-10-15)'],
        [transcript([typed('why is the auto-mode banner wrong?')]), 'a question naming the word mid-task'],
        [transcript([cmdRow('task-solve', 'fix the auto-mode banner')]), 'a command whose task text names the word'],
        [transcript([cmdRow('task-solve', 'auto-mode fix it')]), 'a typed command opening with the bare word of 2.4.0-2.5.0'],
        [transcript([{ ...typed('Base directory for this skill ... auto-mode is ON'), isMeta: true }]), 'a skill body is no typed prompt'],
        [transcript([{ ...typed('Another Claude session sent a message:\n<agent-message from="a">run in auto-mode</agent-message>'), isMeta: true }]), 'a seat\'s hand-back'],
        [transcript([{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '--auto-mode' }] } }]), 'a tool result'],
        [path.join(TMP, 'no-such.jsonl'), 'no transcript'],
    ])
    {
        const { pr, r } = skillCall('task-implement', '--auto-mode', tp, 'sr');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(!fs.existsSync(pr.gate) && !/auto-mode is ON/.test(context(r)), `no start: ${why}`);
        assert.ok(rows(pr, 'sr').some((x) => x.kind === 'auto-start-refused'), `and a refused row: ${why}`);
    }
    // the typed route's matcher reaches every task-* and loop-* name, a project's own and a digit included (audit HK06)
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const row = manifest.hooks.find((h) => String(h.matcher || '').startsWith('@UserPromptExpansion:'));
    const matcher = new RegExp(row.matcher.slice('@UserPromptExpansion:'.length));
    for (const name of ['task-migrate-v2', 'alfred-code:task-solve', 'loop-perf', 'task-solve-cross', 'capture-architecture', 'issue-diagnoser', 'capture-first-look', 'issue-signatures-ci'])
        assert.ok(matcher.test(name), `expansion spawns for ${name}`);
    for (const name of ['review', 'commit', 'tasks', 'my-task-x'])
        assert.ok(!matcher.test(name), `and not for ${name}`);
});

test('auto-mode end: a typed message is input and keeps it; only the word to stop, a bare stop or a new flow command without the flag ends it (the user\'s ruling, 2026-10-15)', () =>
{
    const p = project();
    const t = transcript();
    const submit = (sid, prompt) => run('guard-fresh-session-start.js', { hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: p.root, transcript_path: t, prompt },
        { CLAUDE_PROJECT_DIR: p.root });
    autoStamp(p, 'e1');
    for (const [sid, prompt, why] of [['e2', 'take over here', "another session's prompt"], ['e1', '<task-notification>\n<task-id>x</task-id>', 'a task notice'],
        ['e1', '/loop-code-quality --auto-mode src/', 'the next auto-mode run'], ['e1', '/issue-diagnoser --auto-mode the 500', 'the next auto-mode run, an issue command'],
        ['e1', '/capture-code-style --auto-mode', 'the next auto-mode run, a capture command'],
        ['e1', '/compact', 'a slash command that is no flow command'],
        ['e1', 'Another Claude session sent a message:\n<agent-message from="a1b2">\n[Subagent hand-back] done\n</agent-message>', 'a seat\'s hand-back (audit HK14)']])
    {
        const r = submit(sid, prompt);
        assert.strictEqual(r.status, 0);
        assert.ok(fs.existsSync(p.gate), `kept: ${why}`);
        assert.doesNotMatch(context(r), /auto-mode is OFF/, `and nothing says it ended: ${why}`);
    }
    // a message typed mid-run is input to the run: the stamp stands and the model is told to carry on
    for (const prompt of ['use the v2 endpoint for the fix instead', 'stop using lodash in the fix', 'what is the status?', 'the end of the auto-mode run should commit too'])
    {
        const kept = submit('e1', prompt);
        assert.strictEqual(kept.status, 0, kept.stderr);
        assert.ok(fs.existsSync(p.gate), `kept: ${prompt}`);
        assert.match(context(kept), /^auto-mode stays ON \(\.alfred\/state\/approvals\/APPROVAL\): the user typed this message while the run goes on, so it is INPUT to the run/);
        assert.match(context(kept), /delete \.alfred\/state\/approvals\/APPROVAL - that ends auto-mode/, 'a stop in other words is the model\'s to honor');
    }
    assert.ok(rows(p, 'e1').some((r) => r.kind === 'auto-input'), 'an auto-input row');
    // a stop in another language is input, and the note hands it to the model (English only since 2026-10-16)
    for (const prompt of ['вимкни авто-режим', 'стоп'])
    {
        const kept = submit('e1', prompt);
        assert.ok(fs.existsSync(p.gate), `kept: ${prompt}`);
        assert.match(context(kept), /delete \.alfred\/state\/approvals\/APPROVAL - that ends auto-mode/, `the model honors it: ${prompt}`);
    }
    // the word to stop ends it, and so does a bare stop (audit HK13)
    for (const prompt of ['stop auto-mode', 'auto-mode off', 'turn auto-mode off, I am back', 'Please disable auto mode', 'stop, I will take it from here', 'stop', 'Stop - let me check'])
    {
        const off = submit('e1', prompt);
        assert.strictEqual(off.status, 0, off.stderr);
        assert.ok(!fs.existsSync(p.gate), `ended: ${prompt}`);
        assert.match(context(off), /^auto-mode is OFF: the user asked to stop it/);
        autoStamp(p, 'e1');
    }
    // a new flow command without the flag starts an attended run: its banner says OFF, so the old stamp goes - the bare
    // word of 2.4.0-2.5.0 included
    for (const prompt of ['/task-solve .alfred/docs/plans/x.md - resume at step 5', '/alfred-code:capture-architecture', '/capture-architecture auto-mode',
        '/task-solve auto-mode fix it', '/task-solve fix the auto-mode banner', '/loop-code-quality src/ --auto-mode'])
    {
        const off = submit('e1', prompt);
        assert.strictEqual(off.status, 0, off.stderr);
        assert.ok(!fs.existsSync(p.gate), `ended: ${prompt}`);
        assert.match(context(off), /^auto-mode is OFF: the user typed a new flow command without --auto-mode/);
        assert.match(context(off), /`--auto-mode` as the first word after the next \/task-\*, \/capture-\*, \/loop-\* or \/issue-\* command starts a new run/);
        autoStamp(p, 'e1');
    }
    assert.ok(rows(p, 'e1').some((r) => r.kind === 'auto-end'), 'an auto-end row');
    // a stamp written by hand (task-solve's waiver, no session line) is no auto-mode run of this hook's
    fs.writeFileSync(p.gate, 'AUTO - "take every recommendation"\n');
    assert.strictEqual(context(submit('e1', 'stop auto-mode')), '', 'nothing said');
    assert.ok(fs.existsSync(p.gate), 'a hand-written stamp stays');
});

// ---------------------------------------------------------------------------------------------
// the asks: guard-stop-contract.js PreToolUse AskUserQuestion
// ---------------------------------------------------------------------------------------------
const ask = (p, sid, questions, extra = {}) => run('guard-stop-contract.js', {
    hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions }, session_id: sid, cwd: p.root, transcript_path: transcript(), ...extra,
}, { CLAUDE_PROJECT_DIR: p.root });
const q = (question, labels, multiSelect = false) => ({ question, header: 'H', multiSelect, options: labels.map((label) => ({ label, description: 'd' })) });
const answered = (r) => { try { const o = JSON.parse(r.stdout).hookSpecificOutput; return o.permissionDecision === 'allow' ? o.updatedInput.answers : null; } catch { return null; } };

// THE MODE BANNER (the user's ruling, 2026-10-15): a typed /task-*, /capture-*, /loop-* or /issue-* command opens its
// first reply with two lines - auto-mode ON or OFF, and how the session meets a full context, with its numbers - said
// once per typed command, after whatever else the expansion injects.
const BANNER_HEAD = 'Open your reply to this command with these two lines, exactly as written, and never repeat them in a later reply:';
const bannerOf = (r) => { const t = context(r); const at = t.indexOf(BANNER_HEAD); return at < 0 ? null : t.slice(at).split('\n').slice(1); };
const typedRun = (p, sid, prompt, t, env = {}, extra = {}) => run('guard-fresh-session-start.js', {
    hook_event_name: 'UserPromptExpansion', session_id: sid, cwd: p.root, transcript_path: t, expansion_type: 'slash_command',
    command_name: prompt.slice(1).split(' ')[0], command_args: prompt.split(' ').slice(1).join(' '), prompt, ...extra,
}, { CLAUDE_PROJECT_DIR: p.root, ...env });

test('mode banner: auto-mode ON says every ask takes its Recommended option and the session compacts, at the window it will', () =>
{
    const p = project();
    const t = transcript();
    const on = typedRun(p, 'b1', '/loop-code-quality --auto-mode src/', t);
    assert.strictEqual(on.status, 0, on.stderr);
    const said = context(on);
    assert.match(said, /^auto-mode is ON for this \/loop-code-quality run/, 'the contract first, its shape unchanged');
    assert.strictEqual(said.split(BANNER_HEAD).length, 2, 'the banner once');
    assert.deepStrictEqual(bannerOf(on), [
        '**Auto-mode: ON** for /loop-code-quality - every question takes its (Recommended) option without waiting for you; one with no recommended option, or whose recommendation acts outward (push, merge, deploy, publish, a PR), still waits. A message you type mid-run is input to the run; type `stop auto-mode` (or just `stop`) to end it.',
        "**Context:** no fresh-session hand-off - the session auto-compacts at Claude Code's own point in its 1M context window (claude-opus-5-5) and the run goes on from the summary and its state files.",
    ]);
    // the second flow of the same run rides the live stamp, and says so too
    assert.match(bannerOf(typedRun(p, 'b1', '/task-solve --auto-mode fix the cache', t))[0], /^\*\*Auto-mode: ON\*\* for \/task-solve /);
    // the window the installer seeded for this model (ALFRED_CODE_AUTO_COMPACT=1) is the one named
    const q = project();
    fs.mkdirSync(path.join(q.root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(q.root, '.claude', 'settings.json'), JSON.stringify({ modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400000 } } }));
    assert.strictEqual(bannerOf(typedRun(q, 'b2', '/task-solve --auto-mode x', t))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 400k auto-compact window (of 1M, claude-opus-5-5) and the run goes on from the summary and its state files.');
});

test('mode banner: auto-mode OFF says each ask waits, then the fresh-session refresh, the compaction, or the offers off', () =>
{
    const p = project();
    const t = transcript([], 'claude-sonnet-5-5');
    const off = bannerOf(typedRun(p, 'c1', '/task-solve fix the cache', t));
    assert.deepStrictEqual(off, [
        '**Auto-mode: OFF** for /task-solve - each question waits for your answer.',
        '**Context:** session refresh - past ~400k tokens of its 1M context window (claude-sonnet-5-5), the run offers to resume in a fresh session from its state file instead of compacting.',
    ]);
    // a 200k model takes its own tier's trigger
    assert.match(bannerOf(typedRun(p, 'c2', '/capture-architecture', transcript([], 'claude-haiku-4-5')))[1], /past ~180k tokens of its 200k context window \(claude-haiku-4-5\)/);
    assert.strictEqual(bannerOf(typedRun(p, 'c3', '/loop-test-coverage', t, { ALFRED_CODE_AUTO_COMPACT: '1' }))[1],
        "**Context:** auto-compact is on (ALFRED_CODE_AUTO_COMPACT=1) - the session compacts at Claude Code's own point in its 1M context window (claude-sonnet-5-5) instead of offering a fresh session.");
    assert.strictEqual(bannerOf(typedRun(p, 'c4', '/issue-diagnoser the login 500', t, { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' }))[1],
        "**Context:** the fresh-session offers are off - the session compacts at Claude Code's own point in its 1M context window (claude-sonnet-5-5).");
    // the bare word of 2.4.0-2.5.0 is said, never silently dropped: the flag is `--auto-mode` (the user's ruling, 2026-10-17)
    const HINT = ' (auto-mode starts only with `--auto-mode` as the first word after the command.)';
    assert.strictEqual(bannerOf(typedRun(p, 'c5', '/capture-code-style auto-mode', t))[0],
        `**Auto-mode: OFF** for /capture-code-style - each question waits for your answer.${HINT}`);
    // and the flag past the command's first argument is said too: it starts nothing there (the user's ruling, 2026-10-15)
    assert.strictEqual(bannerOf(typedRun(p, 'c8', '/task-solve fix the cache --auto-mode', t))[0],
        `**Auto-mode: OFF** for /task-solve - each question waits for your answer.${HINT}`);
    // the bare word inside the task text is the task's own, and says nothing
    assert.strictEqual(bannerOf(typedRun(p, 'c11', '/task-solve fix the auto-mode banner', t))[0], '**Auto-mode: OFF** for /task-solve - each question waits for your answer.');
    assert.match(bannerOf(typedRun(project(), 'c12', '/capture-code-style --auto-mode', t))[0], /^\*\*Auto-mode: ON\*\* for \/capture-code-style - /);
    assert.strictEqual(bannerOf(typedRun(p, 'c9', '/issue-diagnoser the login 500', t))[0], '**Auto-mode: OFF** for /issue-diagnoser - each question waits for your answer.');
    assert.match(bannerOf(typedRun(project(), 'c10', '/issue-diagnoser --auto-mode the login 500', t))[0], /^\*\*Auto-mode: ON\*\* for \/issue-diagnoser - /);
    // an unknown model and no window: no number is invented for the window
    const bare = project();
    assert.match(bannerOf(typedRun(bare, 'c6', '/task-design', path.join(TMP, 'no-such.jsonl')))[1], /past ~280k tokens of its 300k default context window, the run offers/);
    // the fresh-session offer keeps its text and its place; the banner follows it
    const big = transcript([], 'claude-opus-5-5', 450000);
    const offered = context(typedRun(p, 'c7', '/loop-code-quality src/', big));
    assert.match(offered, /^\/loop-code-quality is a deliberate orchestration run .* Do NOT start the run yet/);
    assert.ok(offered.indexOf(BANNER_HEAD) > offered.indexOf('Do NOT start the run yet'), 'after the offer');
});

test('mode banner: never for another command, a seat, a print-mode run or the model\'s Skill call', () =>
{
    const p = project();
    const t = transcript();
    for (const prompt of ['/security-review', '/alfred-code:init', '/review', '/help'])
        assert.strictEqual(bannerOf(typedRun(p, 'd1', prompt, t)), null, `no banner for ${prompt}`);
    assert.strictEqual(bannerOf(typedRun(p, 'd2', '/task-solve x', t, {}, { agent_id: 'seat-1' })), null, 'a seat');
    assert.strictEqual(bannerOf(typedRun(p, 'd3', '/task-solve x', t, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' })), null, 'claude -p: nobody to read it');
    assert.strictEqual(bannerOf(typedRun(p, 'd4', '/task-solve x', t, { ALFRED_CODE_UNATTENDED: '1' })), null, 'an unattended launch');
    const typed = { type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '/task-design --auto-mode' }] } };
    const call = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'task-design', args: '--auto-mode' },
        session_id: 'd5', cwd: p.root, transcript_path: transcript([typed]) }, { CLAUDE_PROJECT_DIR: p.root });
    assert.match(context(call), /auto-mode is ON/);
    assert.ok(!context(call).includes(BANNER_HEAD), 'a Skill call is a phase of a run, never a typed command');
});

test('auto-mode asks: every question marking one Recommended option is answered with it; anything else waits for the user', () =>
{
    const p = project();
    autoStamp(p, 'a1');
    const two = [q('Plan ready. Build it?', ['Approve and build (Recommended)', 'Changes needed']), q('Which mode?', ['Run in this session (Recommended)', 'Dispatch the seats'])];
    const r = ask(p, 'a1', two);
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.strictEqual(out.permissionDecision, 'allow');
    assert.deepStrictEqual(out.updatedInput.questions, two, 'the questions are echoed, as the docs require');
    assert.deepStrictEqual(out.updatedInput.answers, { 'Plan ready. Build it?': 'Approve and build (Recommended)', 'Which mode?': 'Run in this session (Recommended)' });
    assert.match(out.additionalContext, /auto: <question> -> <choice>/);
    assert.ok(rows(p, 'a1').some((x) => x.kind === 'auto-answer'), 'one auto-answer row');
    // waits: a question with no Recommended option, or two
    assert.strictEqual(answered(ask(p, 'a1', [two[0], q('Which name?', ['alpha', 'beta'])])), null, 'one unmarked question holds the whole ask');
    assert.strictEqual(answered(ask(p, 'a1', [q('Pick', ['A (Recommended)', 'B (Recommended)'])])), null, 'two marked is no recommendation');
    assert.ok(rows(p, 'a1').some((x) => x.kind === 'auto-ask-waits'), 'and the wait is logged');
    // auto-mode commits but never ships
    for (const outward of [q('Commit is done. Next?', ['Push to origin (Recommended)', 'Stop here']), q('Ready to merge into main?', ['Yes (Recommended)', 'No']),
        q('Next?', ['Deploy the staging build (Recommended)', 'Wait'])])
        assert.strictEqual(answered(ask(p, 'a1', [outward])), null, `waits: ${outward.question}`);
    assert.deepStrictEqual(answered(ask(p, 'a1', [q('Commit the fix?', ['Commit now (Recommended)', 'Leave it staged'])])), { 'Commit the fix?': 'Commit now (Recommended)' }, 'a commit is answered');
    // the fresh-session hand-off is never taken: the next option in the template's order is
    assert.deepStrictEqual(answered(ask(p, 'a1', [q('Size large. Run it where?', ['Resume in a fresh session (Recommended)', 'Run in this session', 'Dispatch the agent seats'])])),
        { 'Size large. Run it where?': 'Run in this session' });
    assert.strictEqual(answered(ask(p, 'a1', [q('Go on?', ['Start a fresh session (Recommended)'])])), null, 'no other option - the ask waits');
    // a multi-select question with one marked option
    assert.deepStrictEqual(answered(ask(p, 'a1', [q('Which layers?', ['Hooks (Recommended)', 'Rules'], true)])), { 'Which layers?': 'Hooks (Recommended)' });
    // outward acts wait: anything another person sees or nothing local undoes (audit HK01, the replayed labels)
    for (const [question, label] of [['The branch is pushed. Next?', 'Open the pull request (Recommended)'], ['Next?', 'Open the PR (Recommended)'],
        ['Ticket comment drafted. Post it?', 'Post the comment to the ticket (Recommended)'], ['Send the summary?', 'Send it to the team channel (Recommended)'],
        ['File the bug upstream?', 'Create the GitHub issue (Recommended)'], ['Stale branches found. Clean up?', 'Delete the 4 remote branches (Recommended)'],
        ['Ship it?', 'Ship v2.5.0 (Recommended)'], ['A token leaked. Rotate?', 'Rotate it now (Recommended)'], ['Diverged. Reset?', 'Reset the branch to origin/main (Recommended)'],
        ['Drop the test database?', 'Drop it (Recommended)'],
        // an ask the English list cannot read waits too (deep hooks review 2026-10-16, the script rule)
        ['Що далі?', 'Запушити гілку (Recommended)'], ['Що далі?', 'Оновити документацію (Recommended)']])
        assert.strictEqual(answered(ask(p, 'a1', [q(question, [label, 'Not now'])])), null, `waits: ${label}`);
    for (const [question, label] of [['Fix the issue now?', 'Fix it (Recommended)'], ['Drop the unused import?', 'Drop it (Recommended)'], ['Dead code found.', 'Remove the dead code (Recommended)']])
        assert.ok(answered(ask(p, 'a1', [q(question, [label, 'Not now'])])), `answered, a local act: ${label}`);
    // not auto-mode: another session's stamp, a hand-written stamp in any session, a seat, no stamp
    assert.strictEqual(answered(ask(p, 'other', two)), null, "another session's stamp");
    const hand = fs.readFileSync(p.gate, 'utf8');
    fs.writeFileSync(p.gate, 'AUTO - "take every recommended option"\n');
    assert.strictEqual(answered(ask(p, 'other', two)), null, 'a hand-written stamp answers no other session (audit HK02)');
    assert.strictEqual(answered(ask(p, 'a1', two)), null, 'nor its own: only a stamp naming the session answers');
    fs.writeFileSync(p.gate, hand);
    assert.strictEqual(answered(ask(p, 'a1', two, { agent_id: 'seat-1' })), null, 'a seat');
    fs.rmSync(p.gate);
    assert.strictEqual(answered(ask(p, 'a1', two)), null, 'no stamp - the user answers');
});

// 2026-10-16, the user's bug report: an auto-mode task-solve approval reached the user. 'too small to pay for seats' read
// as an outward money act, so the ask waited; the shape check then sent it back for a fresh-session option (a new cycle in
// a finished cycle's chat), and the re-sent ask waited on the same word.
test('auto-mode asks: the pay-for-seats idiom and the fresh-session cost line are no outward act, and no new-cycle deny under auto-mode', () =>
{
    const p = project();
    autoStamp(p, 'pay1');
    const approve = q('Plan ready: 4 steps in 2 files, too small to pay for seats. Approve it?',
        ['Approve - build in this session (Recommended)', 'Approve - dispatch the agent seats', 'Not yet - changes needed']);
    assert.deepStrictEqual(answered(ask(p, 'pay1', [approve])), { [approve.question]: 'Approve - build in this session (Recommended)' }, 'the reported ask is answered');
    for (const question of ['This chat re-sends about 401k tokens per message. Where next?', 'This chat sends about 226k tokens with every message. Go on?',
        'Run it where? ~254k tokens re-sent per message here.', 'Seats would not pay for themselves here. Build?'])
    {
        const cost = q(question, ['Resume in a fresh session (Recommended)', 'Run in this session']);
        assert.deepStrictEqual(answered(ask(p, 'pay1', [cost])), { [question]: 'Run in this session' }, `answered: ${question}`);
    }
    // a real outward act still waits
    for (const [question, label] of [['Licence needed. Buy it?', 'Pay for the licence (Recommended)'], ['Done. Next?', 'Send the report to the client (Recommended)'],
        ['Next?', 'Push to origin (Recommended)'], ['Order ready. Next?', 'Charge the customer card (Recommended)']])
        assert.strictEqual(answered(ask(p, 'pay1', [q(question, [label, 'Not now'])])), null, `waits: ${label}`);

    // the new-cycle deny: a typed prompt after this session's plan was stamped Completed:, then an ask with no fresh option
    const completed = { type: 'assistant', message: { id: 'done', content: [{ type: 'tool_use', id: 'w1', name: 'Edit',
        input: { file_path: path.join(p.root, '.alfred/docs/plans/2026-10-16-x.md'), old_string: 'Approved:', new_string: 'Approved: yes\nCompleted: 2026-10-16' } }] } };
    const cycle = () => transcript([{ type: 'user', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } }, completed,
        { type: 'user', entrypoint: 'cli', message: { role: 'user', content: [{ type: 'text', text: 'now the manager view' }] } },
        { type: 'assistant', entrypoint: 'cli', message: { id: `m${++n}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: 362000 } } }]);
    const outward = q('Result: design done. Ship it?', ['Push the branch (Recommended)', 'Stop']);
    const waits = ask(p, 'pay1', [outward], { transcript_path: cycle() });
    assert.strictEqual(waits.status, 0, `auto-mode: an outward ask waits for the user, never sent back for a fresh option: ${waits.stderr}`);
    assert.strictEqual(answered(waits), null);
    assert.doesNotMatch(context(waits), /fresh session/i, 'nor noted with one');
    fs.rmSync(p.gate);
    const attended = ask(p, 'pay2', [outward], { transcript_path: cycle() });
    assert.strictEqual(attended.status, 2, 'off auto-mode the new cycle\'s first ask is still sent back');
    assert.match(attended.stderr, /Resume in a fresh session \(Recommended\)/);
});

// audit 2026-10-14 SKF-04 (the user's ruling, option A): the upgrade's hard stop is a rail. Put as the attended run puts
// it, the hook answers its marked 'Re-plan' and a stage that stays red re-plans unattended; so under auto-mode the skill
// puts it with no mark and the question saying why, and the hook leaves it for the user without denying it.
test('auto-mode asks: the upgrade hard stop waits when put unmarked with its reason, as task-version-upgrade says', () =>
{
    const p = project();
    fs.writeFileSync(p.gate, 'AUTO - "/task-version-upgrade --auto-mode"\nsession: u1\nskill: task-version-upgrade\n');
    const labels = ['Re-plan from this stage', "Roll back to the last stage's rollback point", 'Stop here'];
    const marked = q('Stage 3 stays red after its resolver pass. How do we go on?', [`${labels[0]} (Recommended)`, ...labels.slice(1)]);
    assert.deepStrictEqual(answered(ask(p, 'u1', [marked])), { [marked.question]: 'Re-plan from this stage (Recommended)' },
        'the attended shape is answered unattended - the reason auto-mode drops the mark');
    const skillText = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'task-version-upgrade', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
    const opener = (/the question opening '([^']+)'/.exec(skillText) || [])[1];
    assert.ok(opener, 'the skill names the opener its auto-mode hard stop carries');
    const waits = q(`${opener}. Stage 3 stays red after its resolver pass. How do we go on?`, labels);
    const r = ask(p, 'u1', [waits]);
    assert.strictEqual(answered(r), null, 'the unmarked hard stop is not answered');
    assert.strictEqual(r.status, 0, `the mark check lets it through: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Blocked/);
    assert.ok(rows(p, 'u1').some((x) => x.kind === 'auto-ask-waits'), 'the wait is logged');
    const bare = ask(p, 'u1', [q('Stage 3 stays red after its resolver pass. How do we go on?', labels)]);
    assert.strictEqual(bare.status, 2, 'unmarked with no reason is handed back by the mark check');
    assert.match(bare.stderr, /without exactly one option marked '\(Recommended\)'/);
});

// ---------------------------------------------------------------------------------------------
// the run goes on: guard-stop-contract.js Stop
// ---------------------------------------------------------------------------------------------
test('auto-mode Stop: the run is sent back until its close deletes the stamp, and the chain bounds it', () =>
{
    const p = project();
    const log = fs.mkdtempSync(path.join(TMP, 'chain-'));
    const t = transcript();
    const stop = (sid, extra = {}) => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.', ...extra }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log });
    autoStamp(p, 'r1');
    const held = stop('r1');
    assert.strictEqual(held.status, 2, 'a turn ending between steps is sent back');
    assert.match(held.stderr, /auto-mode is on and its run is not closed/);
    assert.match(held.stderr, /delete .*APPROVAL - that ends auto-mode/);
    // the continuation with no tool call since: the run can only wait or ask - it ends its turn
    assert.strictEqual(stop('r1', { stop_hook_active: true }).status, 0, 'never a loop');
    // work since the hold re-arms it
    fs.appendFileSync(t, JSON.stringify({ type: 'assistant', timestamp: new Date(Date.now() + 1000).toISOString(),
        message: { id: 'w', role: 'assistant', content: [{ type: 'tool_use', id: 'tu', name: 'Bash', input: { command: 'npm test' } }] } }) + '\n');
    assert.strictEqual(stop('r1', { stop_hook_active: true }).status, 2, 'a tool call since the hold - the run is going, held again');
    // the close deleted the stamp: the Stop stands
    fs.rmSync(p.gate);
    assert.strictEqual(stop('r1', { last_assistant_message: 'Result: 4 of 4 stages - docs/plans/q.md\nProgress: 4 of 4\nLeftovers: none' }).status, 0, 'closed');
    // not this run: another session, a seat, a hand-written stamp (its flow closes itself)
    autoStamp(p, 'r1');
    assert.strictEqual(stop('r2', { last_assistant_message: 'Report written to docs/report.md.' }).status, 0, "another session's stamp");
    assert.strictEqual(run('guard-stop-contract.js', { hook_event_name: 'SubagentStop', agent_id: 'seat', session_id: 'r1', cwd: p.root, transcript_path: t, last_assistant_message: 'done' },
        { CLAUDE_PROJECT_DIR: p.root }).status, 0, 'a seat');
    fs.writeFileSync(p.gate, 'AUTO - "take every recommendation"\n');
    assert.strictEqual(stop('r3', { last_assistant_message: 'Report written to docs/report.md.' }).status, 0, 'a hand-written AUTO stamp is not held here');
});

// Audit 2026-10-20 C02 (71d5428a, 3a8a1ee3, 7ec6c7db, 8a1fb350): every wait for the run's own seats was sent back once,
// and the retry only restated the wait - ~3.4M tokens. Work this session launched that is still out wakes the run itself.
test('auto-mode Stop: a run waiting on its own background work passes, an idle run is still sent back (C02)', () =>
{
    const p = project();
    const t = transcript();
    const wait = 'Waiting on the category-order builder agent (tasks 3-5) this session started.';
    const stop = (sid, extra = {}) => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: t,
        last_assistant_message: wait, ...extra }, { CLAUDE_PROJECT_DIR: p.root });
    autoStamp(p, 'w1');
    const seat = [{ id: 't1', type: 'subagent', status: 'running', description: 'builder', agent_type: 'implementer' }];
    const waits = stop('w1', { background_tasks: seat });
    assert.strictEqual(waits.status, 0, `a wait on a running seat is not sent back: ${waits.stderr}`);
    assert.ok(rows(p, 'w1').some((r) => r.kind === 'auto-wait' && r.mode === 'auto'), 'one auto-wait row, a record');
    assert.strictEqual(stop('w1', { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'for i in $(seq 1 36); do docker info >/dev/null 2>&1 && break; sleep 5; done' }] }).status, 0,
        'a finite poll redirected to /dev/null is live work too');
    // the case the hold exists for: nothing is out, so nobody will wake the run
    const idle = stop('w1', { background_tasks: [] });
    assert.strictEqual(idle.status, 2, 'an idle run with nothing out is sent back');
    assert.match(idle.stderr, /auto-mode is on and its run is not closed/);
    assert.strictEqual(stop('w1', { background_tasks: [{ id: 's', type: 'shell', status: 'running', command: 'npm run dev' }] }).status, 2, 'a dev server never wakes the run');
    assert.strictEqual(stop('w1', { background_tasks: [{ id: 'd', type: 'subagent', status: 'completed' }] }).status, 2, 'a settled seat wakes nothing');
});

test('auto-mode Stop: the auto-fields hold skips a progress note over running work, and still holds the idle done close (C02)', () =>
{
    const p = project();
    const t = transcript([{ type: 'user', entrypoint: 'cli', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } }]);
    const note = "Chain A's fix delta is done and verified. Waiting on chain B's fix agent.";
    const stop = (sid, extra = {}) => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: t,
        last_assistant_message: note, ...extra }, { CLAUDE_PROJECT_DIR: p.root });
    autoStamp(p, 'f1');
    const live = stop('f1', { background_tasks: [{ id: 't1', type: 'subagent', status: 'running' }] });
    assert.strictEqual(live.status, 0, `71d5428a L1130: no fields owed mid-wait: ${live.stderr}`);
    assert.ok(!rows(p, 'f1').some((r) => r.detail && r.detail.branch === 'auto-fields'), 'no auto-fields row');
    const idle = stop('f1', { background_tasks: [] });
    assert.strictEqual(idle.status, 2, 'with nothing running the done close owes its fields');
    assert.match(idle.stderr, /THREE named fields/);
});

// Audit 2026-10-20 C04 (71d5428a, 3a8a1ee3, 7ec6c7db, 8a1fb350): an auto-answered stop returned before the FLOW STOP
// FIELDS check, so no waived stop carried Result / Progress / Leftovers. The check runs first and rides the answer's note.
test('auto-mode asks: an auto-answered solve-task stop gets the stop-field note beside its answer (C04)', () =>
{
    const p = project();
    autoStamp(p, 'k1');
    const flowRows = [{ type: 'user', entrypoint: 'cli', message: { role: 'user', content: '<command-name>/task-solve</command-name>' } }];
    const stopAsk = [q('Approve the gated plan? Mode: in this session.', ['Approve - build in this session (Recommended)', 'Not yet - changes needed'])];
    const bare = run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: stopAsk }, session_id: 'k1', cwd: p.root,
        transcript_path: transcript(flowRows) }, { CLAUDE_PROJECT_DIR: p.root });
    assert.ok(answered(bare), `still auto-answered: ${bare.stdout}`);
    const note = JSON.parse(bare.stdout).hookSpecificOutput.additionalContext;
    assert.match(note, /auto-mode answered this ask/);
    assert.match(note, /THREE named fields/, 'the fields are named beside the answer');
    assert.match(note, /`mechanics: read`/, 'and the approval receipt the stop owes');
    const stamped = [...flowRows, { type: 'assistant', entrypoint: 'cli', message: { id: 'mk', role: 'assistant', content: [{ type: 'text', text: 'Size: standard - three files\nResult: plan gated - docs/plans/x.md\nProgress: 3 of 5\nLeftovers: none\nmechanics: read' }] } }];
    const full = run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: stopAsk }, session_id: 'k1', cwd: p.root,
        transcript_path: transcript(stamped) }, { CLAUDE_PROJECT_DIR: p.root });
    assert.doesNotMatch(JSON.parse(full.stdout).hookSpecificOutput.additionalContext, /THREE named fields|owes a receipt/, 'a stop that printed them gets no note');
    const outside = ask(p, 'k1', stopAsk);
    assert.doesNotMatch(JSON.parse(outside.stdout).hookSpecificOutput.additionalContext, /THREE named fields/, 'no solve-task cycle, no note');
});

// Audit 2026-10-14 HK05 (the user's ruling): Claude Code's 8-continuation cap resets on every tool call, so a run that keeps
// calling tools was sent back for as long as its stamp stood. The holds are counted per stamp beside the chain marker; the
// 50th Stop passes with one auto-continue-cap row, and a new stamp counts from 0.
test('auto-mode Stop: the 50th Stop under one stamp passes with one auto-continue-cap row, and a new stamp counts again (HK05)', () =>
{
    const p = project();
    const log = fs.mkdtempSync(path.join(TMP, 'cap-'));
    const t = transcript();
    // each Stop opens a new cycle (no stop_hook_active), so the chain never stands one down and only the count decides
    const stop = () => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'c1', cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.' }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log });
    const capRows = () => rows(p, 'c1').filter((r) => r.kind === 'auto-continue-cap');
    autoStamp(p, 'c1', `at: ${new Date().toISOString()}\n`);
    assert.strictEqual(stop().status, 2, 'the first Stop is sent back');
    const counter = fs.readdirSync(log).filter((f) => /^alfred-stop-held-guard-stop-contract-Stop-c1-main\.auto$/.test(f));
    assert.strictEqual(counter.length, 1, `the count sits beside the chain marker: ${fs.readdirSync(log)}`);
    const file = path.join(log, counter[0]);
    const first = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(first.count, 1, 'one hold counted');
    assert.strictEqual(stop().status, 2, 'the second is sent back too');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).count, 2, 'and counted');
    // 48 holds made: the 49th Stop is still sent back, the 50th passes with its row, the 51st passes with no second row
    fs.writeFileSync(file, JSON.stringify({ ...first, count: 48 }));
    assert.strictEqual(stop().status, 2, '49: sent back');
    assert.deepStrictEqual(capRows(), [], 'no cap row before the cap');
    const fifty = stop();
    assert.strictEqual(fifty.status, 0, '50: passes');
    assert.strictEqual(fifty.stderr, '', 'no continuation is asked for');
    assert.strictEqual(capRows().length, 1, 'one auto-continue-cap row');
    assert.strictEqual(capRows()[0].mode, 'auto', 'a record, never a block');
    assert.strictEqual(capRows()[0].detail.count, 50);
    assert.strictEqual(stop().status, 0, '51: passes');
    assert.strictEqual(capRows().length, 1, 'still the one row');
    assert.ok(fs.existsSync(p.gate), 'the stamp stands - only its close or the user\'s word to stop ends auto-mode');
    // a new auto-mode start writes a new stamp: its count starts over
    autoStamp(p, 'c1', 'at: 2026-10-14T12:00:00.000Z\n');
    const past = new Date(Date.now() - 30000);
    fs.utimesSync(p.gate, past, past);
    assert.strictEqual(stop().status, 2, 'a new stamp is sent back again');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).count, 1, 'counted from 1');
    // a torn count file reads as 0, never as a cap
    fs.writeFileSync(file, '{"stamp":');
    assert.strictEqual(stop().status, 2, 'a torn count file holds');
});

// ---------------------------------------------------------------------------------------------
// the dispatch guard reads the same stamp
// ---------------------------------------------------------------------------------------------
test('auto-mode dispatch: the run\'s stamp approves its implementer seats past 8h, for its own session only', () =>
{
    const p = project();
    const disp = (sid) => run('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: 'aspnet-implementer', prompt: 'x' }, session_id: sid, transcript_path: transcript() },
        { CLAUDE_PROJECT_DIR: p.root }).status;
    autoStamp(p, 'd1');
    const old = (Date.now() - 12 * 3600 * 1000) / 1000;
    fs.utimesSync(p.gate, old, old);
    assert.strictEqual(disp('d1'), 0, 'a 12h auto run still dispatches');
    assert.strictEqual(disp('d2'), 2, "another session's run is no approval");
});

// ---------------------------------------------------------------------------------------------
// the window: settings.js compactWindowSeeds and the writer
// ---------------------------------------------------------------------------------------------
const CATALOG = require('../meta/environment.json').env;
const MODELS = { 'claude-opus-5-5': 1000000, 'claude-haiku-4-5': 200000, 'claude-x-500k': 500000 };

const ON = { ALFRED_CODE_AUTO_COMPACT: '1' };
test('auto-mode window: each model compacts at its window tier\'s fresh-session trigger, only where the project compacts instead', () =>
{
    assert.deepStrictEqual(settings.compactWindowSeeds(MODELS, ON, CATALOG), { 'claude-opus-5-5': 400000, 'claude-haiku-4-5': 180000, 'claude-x-500k': 280000 }, 'the seeded triggers');
    assert.deepStrictEqual(settings.compactWindowSeeds(MODELS, {}, CATALOG), {}, 'the catalog seeds ALFRED_CODE_AUTO_COMPACT 0: the fresh-session offers stay, nothing compacts early');
    for (const v of ['0', 'yes', 'true', ''])
        assert.deepStrictEqual(settings.compactWindowSeeds(MODELS, { ALFRED_CODE_AUTO_COMPACT: v }, CATALOG), {}, `'${v}' is not 1`);
    assert.deepStrictEqual(settings.compactWindowSeeds(MODELS, { ...ON, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '350000', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: 'x' }, CATALOG),
        { 'claude-opus-5-5': 350000, 'claude-x-500k': 280000 }, 'the env the file applies; a tier switched off seeds nothing; garbage reads as the seed');
    assert.deepStrictEqual(settings.compactWindowSeeds({ a: 200000, b: 1000000 }, { ...ON, ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '250000', ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '50000' }, CATALOG),
        { a: 180000, b: 100000 }, 'a trigger past its window is held at 90% of it, and the value never under Claude Code\'s 100,000');
    assert.deepStrictEqual(settings.compactWindowSeeds({ tiny: 50000, junk: 'x' }, ON, CATALOG), {}, 'a row under 100k or not a number seeds nothing');
    assert.deepStrictEqual(settings.compactWindowSeeds({ 'us.anthropic.claude-x': 200000, 'Claude-X': 200000 }, ON, CATALOG), {}, 'nor an id the stamp could not read back');
});

function writer(dir, opts = {})
{
    const file = path.join(dir, '.claude', opts.local ? 'settings.local.json' : 'settings.json');
    return settings.writeSettings({ file, catalog: CATALOG, migrations: {}, log: opts.log || (() => {}), note: () => {},
        localFile: opts.local ? null : path.join(dir, '.claude', 'settings.local.json'),
        inheritedEnv: opts.inheritedEnv || null,
        compactWindows: opts.windows === null ? null : { models: MODELS, inherited: opts.inherited || null, account: opts.account || {} },
        // `--auto-compact on` unless the case says otherwise (null: the flag not given)
        autoCompact: opts.autoCompact === undefined ? { value: '1' } : opts.autoCompact,
        ledger: { prior: opts.prior || null } });
}
const read = (dir, name = 'settings.json') => JSON.parse(fs.readFileSync(path.join(dir, '.claude', name), 'utf8'));
// The ledger as the next run reads it: written into a stamp and read back, never handed over in memory (the 2026-10-14
// matrix: the stamp reader dropped every window row, so no update, move or uninstall could take one back).
function throughStamp(managed)
{
    const file = path.join(TMP, `stamp-${++n}`);
    fs.writeFileSync(file, renderLedger(managed).join('\n') + '\n');
    return readLedger(file);
}

test('auto-mode window: install seeds it per model in the project file, ledgers it, and an update re-derives only its own', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'win-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    const said = [];
    const first = writer(dir, { log: (l) => said.push(l) });
    assert.deepStrictEqual(read(dir).modelSettings, { 'claude-opus-5-5': { autoCompactWindow: 400000 }, 'claude-haiku-4-5': { autoCompactWindow: 180000 }, 'claude-x-500k': { autoCompactWindow: 280000 } });
    assert.ok(said.some((l) => /settings\.json: autoCompactWindow per model - 180000 on 1 model, 280000 on 1 model, 400000 on 1 model/.test(l)), said.join('\n'));
    const ledger = first.managed.settings['settings.json'];
    assert.strictEqual(ledger['modelSettings.claude-opus-5-5.autoCompactWindow'], valueHash('400000'));
    // a re-run changes nothing
    const again = [];
    assert.deepStrictEqual(throughStamp(first.managed).settings['settings.json'], ledger, 'every window row survives the stamp');
    const second = writer(dir, { prior: throughStamp(first.managed), log: (l) => again.push(l) });
    assert.ok(!again.some((l) => /autoCompactWindow/.test(l)), 'idempotent');
    // the user changes one, the trigger moves: the stack's two follow, the user's stays
    const data = read(dir);
    data.modelSettings['claude-haiku-4-5'].autoCompactWindow = 120000;
    data.env = { ...data.env, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '350000' };
    data.modelSettings['claude-opus-5-5'].effortLevel = 'high';
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(data));
    const third = writer(dir, { prior: throughStamp(second.managed) });
    const ms = read(dir).modelSettings;
    assert.deepStrictEqual(ms['claude-opus-5-5'], { autoCompactWindow: 350000, effortLevel: 'high' }, 're-derived, the other key kept');
    assert.strictEqual(ms['claude-haiku-4-5'].autoCompactWindow, 120000, "the user's value stays");
    assert.strictEqual(third.managed.settings['settings.json']['modelSettings.claude-haiku-4-5.autoCompactWindow'], undefined, 'and is not the stack\'s');
    // uninstall removes the stack's own, keeps the user's and the other key
    settings.removeManagedSettings({ claudeDir: path.join(dir, '.claude'), ledger: throughStamp(third.managed) });
    assert.deepStrictEqual(read(dir).modelSettings, { 'claude-opus-5-5': { effortLevel: 'high' }, 'claude-haiku-4-5': { autoCompactWindow: 120000 } });
});

test('auto-mode window: a window the user set for every model, or for this one elsewhere, is left alone', () =>
{
    const fresh = () => { const d = fs.mkdtempSync(path.join(TMP, 'own-')); fs.mkdirSync(path.join(d, '.claude')); return d; };
    let dir = fresh();
    writer(dir, { account: { autoCompactWindow: 500000 } });
    assert.strictEqual(read(dir).modelSettings, undefined, 'the account file sets one window for all - this file would outrank it');
    dir = fresh();
    writer(dir, { account: { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 600000 } } } });
    assert.deepStrictEqual(Object.keys(read(dir).modelSettings), ['claude-haiku-4-5', 'claude-x-500k'], 'a model the account names is the account\'s');
    dir = fresh();
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ modelSettings: { 'claude-haiku-4-5': { autoCompactWindow: 180000 } } }));
    writer(dir);
    assert.deepStrictEqual(Object.keys(read(dir).modelSettings), ['claude-opus-5-5', 'claude-x-500k'], 'settings.local.json names one - it applies over this file');
    dir = fresh();
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 250000 }));
    writer(dir);
    assert.strictEqual(read(dir).modelSettings, undefined, 'this file\'s own top-level window');
    dir = fresh();
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ modelSettings: 'garbage' }));
    writer(dir);
    assert.strictEqual(read(dir).modelSettings, 'garbage', 'a modelSettings that is not an object is never touched');
    dir = fresh();
    writer(dir, { windows: null });
    assert.strictEqual(read(dir).modelSettings, undefined, 'no compactWindows option, nothing seeded');
    // local scope: settings.json's own entry is never hidden by a local seed
    dir = fresh();
    writer(dir, { local: true, inherited: { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 450000 } } } });
    assert.deepStrictEqual(Object.keys(read(dir, 'settings.local.json').modelSettings), ['claude-haiku-4-5', 'claude-x-500k']);
});

test('compact instead: ALFRED_CODE_AUTO_COMPACT is seeded 0, --auto-compact writes it over, and the windows follow it', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'switch-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    let said = [];
    const log = (l) => said.push(l);
    const first = writer(dir, { autoCompact: null, log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, '0', 'seeded 0');
    assert.strictEqual(read(dir).modelSettings, undefined, 'and no window: the fresh-session offers stay');
    said = [];
    const on = writer(dir, { autoCompact: { value: '1' }, prior: throughStamp(first.managed), log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, '1');
    assert.ok(said.some((l) => /env: ALFRED_CODE_AUTO_COMPACT '0' -> '1' \(--auto-compact\)/.test(l)), said.join('\n'));
    assert.deepStrictEqual(Object.keys(read(dir).modelSettings), ['claude-opus-5-5', 'claude-haiku-4-5', 'claude-x-500k'], 'every model seeded in the same run');
    // an update without the flag keeps the answer and changes nothing
    said = [];
    const kept = writer(dir, { autoCompact: null, prior: throughStamp(on.managed), log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, '1');
    assert.ok(!said.some((l) => /AUTO_COMPACT|autoCompactWindow/.test(l)), said.join('\n'));
    // back to the offers: the stack's windows leave, one the user set stays
    const data = read(dir);
    data.modelSettings['claude-haiku-4-5'].autoCompactWindow = 120000;
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(data));
    said = [];
    writer(dir, { autoCompact: { value: '0' }, prior: throughStamp(kept.managed), log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, '0');
    assert.deepStrictEqual(read(dir).modelSettings, { 'claude-haiku-4-5': { autoCompactWindow: 120000 } });
    assert.ok(said.some((l) => /autoCompactWindow removed for claude-opus-5-5, claude-x-500k/.test(l)), said.join('\n'));
    // a value the user put in by hand (configure's env step) is read without the flag
    const hand = fs.mkdtempSync(path.join(TMP, 'hand-'));
    fs.mkdirSync(path.join(hand, '.claude'));
    fs.writeFileSync(path.join(hand, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_AUTO_COMPACT: '1' } }));
    writer(hand, { autoCompact: null });
    assert.strictEqual(Object.keys(read(hand).modelSettings || {}).length, 3, 'settings.local.json\'s value applies over this file');
    // the flag is refused before anything is written when it is neither on nor off
    const bad = spawnSync(process.execPath, [path.join(__dirname, 'install', 'alfred-code.js'), 'install', '--auto-compact', 'maybe'], { cwd: hand, encoding: 'utf8' });
    assert.notStrictEqual(bad.status, 0);
    assert.match(bad.stderr + bad.stdout, /--auto-compact must be 'on' or 'off'/);
});

// ---------------------------------------------------------------------------------------------
// compact instead: the hooks (fresh-session.js COMPACT_INSTEAD)
// ---------------------------------------------------------------------------------------------
test('compact instead: no fresh-session offer at Stop, at a run\'s start or after a compaction; the run is told once', () =>
{
    const p = project();
    const big = transcript([], 'claude-opus-5-5', 450000);
    const log = fs.mkdtempSync(path.join(TMP, 'ci-'));
    const env = (on) => ({ CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log, ALFRED_CODE_AUTO_COMPACT: on ? '1' : '0' });
    const close = (on, sid) => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: big,
        last_assistant_message: 'The loop is closed: four stages done, nothing pending on my side.' }, env(on));
    const offered = close(false, 'c0');
    assert.strictEqual(offered.status, 2, 'past the 400k trigger the offers hold the close');
    assert.match(offered.stderr, /fresh session/i);
    assert.strictEqual(close(true, 'c1').status, 0, 'compacting instead: the close ends the turn');
    const start = (on, sid) => run('guard-fresh-session-start.js', { hook_event_name: 'UserPromptExpansion', session_id: sid, cwd: p.root, transcript_path: big,
        expansion_type: 'slash_command', command_name: 'loop-code-quality', command_args: 'src/', prompt: '/loop-code-quality src/' }, env(on));
    assert.match(context(start(false, 's0')), /Do NOT start the run yet/, 'the offer, with the offers on');
    const told = context(start(true, 's1'));
    assert.doesNotMatch(told, /Do NOT start the run yet/);
    assert.match(told, /^This project compacts instead of offering a fresh session \(ALFRED_CODE_AUTO_COMPACT=1\)/);
    assert.match(told, /puts no fresh-session option in any ask/);
    const again = context(start(true, 's1'));
    assert.doesNotMatch(again, /compacts instead of offering a fresh session \(ALFRED_CODE_AUTO_COMPACT=1\): past/, 'the note is said once per session');
    assert.match(again, /^Open your reply to this command with these two lines/, 'the mode banner still opens each typed run');
    const compacted = run('guard-fresh-session-start.js', { hook_event_name: 'SessionStart', source: 'compact', session_id: 's2', cwd: p.root, transcript_path: big }, env(true));
    assert.strictEqual(compacted.status, 0);
    const said = context(compacted);
    assert.match(said, /compacts instead of offering a fresh session/);
    assert.match(said, /Continue the work from the summary/);
    assert.doesNotMatch(said, /supersedes it/, 'the summary\'s continue line stands');
    assert.ok(!fs.readdirSync(log).some((f) => /^guard-fresh-compact-.*\.hold$/.test(f)), 'and no hold is left for the next change');
});

test('compact instead: an ask still carrying a fresh-session option goes out with it dropped and the mark moved', () =>
{
    const p = project();
    const log = fs.mkdtempSync(path.join(TMP, 'ca-'));
    const questions = [q('Stage 1 is closed. Next?', ['Resume in a fresh session (Recommended)', 'Run stage 2 here', 'Stop here'])];
    const send = (extra = {}, on = true) => run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions },
        session_id: 'k1', cwd: p.root, transcript_path: transcript(), ...extra }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log, ALFRED_CODE_AUTO_COMPACT: on ? '1' : '0' });
    const upd = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput || null; } catch { return null; } };
    const sent = send();
    assert.strictEqual(sent.status, 0, sent.stderr);
    assert.deepStrictEqual(upd(sent).questions[0].options.map((o) => o.label), ['Run stage 2 here (Recommended)', 'Stop here'], 'fixed in place (the 2026-10-17 usage audit)');
    assert.match(JSON.parse(sent.stdout).hookSpecificOutput.additionalContext, /fresh-session option dropped/);
    const seat = send({ agent_id: 'seat-1', session_id: 'k2' });
    assert.strictEqual(seat.status, 0);
    assert.strictEqual(upd(seat), null, 'a seat is never judged for it');
    const lone = run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q('Next?', ['Resume in a fresh session (Recommended)', 'Run stage 2 here'])] },
        session_id: 'k3', cwd: p.root, transcript_path: transcript() }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log, ALFRED_CODE_AUTO_COMPACT: '1' });
    assert.strictEqual(lone.status, 2, 'a question the drop leaves with one option is still handed back');
    assert.match(lone.stderr, /A question left with one option is no question/);
});
