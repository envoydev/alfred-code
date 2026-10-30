// auto-run (stack-modes spec, 2026-10-27; was auto-mode, the user's ruling of 2026-10-14): `--mode-auto-run-on` right after a
// task, capture, loop, issue or mode command turns auto-run on for the SESSION. The fresh-session hook writes the AUTO
// stamp naming the session, and each typed family command under it opens a run marker; the stop contract answers each ask
// that marks one Recommended option and sends a Stop back while the marker stands, until the run's close deletes it.
// `--mode-auto-run-off` alone ends the mode. The installer seeds each model's auto-compact window at its fresh-session
// trigger, because Claude Code reads that key at session start only (measured 2026-10-14: written mid-session it changed
// nothing; set before the start it compacted at 76k of a 100k window). Every hook case runs through the hook's real entry.
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
        // The typed turns a live AUTO stamp is proven by (audit 2026-10-30 HK-03, hook-prelude.js autoStampVerified): the
        // user's flag-only mode line, in the harness's tagged shape, and the hand-written waiver's words.
        { type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: '<command-message>mode-auto-run</command-message>\n<command-name>/mode-auto-run</command-name>\n<command-args>--mode-auto-run-on</command-args>' } },
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
const autoStamp = (p, sid, extra = '') => fs.writeFileSync(p.gate, `AUTO - "/loop-code-quality --mode-auto-run-on"\nsession: ${sid}\nskill: loop-code-quality\ntranscript-size: 0\n${extra}`);
// The run marker (stack-modes spec section 2): open while a run in auto-run goes; the Stop hold and the dispatch guard read it.
const marker = (p, sid) => path.join(p.root, '.alfred', 'state', 'sessions', `AUTO-RUN-${sid}`);
const openRun = (p, sid, skill = 'loop-code-quality') => { fs.mkdirSync(path.dirname(marker(p, sid)), { recursive: true });
    fs.writeFileSync(marker(p, sid), `skill: ${skill}\nprompt: 0123456789ab\nat: ${new Date().toISOString()}\n`); };
const sub = (p, sid, prompt, t) => run('guard-fresh-session-start.js', { hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: p.root, transcript_path: t, prompt },
    { CLAUDE_PROJECT_DIR: p.root });

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

test('auto-mode start: the typed command writes the stamp and the run marker before the run, and the fresh-session offer never fires', () =>
{
    const p = project();
    // 450k of a 1M window over a 20k first message: the size offer is due, and without the flag it is made
    const big = transcript([], 'claude-opus-5-5', 450000);
    const plain = expand(p, 's1', '/loop-code-quality src/', big);
    assert.match(context(plain), /Do NOT start the run yet/, 'the offer, without auto-run');
    assert.ok(!fs.existsSync(p.gate), 'and no stamp');
    const auto = expand(p, 's2', '/loop-code-quality --mode-auto-run-on src/', big);
    assert.strictEqual(auto.status, 0);
    const said = context(auto);
    assert.match(said, /^auto-run is ON for this \/loop-code-quality run/);
    assert.doesNotMatch(said, /Do NOT start the run yet/, 'the offer is never made under auto-run');
    for (const rule of [/\(Recommended\) option/, /Do not end a turn between steps/, /never push, merge, deploy or send anything out/, /fresh-session hand-off is never taken/,
        /never write an APPROVED or AUTO line over it/, /an unpushed commit is a Leftovers line/,
        /delete \.alfred\/state\/sessions\/AUTO-RUN-s2 if its `skill:` line names this run - that ends this run; auto-run stays on for the session until --mode-auto-run-off/])
        assert.match(said, rule);
    assert.doesNotMatch(said, /delete \.alfred\/state\/approvals\/APPROVAL/, 'the close never deletes the stamp');
    const stamp = fs.readFileSync(p.gate, 'utf8');
    assert.match(stamp, /^AUTO - "\/loop-code-quality --mode-auto-run-on src\/"\nsession: s2\nskill: loop-code-quality\nat: \d{4}-/, 'the flag writes its stamp to state/approvals/APPROVAL');
    assert.match(fs.readFileSync(marker(p, 's2'), 'utf8'), /^skill: loop-code-quality\nprompt: [0-9a-f]{12}\nat: \d{4}-/, 'and the run marker');
    assert.ok(!fs.existsSync(p.legacy), 'and nothing to the legacy flow/');
    assert.ok(rows(p, 's2').some((r) => r.mode === 'auto' && r.kind === 'auto-start'), 'one auto-start row');
    // a second flow in the same session rides the live stamp: its words and time stay
    const before = fs.readFileSync(p.gate, 'utf8');
    assert.match(context(expand(p, 's2', '/task-solve --mode-auto-run-on fix the cache', big)), /auto-run is ON for this \/task-solve run/);
    assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), before, 'the live stamp is kept');
    // another session's stamp is never overwritten while that session is still RUNNING (its own transcript, beside this
    // one, written in the last 10 minutes): this run asks as usual, the banner says why and how to take over
    const live = path.join(path.dirname(big), 's2.jsonl');
    fs.writeFileSync(live, '{}\n');
    const refused = context(expand(p, 's3', '/task-solve-cross --mode-auto-run-on', big));
    assert.doesNotMatch(refused, /auto-run is ON/);
    assert.match(refused, /auto-run did NOT start: another session \(s2\) is running a stamped run in this checkout right now, and \.alfred\/state\/approvals\/APPROVAL is its approval - it ends with --mode-auto-run-off there, or delete \.alfred\/state\/approvals\/APPROVAL to take over/);
    assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), before, 'the running session\'s stamp is left as it is');
    assert.ok(rows(p, 's3').some((r) => r.kind === 'auto-start-refused'), 'one refused row');
    assert.ok(!fs.existsSync(marker(p, 's3')), 'and no marker');
    // the session went quiet: the new start takes over, and the stamp says whose it was
    const quiet = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(live, quiet, quiet);
    assert.match(context(expand(p, 's3', '/task-solve-cross --mode-auto-run-on', big)), /auto-run is ON for this \/task-solve-cross run/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: s3\nskill: task-solve-cross\nat: [^\n]+\ntaken-from: s2\n/);
    // no transcript for the stamp's session at all (another machine's, or cleared): no live run, replaced
    fs.writeFileSync(p.gate, 'AUTO - "/task-solve --mode-auto-run-on x"\nsession: gone-session\nskill: task-solve\nat: 2026-10-20T00:00:00Z\n');
    assert.match(context(expand(p, 's4', '/task-solve --mode-auto-run-on y', big)), /auto-run is ON/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: s4\n[\s\S]*\ntaken-from: gone-session\n/);
    fs.rmSync(live, { force: true });
});

