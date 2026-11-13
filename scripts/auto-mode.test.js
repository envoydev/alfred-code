// auto-run (the mode-commands spec, 2026-11-12; stack-modes before it, 2026-10-27; was auto-mode, the user's ruling of
// 2026-10-14): `/alfred-code:mode:auto-run on`, typed alone on its line, turns auto-run on for the SESSION. The
// fresh-session hook writes the AUTO stamp naming the session, and each typed family command under it opens a run marker;
// the stop contract answers each ask that marks one Recommended option and sends a Stop back while the marker stands,
// until the run's close deletes it. `/alfred-code:mode:auto-run off` alone ends the mode. The installer seeds each
// model's auto-compact window at its fresh-session trigger, because Claude Code reads that key at session start only
// (measured 2026-10-14: written mid-session it changed nothing; set before the start it compacted at 76k of a 100k
// window). Every hook case runs through the hook's real entry.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { foreignWords } = require('./hook-test-env'); // another script's text, generated from code points
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Each typed prompt carries its own prompt_id (code.claude.com/docs/en/hooks, 'Common input fields'); a test of one prompt
// expanded twice passes the same one.
const { randomUUID } = require('node:crypto');
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
        // The typed turns a live AUTO stamp is proven by (audit 2026-10-30 HK-03, hook-prelude.js autoStampVerified): the
        // user's mode command, in the harness's tagged shape, and the hand-written waiver's words.
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>alfred-code:mode:auto-run</command-message>\n<command-name>/alfred-code:mode:auto-run</command-name>\n<command-args>on</command-args>' } },
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'take every recommendation' }] } },
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'text', text: 'go' }] } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_creation_input_tokens: 20000 } } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: ctx } } },
    ];
    fs.writeFileSync(p, [...base, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
// The window keys an install seeds (absent-only, meta/environment.json): an unset tier reads as the default's trigger.
const WINDOW_SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
    ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
const run = (hook, payload, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, hook)],
    { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...WINDOW_SEEDS, ALFRED_CODE_HOOK_LOG_DIR: env.ALFRED_CODE_HOOK_LOG_DIR || fs.mkdtempSync(path.join(TMP, 'log-')), ...env } });
const rows = (p, sid) => { try { return fs.readFileSync(path.join(p.blocks, `${sid}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
const autoStamp = (p, sid, extra = '') => fs.writeFileSync(p.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: ${sid}\nskill: alfred-code:mode:auto-run\ntranscript-size: 0\n${extra}`);
// The run marker (stack-modes spec section 2): open while a run in auto-run goes; the Stop hold and the dispatch guard read it.
const marker = (p, sid) => path.join(p.root, '.alfred', 'state', 'sessions', `AUTO-RUN-${sid}`);
const openRun = (p, sid, skill = 'loop-code-quality') => { fs.mkdirSync(path.dirname(marker(p, sid)), { recursive: true });
    fs.writeFileSync(marker(p, sid), `skill: ${skill}\nprompt: 0123456789ab\nat: ${new Date().toISOString()}\n`); };
const sub = (p, sid, prompt, t, env = {}, extra = {}) => run('guard-fresh-session-start.js', { hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: p.root, transcript_path: t, prompt, ...extra },
    { CLAUDE_PROJECT_DIR: p.root, ...(p.env || {}), ...env });

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
    command_name: prompt.slice(1).split(' ')[0], command_args: prompt.split(' ').slice(1).join(' '), prompt, prompt_id: randomUUID(), ...extra,
}, { CLAUDE_PROJECT_DIR: p.root });
const context = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };

test('auto-run start: after the mode command a typed flow command opens the run marker and gets the contract, and the fresh-session offer never fires', () =>
{
    const p = project();
    // 450k of a 1M window over a 20k first message: the size offer is due, and without auto-run it is made
    const big = transcript([], 'claude-opus-5-5', 450000);
    const plain = expand(p, 's1', '/loop-code-quality src/', big);
    assert.match(context(plain), /Do NOT start the run yet/, 'the offer, without auto-run');
    assert.ok(!fs.existsSync(p.gate), 'and no stamp');
    autoOn(p, 's2', big);
    assert.ok(!fs.existsSync(p.gate), 'the mode command writes the variable, never a stamp');
    const before = rawMode(p);
    const auto = expand(p, 's2', '/loop-code-quality src/', big);
    assert.strictEqual(auto.status, 0);
    const said = context(auto);
    assert.match(said, /^auto-run is ON for this \/loop-code-quality run/);
    assert.doesNotMatch(said, /Do NOT start the run yet/, 'the offer is never made under auto-run');
    for (const rule of [/\(Recommended\) option/, /Do not end a turn between steps/, /never push, merge, deploy or send anything out/, /fresh-session hand-off is never taken/,
        /never write an APPROVED or AUTO line over it/, /an unpushed commit is a Leftovers line/,
        /delete \.alfred\/state\/sessions\/AUTO-RUN-s2 if its `skill:` line names this run - that ends this run; auto-run stays on for the session until \/alfred-code:mode:auto-run off/])
        assert.match(said, rule);
    assert.doesNotMatch(said, /delete \.alfred\/state\/approvals\/APPROVAL/, 'the close never deletes the stamp');
    assert.match(fs.readFileSync(marker(p, 's2'), 'utf8'), /^skill: loop-code-quality\nprompt: [0-9a-f]{12}\nat: \d{4}-/, 'and the run marker');
    assert.ok(!fs.existsSync(p.legacy), 'and nothing to the legacy flow/');
    // a second flow in the same session rides the variable: the mode file stays as it was
    assert.match(context(expand(p, 's2', '/task-solve fix the cache', big)), /auto-run is ON for this \/task-solve run/);
    assert.strictEqual(rawMode(p), before, 'the mode file is kept');
    // every session in the checkout runs under it, another session's live transcript beside this one included (D4)
    const live = path.join(path.dirname(big), 's2.jsonl');
    fs.writeFileSync(live, '{}\n');
    assert.ok(modeLine(p, 's3', `${AUTO_CMD} on`, big).startsWith(AUTO_ON_LINE), 'the mode command is never refused for another session');
    assert.ok(!rows(p, 's3').some((r) => r.kind === 'auto-start-refused'), 'no refused row');
    assert.match(context(expand(p, 's3', '/task-solve-cross', big)), /auto-run is ON for this \/task-solve-cross run/);
    assert.ok(!fs.existsSync(p.gate), 'and still no stamp');
    fs.rmSync(live, { force: true });
});

test('auto-run start: a retired flag, a prose word, a seat and a payload with no session start nothing; every family command runs under the session\'s stamp', () =>
{
    const t = transcript();
    const none = (prompt, extra) => { const p = project(); const r = expand(p, 'sx', prompt, t, extra); return !fs.existsSync(p.gate) && !/auto-run is ON/.test(context(r)); };
    // a retired flag and the bare word start nothing: the flag gets its pointer at UserPromptSubmit (spec section 5)
    for (const prompt of ['/task-solve --auto-mode fix it', '/task-solve auto-mode fix it', '/loop-code-quality --mode-auto-run-on', '/loop-code-quality --mode-auto-run-on src/',
        '/task-solve fix the --mode-auto-run-on flag wording', '/loop-code-quality src/ --mode-auto-run-on', '/loop-code-quality'])
        assert.ok(none(prompt), prompt);
    // under a live stamp a seat's line and a payload naming no session open no run
    const seat = project();
    autoStamp(seat, 'sx');
    assert.doesNotMatch(context(expand(seat, 'sx', '/loop-code-quality', t, { agent_id: 'seat-1' })), /auto-run is ON/, 'a seat never opens a run');
    assert.doesNotMatch(context(expand(seat, 'sx', '/loop-code-quality', t, { session_id: '' })), /auto-run is ON/, 'no session, nothing to name');
    assert.ok(!fs.existsSync(marker(seat, 'sx')), 'and no marker');
    // a scoped name, a capture, an issue command and a project's own task skill (a digit in its name) all run under the mode
    for (const [line, name] of [['/alfred-code:loop-test-coverage-quality', 'loop-test-coverage-quality'], ['/capture-awareness', 'capture-awareness'],
        ['/issue-diagnoser the login 500', 'issue-diagnoser'], ['/task-migrate-v2', 'task-migrate-v2']])
    {
        const p = project();
        autoOn(p, 'sy', t);
        assert.match(context(expand(p, 'sy', line, t)), new RegExp(`^auto-run is ON for this /${name} run`), line);
        assert.match(fs.readFileSync(marker(p, 'sy'), 'utf8'), new RegExp(`^skill: ${name}\\n`), line);
    }
    // the typed route's matcher reaches every family name, a project's own and a digit included (audit HK06)
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const row = manifest.hooks.find((h) => String(h.matcher || '').startsWith('@UserPromptExpansion:'));
    const matcher = new RegExp(row.matcher.slice('@UserPromptExpansion:'.length));
    for (const name of ['task-migrate-v2', 'alfred-code:task-solve', 'loop-perf', 'task-solve-cross', 'capture-awareness', 'issue-diagnoser', 'issue-signatures-ci', 'mode-auto-run', 'mode-output-scoring'])
        assert.ok(matcher.test(name), `expansion spawns for ${name}`);
    for (const name of ['review', 'commit', 'tasks', 'my-task-x'])
        assert.ok(!matcher.test(name), `and not for ${name}`);
});

test('mode start: the mode command writes the stamp; each typed family command under it writes a new marker and keeps the stamp (AC2)', () =>
{
    const t = transcript();
    const ends = [];
    // UserPromptSubmit and the expansion of one typed prompt are not ordered for us: both orders end in the same files
    for (const submitFirst of [true, false])
    {
        const p = project();
        const both = (prompt) => { if (submitFirst) sub(p, 'm1', prompt, t); const r = expand(p, 'm1', prompt, t); if (!submitFirst) sub(p, 'm1', prompt, t); return r; };
        autoOn(p, 'm1', t);
        const stamp = rawMode(p);   // v2: the mode file holds the mode, no stamp is written
        assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_RUN, '1');
        assert.ok(!fs.existsSync(p.gate), 'no stamp');
        assert.ok(!fs.existsSync(marker(p, 'm1')), 'the mode command opens no run');
        assert.match(context(both('/task-solve fix A')), /^auto-run is ON for this \/task-solve run/);
        assert.strictEqual(rawMode(p), stamp, 'the mode file is kept');
        const first = fs.readFileSync(marker(p, 'm1'), 'utf8');
        assert.match(first, /^skill: task-solve\nprompt: [0-9a-f]{12}\n/);
        const b = both('/capture-awareness');
        assert.match(context(b), /^auto-run is ON for this \/capture-awareness run/, 'the next family command under the mode gets the contract');
        assert.match(bannerOf(b)[0], /^\*\*Auto-run: ON\*\* for \/capture-awareness /);
        assert.strictEqual(rawMode(p), stamp, 'the mode file is kept');
        const second = fs.readFileSync(marker(p, 'm1'), 'utf8');
        assert.match(second, /^skill: capture-awareness\n/, 'a new marker');
        assert.notStrictEqual(second.split('\n')[1], first.split('\n')[1], 'for the new prompt');
        // each typed prompt carries its own prompt_id, which the marker records (R096)
        ends.push([stamp, second].map((x) => x.replace(/\nat: [^\n]*/, '').replace(/\nprompt-id: [^\n]*/, '')));
    }
    assert.deepStrictEqual(ends[0], ends[1], 'both event orders end in the same files');
});

test('mode prompt: a plain prompt or "stop auto-mode" keeps the stamp; the off command deletes the stamp and the marker with one auto-end row (AC3, AC4)', () =>
{
    const t = transcript();
    const p = project();
    autoStamp(p, 'e1');
    openRun(p, 'e1');
    for (const prompt of ['use the v2 endpoint for the fix instead', 'stop auto-mode', 'stop', 'auto-mode off', '/compact', '/task-solve fix the auto-mode banner',
        '<task-notification>\n<task-id>x</task-id>', 'Another Claude session sent a message:\n<agent-message from="a1b2">\n[Subagent hand-back] done\n</agent-message>'])
    {
        const r = sub(p, 'e1', prompt, t);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(fs.existsSync(p.gate), `kept: ${prompt}`);
        assert.doesNotMatch(context(r), /auto-run is OFF/, `and nothing says it ended: ${prompt}`);
    }
    assert.ok(!rows(p, 'e1').some((r) => r.kind === 'auto-end'), 'no auto-end row');
    sub(p, 'e2', `${AUTO_CMD} off`, t);
    assert.ok(!fs.existsSync(p.gate) && fs.existsSync(marker(p, 'e1')), 'D7: any session\'s off ends the checkout\'s stamp; this session\'s run marker stays');
    const pr = project();
    autoStamp(pr, 'e3');
    openRun(pr, 'e3');
    assert.strictEqual(modeLine(pr, 'e3', `${AUTO_CMD} off`, t), '[mode] auto-run is OFF');
    assert.ok(!fs.existsSync(pr.gate) && !fs.existsSync(marker(pr, 'e3')), 'both files deleted');
    assert.strictEqual(rows(pr, 'e3').filter((r) => r.kind === 'auto-end').length, 1, 'one auto-end row');
    // AC4: after the off command the next asks wait
    const next = expand(pr, 'e3', '/task-solve Y', t);
    assert.match(bannerOf(next)[0], /^\*\*Auto-run: OFF\*\* for \/task-solve - each question waits for your answer\.$/);
    assert.doesNotMatch(context(next), /auto-run is ON/);
    assert.ok(!fs.existsSync(marker(pr, 'e3')), 'no marker without the mode');
    assert.strictEqual(answered(ask(pr, 'e3', [q('Build it?', ['Yes (Recommended)', 'No'])])), null, 'the ask waits');
    const stopped = run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'e3', cwd: pr.root, transcript_path: t,
        last_assistant_message: 'Result: done\nProgress: 4 of 4\nLeftovers: none' }, { CLAUDE_PROJECT_DIR: pr.root });
    assert.doesNotMatch(stopped.stderr, /its run is not closed/, 'and Stop is not held');
    // a stamp written by hand (a solve flow's no-stops waiver, no session line) is no auto-run of this hook's
    const h = project();
    fs.writeFileSync(h.gate, 'AUTO - "take every recommendation"\n');
    sub(h, 'e4', `${AUTO_CMD} off`, t);
    assert.ok(fs.existsSync(h.gate), 'a hand-written stamp stays');
});