test('auto-mode start: a task, capture, loop, issue or mode command, only --mode-auto-run-on in the leading run, never a seat, and the model\'s Skill call only on the user\'s typed auto-run command', () =>
{
    const t = transcript();
    const none = (prompt, extra) => { const p = project(); const r = expand(p, 'sx', prompt, t, extra); return !fs.existsSync(p.gate) && !/auto-run is ON/.test(context(r)); };
    // the old flag and the bare word start nothing: the old flag gets its pointer at UserPromptSubmit (spec section 5)
    assert.ok(none('/task-solve --auto-mode fix it'), 'the old flag');
    assert.ok(none('/task-solve auto-mode fix it'), 'the bare word of 2.4.0-2.5.0');
    assert.ok(none('/loop-code-quality --mode-auto-run'), 'the flag is exact');
    assert.ok(none('/loop-code-quality -mode-auto-run-on'), 'two dashes');
    assert.ok(none('/loop-code-quality --mode-auto-run-ons'), 'and whole');
    assert.ok(none('/loop-code-quality --MODE-AUTO-RUN-ON'), 'and lower case');
    // only in the leading run right after the command
    assert.ok(none('/task-solve fix the --mode-auto-run-on flag wording'), 'the flag inside the request is the request');
    assert.ok(none('/loop-code-quality src/ --mode-auto-run-on'), 'and trailing it starts nothing');
    assert.ok(none('/loop-code-quality --mode-auto-run-on --mode-auto-run-off'), 'off wins');
    assert.ok(none('/loop-code-quality --mode-auto-run-on', { agent_id: 'seat-1' }), 'a seat never starts one');
    assert.ok(none('/loop-code-quality --mode-auto-run-on', { session_id: '' }), 'no session, nothing to name');
    const p = project();
    assert.match(context(expand(p, 'sy', '/alfred-code:loop-test-coverage-quality --mode-output-scorer-on --mode-auto-run-on', t)), /auto-run is ON/, 'a scoped name, any order in the run');
    const cap = project();
    assert.match(context(expand(cap, 'sc', '/capture-awareness --mode-auto-run-on', t)), /auto-run is ON for this \/capture-awareness run/);
    assert.match(fs.readFileSync(cap.gate, 'utf8'), /^AUTO - "\/capture-awareness --mode-auto-run-on"\nsession: sc\nskill: capture-awareness\n/);
    // an issue command, the flag on its own line as typed in a real session
    const iss = project();
    assert.match(context(expand(iss, 'si', '/issue-diagnoser --mode-auto-run-on\n\nthe login 500', t)), /auto-run is ON for this \/issue-diagnoser run/);
    assert.match(fs.readFileSync(iss.gate, 'utf8'), /^AUTO - "\/issue-diagnoser --mode-auto-run-on the login 500"\nsession: si\nskill: issue-diagnoser\n/);
    // the model's own Skill call, the flag leading its args: it writes or keeps the stamp only when the user's newest
    // TYPED prompt is a family command whose leading run turns auto-run on (spec section 2, round-3 M1)
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text }] } });
    const skillCall = (skill, args, tp, sid = 'sz') => { const pr = project(); const r = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill',
        tool_input: { skill, args }, session_id: sid, cwd: pr.root, transcript_path: tp }, { CLAUDE_PROJECT_DIR: pr.root }); return { pr, r }; };
    const { pr: q, r: call } = skillCall('task-design', '--mode-auto-run-on the cache plan', transcript([typed('/task-design --mode-auto-run-on the cache plan')]));
    assert.strictEqual(call.status, 0, call.stderr);
    assert.strictEqual(JSON.parse(call.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(context(call), /auto-run is ON for this \/task-design run/);
    assert.match(fs.readFileSync(q.gate, 'utf8'), /^AUTO - "\/task-design --mode-auto-run-on the cache plan"\nsession: sz\n/);
    assert.ok(!fs.existsSync(marker(q, 'sz')), 'the Skill route never writes a marker');
    const cmdRow = (name, args) => typed(`<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`);
    assert.match(context(skillCall('task-implement', '--mode-auto-run-on', transcript([cmdRow('task-solve', '--mode-auto-run-on\n\nfix it')])).r), /auto-run is ON/, 'a typed slash run');
    assert.match(context(skillCall('issue-signatures-runtime', '--mode-auto-run-on', transcript([cmdRow('issue-diagnoser', '--mode-auto-run-on the 500')])).r), /auto-run is ON/, 'a typed issue run');
    assert.match(context(skillCall('capture-quality', '--mode-auto-run-on', transcript([cmdRow('capture-quality', '--mode-auto-run-on')])).r), /auto-run is ON for this \/capture-quality run/, 'a typed capture run');
    const { pr: v, r: own } = skillCall('task-migrate-v2', '--mode-auto-run-on', transcript([typed('/task-migrate-v2 --mode-auto-run-on')]), 'sv');
    assert.match(context(own), /auto-run is ON for this \/task-migrate-v2 run/);
    assert.ok(fs.existsSync(v.gate), 'a project\'s own task skill, a digit in its name');
    for (const [tp, why] of [
        [t, 'the typed prompt does not carry it'],
        [transcript([typed('/task-solve --mode-auto-run-on fix it'), { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }, typed('now look at the cache layer')]), 'an older typed prompt carried it, the newest does not'],
        [transcript([typed('design the cache plan in auto-run please')]), 'a prose ask is no command'],
        [transcript([cmdRow('task-solve', 'fix the --mode-auto-run-on banner')]), 'a command whose request names the flag'],
        [transcript([cmdRow('task-solve', '--auto-mode fix it')]), 'a typed command opening with the old flag'],
        [transcript([cmdRow('habits-explain-topic', '--mode-auto-run-on x')]), 'a command outside the families'],
        [transcript([{ ...typed('Base directory for this skill ... auto-run is ON'), isMeta: true }]), 'a skill body is no typed prompt'],
        [transcript([{ ...typed('Another Claude session sent a message:\n<agent-message from="a">run in auto-run</agent-message>'), isMeta: true }]), 'a seat\'s hand-back'],
        [transcript([{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '--mode-auto-run-on' }] } }]), 'a tool result'],
        [path.join(TMP, 'no-such.jsonl'), 'no transcript'],
    ])
    {
        const { pr, r } = skillCall('task-implement', '--mode-auto-run-on', tp, 'sr');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(!fs.existsSync(pr.gate) && !/auto-run is ON/.test(context(r)), `no start: ${why}`);
        assert.ok(rows(pr, 'sr').some((x) => x.kind === 'auto-start-refused'), `and a refused row: ${why}`);
    }
    // the typed route's matcher reaches every family name, a project's own and a digit included (audit HK06)
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const row = manifest.hooks.find((h) => String(h.matcher || '').startsWith('@UserPromptExpansion:'));
    const matcher = new RegExp(row.matcher.slice('@UserPromptExpansion:'.length));
    for (const name of ['task-migrate-v2', 'alfred-code:task-solve', 'loop-perf', 'task-solve-cross', 'capture-awareness', 'issue-diagnoser', 'issue-signatures-ci', 'mode-auto-run', 'mode-output-scorer'])
        assert.ok(matcher.test(name), `expansion spawns for ${name}`);
    for (const name of ['review', 'commit', 'tasks', 'my-task-x'])
        assert.ok(!matcher.test(name), `and not for ${name}`);
});