test('mode texts: the Stop hold stderr and the auto-input note name the run marker and the off command, never the stamp path; a typed /task-solve B gets the contract and no auto-input note', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'x1');
    openRun(p, 'x1');
    const note = context(sub(p, 'x1', 'use the v2 endpoint instead', t));
    assert.match(note, /^auto-run stays ON: the user typed this message while the run goes on, so it is INPUT to the run/);
    assert.match(note, /If this message asks to stop or pause the run, print its close and delete \.alfred\/state\/sessions\/AUTO-RUN-x1 - that ends this run; auto-run stays on until \/alfred-code:mode:auto-run off\./);
    assert.doesNotMatch(note, /approvals\/APPROVAL/, 'the note never names the stamp');
    assert.ok(rows(p, 'x1').some((r) => r.kind === 'auto-input'), 'an auto-input row');
    const held = run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'x1', cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.' }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(held.status, 2);
    assert.match(held.stderr, /If the run is finished,\s+print its close and delete \S*AUTO-RUN-x1 - that ends this run; auto-run stays on for the session until\s+\/alfred-code:mode:auto-run off\./);
    assert.doesNotMatch(held.stderr, /APPROVAL/, 'the hold never names the stamp');
    assert.strictEqual(context(sub(p, 'x1', '/task-solve B', t)), '', 'a typed family command gets no auto-input note');
    const contract = context(expand(p, 'x1', '/task-solve B', t));
    assert.match(contract, /^auto-run is ON for this \/task-solve run/, 'it gets the contract');
    // the four security asks (audit 2026-10-30 fix #6; the config guard's ask before a settings write that switches a
    // protective guard off since SYS-01 of the 2026-11-03 system audit; the desktop launch left with its guard, stage 1 B12)
    assert.match(contract, /a guard's security ask \(a credential shown, work discarded, a write outside the project, a protective guard switched off\) is never auto-run's to allow: take its safe option and list the act for the user in the close/,
        'the four security asks stay the user\'s');
    const skill = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'mode-auto-run', 'SKILL.md'), 'utf8');
    assert.match(skill.replace(/\s+/g, ' '), /A guard's security ask - a credential shown, work discarded, a write outside the project, a protective guard switched off - is never auto-run's to allow/,
        'the skill says it too');
    fs.rmSync(marker(p, 'x1'));
    assert.doesNotMatch(context(sub(p, 'x1', 'another remark', t)), /auto-run stays ON/, 'no run open, no note');
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
    command_name: prompt.slice(1).split(' ')[0], command_args: prompt.split(' ').slice(1).join(' '), prompt, prompt_id: randomUUID(), ...extra,
}, { CLAUDE_PROJECT_DIR: p.root, ...env });

test('mode banner: auto-mode ON says every ask takes its Recommended option and the session compacts, at the window it will', () =>
{
    const p = project();
    const t = transcript();
    autoOn(p, 'b1', t);
    const on = typedRun(p, 'b1', '/loop-code-quality src/', t);
    assert.strictEqual(on.status, 0, on.stderr);
    const said = context(on);
    assert.match(said, /^auto-run is ON for this \/loop-code-quality run/, 'the contract first, its shape unchanged');
    assert.strictEqual(said.split(BANNER_HEAD).length, 2, 'the banner once');
    assert.deepStrictEqual(bannerOf(on), [
        '**Auto-run: ON** for /loop-code-quality - every question takes its (Recommended) option without waiting for you; one with no recommended option, or whose recommendation acts outward (push, merge, deploy, publish, a PR, a billed run), still waits. A message you type mid-run is input to the run; auto-run stays on for this session until you type `/alfred-code:mode:auto-run off`.',
        // v2: the command's save seeds the model's window (ALFRED_CODE_AUTO_COMPACT=1 with it), so the banner names it
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 400k auto-compact window (of 1M, claude-opus-5-5) and the run goes on from the summary and its state files.',
    ]);
    // the second flow of the same run rides the live stamp, and says so too
    assert.match(bannerOf(typedRun(p, 'b1', '/task-solve fix the cache', t))[0], /^\*\*Auto-run: ON\*\* for \/task-solve /);
    // the window the installer seeded for this model (ALFRED_CODE_AUTO_COMPACT=1) is the one named
    const q = project();
    fs.mkdirSync(path.join(q.root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(q.root, '.claude', 'settings.json'), JSON.stringify({ modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400000 } } }));
    autoOn(q, 'b2', t);
    assert.strictEqual(bannerOf(typedRun(q, 'b2', '/task-solve x', t))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 400k auto-compact window (of 1M, claude-opus-5-5) and the run goes on from the summary and its state files.');
});