test('mode start: --mode-auto-run-on writes the stamp and a run marker; a later flagless family command writes a new marker and keeps the stamp (AC2)', () =>
{
    const t = transcript();
    const ends = [];
    // UserPromptSubmit and the expansion of one typed prompt are not ordered for us: both orders end in the same files
    for (const submitFirst of [true, false])
    {
        const p = project();
        const both = (prompt) => { if (submitFirst) sub(p, 'm1', prompt, t); const r = expand(p, 'm1', prompt, t); if (!submitFirst) sub(p, 'm1', prompt, t); return r; };
        assert.match(context(both('/task-solve --mode-auto-run-on fix A')), /^auto-run is ON for this \/task-solve run/);
        const stamp = fs.readFileSync(p.gate, 'utf8');
        assert.match(stamp, /^AUTO - "\/task-solve --mode-auto-run-on fix A"\nsession: m1\nskill: task-solve\n/);
        const first = fs.readFileSync(marker(p, 'm1'), 'utf8');
        assert.match(first, /^skill: task-solve\nprompt: [0-9a-f]{12}\n/);
        const b = both('/capture-awareness');
        assert.match(context(b), /^auto-run is ON for this \/capture-awareness run/, 'a flagless family command under the mode gets the contract');
        assert.match(bannerOf(b)[0], /^\*\*Auto-run: ON\*\* for \/capture-awareness /);
        assert.strictEqual(fs.readFileSync(p.gate, 'utf8'), stamp, 'the stamp is kept');
        const second = fs.readFileSync(marker(p, 'm1'), 'utf8');
        assert.match(second, /^skill: capture-awareness\n/, 'a new marker');
        assert.notStrictEqual(second.split('\n')[1], first.split('\n')[1], 'for the new prompt');
        ends.push([stamp, second].map((s) => s.replace(/\nat: [^\n]*/, '')));
    }
    assert.deepStrictEqual(ends[0], ends[1], 'both event orders end in the same files');
});

test('mode prompt: a plain prompt or "stop auto-mode" keeps the stamp; --mode-auto-run-off deletes the stamp and the marker with one auto-end row (AC3, AC4)', () =>
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
    sub(p, 'e2', '/task-solve --mode-auto-run-off x', t);
    assert.ok(fs.existsSync(p.gate) && fs.existsSync(marker(p, 'e1')), 'another session\'s -off leaves this session\'s files');
    for (const submitFirst of [true, false])
    {
        const pr = project();
        autoStamp(pr, 'e3');
        openRun(pr, 'e3');
        const prompt = '/task-solve --mode-auto-run-off X';
        const before = submitFirst ? sub(pr, 'e3', prompt, t) : null;
        const x = expand(pr, 'e3', prompt, t);
        const s = before || sub(pr, 'e3', prompt, t);
        assert.doesNotMatch(context(x), /auto-run is ON for this/, `no contract (${submitFirst ? 'submit first' : 'expansion first'})`);
        assert.match(bannerOf(x)[0], /^\*\*Auto-run: OFF\*\* for \/task-solve /);
        assert.ok(!fs.existsSync(pr.gate) && !fs.existsSync(marker(pr, 'e3')), 'both files deleted');
        assert.match(context(s), /auto-run is OFF for this session/);
        assert.strictEqual(rows(pr, 'e3').filter((r) => r.kind === 'auto-end').length, 1, 'one auto-end row');
        // AC4: after -off the next asks wait
        const next = expand(pr, 'e3', '/task-solve Y', t);
        assert.match(bannerOf(next)[0], /^\*\*Auto-run: OFF\*\* for \/task-solve - each question waits for your answer\.$/);
        assert.doesNotMatch(context(next), /auto-run is ON/);
        assert.ok(!fs.existsSync(marker(pr, 'e3')), 'no marker without the mode');
        assert.strictEqual(answered(ask(pr, 'e3', [q('Build it?', ['Yes (Recommended)', 'No'])])), null, 'the ask waits');
        const stopped = run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'e3', cwd: pr.root, transcript_path: t,
            last_assistant_message: 'Result: done\nProgress: 4 of 4\nLeftovers: none' }, { CLAUDE_PROJECT_DIR: pr.root });
        assert.doesNotMatch(stopped.stderr, /its run is not closed/, 'and Stop is not held');
    }
    // a stamp written by hand (a solve flow's no-stops waiver, no session line) is no auto-run of this hook's
    const h = project();
    fs.writeFileSync(h.gate, 'AUTO - "take every recommendation"\n');
    sub(h, 'e4', '/task-solve --mode-auto-run-off x', t);
    assert.ok(fs.existsSync(h.gate), 'a hand-written stamp stays');
});