test('mode banner: auto-mode OFF says each ask waits, then the fresh-session refresh, the compaction, or the offers off', () =>
{
    const p = project();
    const t = transcript([], 'claude-sonnet-5-5');
    const off = bannerOf(typedRun(p, 'c1', '/task-solve fix the cache', t));
    assert.deepStrictEqual(off, [
        '**Auto-run: OFF** for /task-solve - each question waits for your answer.',
        '**Context:** session refresh - the run offers to resume in a fresh session once the carry passes ~400k tokens of its 1M context window (claude-sonnet-5-5) (a trigger, not the current size), instead of compacting.',
    ]);
    // a 200k model takes its own tier's trigger
    assert.match(bannerOf(typedRun(p, 'c2', '/capture-awareness', transcript([], 'claude-haiku-4-5')))[1], /once the carry passes ~180k tokens of its 200k context window \(claude-haiku-4-5\) \(a trigger, not the current size\)/);
    assert.strictEqual(bannerOf(typedRun(p, 'c3', '/loop-test-coverage-quality', t, { ALFRED_CODE_AUTO_COMPACT: '1' }))[1],
        "**Context:** auto-compact is on (ALFRED_CODE_AUTO_COMPACT=1) - the session compacts at Claude Code's own point in its 1M context window (claude-sonnet-5-5) instead of offering a fresh session.");
    assert.strictEqual(bannerOf(typedRun(p, 'c4', '/issue-diagnoser the login 500', t, { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' }))[1],
        "**Context:** the fresh-session offers are off - the session compacts at Claude Code's own point in its 1M context window (claude-sonnet-5-5).");
    // a retired flag, in the leading run or past it, starts nothing: plain OFF (its pointer comes at submit)
    for (const line of ['/task-solve fix the cache --mode-auto-run-on', '/task-solve --mode-auto-run-on fix the cache'])
        assert.strictEqual(bannerOf(typedRun(p, 'c8', line, t))[0], '**Auto-run: OFF** for /task-solve - each question waits for your answer.', line);
    // the bare word of 2.4.0-2.5.0 and the old flag are no mode-like token past the run: plain OFF (the old flag's pointer comes at submit)
    assert.strictEqual(bannerOf(typedRun(p, 'c5', '/capture-awareness auto-mode', t))[0], '**Auto-run: OFF** for /capture-awareness - each question waits for your answer.');
    assert.strictEqual(bannerOf(typedRun(p, 'c11', '/task-solve fix the auto-mode banner', t))[0], '**Auto-run: OFF** for /task-solve - each question waits for your answer.');
    const onC = project();
    autoOn(onC, 'c12', t);
    assert.match(bannerOf(typedRun(onC, 'c12', '/capture-awareness', t))[0], /^\*\*Auto-run: ON\*\* for \/capture-awareness - /);
    assert.strictEqual(bannerOf(typedRun(p, 'c9', '/issue-diagnoser the login 500', t))[0], '**Auto-run: OFF** for /issue-diagnoser - each question waits for your answer.');
    const onI = project();
    autoOn(onI, 'c10', t);
    assert.match(bannerOf(typedRun(onI, 'c10', '/issue-diagnoser the login 500', t))[0], /^\*\*Auto-run: ON\*\* for \/issue-diagnoser - /);
    // an unknown model and no window: no number is invented for the window, and the default is said as the trigger it is
    const bare = project();
    assert.strictEqual(bannerOf(typedRun(bare, 'c6', '/task-design', path.join(TMP, 'no-such.jsonl')))[1],
        '**Context:** session refresh - the run offers to resume in a fresh session once the carry passes ~180k tokens (ALFRED_CODE_CONTEXT_WINDOW_DEFAULT - the size of its context window is not known; a trigger, not the current size), instead of compacting.');
    // the fresh-session offer keeps its text and its place; the banner follows it
    const big = transcript([], 'claude-opus-5-5', 450000);
    const offered = context(typedRun(p, 'c7', '/loop-code-quality src/', big));
    assert.match(offered, /^\/loop-code-quality is a deliberate orchestration run .* Do NOT start the run yet/);
    assert.ok(offered.indexOf(BANNER_HEAD) > offered.indexOf('Do NOT start the run yet'), 'after the offer');
});

// The user's report of 2026-10-21: settings `"model": "sonnet"` and FOR_1M=400000, yet the first command of a fresh
// session said '~280k tokens of its 300k default context window (sonnet)' - the alias read as a model id, matched no row.
test('mode banner: the model SessionStart recorded gives the window before any reply; a settings alias names none', () =>
{
    const p = project();
    fs.mkdirSync(path.join(p.root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }));
    const none = path.join(TMP, 'no-such.jsonl');
    const start = (sid, model) => run('guard-fresh-session-start.js', { hook_event_name: 'SessionStart', source: 'startup', session_id: sid, cwd: p.root, model }, { CLAUDE_PROJECT_DIR: p.root });

    assert.strictEqual(bannerOf(typedRun(p, 'r0', '/capture-awareness', none))[1],
        '**Context:** session refresh - the run offers to resume in a fresh session once the carry passes ~180k tokens (ALFRED_CODE_CONTEXT_WINDOW_DEFAULT - the size of its context window is not known; a trigger, not the current size), instead of compacting.',
        'no record: the alias is not read, so the window is unknown');
    assert.strictEqual(start('r1', 'claude-sonnet-5-5').status, 0);
    assert.strictEqual(bannerOf(typedRun(p, 'r1', '/capture-awareness', none))[1],
        '**Context:** session refresh - the run offers to resume in a fresh session once the carry passes ~400k tokens of its 1M context window (claude-sonnet-5-5) (a trigger, not the current size), instead of compacting.');
    assert.strictEqual(run('guard-fresh-session-start.js', { hook_event_name: 'PostModelSwitch', session_id: 'r1', cwd: p.root, from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-4-5' }, { CLAUDE_PROJECT_DIR: p.root }).status, 0);
    assert.match(bannerOf(typedRun(p, 'r1', '/capture-awareness', none))[1], /once the carry passes ~180k tokens of its 200k context window \(claude-haiku-4-5\) \(a trigger, not the current size\)/, 'a /model switch moves it');
    // the auto-compact window is quoted against the model's own capacity, never against the default
    fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet', autoCompactWindow: 350000 }));
    start('r2', 'claude-sonnet-5-5');
    autoOn(p, 'r2', none);
    assert.strictEqual(bannerOf(typedRun(p, 'r2', '/capture-awareness', none))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 350k auto-compact window (of 1M, claude-sonnet-5-5) and the run goes on from the summary and its state files.');
    // Claude Code caps an auto-compact window at the model's context window (code.claude.com/docs/en/model-config, 'Set
    // the auto-compact window', verified 2026-10-21), so after a /model switch to a smaller model the banner never quotes
    // a compaction point past that model's capacity
    start('r4', 'claude-sonnet-5-5');
    run('guard-fresh-session-start.js', { hook_event_name: 'PostModelSwitch', session_id: 'r4', cwd: p.root, from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-4-5' }, { CLAUDE_PROJECT_DIR: p.root });
    autoOn(p, 'r4', none);
    assert.strictEqual(bannerOf(typedRun(p, 'r4', '/capture-awareness', none))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 200k context window (its 350k auto-compact window is capped there, claude-haiku-4-5) and the run goes on from the summary and its state files.');
    const bare = project();
    autoOn(bare, 'r3', none);
    assert.strictEqual(bannerOf(typedRun(bare, 'r3', '/capture-awareness', none))[1].includes('of 300k'), false, 'no default window is quoted');
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
    autoStamp(p, 'd5');
    openRun(p, 'd5', 'task-solve');
    const call = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'task-design', args: 'x' },
        session_id: 'd5', cwd: p.root, transcript_path: t }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(call.status, 0, call.stderr);
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
        ...[[51, 52], [53, 54]].map(([q, l]) => [`${foreignWords(2, q)}?`, `${foreignWords(2, l)} (Recommended)`])])
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
    // a billed run waits too, named by its bill, its spend or a dollar cap (auto-run B, 2026-11-04: all three were answered)
    for (const [question, label] of [['Gate ready. Run it?', 'Run it, cap $5 (Recommended)'], ['Probe?', 'Five billed Sonnet runs (Recommended)'],
        ['Replay the fixtures?', 'Spend up to 2 USD on the replay (Recommended)'], ['A/B ready.', 'Run the A/B, about $60 (Recommended)'],
        ['Batch 2?', 'Go on - it bills the API key (Recommended)'], ['The probe runs nested sessions, about $3, cap $5. Run it?', 'Yes (Recommended)'],
        ['How much may I spend tonight?', 'The replay only (Recommended)'], ['Which should run?', 'The paid A/B (Recommended)']])
        assert.strictEqual(answered(ask(p, 'pay1', [q(question, [label, 'Not now'])])), null, `waits: ${question} ${label}`);
    const billedDesc = { question: 'Gate ready. Run it?', header: 'H', multiSelect: false,
        options: [{ label: 'Run it (Recommended)', description: 'five billed Sonnet runs, cap 5 dollars' }, { label: 'Not now', description: 'd' }] };
    assert.strictEqual(answered(ask(p, 'pay1', [billedDesc])), null, 'a bill named only in the description waits');
    // a recommended pick that DECLINES the spend is answered, its description naming the bill it declines included
    const declined = { question: 'The proof is billed: nested runs, about $41, capped at $57. Run it now?', header: 'H', multiSelect: false,
        options: [{ label: 'Skip it, mark NOT RUN (Recommended)', description: 'the billed proof waits for your word' }, { label: 'Run it, cap $57', description: 'd' }] };
    assert.deepStrictEqual(answered(ask(p, 'pay1', [declined])), { [declined.question]: 'Skip it, mark NOT RUN (Recommended)' }, 'a declined spend is answered');
    // local words that only look like money, a cost already measured and a negated bill stay answered
    for (const [question, label] of [['Variable unused. Rename it?', 'Rename $value to $count (Recommended)'], ['Regex?', 'Anchor it with ^ and $ (Recommended)'],
        ['Fix the billing module test?', 'Fix the test (Recommended)'], ['Spending too long here. Move on?', 'Move to the next item (Recommended)'],
        ['A/B result: the same cost ($2.96 vs $3.01). Drop the nudge?', 'Drop it (Recommended)'], ['Build it?', 'Build it locally - no billed runs (Recommended)']])
        assert.ok(answered(ask(p, 'pay1', [q(question, [label, 'Not now'])])), `answered, a local act: ${question} ${label}`);

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
    assert.match(attended.stderr, /add a fresh-session option to this first ask of a new cycle - This session carries ~362k tokens per message/);
});

// audit 2026-10-14 SKF-04 (the user's ruling, option A): the upgrade's hard stop is a rail. Put as the attended run puts
// it, the hook answers its marked 'Re-plan' and a stage that stays red re-plans unattended; so under auto-mode the skill
// puts it with no mark and the question saying why, and the hook leaves it for the user without denying it.
test('auto-mode asks: the upgrade hard stop waits when put unmarked with its reason, as task-version-upgrade says', () =>
{
    const p = project();
    autoStamp(p, 'u1');
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
test('auto-mode Stop: the run is sent back until its close deletes the run marker, and the chain bounds it', () =>
{
    const p = project();
    const log = fs.mkdtempSync(path.join(TMP, 'chain-'));
    const t = transcript();
    const stop = (sid, extra = {}) => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.', ...extra }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log });
    autoStamp(p, 'r1');
    openRun(p, 'r1');
    const held = stop('r1');
    assert.strictEqual(held.status, 2, 'a turn ending between steps is sent back');
    assert.match(held.stderr, /auto-run is on and its run is not closed/);
    assert.match(held.stderr, /delete \S*AUTO-RUN-r1 - that ends this run/);
    // the continuation with no tool call since: the run can only wait or ask - it ends its turn
    assert.strictEqual(stop('r1', { stop_hook_active: true }).status, 0, 'never a loop');
    // work since the hold re-arms it
    fs.appendFileSync(t, JSON.stringify({ type: 'assistant', timestamp: new Date(Date.now() + 1000).toISOString(),
        message: { id: 'w', role: 'assistant', content: [{ type: 'tool_use', id: 'tu', name: 'Bash', input: { command: 'npm test' } }] } }) + '\n');
    assert.strictEqual(stop('r1', { stop_hook_active: true }).status, 2, 'a tool call since the hold - the run is going, held again');
    // the close deleted the run marker: the Stop stands, and the mode stays on
    fs.rmSync(marker(p, 'r1'));
    assert.strictEqual(stop('r1', { last_assistant_message: 'Result: 4 of 4 stages - docs/plans/q.md\nProgress: 4 of 4\nLeftovers: none' }).status, 0, 'closed');
    assert.ok(fs.existsSync(p.gate), 'the stamp stands');
    // not this run: another session, a seat, a hand-written stamp (its flow closes itself)
    openRun(p, 'r1');
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
    openRun(p, 'w1');
    const seat = [{ id: 't1', type: 'subagent', status: 'running', description: 'builder', agent_type: 'implementer' }];
    const waits = stop('w1', { background_tasks: seat });
    assert.strictEqual(waits.status, 0, `a wait on a running seat is not sent back: ${waits.stderr}`);
    assert.ok(rows(p, 'w1').some((r) => r.kind === 'auto-wait' && r.mode === 'auto'), 'one auto-wait row, a record');
    assert.strictEqual(stop('w1', { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'for i in $(seq 1 36); do docker info >/dev/null 2>&1 && break; sleep 5; done' }] }).status, 0,
        'a finite poll redirected to /dev/null is live work too');
    // the case the hold exists for: nothing is out, so nobody will wake the run
    const idle = stop('w1', { background_tasks: [] });
    assert.strictEqual(idle.status, 2, 'an idle run with nothing out is sent back');
    assert.match(idle.stderr, /auto-run is on and its run is not closed/);
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
test('auto-mode Stop: the 50th Stop under one run marker passes with one auto-continue-cap row, and a new marker counts again (HK05)', () =>
{
    const p = project();
    const log = fs.mkdtempSync(path.join(TMP, 'cap-'));
    const t = transcript();
    // each Stop opens a new cycle (no stop_hook_active), so the chain never stands one down and only the count decides
    const stop = () => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'c1', cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.' }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log });
    const capRows = () => rows(p, 'c1').filter((r) => r.kind === 'auto-continue-cap');
    autoStamp(p, 'c1', `at: ${new Date().toISOString()}\n`);
    openRun(p, 'c1');
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
    assert.ok(fs.existsSync(p.gate) && fs.existsSync(marker(p, 'c1')), 'the stamp and the marker stand - only the run\'s close or the off command ends them');
    // a new typed run writes a new marker: its count starts over
    openRun(p, 'c1', 'task-solve');
    const past = new Date(Date.now() - 30000);
    fs.utimesSync(marker(p, 'c1'), past, past);
    assert.strictEqual(stop().status, 2, 'a new marker is sent back again');
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
    openRun(p, 'd1');
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

const fresh = require('../stack/hooks/fresh-session.js');
test('auto-mode window: each model compacts at its window tier\'s fresh-session trigger (the engine\'s seeds)', () =>
{
    assert.deepStrictEqual(fresh.compactWindowSeeds(MODELS, WINDOW_SEEDS), { 'claude-opus-5-5': 400000, 'claude-haiku-4-5': 180000, 'claude-x-500k': 280000 }, 'the seeded triggers');
    assert.deepStrictEqual(fresh.compactWindowSeeds(MODELS, WINDOW_SEEDS), fresh.compactWindowSeeds(MODELS, { ...WINDOW_SEEDS, ALFRED_CODE_AUTO_COMPACT: '0' }), 'the key is not read here');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ big: 1000000 }, {}), { big: 180000 }, 'an unset tier takes DEFAULT_SEED');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ big: 1000000 }, { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: 'x', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '250000' }), { big: 250000 }, 'garbage takes the default trigger');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ big: 1000000 }, { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' }), {}, '0 skips the tier');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ small: 150000 }, { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '120000' }), {}, 'a model under 200K never gets a row');
    assert.strictEqual(require('./install/settings.js').compactWindowSeeds, undefined);
    assert.deepStrictEqual(fresh.compactWindowSeeds(MODELS, { ...WINDOW_SEEDS, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '350000', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: 'x' }),
        { 'claude-opus-5-5': 350000, 'claude-x-500k': 180000 }, 'the env the file applies; a tier switched off seeds nothing; garbage reads as the default trigger');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ a: 200000, b: 1000000 }, { ...WINDOW_SEEDS, ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '250000', ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '50000' }),
        { a: 180000, b: 100000 }, 'a trigger past its window is held at 90% of it, and the value never under Claude Code\'s 100,000');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ tiny: 50000, junk: 'x' }, WINDOW_SEEDS), {}, 'a row under 100k or not a number seeds nothing');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ small: 150000, edge: 199999, at: 200000 }, { ...WINDOW_SEEDS, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '120000' }),
        { at: 180000 }, 'a window under 200K is no tier');
    assert.deepStrictEqual(fresh.compactWindowSeeds({ 'us.anthropic.claude-x': 200000, 'Claude-X': 200000 }, WINDOW_SEEDS), {}, 'nor an id the stamp could not read back');
});

function writer(dir, opts = {})
{
    const file = path.join(dir, '.claude', opts.local ? 'settings.local.json' : 'settings.json');
    return settings.writeSettings({ file, catalog: CATALOG, migrations: {}, log: opts.log || (() => {}), note: () => {},
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

test('auto-mode window: the settings pass writes no window - under --auto-compact on and under a hand-set 1', () =>
{
    // Mode commands v2 stage 3: the windows are writeModes's alone (scripts/install/modes.js refresh, install-modes.test.js).
    const dir = fs.mkdtempSync(path.join(TMP, 'win-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    const said = [];
    const first = writer(dir, { log: (l) => said.push(l) });
    assert.strictEqual(read(dir).modelSettings, undefined);
    assert.ok(!said.some((l) => /autoCompactWindow per model/.test(l)), said.join('\n'));
    assert.ok(!Object.keys(first.managed.settings['settings.json'] || {}).some((k) => k.startsWith('modelSettings.')), 'and no window row ledgered');
    const hand = fs.mkdtempSync(path.join(TMP, 'hand-'));
    fs.mkdirSync(path.join(hand, '.claude'));
    fs.writeFileSync(path.join(hand, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_AUTO_COMPACT: '1' } }));
    writer(hand, { local: true, autoCompact: null });
    const local = read(hand, 'settings.local.json');
    assert.strictEqual(local.modelSettings, undefined);
    assert.strictEqual(local.env.ALFRED_CODE_AUTO_COMPACT, '1', 'the typed mode stays as typed');
});

test('auto-mode window: the rows an earlier release ledgered leave at their hash, one the user changed stays', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'gone-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    const rows = { 'claude-opus-5-5': 400000, 'claude-haiku-4-5': 180000, 'claude-x-500k': 280000 };
    const prior = throughStamp({ settings: { 'settings.json': Object.fromEntries(Object.entries(rows)
        .map(([id, v]) => [`modelSettings.${id}.autoCompactWindow`, valueHash(String(v))])) } });
    assert.strictEqual(Object.keys(prior.settings['settings.json']).length, 3, 'every window row survives the stamp');
    const modelSettings = Object.fromEntries(Object.entries(rows).map(([id, v]) => [id, { autoCompactWindow: v }]));
    modelSettings['claude-haiku-4-5'].autoCompactWindow = 120000;
    modelSettings['claude-opus-5-5'].effortLevel = 'high';
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ modelSettings }));
    const said = [];
    writer(dir, { prior, log: (l) => said.push(l) });
    assert.deepStrictEqual(read(dir).modelSettings, { 'claude-opus-5-5': { effortLevel: 'high' }, 'claude-haiku-4-5': { autoCompactWindow: 120000 } });
    assert.ok(said.some((l) => /autoCompactWindow removed for claude-opus-5-5, claude-x-500k/.test(l)), said.join('\n'));
    // a modelSettings that is not an object is never touched
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ modelSettings: 'garbage' }));
    writer(dir, { prior });
    assert.strictEqual(read(dir).modelSettings, 'garbage');
});

test('settings-writer: uninstall takes the seeded scoring rows back and keeps one the user changed', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'scoring-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    const first = writer(dir);
    const data = read(dir);
    assert.deepStrictEqual([data.env.ALFRED_CODE_SCORING, data.env.ALFRED_CODE_SCORING_LEVEL], ['1', '80'], 'the install seeded them (on since B1 of the 2026-11-03 usage audit)');
    data.env.ALFRED_CODE_SCORING_ROUNDS = '6';
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(data));
    settings.removeManagedSettings({ claudeDir: path.join(dir, '.claude'), ledger: throughStamp(first.managed) });
    const env = read(dir).env || {};
    assert.deepStrictEqual([env.ALFRED_CODE_SCORING, env.ALFRED_CODE_SCORING_LEVEL], [undefined, undefined], 'the seeded rows go');
    assert.strictEqual(env.ALFRED_CODE_SCORING_ROUNDS, '6', "the user's value stays");
});