test('mode texts: the Stop hold stderr and the auto-input note name the run marker and --mode-auto-run-off, never the stamp path; a typed /task-solve B gets the contract and no auto-input note', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'x1');
    openRun(p, 'x1');
    const note = context(sub(p, 'x1', 'use the v2 endpoint instead', t));
    assert.match(note, /^auto-run stays ON: the user typed this message while the run goes on, so it is INPUT to the run/);
    assert.match(note, /If this message asks to stop or pause the run, print its close and delete \.alfred\/state\/sessions\/AUTO-RUN-x1 - that ends this run; auto-run stays on until --mode-auto-run-off\./);
    assert.doesNotMatch(note, /approvals\/APPROVAL/, 'the note never names the stamp');
    assert.ok(rows(p, 'x1').some((r) => r.kind === 'auto-input'), 'an auto-input row');
    const held = run('guard-stop-contract.js', { hook_event_name: 'Stop', session_id: 'x1', cwd: p.root, transcript_path: t,
        last_assistant_message: 'Stage 2 of 4 is done; stage 3 starts next.' }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(held.status, 2);
    assert.match(held.stderr, /If the run is finished,\s+print its close and delete \S*AUTO-RUN-x1 - that ends this run; auto-run stays on for the session until\s+--mode-auto-run-off\./);
    assert.doesNotMatch(held.stderr, /APPROVAL/, 'the hold never names the stamp');
    assert.strictEqual(context(sub(p, 'x1', '/task-solve B', t)), '', 'a typed family command gets no auto-input note');
    const contract = context(expand(p, 'x1', '/task-solve B', t));
    assert.match(contract, /^auto-run is ON for this \/task-solve run/, 'it gets the contract');
    assert.match(contract, /a guard's security ask \(a credential shown, work discarded, a write outside the project, a desktop launch\) is never auto-run's to allow: take its safe option and list the act for the user in the close/,
        'the four security asks stay the user\'s (audit 2026-10-30 fix #6)');
    const skill = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'mode-auto-run', 'SKILL.md'), 'utf8');
    assert.match(skill.replace(/\s+/g, ' '), /A guard's security ask - a credential shown, work discarded, a write outside the project, a desktop launch - is never auto-run's to allow/,
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
    command_name: prompt.slice(1).split(' ')[0], command_args: prompt.split(' ').slice(1).join(' '), prompt, ...extra,
}, { CLAUDE_PROJECT_DIR: p.root, ...env });

test('mode banner: auto-mode ON says every ask takes its Recommended option and the session compacts, at the window it will', () =>
{
    const p = project();
    const t = transcript();
    const on = typedRun(p, 'b1', '/loop-code-quality --mode-auto-run-on src/', t);
    assert.strictEqual(on.status, 0, on.stderr);
    const said = context(on);
    assert.match(said, /^auto-run is ON for this \/loop-code-quality run/, 'the contract first, its shape unchanged');
    assert.strictEqual(said.split(BANNER_HEAD).length, 2, 'the banner once');
    assert.deepStrictEqual(bannerOf(on), [
        '**Auto-run: ON** for /loop-code-quality - every question takes its (Recommended) option without waiting for you; one with no recommended option, or whose recommendation acts outward (push, merge, deploy, publish, a PR), still waits. A message you type mid-run is input to the run; auto-run stays on for this session until you type `/mode-auto-run --mode-auto-run-off`.',
        "**Context:** no fresh-session hand-off - the session auto-compacts at Claude Code's own point in its 1M context window (claude-opus-5-5) and the run goes on from the summary and its state files.",
    ]);
    // the second flow of the same run rides the live stamp, and says so too
    assert.match(bannerOf(typedRun(p, 'b1', '/task-solve --mode-auto-run-on fix the cache', t))[0], /^\*\*Auto-run: ON\*\* for \/task-solve /);
    // the window the installer seeded for this model (ALFRED_CODE_AUTO_COMPACT=1) is the one named
    const q = project();
    fs.mkdirSync(path.join(q.root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(q.root, '.claude', 'settings.json'), JSON.stringify({ modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400000 } } }));
    assert.strictEqual(bannerOf(typedRun(q, 'b2', '/task-solve --mode-auto-run-on x', t))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 400k auto-compact window (of 1M, claude-opus-5-5) and the run goes on from the summary and its state files.');
});

test('mode banner: auto-mode OFF says each ask waits, then the fresh-session refresh, the compaction, or the offers off', () =>
{
    const p = project();
    const t = transcript([], 'claude-sonnet-5-5');
    const off = bannerOf(typedRun(p, 'c1', '/task-solve fix the cache', t));
    assert.deepStrictEqual(off, [
        '**Auto-run: OFF** for /task-solve - each question waits for your answer.',
        '**Context:** session refresh - past ~400k tokens of its 1M context window (claude-sonnet-5-5), the run offers to resume in a fresh session from its state file instead of compacting.',
    ]);
    // a 200k model takes its own tier's trigger
    assert.match(bannerOf(typedRun(p, 'c2', '/capture-awareness', transcript([], 'claude-haiku-4-5')))[1], /past ~180k tokens of its 200k context window \(claude-haiku-4-5\)/);
    assert.strictEqual(bannerOf(typedRun(p, 'c3', '/loop-test-coverage-quality', t, { ALFRED_CODE_AUTO_COMPACT: '1' }))[1],
        "**Context:** auto-compact is on (ALFRED_CODE_AUTO_COMPACT=1) - the session compacts at Claude Code's own point in its 1M context window (claude-sonnet-5-5) instead of offering a fresh session.");
    assert.strictEqual(bannerOf(typedRun(p, 'c4', '/issue-diagnoser the login 500', t, { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' }))[1],
        "**Context:** the fresh-session offers are off - the session compacts at Claude Code's own point in its 1M context window (claude-sonnet-5-5).");
    // a mode flag past the leading run starts nothing there, and the banner says so (spec section 1, `late`)
    const HINT = ' (mode flags count only right after the command: `--mode-auto-run-on` there starts auto-run.)';
    assert.strictEqual(bannerOf(typedRun(p, 'c8', '/task-solve fix the cache --mode-auto-run-on', t))[0],
        `**Auto-run: OFF** for /task-solve - each question waits for your answer.${HINT}`);
    // the bare word of 2.4.0-2.5.0 and the old flag are no mode-like token past the run: plain OFF (the old flag's pointer comes at submit)
    assert.strictEqual(bannerOf(typedRun(p, 'c5', '/capture-awareness auto-mode', t))[0], '**Auto-run: OFF** for /capture-awareness - each question waits for your answer.');
    assert.strictEqual(bannerOf(typedRun(p, 'c11', '/task-solve fix the auto-mode banner', t))[0], '**Auto-run: OFF** for /task-solve - each question waits for your answer.');
    assert.match(bannerOf(typedRun(project(), 'c12', '/capture-awareness --mode-auto-run-on', t))[0], /^\*\*Auto-run: ON\*\* for \/capture-awareness - /);
    assert.strictEqual(bannerOf(typedRun(p, 'c9', '/issue-diagnoser the login 500', t))[0], '**Auto-run: OFF** for /issue-diagnoser - each question waits for your answer.');
    assert.match(bannerOf(typedRun(project(), 'c10', '/issue-diagnoser --mode-auto-run-on the login 500', t))[0], /^\*\*Auto-run: ON\*\* for \/issue-diagnoser - /);
    // an unknown model and no window: no number is invented for the window, and the default is said as the trigger it is
    const bare = project();
    assert.strictEqual(bannerOf(typedRun(bare, 'c6', '/task-design', path.join(TMP, 'no-such.jsonl')))[1],
        '**Context:** session refresh - past ~180k tokens (ALFRED_CODE_CONTEXT_WINDOW_DEFAULT - the size of its context window is not known), the run offers to resume in a fresh session from its state file instead of compacting.');
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
        '**Context:** session refresh - past ~180k tokens (ALFRED_CODE_CONTEXT_WINDOW_DEFAULT - the size of its context window is not known), the run offers to resume in a fresh session from its state file instead of compacting.',
        'no record: the alias is not read, so the window is unknown');
    assert.strictEqual(start('r1', 'claude-sonnet-5-5').status, 0);
    assert.strictEqual(bannerOf(typedRun(p, 'r1', '/capture-awareness', none))[1],
        '**Context:** session refresh - past ~400k tokens of its 1M context window (claude-sonnet-5-5), the run offers to resume in a fresh session from its state file instead of compacting.');
    assert.strictEqual(run('guard-fresh-session-start.js', { hook_event_name: 'PostModelSwitch', session_id: 'r1', cwd: p.root, from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-4-5' }, { CLAUDE_PROJECT_DIR: p.root }).status, 0);
    assert.match(bannerOf(typedRun(p, 'r1', '/capture-awareness', none))[1], /past ~180k tokens of its 200k context window \(claude-haiku-4-5\)/, 'a /model switch moves it');
    // the auto-compact window is quoted against the model's own capacity, never against the default
    fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet', autoCompactWindow: 350000 }));
    start('r2', 'claude-sonnet-5-5');
    assert.strictEqual(bannerOf(typedRun(p, 'r2', '/capture-awareness --mode-auto-run-on', none))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 350k auto-compact window (of 1M, claude-sonnet-5-5) and the run goes on from the summary and its state files.');
    // Claude Code caps an auto-compact window at the model's context window (code.claude.com/docs/en/model-config, 'Set
    // the auto-compact window', verified 2026-10-21), so after a /model switch to a smaller model the banner never quotes
    // a compaction point past that model's capacity
    start('r4', 'claude-sonnet-5-5');
    run('guard-fresh-session-start.js', { hook_event_name: 'PostModelSwitch', session_id: 'r4', cwd: p.root, from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-4-5' }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(bannerOf(typedRun(p, 'r4', '/capture-awareness --mode-auto-run-on', none))[1],
        '**Context:** no fresh-session hand-off - the session auto-compacts as it nears its 200k context window (its 350k auto-compact window is capped there, claude-haiku-4-5) and the run goes on from the summary and its state files.');
    assert.strictEqual(bannerOf(typedRun(project(), 'r3', '/capture-awareness --mode-auto-run-on', none))[1].includes('of 300k'), false, 'no default window is quoted');
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
    const typed = { type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '/task-design --mode-auto-run-on' }] } };
    const call = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'task-design', args: '--mode-auto-run-on' },
        session_id: 'd5', cwd: p.root, transcript_path: transcript([typed]) }, { CLAUDE_PROJECT_DIR: p.root });
    assert.match(context(call), /auto-run is ON/);
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
    assert.match(attended.stderr, /add a fresh-session option to this first ask of a new cycle - This session carries ~362k tokens per message/);
});

// audit 2026-10-14 SKF-04 (the user's ruling, option A): the upgrade's hard stop is a rail. Put as the attended run puts
// it, the hook answers its marked 'Re-plan' and a stage that stays red re-plans unattended; so under auto-mode the skill
// puts it with no mark and the question saying why, and the hook leaves it for the user without denying it.
test('auto-mode asks: the upgrade hard stop waits when put unmarked with its reason, as task-version-upgrade says', () =>
{
    const p = project();
    fs.writeFileSync(p.gate, 'AUTO - "/task-version-upgrade --mode-auto-run-on"\nsession: u1\nskill: task-version-upgrade\ntranscript-size: 0\n');
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
    assert.ok(fs.existsSync(p.gate) && fs.existsSync(marker(p, 'c1')), 'the stamp and the marker stand - only the run\'s close or --mode-auto-run-off ends them');
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
    assert.deepStrictEqual(settings.compactWindowSeeds({ small: 150000, edge: 199999, at: 200000 }, { ...ON, ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '120000' }, CATALOG),
        { at: 180000 }, 'a window under 200K is no tier, and auto-compact never takes ALFRED_CODE_CONTEXT_WINDOW_DEFAULT (the user\'s ruling, 2026-10-21)');
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

test('settings-writer: uninstall takes the seeded scorer rows back and keeps one the user changed', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'scorer-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    const first = writer(dir);
    const data = read(dir);
    assert.deepStrictEqual([data.env.ALFRED_CODE_SCORER, data.env.ALFRED_CODE_SCORER_LEVEL], ['0', '80'], 'the install seeded them');
    data.env.ALFRED_CODE_SCORER_ROUNDS = '6';
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(data));
    settings.removeManagedSettings({ claudeDir: path.join(dir, '.claude'), ledger: throughStamp(first.managed) });
    const env = read(dir).env || {};
    assert.deepStrictEqual([env.ALFRED_CODE_SCORER, env.ALFRED_CODE_SCORER_LEVEL], [undefined, undefined], 'the seeded rows go');
    assert.strictEqual(env.ALFRED_CODE_SCORER_ROUNDS, '6', "the user's value stays");
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

test('scorer asks: each option of the continue and withhold-final asks is auto-answered when it is the recommended one (R19)', () =>
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
        const r = ask(p, 'sc1', [{ question, header: 'Scorer', multiSelect: false, options: ordered }]);
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
    fs.writeFileSync(p8.gate, `AUTO - "/task-solve --mode-auto-run-on x"\nsession: oth1\nskill: task-solve\nat: ${new Date().toISOString()}\n`);
    const live = path.join(path.dirname(t), 'oth1.jsonl'); fs.writeFileSync(live, '{}\n');
    assert.match(context(typedRun(p8, 'ta8', '/mode-auto-run y', t, cfg())), /auto-run did NOT start: another session \(oth1\) is running a stamped run/);
    assert.match(fs.readFileSync(p8.gate, 'utf8'), /\nsession: oth1\n/);
    fs.rmSync(live, { force: true });
});

test('mode-auto-run: the model never calls it, the flow\'s step calls ride its stamp, and a typed /mode-auto-run mid-run keeps the mode until -off', () =>
{
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text }] } });
    const cmdRow = (name, args) => typed(`<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`);
    // the model's own Skill(mode-auto-run) is denied by its disable-model-invocation flag and writes no stamp
    const p = project();
    fs.cpSync(path.join(__dirname, '..', 'stack', 'skills', 'mode-auto-run'), path.join(p.root, '.claude', 'skills', 'mode-auto-run'), { recursive: true });
    const self = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'mode-auto-run', args: 'add x' },
        session_id: 'tb1', cwd: p.root, transcript_path: transcript([typed('go on')]) }, { CLAUDE_PROJECT_DIR: p.root });
    assert.strictEqual(self.status, 2);
    assert.match(self.stderr, /mode-auto-run is marked disable-model-invocation/);
    assert.ok(!fs.existsSync(p.gate));
    // a step skill the flow calls with the flag behind a typed /mode-auto-run keeps the stamp; behind an empty one it is refused
    const step = (tp) => { const pr = project(); fs.writeFileSync(pr.gate, `AUTO - "/mode-auto-run x"\nsession: tb2\nskill: mode-auto-run\nat: ${new Date().toISOString()}\ntranscript-size: 0\n`);
        const r = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'task-design', args: '--mode-auto-run-on x' },
            session_id: 'tb2', cwd: pr.root, transcript_path: tp }, { CLAUDE_PROJECT_DIR: pr.root }); return { pr, r }; };
    const { pr: kept, r: rk } = step(transcript([cmdRow('mode-auto-run', 'x')]));
    assert.match(context(rk), /auto-run is ON for this \/task-design run/);
    assert.ok(rows(kept, 'tb2').some((x) => x.kind === 'auto-start' && x.detail && x.detail.kept === true), 'a kept auto-start row');
    assert.ok(!rows(kept, 'tb2').some((x) => x.kind === 'auto-start-refused'), 'and no refused row');
    const { pr: bare } = step(transcript([cmdRow('mode-auto-run', '')]));
    assert.ok(rows(bare, 'tb2').some((x) => x.kind === 'auto-start-refused'), 'an empty /mode-auto-run backs nothing');
    // mid-run: a typed /mode-auto-run with a request opens a new run under the mode; an empty one ends nothing; -off ends it
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
    const off = sub(q3, 'tb3', '/mode-auto-run --mode-auto-run-off', t);
    assert.ok(!fs.existsSync(q3.gate) && !fs.existsSync(marker(q3, 'tb3')), 'ended: -off');
    assert.match(context(off), /auto-run is OFF for this session/);
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
    assert.match(context(expand(p, 'tk-new-session', '/task-solve --mode-auto-run-on x', t)), /auto-run did NOT start: another session \(tk-old-s\) is running/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: tk-old-session\n/, 'kept while it runs');
    const quiet = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(live, quiet, quiet);
    assert.match(context(expand(p, 'tk-new-session', '/task-solve --mode-auto-run-on x', t)), /auto-run is ON/);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /\nsession: tk-new-session\n[\s\S]*\ntaken-from: tk-old-session\n/);
    const takeovers = rows(p, 'tk-new-session').filter((r) => r.kind === 'auto-takeover');
    assert.strictEqual(takeovers.length, 1, 'one auto-takeover row');
    assert.match(takeovers[0].reason, /tk-new-s.*tk-old-s|tk-old-s.*tk-new-s/, 'naming both sessions');
    const notice = "auto-run is OFF here - session tk-new-s took it; `--mode-auto-run-on` after a command takes it back";
    assert.ok(context(sub(p, 'tk-old-session', 'carry on', t)).includes(notice), 'the losing session is told');
    assert.ok(!context(sub(p, 'tk-old-session', 'carry on', t)).includes('took it'), 'once');
    assert.ok(!context(sub(p, 'tk-new-session', 'carry on', t)).includes('took it'), 'never the winner');
    fs.rmSync(live, { force: true });
});