test('compact instead: ALFRED_CODE_AUTO_COMPACT is never seeded, --auto-compact on writes 1, off takes the key out', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'switch-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    let said = [];
    const log = (l) => said.push(l);
    const first = writer(dir, { autoCompact: null, log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, undefined, 'never seeded');
    said = [];
    const on = writer(dir, { autoCompact: { value: '1' }, prior: throughStamp(first.managed), log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, '1');
    assert.ok(said.some((l) => /env: ALFRED_CODE_AUTO_COMPACT absent -> '1' \(--auto-compact\)/.test(l)), said.join('\n'));
    assert.strictEqual(read(dir).modelSettings, undefined, 'no window from this pass');
    // an update without the flag keeps the answer and changes nothing
    said = [];
    const kept = writer(dir, { autoCompact: null, prior: throughStamp(on.managed), log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, '1');
    assert.ok(!said.some((l) => /AUTO_COMPACT|autoCompactWindow/.test(l)), said.join('\n'));
    // off takes the key out, a 1 included
    said = [];
    writer(dir, { autoCompact: { value: '0' }, prior: throughStamp(kept.managed), log });
    assert.strictEqual(read(dir).env.ALFRED_CODE_AUTO_COMPACT, undefined);
    assert.ok(said.some((l) => /env: ALFRED_CODE_AUTO_COMPACT '1' removed \(--auto-compact off\)/.test(l)), said.join('\n'));
    // the flag is refused before anything is written when it is neither on nor off
    const bad = spawnSync(process.execPath, [path.join(__dirname, 'install', 'alfred-code.js'), 'install', '--auto-compact', 'maybe'], { cwd: dir, encoding: 'utf8' });
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
        expansion_type: 'slash_command', command_name: 'loop-code-quality', command_args: 'src/', prompt: '/loop-code-quality src/', prompt_id: randomUUID() }, env(on));
    assert.match(context(start(false, 's0')), /Do NOT start the run yet/, 'the offer, with the offers on');
    const told = context(start(true, 's1'));
    assert.doesNotMatch(told, /Do NOT start the run yet/);
    assert.match(told, /^This session compacts instead of offering a fresh session \(ALFRED_CODE_AUTO_COMPACT=1\)/);
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

test('scoring asks: each option of the continue and withhold-final asks is auto-answered when it is the recommended one (R19)', () =>
{
    const p = project();
    autoStamp(p, 'sc1');
    const options = [['Answer the open decisions', 'your answers join the task and one more attempt runs'],
        ['Accept it at 70, marked', 'it goes out now, its score and open findings named'],
        ['Revise once more', 'one more revision and grade, about one seat run'], ['Keep it withheld', 'the best draft stays where it is']];
    const question = 'The designer-plan scored 70/100 (level 80); the next revision can reach at most 78 - 1 open decision(s). How should it go on?';
    for (const [pick] of options)
    {
        const ordered = [options.find(([l]) => l === pick), ...options.filter(([l]) => l !== pick)]
            .map(([label, description], i) => ({ label: i ? label : `${label} (Recommended)`, description }));
        const r = ask(p, 'sc1', [{ question, header: 'Scoring', multiSelect: false, options: ordered }]);
        assert.deepStrictEqual(answered(r), { [question]: ordered[0].label }, pick);
    }
});

// ---------------------------------------------------------------------------------------------
// /mode-auto-run <request> (the user's ask, 2026-10-25): the typed request IS the waiver, no flag; a code change follows the
// installed solve flow by reading it, since Claude Code refuses the model's own call of a disable-model-invocation skill
// ---------------------------------------------------------------------------------------------
test('mode-auto-run: an empty request starts nothing and says why; with a request it starts the mode for the session', () =>
{
    const t = transcript();
    const cfg = () => ({ CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'acct-ta-')) });
    const p = project();
    const on = typedRun(p, 'ta1', '/mode-auto-run add a status route', t, cfg());
    assert.strictEqual(on.status, 0, on.stderr);
    const said = context(on);
    assert.match(said, /^auto-run is ON for this \/mode-auto-run run/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /^AUTO - "\/mode-auto-run add a status route"\nsession: ta1\nskill: mode-auto-run\nat: \d{4}-/);
    assert.match(fs.readFileSync(marker(p, 'ta1'), 'utf8'), /^skill: mode-auto-run\n/);
    assert.match(bannerOf(on)[0], /^\*\*Auto-run: ON\*\* for \/mode-auto-run /);
    assert.match(said, /Solve flow: not installed here - a code change goes under Left for you\./, 'no copy on disk');
    assert.ok(rows(p, 'ta1').some((r) => r.kind === 'auto-start' && r.detail && r.detail.skill === 'mode-auto-run'));
    // the mode lasts the session: the next typed family command runs under it with no flag
    assert.match(context(typedRun(p, 'ta1', '/task-solve next', t, cfg())), /^auto-run is ON for this \/task-solve run/);
    // the project's library copy is the one named, with its folder
    const solve = (root) => { const d = path.join(root, '.claude', 'skills', 'task-solve'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: task-solve\ndisable-model-invocation: true\n---\n'); return d; };
    const p2 = project(); const d2 = solve(p2.root);
    assert.ok(context(typedRun(p2, 'ta2', '/mode-auto-run add a status route', t, cfg())).includes(`Solve flow: ${path.join(d2, 'SKILL.md')} - on the code route Read it whole and follow it as this run's flow; its references/ and scripts/ paths are under ${d2}.`));
    const p4 = project(); const d4 = solve(p4.root);
    fs.writeFileSync(path.join(p4.root, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { 'task-solve': 'user-invocable-only' } }));
    assert.ok(context(typedRun(p4, 'ta4', '/mode-auto-run x', t, cfg())).includes(`Solve flow: ${path.join(d4, 'SKILL.md')}`), 'user-invocable-only still runs from its copy');
    const p5 = project(); const c5 = cfg();
    const cache = path.join(c5.CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'm', 'alfred-code', '9.9.9', 'stack', 'skills', 'task-solve');
    fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, 'SKILL.md'), '---\nname: task-solve\n---\n');
    assert.match(context(typedRun(p5, 'ta5', '/mode-auto-run x', t, c5)), /Solve flow: not installed here/, 'the cache source is no copy');
    // no request or spaces only: no stamp, the banner says OFF and why
    for (const prompt of ['/mode-auto-run', '/mode-auto-run   '])
    {
        const q0 = project();
        const off = typedRun(q0, 'ta6', prompt, t, cfg());
        assert.strictEqual(off.status, 0, off.stderr);
        assert.ok(!fs.existsSync(q0.gate), `no stamp: '${prompt}'`);
        assert.strictEqual(bannerOf(off)[0], '**Auto-run: OFF** for /mode-auto-run - each question waits for your answer. (auto-run did NOT start: type the request after /mode-auto-run.)');
    }
    const oldFlag = project();
    typedRun(oldFlag, 'ta7', '/mode-auto-run --auto-mode', t, cfg());
    assert.ok(!fs.existsSync(oldFlag.gate), 'the old flag alone starts nothing');
    // another session's running stamp: the refusal and its banner line
    const p8 = project();
    fs.writeFileSync(p8.gate, `AUTO - "/alfred-code:mode:auto-run on"\nsession: oth1\nskill: alfred-code:mode:auto-run\nat: ${new Date().toISOString()}\n`);
    const live = path.join(path.dirname(t), 'oth1.jsonl'); fs.writeFileSync(live, '{}\n');
    assert.match(context(typedRun(p8, 'ta8', '/mode-auto-run y', t, cfg())), /auto-run did NOT start: another session \(oth1\) is running a stamped run/);
    assert.match(fs.readFileSync(p8.gate, 'utf8'), /\nsession: oth1\n/);
    fs.rmSync(live, { force: true });
});

test('mode-auto-run: the model never calls it, and a typed /mode-auto-run mid-run keeps the mode until the off command', () =>
{
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text }] } });
    // the model's own Skill(mode-auto-run) is denied by its disable-model-invocation flag and writes no stamp
    const p = project();
    fs.cpSync(path.join(__dirname, '..', 'stack', 'skills', 'mode-auto-run'), path.join(p.root, '.claude', 'skills', 'mode-auto-run'), { recursive: true });
    const self = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'mode-auto-run', args: 'add x' },
        session_id: 'tb1', cwd: p.root, transcript_path: transcript([typed('go on')]) }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(self.status, 2);
    assert.match(self.stderr, /mode-auto-run is marked disable-model-invocation/);
    assert.ok(!fs.existsSync(p.gate));
    // mid-run: a typed /mode-auto-run with a request opens a new run under the mode; an empty one ends nothing; the off command ends it
    const q3 = project();
    const t = transcript();
    autoStamp(q3, 'tb3');
    openRun(q3, 'tb3', 'mode-auto-run');
    sub(q3, 'tb3', '/mode-auto-run z', t);
    expand(q3, 'tb3', '/mode-auto-run z', t);
    assert.ok(fs.existsSync(q3.gate), 'kept: a new request');
    assert.match(fs.readFileSync(marker(q3, 'tb3'), 'utf8'), /^skill: mode-auto-run\nprompt: (?!0123456789ab)/, 'its own marker');
    sub(q3, 'tb3', '/mode-auto-run', t);
    assert.ok(fs.existsSync(q3.gate), 'an empty /mode-auto-run ends nothing');
    assert.ok(!rows(q3, 'tb3').some((x) => x.kind === 'auto-end'), 'no auto-end row');
    assert.strictEqual(modeLine(q3, 'tb3', `${AUTO_CMD} off`, t), '[mode] auto-run is OFF');
    assert.ok(!fs.existsSync(q3.gate) && !fs.existsSync(marker(q3, 'tb3')), 'ended: the off command');
    assert.ok(rows(q3, 'tb3').some((x) => x.kind === 'auto-end'), 'an auto-end row');
});

test('mode Stop: a live stamp with no marker is not held; with the marker it is held, and the 50th hold under one marker passes (AC5)', () =>
{
    const p = project();
    const log = fs.mkdtempSync(path.join(TMP, 'm5-'));
    const t = transcript();
    const stop = () => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'h1', cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.' }, { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log });
    autoStamp(p, 'h1');
    const between = stop();
    assert.strictEqual(between.status, 0, `between runs the mode answers asks but holds no Stop: ${between.stderr}`);
    openRun(p, 'h1');
    assert.strictEqual(stop().status, 2, 'a run marker open: held');
    const file = path.join(log, 'alfred-stop-held-guard-stop-contract-Stop-h1-main.auto');
    const first = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.match(first.stamp, /^h1@\d+(\.\d+)?$/, 'counted per marker: <session>@<marker mtime>');
    assert.strictEqual(first.stamp, `h1@${fs.statSync(marker(p, 'h1')).mtimeMs}`);
    fs.writeFileSync(file, JSON.stringify({ ...first, count: 48 }));
    assert.strictEqual(stop().status, 2, '49: held');
    assert.strictEqual(stop().status, 0, '50: passes');
    assert.strictEqual(rows(p, 'h1').filter((r) => r.kind === 'auto-continue-cap').length, 1, 'one cap row');
    // a torn or garbage marker still counts as present (spec, Error handling); its new mtime counts from 1
    fs.writeFileSync(marker(p, 'h1'), '\u0000garbage');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(marker(p, 'h1'), later, later);
    assert.strictEqual(stop().status, 2, 'a garbage marker holds');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).count, 1, 'counted from 1');
});

test('mode takeover: another session idle 10 minutes is replaced with taken-from and one auto-takeover row; the losing session gets one notice, once (AC6)', () =>
{
    const p = project();
    const t = transcript();
    const env = { CLAUDE_PROJECT_DIR: p.root };
    const live = path.join(path.dirname(t), 'tk-old-session.jsonl');
    fs.writeFileSync(live, '{}\n');
    autoStamp(p, 'tk-old-session');
    assert.strictEqual(autoStampLive({ session_id: 'tk-new-session', transcript_path: t }, env), false, 'another session\'s stamp is not live here');
    // v2: the mode command writes the variable and takes nothing over; a typed /mode-auto-run <request> still writes a stamp
    assert.match(context(typedRun(p, 'tk-new-session', '/mode-auto-run fix X', t)), /another session \(tk-old-s\) is running/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: tk-old-session\n/, 'kept while it runs');
    const quiet = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(live, quiet, quiet);
    assert.match(context(typedRun(p, 'tk-new-session', '/mode-auto-run fix X', t)), /^auto-run is ON for this \/mode-auto-run run/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: tk-new-session\n[\s\S]*\ntaken-from: tk-old-session\n/);
    const takeovers = rows(p, 'tk-new-session').filter((r) => r.kind === 'auto-takeover');
    assert.strictEqual(takeovers.length, 1, 'one auto-takeover row');
    assert.match(takeovers[0].reason, /tk-new-s.*tk-old-s|tk-old-s.*tk-new-s/, 'naming both sessions');
    const notice = 'auto-run is OFF here - session tk-new-s took it; `/alfred-code:mode:auto-run on` takes it back';   // the v1 wording, unchanged
    assert.ok(context(sub(p, 'tk-old-session', 'carry on', t)).includes(notice), 'the losing session is told');
    assert.ok(!context(sub(p, 'tk-old-session', 'carry on', t)).includes('took it'), 'once');
    assert.ok(!context(sub(p, 'tk-new-session', 'carry on', t)).includes('took it'), 'never the winner');
    fs.rmSync(live, { force: true });
});

test('mode whole-project runs: /loop-code-quality and /capture-awareness with no request open a marker and get the contract under the mode (spec section 6, AC2)', () =>
{
    const t = transcript();
    for (const cmd of ['loop-code-quality', 'capture-awareness'])
    {
        const pr = project();
        autoOn(pr, 'fw', t);
        const r = expand(pr, 'fw', `/${cmd}`, t);
        assert.match(context(r), new RegExp(`^auto-run is ON for this /${cmd} run`), cmd);
        assert.match(fs.readFileSync(marker(pr, 'fw'), 'utf8'), new RegExp(`^skill: ${cmd}\\n`), `${cmd}: a whole-project run opens a marker`);
    }
});

test('mode marker: a stacked /mode-output-scoring /task-solve X writes skill: task-solve, and a second expansion of the same prompt keeps the mtime (AC15)', () =>
{
    const t = transcript();
    const p = project();
    autoOn(p, 'sk', t);
    const prompt = '/mode-output-scoring /task-solve X';
    assert.match(context(expand(p, 'sk', prompt, t, { prompt_id: 'pid-ac15' })), /^auto-run is ON for this \/task-solve run/);
    assert.match(fs.readFileSync(marker(p, 'sk'), 'utf8'), /^skill: task-solve\n/);
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(marker(p, 'sk'), past, past);
    const was = fs.statSync(marker(p, 'sk')).mtimeMs;
    expand(p, 'sk', prompt, t, { command_name: 'task-solve', command_args: 'X', prompt_id: 'pid-ac15' });
    assert.strictEqual(fs.statSync(marker(p, 'sk')).mtimeMs, was, 'the same skill and prompt leave the file as it is');
});

test('mode marker writers: /mode-output-scoring X under the mode opens no marker and gets the banner alone; /mode-auto-run fix X writes skill: mode-auto-run', () =>
{
    const t = transcript();
    const p = project();
    autoOn(p, 'mw', t);
    const graded = expand(p, 'mw', '/mode-output-scoring grade the plan in docs/plan.md', t);
    assert.ok(!fs.existsSync(marker(p, 'mw')), 'no marker: the grader opens no run');
    assert.doesNotMatch(context(graded), /auto-run is ON for this|Do nothing else|no run started/, 'no contract, and the request is not dropped');
    assert.match(bannerOf(graded)[0], /^\*\*Auto-run: ON\*\* for \/mode-output-scoring /);
    const q2 = project();
    assert.match(context(expand(q2, 'mw', '/mode-auto-run fix X', t)), /^auto-run is ON for this \/mode-auto-run run/);
    assert.match(fs.readFileSync(marker(q2, 'mw'), 'utf8'), /^skill: mode-auto-run\n/);
});

test('mode runs: a typed /task-solve B under the live stamp gets the full contract naming its marker; a model Skill call to a capture keeps the loop marker and gets no contract (AC15)', () =>
{
    const t = transcript();
    const p = project();
    autoOn(p, 'rn', t);
    expand(p, 'rn', '/task-solve A', t);
    const b = context(expand(p, 'rn', '/task-solve B', t));
    for (const item of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)']) assert.ok(b.includes(item), `item ${item}`);
    assert.match(b, /\.alfred\/state\/sessions\/AUTO-RUN-rn/, 'naming its marker');
    const loop = project();
    autoOn(loop, 'ln', t);
    expand(loop, 'ln', '/loop-code-quality src/', t);
    const before = fs.readFileSync(marker(loop, 'ln'), 'utf8');
    const r = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'capture-quality', args: '' },
        session_id: 'ln', cwd: loop.root, transcript_path: t }, { CLAUDE_PROJECT_DIR: loop.root });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(context(r), /auto-run is ON for this/, 'a phase of the run, never a start');
    assert.strictEqual(fs.readFileSync(marker(loop, 'ln'), 'utf8'), before, 'the loop\'s marker stands');
});

test('M1: the solve-flow mark arms only on /mode-auto-run with a request and disarms at the next typed prompt', () =>
{
    const typed = (text) => ({ type: 'user', message: { role: 'user', content: text } });
    const cmd = (args) => typed(`<command-message>mode-auto-run</command-message>\n<command-name>/mode-auto-run</command-name>\n<command-args>${args}</command-args>`);
    let k = 0;
    const readSolve = () => ({ type: 'assistant', message: { id: `rd${++k}`, content: [{ type: 'tool_use', id: `rd${k}t`, name: 'Read', input: { file_path: '/p/.claude/skills/task-solve/SKILL.md' } }] } });
    const said = { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'Result: spec at docs/plans/x.md. Progress: 1 of 6 steps. Leftovers: none.' }] } };
    const goOn = [q('Next?', ['Go on (Recommended)', 'Stop'])];
    const p = project();
    const note = (rowsIn) => { const r = run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: goOn },
        session_id: `m1-${++k}`, cwd: p.root, transcript_path: transcript(rowsIn) }, { CLAUDE_PROJECT_DIR: p.root });
        try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
    assert.match(note([cmd('add a status route'), readSolve(), said]), /`Size: /, 'a request arms it');
    assert.doesNotMatch(note([cmd(''), readSolve(), said]), /`Size: /, 'an empty /mode-auto-run arms nothing');
    assert.doesNotMatch(note([cmd('--mode-auto-run-off'), readSolve(), said]), /`Size: /, 'a retired flag is no request: it arms nothing');
    assert.doesNotMatch(note([cmd('add a status route'), typed('never mind, just explain the cache'), readSolve(), said]), /`Size: /, 'the next typed prompt disarms it');
    assert.match(note([cmd('add a status route'), { ...typed('Base directory for this skill: x'), isMeta: true }, readSolve(), said]), /`Size: /, 'the skill body row is no typed prompt');
});

test('M7: a refused /mode-auto-run start gets no fresh-session offer past the trigger', () =>
{
    const big = transcript([], 'claude-opus-5-5', 450000);
    const r = typedRun(project(), 'm7', '/mode-auto-run', big);
    assert.doesNotMatch(context(r), /Do NOT start the run yet/);
    assert.match(bannerOf(r)[0], /auto-run did NOT start: type the request after \/mode-auto-run/);
});

test('final review I3: a /mode- line that starts no run gets no fresh-session offer past the trigger', () =>
{
    const big = transcript([], 'claude-opus-5-5', 450000);
    for (const line of ['/mode-auto-run --mode-auto-run-off', '/mode-auto-run --mode-output-scorer-on', '/mode-auto-run --auto-mode', '/mode-auto-run --mode-auto-run-on'])
        assert.doesNotMatch(context(typedRun(project(), 'i3', line, big)), /Do NOT start the run yet/, line);
    assert.match(context(typedRun(project(), 'i3b', '/mode-auto-run fix X', big)), /auto-run is ON for this \/mode-auto-run run/, 'a request still runs, under the contract');
});

test('M8: task-solve switched off by skillOverrides reads "switched off here"', () =>
{
    const t = transcript();
    const p = project();
    const d = path.join(p.root, '.claude', 'skills', 'task-solve');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: task-solve\ndisable-model-invocation: true\n---\n');
    fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { 'task-solve': 'off' } }));
    const said = context(typedRun(p, 'm8', '/mode-auto-run x', t, { CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'acct-m8-')) }));
    assert.match(said, /Solve flow: switched off here - a code change goes under Left for you\./);
    assert.match(context(typedRun(project(), 'm8b', '/mode-auto-run x', t, { CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'acct-m8-')) })), /Solve flow: not installed here/, 'absent stays not installed');
});

test('mode sweep: an AUTO-RUN- or AUTO-TAKEN- file untouched for 8 days is swept at the next prompt; one 6 days old stays', () =>
{
    const t = transcript();
    const p = project();
    const dir = path.join(p.root, '.alfred', 'state', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    const aged = (name, days) => { const f = path.join(dir, name); fs.writeFileSync(f, 'skill: x\n'); const at = new Date(Date.now() - days * 24 * 3600 * 1000); fs.utimesSync(f, at, at); return f; };
    const oldRun = aged('AUTO-RUN-gone', 8);
    const oldTaken = aged('AUTO-TAKEN-gone', 8);
    const fresh = aged('AUTO-RUN-recent', 6);
    for (const prefix of ['AUTO-RUN-', 'AUTO-TAKEN-']) fs.rmSync(path.join(dir, `.alfred-sweep-${prefix.replace(/[^\w-]/g, '_')}`), { force: true });
    sub(p, 'sw', 'hello', t);
    assert.ok(!fs.existsSync(oldRun) && !fs.existsSync(oldTaken), 'past a week: swept');
    assert.ok(fs.existsSync(fresh), 'inside it: kept');
});

test('mode dispatch: a live stamp and no marker lets a generic seat and an implementer seat through as with no stamp; with a marker the generic block fires naming the off command; a capture-usage-report marker passes its authors (AC16)', () =>
{
    const p = project();
    const disp = (seat, prompt = 'x') => run('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt }, session_id: 'ds', cwd: p.root, transcript_path: transcript() },
        { CLAUDE_PROJECT_DIR: p.root });
    autoStamp(p, 'ds');
    assert.strictEqual(disp('general-purpose').status, 0, 'between runs a generic seat goes, as with no stamp');
    const impl = disp('aspnet-implementer', 'build it');
    assert.strictEqual(impl.status, 2, 'and an implementer needs its plan stamp, as with no stamp');
    assert.match(impl.stderr, /'\/alfred-code:mode:auto-run on' before the command/, 'the denial names the mode command');
    assert.doesNotMatch(impl.stderr, /--auto-mode|--mode-auto-run/);
    openRun(p, 'ds', 'task-solve');
    const generic = disp('general-purpose');
    assert.strictEqual(generic.status, 2, 'a run open: the generic block fires');
    assert.match(generic.stderr, /\/alfred-code:mode:auto-run off/);
    assert.doesNotMatch(generic.stderr, /--mode-auto-run/);
    assert.doesNotMatch(generic.stderr, /clears the stamp/);
    assert.strictEqual(disp('aspnet-implementer', 'build it').status, 0, 'and the run approves its implementer');
    openRun(p, 'ds', 'capture-usage-report');
    assert.strictEqual(disp('general-purpose').status, 0, 'a capture-usage-report marker passes its authors');
});

test('mode-auto-run names every other user-typed flow, so a new one fails until its route line is added', () =>
{
    const SKILLS = path.join(__dirname, '..', 'stack', 'skills');
    const body = fs.readFileSync(path.join(SKILLS, 'mode-auto-run', 'SKILL.md'), 'utf8');
    const flagged = fs.readdirSync(SKILLS).filter((n) => !['mode-auto-run', 'task-solve'].includes(n)).filter((n) => {
        try { return /^disable-model-invocation:\s*true\s*$/m.test(fs.readFileSync(path.join(SKILLS, n, 'SKILL.md'), 'utf8').split(/^---\s*$/m)[1] || ''); } catch { return false; }
    });
    // 9 since the capture-awareness merge (2026-10-29): the two manual-only captures it absorbed are gone, and it is model-invocable
    assert.strictEqual(flagged.length, 9);
    for (const n of flagged) assert.ok(body.includes(`/${n}`), n);
});

test('final review I4/I5: the catalog and the solve flow describe the marker lifecycle - a close deletes the run marker, never the session stamp, and the ON line is named', () =>
{
    const root = path.join(__dirname, '..');
    const note = JSON.parse(fs.readFileSync(path.join(root, 'meta', 'stack-manifest.json'), 'utf8')).hooks.find((h) => h.file === 'guard-stop-contract.js' && h.matcher === '@Stop').note;
    const html = fs.readFileSync(path.join(root, 'docs', 'alfred-code.html'), 'utf8').split('\n');
    const row = (name) => html.find((l) => l.startsWith(`  ["${name}", `)) || '';
    for (const [where, text] of [['the manifest note', note], ['the HTML row', row('guard-stop-contract')]])
    {
        assert.doesNotMatch(text, /deletes the stamp|per stamp/, `${where} still tells a close to delete the stamp`);
        assert.match(text, /deletes the marker/, `${where} names the marker`);
    }
    assert.match(row('guard-answer'), /Modes ON: /, 'the ON line is in the guard-answer row');
    const mechanics = fs.readFileSync(path.join(root, 'stack', 'skills', 'task-solve', 'references', 'step-mechanics.md'), 'utf8');
    const lifetime = mechanics.split('\n').findIndex((l) => l.includes('**Lifetime.**'));
    assert.match(mechanics.split('\n').slice(lifetime, lifetime + 3).join(' '), /hook's session stamp is never deleted/, 'step-mechanics says which stamp a close deletes');
});

// ---------------------------------------------------------------------------------------------
// the mode minors R090-R096: one contract per prompt, honest banners, a takeover said to each taker, a marker per prompt id
// ---------------------------------------------------------------------------------------------
test('R090: an empty /mode-auto-run under this session\'s live stamp says auto-run is already ON, never that it did NOT start', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'r90');
    const r = typedRun(p, 'r90', '/mode-auto-run', t);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(context(r), /did NOT start/);
    assert.match(context(r), /auto-run is already ON for this session - no run started: type the request after \/mode-auto-run/);
    assert.match(bannerOf(r)[0], /^\*\*Auto-run: ON\*\* for \/mode-auto-run/);
    assert.ok(!fs.existsSync(marker(p, 'r90')), 'no run opened');
    assert.match(bannerOf(typedRun(project(), 'r90b', '/mode-auto-run', t))[0], /auto-run did NOT start: type the request after \/mode-auto-run/, 'with no stamp the refusal stands');
});

test('R091: each takeover of a session\'s mode tells it once, a second taker included', () =>
{
    const p = project();
    const t = transcript();
    const said = (sid) => context(sub(p, sid, 'carry on', t));
    autoStamp(p, 'r91-bbbbbbbb', 'taken-from: r91-aaaaaaaa\n');
    assert.match(said('r91-aaaaaaaa'), /session r91-bbbb took it/);
    assert.doesNotMatch(said('r91-aaaaaaaa'), /took it/, 'once');
    autoStamp(p, 'r91-cccccccc', 'taken-from: r91-aaaaaaaa\n');
    assert.match(said('r91-aaaaaaaa'), /session r91-cccc took it/, 'a second taker is said too');
    assert.doesNotMatch(said('r91-aaaaaaaa'), /took it/, 'once');
});

test('R093: two expansions of one typed prompt get the contract and the banner once - keyed by prompt_id, else the prompt and session', () =>
{
    const t = transcript();
    const p = project();
    autoOn(p, 'r93', t);
    const line = '/mode-output-scoring /task-solve X';
    const first = context(expand(p, 'r93', line, t, { prompt_id: 'pid-1' }));
    assert.match(first, /^auto-run is ON for this \/task-solve run/);
    assert.strictEqual(first.split(BANNER_HEAD).length, 2, 'the banner once');
    const again = context(expand(p, 'r93', line, t, { prompt_id: 'pid-1', command_name: 'task-solve', command_args: 'X' }));
    assert.doesNotMatch(again, /auto-run is ON/, 'no second contract');
    assert.ok(!again.includes(BANNER_HEAD), 'no second banner');
    assert.match(context(expand(p, 'r93', line, t, { prompt_id: 'pid-2' })), /^auto-run is ON for this \/task-solve run/, 'the line typed again is a new prompt');
    // no prompt_id (a Claude Code that sends none): the prompt and the session key it, for a few seconds
    const q = project();
    autoOn(q, 'r93b', t);
    assert.match(context(expand(q, 'r93b', line, t, { prompt_id: undefined })), /^auto-run is ON/);
    assert.strictEqual(context(expand(q, 'r93b', line, t, { prompt_id: undefined })), '', 'the same prompt expanded again at once');
});

// A folder's mode bits do not make it read-only on Windows, and root writes through them.
test('R095: a run marker that cannot be written is said in one !! line, and the contract promises no Stop hold',
    { skip: (process.platform === 'win32' && 'a mode bit does not make a Windows folder read-only') || (process.getuid?.() === 0 && 'root writes a mode-555 folder') }, () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'r95');
    const dir = path.dirname(marker(p, 'r95'));
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555);
    try
    {
        const said = context(typedRun(p, 'r95', '/loop-code-quality src/', t));
        assert.strictEqual(said.split('\n').filter((l) => l.startsWith('!!')).length, 1, said);
        assert.match(said, /^!! the run marker could not be written/m);
        assert.match(said, /auto-run is ON for this \/loop-code-quality run/);
        assert.doesNotMatch(said, /sends you back/);
        assert.ok(fs.existsSync(p.gate), 'the stamp stands');
    }
    finally { fs.chmodSync(dir, 0o755); }
});

test('R096: the run marker records prompt_id - the line typed again moves its mtime, one prompt expanded twice does not', () =>
{
    const t = transcript();
    const p = project();
    autoOn(p, 'r96', t);
    const line = '/loop-code-quality src/';
    expand(p, 'r96', line, t, { prompt_id: 'pid-a' });
    assert.match(fs.readFileSync(marker(p, 'r96'), 'utf8'), /^prompt-id: pid-a$/m);
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(marker(p, 'r96'), past, past);
    const was = fs.statSync(marker(p, 'r96')).mtimeMs;
    expand(p, 'r96', line, t, { prompt_id: 'pid-a' });
    assert.strictEqual(fs.statSync(marker(p, 'r96')).mtimeMs, was, 'one prompt expanded twice');
    expand(p, 'r96', line, t, { prompt_id: 'pid-b' });
    assert.notStrictEqual(fs.statSync(marker(p, 'r96')).mtimeMs, was, 'the line typed again');
});

// ---------------------------------------------------------------------------------------------
// the mode commands (the mode-commands spec, 2026-11-12, section 3): typed alone on their line, handled at UserPromptSubmit
// ---------------------------------------------------------------------------------------------
const AUTO_CMD = '/alfred-code:mode:auto-run';
const COMPACT_CMD = '/alfred-code:mode:auto-compact';
const modeLine = (p, sid, line, t, env = {}) => context(run('guard-fresh-session-start.js',
    { hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: p.root, transcript_path: t, prompt: line }, { CLAUDE_PROJECT_DIR: p.root, ...env }));
const AUTO_ON_LINE = '[mode] auto-run is ON until /alfred-code:mode:auto-run off, new sessions included: each ask takes its (Recommended) option. auto-compact is ON with it';
const autoOn = (p, sid, t, env) => { const said = modeLine(p, sid, `${AUTO_CMD} on`, t, env); assert.ok(said.startsWith(AUTO_ON_LINE), said); };   // a window note may follow
const TYPE_ALONE = '[mode] type the command alone on its line, then on or off';
const compactSwitch = (p, sid) => path.join(p.root, '.alfred', 'state', 'sessions', `AUTO-COMPACT-${sid}`);
// A transcript with no row that turns auto-run on: the stamp a mode command writes is proven by its own typed row alone.
function bareTranscript()
{
    const p = path.join(TMP, `bare-${++n}.jsonl`);
    const at = new Date(Date.now() - 60000).toISOString();
    fs.writeFileSync(p, [{ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: 'go' } },
        { type: 'assistant', entrypoint: 'cli', timestamp: at, message: { id: `m${++n}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { cache_read_input_tokens: 30000 } } }]
        .map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}