test('mode pointers: --auto-mode, --score-on and --score-off each get their pointer line and start nothing; --mode-x gets its reason (AC9)', () =>
{
    const p = project();
    const t = transcript();
    const pointer = "'--auto-mode' is now '--mode-auto-run-on' - this run is attended: ask as usual and take no (Recommended) option unasked";
    const old = context(sub(p, 'pt', '/task-solve --auto-mode X', t));
    assert.ok(old.includes(pointer), old);
    expand(p, 'pt', '/task-solve --auto-mode X', t);
    assert.ok(!fs.existsSync(p.gate) && !fs.existsSync(marker(p, 'pt')), 'the old flag starts nothing');
    for (const [flag, now] of [['--score-on', '--mode-output-scorer-on'], ['--score-off', '--mode-output-scorer-off']])
    {
        const said = context(sub(p, 'pt', `/task-solve ${flag} X`, t));
        assert.ok(said.includes(`'${flag}' is now '${now}'`), said);
        assert.doesNotMatch(said, /attended/, 'no attended clause on the scorer pointers');
    }
    // a new flag in the same run still works
    const mixed = project();
    assert.ok(context(sub(mixed, 'pm', '/task-solve --auto-mode --mode-auto-run-on X', t)).includes(pointer));
    assert.match(context(expand(mixed, 'pm', '/task-solve --auto-mode --mode-auto-run-on X', t)), /^auto-run is ON for this \/task-solve run/);
    const unknown = context(sub(p, 'pt', '/task-solve --mode-x X', t));
    assert.ok(unknown.includes("'--mode-x' is no mode flag - the four are --mode-auto-run-on|off and --mode-output-scorer-on|off"), unknown);
    assert.ok(rows(p, 'pt').some((r) => r.kind === 'mode-flag-old') && rows(p, 'pt').some((r) => r.kind === 'mode-flag-unknown'), 'one row per token');
    assert.strictEqual(rows(p, 'pt').filter((r) => r.kind === 'mode-flag-old').length, 3, 'one per old token');
});