const typedRow = (t, text) => fs.appendFileSync(t, `${JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: text } })}\n`);

test('mode command: auto-run on writes the variable, no stamp, opens no run marker, says the ON line', () =>
{
    const p = project();
    const t = bareTranscript();
    assert.strictEqual(modeLine(p, 'm1', `${AUTO_CMD} on`, t), AUTO_ON_LINE);
    assert.ok(!fs.existsSync(p.gate), 'no stamp: the variable is the mode');
    assert.deepStrictEqual(modeOf(p).env, { ALFRED_CODE_AUTO_RUN: '1', ALFRED_CODE_AUTO_COMPACT: '1' });
    assert.ok(!fs.existsSync(marker(p, 'm1')), 'no run marker: the next typed flow command opens it');
    assert.strictEqual(rows(p, 'm1').filter((r) => r.kind === 'auto-start').length, 1);
    const env = { CLAUDE_PROJECT_DIR: p.root };
    assert.strictEqual(approvalStamp({ session_id: 'm1', transcript_path: t }, env).live, true, 'the standing variable needs no typed row');
    assert.strictEqual(approvalStamp({ session_id: 'm2', transcript_path: t }, env).live, true, 'and holds for every named session');
});

test('mode command: the next typed flow command runs under the variable and opens the marker', () =>
{
    const p = project();
    const t = bareTranscript();
    modeLine(p, 'm3', `${AUTO_CMD} on`, t);
    const x = expand(p, 'm3', '/task-solve fix X', t);
    assert.match(context(x), /^auto-run is ON for this \/task-solve run/);
    assert.match(context(x), /only the user's \/alfred-code:mode:auto-run off ends auto-run/);
    assert.match(fs.readFileSync(marker(p, 'm3'), 'utf8'), /^skill: task-solve$/m);
    assert.ok(!fs.existsSync(p.gate), 'the run writes no stamp');
});

test('mode command: auto-run on typed again changes no byte and keeps an open run marker', () =>
{
    const p = project();
    const t = bareTranscript();
    modeLine(p, 'm4', `${AUTO_CMD} on`, t);
    expand(p, 'm4', '/task-solve fix X', t);
    const old = (Date.now() - 3600 * 1000) / 1000;
    fs.utimesSync(modePath(p), old, old);
    fs.utimesSync(marker(p, 'm4'), old, old);
    const before = [fs.statSync(modePath(p)).mtimeMs, fs.statSync(marker(p, 'm4')).mtimeMs, rawMode(p)];
    assert.strictEqual(modeLine(p, 'm4', `${AUTO_CMD} on`, t), AUTO_ON_LINE);
    assert.deepStrictEqual([fs.statSync(modePath(p)).mtimeMs, fs.statSync(marker(p, 'm4')).mtimeMs, rawMode(p)], before);
    assert.strictEqual(rows(p, 'm4').filter((r) => r.kind === 'auto-start').length >= 2, true, 'each start is a row');
});

test('mode command: auto-run off writes 0, deletes the checkout\'s hook-written stamp and this session\'s marker (D7)', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'm5');
    openRun(p, 'm5');
    assert.strictEqual(modeLine(p, 'm6', `${AUTO_CMD} off`, t), '[mode] auto-run is OFF');
    assert.ok(!fs.existsSync(p.gate) && fs.existsSync(marker(p, 'm5')), 'another session\'s off ends the stamp; the run marker is that session\'s');
    assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_RUN, '0');
    assert.strictEqual(rows(p, 'm6').filter((r) => r.kind === 'auto-end').length, 1, 'one auto-end row');
    autoStamp(p, 'm5');
    assert.strictEqual(modeLine(p, 'm5', `${AUTO_CMD} off`, t), '[mode] auto-run is OFF');
    assert.ok(!fs.existsSync(p.gate) && !fs.existsSync(marker(p, 'm5')), 'both files deleted');
    assert.strictEqual(rows(p, 'm5').filter((r) => r.kind === 'auto-end').length, 1, 'one auto-end row');
    assert.strictEqual(modeLine(p, 'm5', `${AUTO_CMD} off`, t), '[mode] auto-run is OFF', 'typed again: the same line');
    assert.strictEqual(rows(p, 'm5').filter((r) => r.kind === 'auto-end').length, 1, 'and no second row');
    // a stamp written by hand (a solve flow's no-stops waiver, no session line) is no auto-run of this hook's
    const h = project();
    fs.writeFileSync(h.gate, 'AUTO - "take every recommendation"\n');
    modeLine(h, 'm7', `${AUTO_CMD} off`, t);
    assert.ok(fs.existsSync(h.gate), 'a hand-written stamp stays');
});

test('mode command: auto-run on beside another session\'s live stamped run is not refused, and leaves that stamp (D4)', () =>
{
    const p = project();
    const t = bareTranscript();
    const other = `live-${++n}`;
    autoStamp(p, other);
    fs.writeFileSync(path.join(path.dirname(t), `${other}.jsonl`), '');
    const before = fs.readFileSync(p.gate, 'utf8');
    assert.strictEqual(modeLine(p, 'm8', `${AUTO_CMD} on`, t), AUTO_ON_LINE);
    assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), before, 'the other session\'s stamp stands');
    assert.strictEqual(rows(p, 'm8').filter((r) => r.kind === 'auto-start').length, 1);
    assert.ok(!rows(p, 'm8').some((r) => r.kind === 'auto-start-refused'));
});

test('mode command: auto-compact on and off write the mode file, never a session file', () =>
{
    const p = project();
    const t = bareTranscript();
    assert.match(modeLine(p, 'c1', `${COMPACT_CMD} on`, t), /^\[mode\] auto-compact is ON: no fresh-session ask is made\. From the next session Claude Code compacts at /);
    assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_COMPACT, '1');
    assert.match(modeLine(p, 'c1', `${COMPACT_CMD} off`, t), /^\[mode\] auto-compact is OFF: fresh-session asks are back\./);
    assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_COMPACT, '0');
    assert.deepStrictEqual(rows(p, 'c1').filter((r) => r.kind === 'compact-flag').map((r) => r.reason), ['auto-compact on', 'auto-compact off']);
    assert.ok(!fs.existsSync(compactSwitch(p, 'c1')) && !fs.existsSync(p.gate), 'no session file, no auto-run stamp');
});

test('mode command: auto-compact off writes 0 over the launch variable; under auto-run it stays on and says why', () =>
{
    const p = project();
    const t = transcript();
    assert.match(modeLine(p, 'c2', `${COMPACT_CMD} off`, t, { ALFRED_CODE_AUTO_COMPACT: '1' }), /^\[mode\] auto-compact is OFF: /);
    assert.strictEqual(modeLine(p, 'c2', COMPACT_CMD, t, { ALFRED_CODE_AUTO_COMPACT: '1' }), '[mode] auto-compact is OFF', 'the file outranks the launch env');
    autoStamp(p, 'c2');
    const before = rawMode(p);
    assert.strictEqual(modeLine(p, 'c2', `${COMPACT_CMD} off`, t), '[mode] auto-compact stays ON: auto-run is on - type /alfred-code:mode:auto-run off first');
    assert.strictEqual(rawMode(p), before, 'nothing written');
    assert.strictEqual(modeLine(p, 'c2', COMPACT_CMD, t), '[mode] auto-compact is ON');
});

test('mode command: a bare command reports and changes nothing', () =>
{
    const p = project();
    const t = transcript();
    assert.strictEqual(modeLine(p, 'b1', AUTO_CMD, t), '[mode] auto-run is OFF');
    assert.strictEqual(modeLine(p, 'b1', COMPACT_CMD, t), '[mode] auto-compact is OFF');
    assert.ok(!fs.existsSync(p.gate) && rawMode(p) === null && !rows(p, 'b1').length, 'no file, no row');
    autoStamp(p, 'b1');
    fs.mkdirSync(path.dirname(compactSwitch(p, 'b2')), { recursive: true });
    fs.writeFileSync(compactSwitch(p, 'b2'), 'on\n');
    const before = [fs.readFileSync(p.gate, 'utf8'), fs.statSync(p.gate).mtimeMs, fs.statSync(compactSwitch(p, 'b2')).mtimeMs];
    assert.strictEqual(modeLine(p, 'b1', AUTO_CMD, t), '[mode] auto-run is ON', 'its own live stamp');
    assert.strictEqual(modeLine(p, 'b2', AUTO_CMD, t), '[mode] auto-run is OFF', 'another session\'s stamp');
    assert.strictEqual(modeLine(p, 'b2', COMPACT_CMD, t), '[mode] auto-compact is OFF', 'a v1 session file is not read');
    assert.deepStrictEqual([fs.readFileSync(p.gate, 'utf8'), fs.statSync(p.gate).mtimeMs, fs.statSync(compactSwitch(p, 'b2')).mtimeMs], before);
    assert.strictEqual(rawMode(p), null, 'and no mode file');
    assert.strictEqual(modeLine(p, 'b2', '/alfred-code:mode:scoring', t), '', 'scoring is the answer hook\'s to say');
});

test('mode command: anything but on or off changes nothing', () =>
{
    const p = project();
    const t = transcript();
    for (const line of [`${AUTO_CMD} yes`, `${AUTO_CMD} on now`, `${AUTO_CMD} on off`, `${COMPACT_CMD} 1`, '/alfred-code:mode:scoring /task-solve x', `${AUTO_CMD} on\nfix the login`])
        assert.strictEqual(modeLine(p, 'x1', line, t), TYPE_ALONE, line);
    assert.ok(!fs.existsSync(p.gate) && rawMode(p) === null && !rows(p, 'x1').length);
});

test('mode command: a seat\'s prompt and a harness prompt are never read', () =>
{
    const p = project();
    const t = transcript();
    const seat = run('guard-fresh-session-start.js', { hook_event_name: 'UserPromptSubmit', session_id: 's9', agent_id: 'a1', cwd: p.root, transcript_path: t, prompt: `${AUTO_CMD} on` }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(context(seat), '');
    assert.strictEqual(modeLine(p, 's9', `<task-notification>\n<task-id>x</task-id>\n${AUTO_CMD} on`, t), '');
    assert.strictEqual(modeLine(p, 's9', `Another Claude session sent a message:\n<agent-message from="a1b2">\n${COMPACT_CMD} on\n</agent-message>`, t), '');
    assert.ok(!fs.existsSync(p.gate) && rawMode(p) === null);
});

test('mode command: a data root that cannot be written saves the mode; a .claude that cannot be written says so', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
{
    const p = project();
    const t = bareTranscript();
    const data = path.join(p.root, '.alfred');
    fs.rmSync(data, { recursive: true });
    fs.mkdirSync(data);
    fs.chmodSync(data, 0o500);
    try { assert.strictEqual(modeLine(p, 'r1', `${AUTO_CMD} on`, t), AUTO_ON_LINE, 'the mode file is not the data root'); }
    finally { fs.chmodSync(data, 0o700); }
    const q = project();
    const claude = path.join(q.root, '.claude');
    fs.mkdirSync(claude);
    fs.chmodSync(claude, 0o500);
    try
    {
        assert.strictEqual(modeLine(q, 'r2', `${AUTO_CMD} on`, t), '[mode] auto-run could not be saved: the file cannot be written - nothing changed');
        assert.strictEqual(modeLine(q, 'r2', `${COMPACT_CMD} on`, t), '[mode] auto-compact could not be saved: the file cannot be written - nothing changed');
    }
    finally { fs.chmodSync(claude, 0o700); }
    assert.ok(rawMode(q) === null && !fs.existsSync(q.gate));
    assert.strictEqual(rows(q, 'r2').filter((r) => r.kind === 'auto-start-refused').length, 1);
});

const GONE = (flag) => `'${flag}' is gone: type /alfred-code:mode:auto-run on|off or /alfred-code:mode:scoring on|off on its own line`;
const ATTENDED = ' - this run is attended: ask as usual and take no (Recommended) option unasked';
// a retired off flag typed under a live auto-run ends nothing, and the pointer says so (final review I1)
const STILL_ON = ' - auto-run is still ON: only /alfred-code:mode:auto-run off ends it';
test('old flag: after a flow command with auto-run off, the pointer says the run is attended', () =>
{
    const p = project();
    const t = transcript();
    assert.strictEqual(modeLine(p, 'o1', '/task-solve --mode-auto-run-on X', t), `${GONE('--mode-auto-run-on')}${ATTENDED}`);
    assert.strictEqual(modeLine(p, 'o1', '/task-solve --auto-mode --mode-output-scorer-on --mode-x X', t),
        ['--auto-mode', '--mode-output-scorer-on', '--mode-x'].map((f) => `${GONE(f)}${ATTENDED}`).join('\n'));
    assert.strictEqual(modeLine(p, 'o1', '/habits-explain-topic --score-on X', t), `${GONE('--score-on')}${ATTENDED}`, 'after any command');
    assert.ok(!fs.existsSync(p.gate), 'no stamp');
    assert.strictEqual(rows(p, 'o1').filter((r) => r.kind === 'mode-flag-old').length, 5);
    const x = expand(p, 'o1', '/task-solve --mode-auto-run-on X', t);
    assert.doesNotMatch(context(x), /auto-run is ON for this/, 'and the expansion starts nothing');
    assert.match(bannerOf(x)[0], /^\*\*Auto-run: OFF\*\* for \/task-solve - each question waits for your answer\.$/);
    assert.ok(!fs.existsSync(p.gate) && !fs.existsSync(marker(p, 'o1')));
    assert.strictEqual(modeLine(p, 'o1', '/task-solve X --mode-auto-run-on', t), '', 'past the leading run it is the request\'s text');
});

test('old flag: under a live auto-run, and on /mode-auto-run <request>, the pointer has no attended clause', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'o2');
    assert.strictEqual(modeLine(p, 'o2', '/task-solve --mode-auto-run-on X', t), GONE('--mode-auto-run-on'));
    assert.strictEqual(modeLine(p, 'o2', '/task-solve --mode-auto-run-off X', t), `${GONE('--mode-auto-run-off')}${STILL_ON}`);
    assert.strictEqual(modeLine(p, 'o2', '/task-solve --mode-output-scorer-off --mode-auto-run-off X', t),
        `${GONE('--mode-output-scorer-off')}\n${GONE('--mode-auto-run-off')}${STILL_ON}`, 'only the auto-run off flag carries it');
    assert.ok(fs.existsSync(p.gate), 'a retired off flag ends nothing');
    const q2 = project();
    assert.strictEqual(modeLine(q2, 'o3', '/mode-auto-run --mode-auto-run-on fix X', t), GONE('--mode-auto-run-on'));
});

test('old flag: typed with no command before it gets the same pointer', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'o4');
    assert.strictEqual(modeLine(p, 'o4', '--mode-auto-run-off', t), `${GONE('--mode-auto-run-off')}${STILL_ON}`);
    assert.ok(fs.existsSync(p.gate), 'and switches nothing');
    assert.strictEqual(modeLine(p, 'o5', '  --auto-mode fix it', t), `${GONE('--auto-mode')}${ATTENDED}`);
    assert.strictEqual(modeLine(p, 'o5', '--dry-run fix it', t), '');
    assert.strictEqual(modeLine(p, 'o5', 'pass --mode-auto-run-on to it', t), '');
});

test('old flag: a stamp whose only on-row is a retired flag is not live (R5)', () =>
{
    const p = project();
    const t = bareTranscript();
    typedRow(t, '/task-solve --mode-auto-run-on X');
    fs.writeFileSync(p.gate, 'AUTO - "/task-solve --mode-auto-run-on X"\nsession: o6\nskill: task-solve\ntranscript-size: 0\n');
    const env = { CLAUDE_PROJECT_DIR: p.root };
    const pre = require('../stack/hooks/hook-prelude.js');
    assert.strictEqual(pre.autoRunFor({ session_id: 'o6', transcript_path: t, cwd: p.root }, env, null), false);
    const said = JSON.parse(run('guard-answer.js', { hook_event_name: 'UserPromptSubmit', session_id: 'o6', cwd: p.root, transcript_path: t, prompt: 'go on' }, env).stdout || '{}');
    assert.doesNotMatch(String(said.systemMessage || ''), /auto-run/, 'the ON line lists no auto-run');
    typedRow(t, `${AUTO_CMD} on`);
    assert.strictEqual(pre.autoRunFor({ session_id: 'o6', transcript_path: t, cwd: p.root }, env, null), true, 'the mode command\'s row proves it');
});

test('old flag: the answer hook\'s scoring switch and ON line read no retired flag (AC7, AC9)', () =>
{
    const p = project();
    const t = transcript();
    const copy = path.join(p.root, '.claude', 'skills', 'mode-output-scoring');
    fs.mkdirSync(copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'SKILL.md'), '---\nname: mode-output-scoring\n---\n');
    const answer = (sid, text, scoring) => JSON.parse(run('guard-answer.js', { hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: p.root, transcript_path: t, prompt: text },
        { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_SCORING: scoring }).stdout || '{}');
    const said = (sid, text, scoring) => String((answer(sid, text, scoring).hookSpecificOutput || {}).additionalContext || '');
    const switches = () => (rawMode(p) === null ? [] : ['the mode file']);   // v2: a scoring switch is the mode file's
    for (const text of ['go --mode-output-scorer-on', '/task-solve fix x --mode-output-scorer-on', '/task-solve --mode-output-scorer-on x', '/mode-output-scoring --mode-output-scorer-on',
        '/review-code --mode-output-scorer-on x', 'what does `/task-solve --mode-output-scorer-on` do', '--score-on', '/task-solve --score-on x'])
        assert.doesNotMatch(said('g1', text, '0'), /scoring: on|\[mode\]/, text);
    assert.deepStrictEqual(switches(), [], 'no scoring switch written');
    assert.match(said('g1', '/task-solve --mode-output-scorer-off x', '1'), /scoring: on \(level 80, rounds 3, env\)/, 'a retired off flag leaves the scoring on');
    assert.doesNotMatch(said('g2', '/mode-output-scoring --mode-output-scorer-on', '0'), /scoring: stacked/, 'a retired flag alone is no stacked request');
    assert.match(said('g2', '/mode-output-scoring --mode-output-scorer-on explain x', '0'), /scoring: stacked for this request/, 'a request behind it still is');
    for (const line of ['/review-code --mode-auto-run-on X', '/task-solve --mode-auto-run-on X', '/habits-explain-topic --mode-output-scorer-on X', '/task-solve --auto-mode --score-on X'])
        assert.strictEqual(answer('g3', line, '0').systemMessage, undefined, line);
    autoStamp(p, 'g4');
    assert.strictEqual(answer('g4', '/task-solve --mode-auto-run-off x', '0').systemMessage, 'Modes ON: auto-run, auto-compact', 'a retired off flag ends nothing');
    assert.deepStrictEqual(switches(), []);
});

test('a model\'s Skill call never starts auto-run', () =>
{
    const p = project();
    const t = transcript();
    const call = (sid, args) => run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', session_id: sid, cwd: p.root, transcript_path: t,
        tool_input: { skill: 'task-implement', args } }, { CLAUDE_PROJECT_DIR: p.root });
    const cold = call('k1', '--mode-auto-run-on X');
    assert.doesNotMatch(context(cold), /auto-run is ON/);
    assert.ok(!fs.existsSync(p.gate), 'no stamp');
    autoStamp(p, 'k1');
    openRun(p, 'k1');
    const before = fs.readFileSync(p.gate, 'utf8');
    for (const args of ['--mode-auto-run-on X', 'X'])
    {
        const live = call('k1', args);
        assert.doesNotMatch(context(live), /auto-run is ON for this/, `no contract under the live stamp (${args})`);
    }
    assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), before);
    assert.ok(!rows(p, 'k1').some((r) => r.kind === 'auto-start' || r.kind === 'auto-start-refused'), 'no start row');
});