test('mode non-family: /habits-explain-topic --mode-output-scorer-on X gets the count-only-after line and switches nothing (AC9)', () =>
{
    const p = project();
    const t = transcript();
    const line = 'mode flags count only after a task-, capture-, loop-, issue- or mode- command - stack /mode-output-scorer to grade this request';
    const said = context(sub(p, 'nf', '/habits-explain-topic --mode-output-scorer-on X', t));
    assert.ok(said.includes(line), said);
    const both = context(sub(p, 'nf', '/habits-explain-topic --auto-mode --mode-auto-run-on X', t));
    assert.ok(both.includes(line) && both.includes("'--auto-mode' is now '--mode-auto-run-on'"), 'its old flags still get their pointer');
    assert.doesNotMatch(both, /is no mode flag/);
    assert.ok(!fs.existsSync(p.gate), 'nothing starts');
    assert.strictEqual(context(sub(p, 'nf', 'what does --mode-auto-run-on do?', t)), '', 'prose names a flag and says nothing');
});

test('mode flag-only: /mode-auto-run --mode-auto-run-on writes the stamp and no AUTO-RUN- file; /mode-auto-run --mode-auto-run-off and /mode-output-scorer --mode-output-scorer-on switch and start nothing; /loop-code-quality --mode-auto-run-on and /capture-awareness --mode-auto-run-on run over the whole project with a marker and the contract (spec section 6, AC2)', () =>
{
    const t = transcript();
    const p = project();
    const on = expand(p, 'fo', '/mode-auto-run --mode-auto-run-on', t);
    assert.match(fs.readFileSync(p.gate, 'utf8'), /^AUTO - "\/mode-auto-run --mode-auto-run-on"\nsession: fo\n/);
    assert.ok(!fs.existsSync(marker(p, 'fo')), 'no marker');
    assert.doesNotMatch(context(on), /\(7\)/, 'no run contract');
    assert.match(context(on), /auto-run is ON for this session \(\.alfred\/state\/approvals\/APPROVAL\) - no run started/);
    assert.doesNotMatch(context(expand(p, 'fo', '/mode-output-scorer --mode-output-scorer-on', t)), /\(7\)/, 'a scorer switch starts nothing');
    assert.ok(!fs.existsSync(marker(p, 'fo')));
    sub(p, 'fo', '/mode-auto-run --mode-auto-run-off', t);
    expand(p, 'fo', '/mode-auto-run --mode-auto-run-off', t);
    assert.ok(!fs.existsSync(p.gate), 'switched off');
    for (const cmd of ['loop-code-quality', 'capture-awareness'])
    {
        const pr = project();
        const r = expand(pr, 'fw', `/${cmd} --mode-auto-run-on`, t);
        assert.match(context(r), new RegExp(`^auto-run is ON for this /${cmd} run`), cmd);
        assert.match(fs.readFileSync(marker(pr, 'fw'), 'utf8'), new RegExp(`^skill: ${cmd}\\n`), `${cmd}: a whole-project run opens a marker`);
    }
});

test('mode marker: a stacked /mode-output-scorer /task-solve --mode-auto-run-on X writes skill: task-solve, and a second expansion of the same prompt keeps the mtime (AC15)', () =>
{
    const t = transcript();
    const p = project();
    const prompt = '/mode-output-scorer /task-solve --mode-auto-run-on X';
    assert.match(context(expand(p, 'sk', prompt, t)), /^auto-run is ON for this \/task-solve run/);
    assert.match(fs.readFileSync(marker(p, 'sk'), 'utf8'), /^skill: task-solve\n/);
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(marker(p, 'sk'), past, past);
    const was = fs.statSync(marker(p, 'sk')).mtimeMs;
    expand(p, 'sk', prompt, t, { command_name: 'task-solve', command_args: '--mode-auto-run-on X' });
    assert.strictEqual(fs.statSync(marker(p, 'sk')).mtimeMs, was, 'the same skill and prompt leave the file as it is');
});

test('mode marker writers: /mode-output-scorer --mode-auto-run-on X writes the stamp and no marker; /mode-auto-run fix X writes skill: mode-auto-run', () =>
{
    const t = transcript();
    const p = project();
    expand(p, 'mw', '/mode-output-scorer --mode-auto-run-on X', t);
    assert.ok(fs.existsSync(p.gate), 'the stamp');
    assert.ok(!fs.existsSync(marker(p, 'mw')), 'and no marker: the grader opens no run');
    const q2 = project();
    assert.match(context(expand(q2, 'mw', '/mode-auto-run fix X', t)), /^auto-run is ON for this \/mode-auto-run run/);
    assert.match(fs.readFileSync(marker(q2, 'mw'), 'utf8'), /^skill: mode-auto-run\n/);
});

test('mode runs: a flagless typed /task-solve B under the live stamp gets the full contract naming its marker; a model Skill call to a capture keeps the loop marker (AC15)', () =>
{
    const typed = (text) => ({ type: 'user', entrypoint: 'cli', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text }] } });
    const t = transcript();
    const p = project();
    expand(p, 'rn', '/task-solve --mode-auto-run-on A', t);
    const b = context(expand(p, 'rn', '/task-solve B', t));
    for (const item of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)']) assert.ok(b.includes(item), `item ${item}`);
    assert.match(b, /\.alfred\/state\/sessions\/AUTO-RUN-rn/, 'naming its marker');
    const loop = project();
    const lt = transcript([typed('/loop-code-quality --mode-auto-run-on src/')]);
    expand(loop, 'ln', '/loop-code-quality --mode-auto-run-on src/', lt);
    const before = fs.readFileSync(marker(loop, 'ln'), 'utf8');
    const r = run('guard-fresh-session-start.js', { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'capture-quality', args: '--mode-auto-run-on' },
        session_id: 'ln', cwd: loop.root, transcript_path: lt }, { CLAUDE_PROJECT_DIR: loop.root });
    assert.match(context(r), /auto-run is ON for this \/capture-quality run/);
    assert.strictEqual(fs.readFileSync(marker(loop, 'ln'), 'utf8'), before, 'the loop\'s marker stands');
    assert.match(context(r), /delete \.alfred\/state\/sessions\/AUTO-RUN-ln if its `skill:` line names this run/, 'and the capture\'s close leaves it, since it names the loop');
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
    assert.doesNotMatch(note([cmd('--mode-auto-run-off'), readSolve(), said]), /`Size: /, 'a flag-only line arms nothing');
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

test('final review I2: an -on line carrying a request with no flow command keeps its request; the flag-only line still starts nothing', () =>
{
    const t = transcript();
    for (const line of ['/mode-output-scorer --mode-auto-run-on grade the plan in docs/plan.md', '/habits-explain-topic /mode-output-scorer --mode-auto-run-on explain closures'])
    {
        const p = project();
        const r = expand(p, 'i2', line, t, { command_name: 'mode-output-scorer', command_args: '--mode-auto-run-on x' });
        const said = context(r);
        assert.ok(fs.existsSync(p.gate), `${line}: the stamp`);
        assert.doesNotMatch(said, /Do nothing else|no run started/, `${line}: the request is not dropped`);
        assert.match(said, /auto-run is ON for this session \(\.alfred\/state\/approvals\/APPROVAL\) - this line's request runs under it/, line);
    }
    assert.match(context(expand(project(), 'i2f', '/mode-output-scorer --mode-auto-run-on', t)), /no run started: .*Do nothing else for this line\./, 'flag-only keeps its line');
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

test('mode dispatch: a live stamp and no marker lets a generic seat and an implementer seat through as with no stamp; with a marker the generic block fires naming --mode-auto-run-off; a capture-usage-report marker passes its authors (AC16)', () =>
{
    const p = project();
    const disp = (seat, prompt = 'x') => run('guard-unapproved-dispatch.js', { tool_name: 'Agent', tool_input: { subagent_type: seat, prompt }, session_id: 'ds', cwd: p.root, transcript_path: transcript() },
        { CLAUDE_PROJECT_DIR: p.root });
    autoStamp(p, 'ds');
    assert.strictEqual(disp('general-purpose').status, 0, 'between runs a generic seat goes, as with no stamp');
    const impl = disp('aspnet-implementer', 'build it');
    assert.strictEqual(impl.status, 2, 'and an implementer needs its plan stamp, as with no stamp');
    assert.match(impl.stderr, /--mode-auto-run-on/, 'the denial names the new flag');
    assert.doesNotMatch(impl.stderr, /--auto-mode/);
    openRun(p, 'ds', 'task-solve');
    const generic = disp('general-purpose');
    assert.strictEqual(generic.status, 2, 'a run open: the generic block fires');
    assert.match(generic.stderr, /--mode-auto-run-off/);
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

test('final review m9 (re-graded): a mode flag typed alone gets the pointer to its command and switches nothing', () =>
{
    const p = project();
    const t = transcript();
    autoStamp(p, 'bf');
    openRun(p, 'bf');
    const said = context(sub(p, 'bf', '--mode-auto-run-off', t));
    assert.match(said, /'--mode-auto-run-off' typed alone switches nothing: mode flags count only right after a command - `\/mode-auto-run --mode-auto-run-off` ends auto-run for the session/);
    assert.ok(fs.existsSync(p.gate), 'the stamp stands: the grammar is unchanged');
    assert.ok(rows(p, 'bf').some((r) => r.kind === 'mode-flag-bare'), 'one mode-flag-bare row');
    assert.match(context(sub(project(), 'bf2', '--mode-output-scorer-on now', t)), /'--mode-output-scorer-on' typed alone switches nothing/, 'with no stamp too');
    assert.strictEqual(context(sub(project(), 'bf3', 'what does --mode-auto-run-off do?', t)), '', 'a flag inside prose says nothing');
});