test('fresh-session offers: off under each cause, and each string names the cause', () =>
{
    const p = project();
    const big = transcript([], 'claude-opus-5-5', 450000);
    const log = fs.mkdtempSync(path.join(TMP, 'fc-'));
    const env = { CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_HOOK_LOG_DIR: log };
    const close = (sid) => run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: sid, cwd: p.root, transcript_path: big,
        last_assistant_message: 'The loop is closed: four stages done, nothing pending on my side.' }, env);
    const start = (sid) => run('guard-fresh-session-start.js', { hook_event_name: 'UserPromptExpansion', session_id: sid, cwd: p.root, transcript_path: big,
        expansion_type: 'slash_command', command_name: 'loop-code-quality', command_args: 'src/', prompt: '/loop-code-quality src/', prompt_id: randomUUID() }, env);
    const asked = (sid, labels) => run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q('Stage 1 is closed. Next?', labels)] },
        session_id: sid, cwd: p.root, transcript_path: big }, env);
    const MINE = 'ALFRED_CODE_AUTO_COMPACT=1';   // v2: the command saves the project's variable
    assert.strictEqual(modeLine(p, 'f1', `${COMPACT_CMD} on`, big, { ALFRED_CODE_HOOK_LOG_DIR: log }).startsWith('[mode] auto-compact is ON'), true);
    assert.strictEqual(close('f1').status, 0, 'the variable: the close ends the turn');
    const told = start('f1');
    assert.doesNotMatch(context(told), /Do NOT start the run yet/);
    assert.match(context(told), new RegExp(`^This session compacts instead of offering a fresh session \\(${MINE}\\): past its window's trigger`));
    assert.match(bannerOf(start('f1'))[1], new RegExp(`^\\*\\*Context:\\*\\* auto-compact is on \\(${MINE}\\) - the session compacts `));
    const lone = asked('f1', ['Resume in a fresh session (Recommended)', 'Run stage 2 here']);
    assert.strictEqual(lone.status, 2);
    assert.match(lone.stderr, new RegExp(`a fresh-session option, while this session compacts instead \\(${MINE}\\)`));
    const dropped = asked('f1', ['Resume in a fresh session (Recommended)', 'Run stage 2 here', 'Stop here']);
    assert.match(JSON.parse(dropped.stdout).hookSpecificOutput.additionalContext, /fresh-session option dropped \(this session compacts instead\)/);
    // the project's variable keeps its own words
    const project1 = run('guard-stop-contract.js', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q('Next?', ['Resume in a fresh session (Recommended)', 'Run stage 2 here'])] },
        session_id: 'f2', cwd: p.root, transcript_path: big }, { ...env, ALFRED_CODE_AUTO_COMPACT: '1' });
    assert.match(project1.stderr, /while this session compacts instead \(ALFRED_CODE_AUTO_COMPACT=1\)/);
    // every session in the checkout reads it; after the switch goes off, the offers are back for each
    assert.strictEqual(close('f3').status, 0, 'another session compacts too');
    modeLine(p, 'f1', `${COMPACT_CMD} off`, big, { ALFRED_CODE_HOOK_LOG_DIR: log });
    assert.match(context(start('f1')), /Do NOT start the run yet/, 'switched off: the offer is back');
    assert.strictEqual(close('f4').status, 2, 'another session: the Stop offer holds the close');
});

// Mode v2 stage 3, Task 4 (done-2's unit half): the mode file's own ALFRED_CODE_AUTO_RUN=1 puts every session under
// auto-run through the installed readers, with no stamp file.
test('the standing auto-run: the mode file\'s 1 answers asks for every session, and one session\'s start is no refusal for another', () =>
{
    const p = project();
    fs.mkdirSync(path.join(p.root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(p.root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_AUTO_RUN: '1' } }));
    for (const sid of ['sess-a', 'sess-b'])
        assert.deepStrictEqual(answered(ask(p, sid, [q('Go on?', ['Yes (Recommended)', 'No'])])), { 'Go on?': 'Yes (Recommended)' }, sid);
    assert.ok(!fs.existsSync(p.gate), 'no stamp file');
    const t = transcript();
    fs.writeFileSync(path.join(path.dirname(t), 'sess-a.jsonl'), '');
    assert.doesNotMatch(context(typedRun(p, 'sess-b', '/mode-auto-run fix X', t)), /did not start/);
});

// ---------------------------------------------------------------------------------------------
// mode commands v2 (stage 3, Task 6): the three commands write the mode block of the project's local settings file
// and stay on until off; the session files go (spec 3.3)
// ---------------------------------------------------------------------------------------------
const GIT = spawnSync('git', ['--version']).status === 0;
const ENVS = WINDOW_SEEDS;
const ALL_FOUR_OFF = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '0' };
const modePath = (p) => path.join(p.root, '.claude', 'settings.local.json');
const rawMode = (p) => { try { return fs.readFileSync(modePath(p), 'utf8'); } catch { return null; } };
const modeOf = (p) => JSON.parse(rawMode(p));
const line = context;
const gitOf = (cwd, ...args) => spawnSync('git', ['-C', cwd, '-c', 'user.email=t@x', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
const putModeIn = (dir, env) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env })); };
// a repository whose local settings file git tracks (and holds `env`)
function trackedModeProject(env = {})
{
    const p = project();
    gitOf(p.root, 'init', '-q');
    putModeIn(path.join(p.root, '.claude'), env);
    gitOf(p.root, 'add', '-f', '.claude');
    gitOf(p.root, 'commit', '-qm', 'tracked');
    return p;
}
// a `.claude` that is a link to a folder elsewhere: git cannot vouch for the file
function linkedClaudeProject(env = {})
{
    const p = project();
    const real = fs.mkdtempSync(path.join(TMP, 'real-claude-'));
    putModeIn(real, env);
    fs.symlinkSync(real, path.join(p.root, '.claude'), 'dir');
    return p;
}
// a repository with no machine-wide ignore list: the run's HOME is a folder of its own
function gitProject()
{
    const p = project();
    gitOf(p.root, 'init', '-q');
    const home = fs.mkdtempSync(path.join(TMP, 'home-'));
    p.env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };
    return p;
}
const liveTranscript = (p, sid) => fs.writeFileSync(path.join(TMP, `${sid}.jsonl`), '');
const sessionFiles = (p) => { try { return fs.readdirSync(path.join(p.root, '.alfred', 'state', 'sessions')); } catch { return []; } };
const AUTO_ON = '[mode] auto-run is ON until /alfred-code:mode:auto-run off, new sessions included: each ask takes its (Recommended) option. auto-compact is ON with it';

test('v2 auto-run on: both keys, both Claude Code keys, no stamp file', () => { const p = project(); const r = sub(p, 'A', '/alfred-code:mode:auto-run on', transcript());
    assert.strictEqual(line(r), AUTO_ON); assert.deepStrictEqual(modeOf(p).env, { ALFRED_CODE_AUTO_RUN: '1', ALFRED_CODE_AUTO_COMPACT: '1' });
    assert.strictEqual(modeOf(p).autoCompactEnabled, true); assert.ok(!fs.existsSync(p.gate)); assert.strictEqual(rows(p, 'A').filter((x) => x.kind === 'auto-start').length, 1); });
test('v2 the same command twice changes no byte and says the same line', () => { const p = project(); sub(p, 'A', '/alfred-code:mode:auto-run on', transcript()); const b = rawMode(p);
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-run on', transcript())), AUTO_ON); assert.strictEqual(rawMode(p), b); });
test('v2 auto-run on while another session holds a live stamped run: not refused (D4)', () => { const p = project(); autoStamp(p, 'B'); liveTranscript(p, 'B');
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-run on', transcript())), AUTO_ON); });
test('v2 auto-run off ends it for the checkout: the variable 0, another session\'s stamp gone, a hand-written stamp kept (D7)', () => { const p = project();
    sub(p, 'A', '/alfred-code:mode:auto-run on', transcript()); autoStamp(p, 'B');
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-run off', transcript())), '[mode] auto-run is OFF - auto-compact stays ON until /alfred-code:mode:auto-compact off');
    assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_RUN, '0'); assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_COMPACT, '1'); assert.ok(!fs.existsSync(p.gate));
    fs.writeFileSync(p.gate, 'AUTO - by hand\n'); sub(p, 'A', '/alfred-code:mode:auto-run off', transcript()); assert.ok(fs.existsSync(p.gate)); });
test('v2 auto-run off that cannot be saved deletes nothing', { skip: !GIT }, () => { const p = trackedModeProject(); autoStamp(p, 'B');
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-run off', transcript())), '[mode] auto-run could not be saved: git tracks the file - nothing changed'); assert.ok(fs.existsSync(p.gate)); });
test('v2 auto-run on under an unknown trust: refused before any byte', { skip: !GIT }, () => { const p = linkedClaudeProject(); const b = rawMode(p);
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-run on', transcript())), '[mode] auto-run could not be saved: git cannot say the file is yours alone - nothing changed');
    assert.strictEqual(rawMode(p), b); assert.strictEqual(rows(p, 'A').filter((x) => x.kind === 'auto-start-refused').length, 1); });
test('v2 bare auto-run: ON, OFF, and the reason when the file holds a 1 nobody vouches for', { skip: !GIT }, () => { const p = project();
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-run', transcript())), '[mode] auto-run is OFF'); sub(p, 'A', '/alfred-code:mode:auto-run on', transcript());
    assert.strictEqual(line(sub(p, 'B', '/alfred-code:mode:auto-run', transcript())), '[mode] auto-run is ON');
    assert.strictEqual(line(sub(trackedModeProject({ ALFRED_CODE_AUTO_RUN: '1' }), 'A', '/alfred-code:mode:auto-run', transcript())), '[mode] auto-run is OFF: the file holds it, but git tracks the file - asks stay with you');
    assert.strictEqual(line(sub(linkedClaudeProject({ ALFRED_CODE_AUTO_RUN: '1' }), 'A', '/alfred-code:mode:auto-run', transcript())), '[mode] auto-run is OFF: the file holds it, but git cannot say the file is yours alone - asks stay with you'); });
test('v2 auto-compact on: the window in the reply, at its own point for a tier of 0, the replaced note', () => { const p = project();
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-compact on', transcript([], 'claude-opus-5-5'), ENVS)), '[mode] auto-compact is ON: no fresh-session ask is made. From the next session Claude Code compacts at 400k on claude-opus-5-5');
    assert.match(line(sub(project(), 'A', '/alfred-code:mode:auto-compact on', transcript([], 'claude-opus-5-5'), { ...ENVS, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' })), /Claude Code compacts at its own point$/);
    const q = project(); fs.mkdirSync(path.join(q.root, '.claude'), { recursive: true }); fs.writeFileSync(modePath(q), '{"autoCompactEnabled":false}');
    assert.match(line(sub(q, 'A', '/alfred-code:mode:auto-compact on', transcript(), ENVS)), / - replaced autoCompactEnabled false$/); });
test('v2 auto-compact off: 0 and false; refused under auto-run (D11); the all-four-off tail', () => { const p = project(); sub(p, 'A', '/alfred-code:mode:auto-compact on', transcript(), ENVS);
    assert.strictEqual(line(sub(p, 'A', '/alfred-code:mode:auto-compact off', transcript(), ENVS)), '[mode] auto-compact is OFF: fresh-session asks are back. From the next session Claude Code no longer compacts by itself here - /compact still works');
    assert.strictEqual(modeOf(p).env.ALFRED_CODE_AUTO_COMPACT, '0'); assert.strictEqual(modeOf(p).autoCompactEnabled, false);
    assert.match(line(sub(project(), 'A', '/alfred-code:mode:auto-compact off', transcript(), ALL_FOUR_OFF)), / - the fresh-session offer is off here too, so nothing else relieves a full context$/);
    const r = project(); sub(r, 'A', '/alfred-code:mode:auto-run on', transcript()); const b = rawMode(r);
    assert.strictEqual(line(sub(r, 'B', '/alfred-code:mode:auto-compact off', transcript())), '[mode] auto-compact stays ON: auto-run is on - type /alfred-code:mode:auto-run off first'); assert.strictEqual(rawMode(r), b); });
test('v2 the first command in a project with no local file creates it, and says the unignored line once in a repository', { skip: !GIT }, () => { const p = gitProject();
    assert.match(line(sub(p, 'A', '/alfred-code:mode:auto-compact on', transcript(), ENVS)), / - \.claude\/settings\.local\.json was created and git does not ignore it here: add it to \.gitignore$/);
    assert.doesNotMatch(line(sub(p, 'A', '/alfred-code:mode:auto-compact on', transcript(), ENVS)), /was created/); });
test('v2 no session file is written or read any more', () => { const p = project(); sub(p, 'A', '/alfred-code:mode:auto-compact on', transcript(), ENVS);
    assert.ok(!sessionFiles(p).some((f) => f.startsWith('AUTO-COMPACT-')));
    const q = project(); fs.mkdirSync(path.join(q.root, '.alfred', 'state', 'sessions'), { recursive: true }); fs.writeFileSync(path.join(q.root, '.alfred', 'state', 'sessions', 'AUTO-COMPACT-A'), 'on\n');
    assert.strictEqual(line(sub(q, 'A', '/alfred-code:mode:auto-compact', transcript())), '[mode] auto-compact is OFF'); });
test('v2 a seat\'s prompt and a harness prompt write nothing', () => { const p = project(); sub(p, 'A', '/alfred-code:mode:auto-run on', transcript(), {}, { agent_id: 'seat-1' });
    assert.ok(!fs.existsSync(modePath(p))); });
