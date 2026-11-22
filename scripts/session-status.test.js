'use strict';
// The session status file (the session-status-file design of 2026-10-29): the plan
// read's one home in history.js (openPlan, entryFor) and session-status.js, the file a main session keeps under its cwd.
const test = require('node:test');
const SUITE = require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const history = require(path.join(HOOKS, 'history.js'));

// The native resolve: a GitHub Windows runner's temp folder sits under an 8.3 short name (`RUNNER~1`), which only the
// native call expands - git writes a worktree's paths in the long form, and a stub dirKey with no resolve must match them.
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'session-status-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const project = () => { const root = path.join(TMP, `p-${seq++}`); fs.mkdirSync(root, { recursive: true }); return root; };
const PLANS = '.alfred/docs/work/plans';
const writePlan = (root, name, text) => { const file = path.join(root, PLANS, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return `${PLANS}/${name}`; };
// Records oldest first: each a later mtime, so lastForBranch reads the last one first.
function records(root, rows)
{
    const dir = path.join(root, '.alfred', 'state', 'history');
    fs.mkdirSync(dir, { recursive: true });
    const base = Date.now() / 1000 - 1000;
    rows.forEach((r, i) =>
    {
        const file = path.join(dir, `${r.session}.json`);
        fs.writeFileSync(file, JSON.stringify({ offset: 1, rulings: [], ...r }));
        fs.utimesSync(file, base + i * 10, base + i * 10);
    });
}

test('openPlan names the newest open plan', () =>
{
    const root = project();
    const a = writePlan(root, 'a.md', '# A\n\nResume: task 1 - start\n');
    const b = writePlan(root, 'b.md', '# B\n\nResume: task 4 - write the router\n');
    const c = writePlan(root, 'c.md', '# C\n\nCompleted: 2026-10-29\nResume: task 9\n');
    records(root, [{ session: 'r1', branch: 'feat/x', plan: a }, { session: 'r2', branch: 'feat/x', plan: b }, { session: 'r3', branch: 'feat/x', plan: c }]);
    assert.deepStrictEqual(history.openPlan(root, 'feat/x', 3), { plan: b, resume: 'task 4 - write the router' });
});

test('the session\'s own record counts (A3)', () =>
{
    const root = project();
    const a = writePlan(root, 'a.md', 'Resume: older\n');
    const own = writePlan(root, 'own.md', 'Resume: task 2 - mine\n');
    records(root, [{ session: 'other', branch: 'main', plan: a }, { session: 'me', branch: 'main', plan: own }]);
    assert.deepStrictEqual(history.openPlan(root, 'main', 3), { plan: own, resume: 'task 2 - mine' });
});

test('a backslash record path reads with /', () =>
{
    const root = project();
    const b = writePlan(root, 'b.md', 'Resume: task 4 - write the router\n');
    records(root, [{ session: 'r2', branch: 'feat/x', plan: b.replace(/\//g, '\\') }]);
    assert.deepStrictEqual(history.openPlan(root, 'feat/x', 3), { plan: b, resume: 'task 4 - write the router' });
});

test('off-disk, home and outside plans are passed over', () =>
{
    const root = project();
    const b = writePlan(root, 'b.md', 'Resume: task 4 - write the router\n');
    records(root, [
        { session: 'r2', branch: 'feat/x', plan: b },
        { session: 'r3', branch: 'feat/x', plan: `${PLANS}/gone.md` },
        { session: 'r4', branch: 'feat/x', plan: '~/x/plans/a.md' },
        { session: 'r5', branch: 'feat/x', plan: '../other/plans/a.md' },
    ]);
    assert.deepStrictEqual(history.openPlan(root, 'feat/x', 5), { plan: b, resume: 'task 4 - write the router' });
});

test('the chosen plan ends the search', () =>
{
    const older = 'Resume: task 1 - older\n';
    const cases = [
        (root) => writePlan(root, 'new.md', '# no resume line\n'),
        (root) => writePlan(root, 'new.md', '# x\nResume:   \n'),
        (root) => { fs.mkdirSync(path.join(root, PLANS, 'dir.md'), { recursive: true }); return `${PLANS}/dir.md`; },
        (root) => writePlan(root, 'big.md', `Resume: big\n${'x'.repeat(1024 * 1024)}`),
    ];
    for (const make of cases)
    {
        const root = project();
        const old = writePlan(root, 'old.md', older);
        records(root, [{ session: 'r1', branch: 'main', plan: old }, { session: 'r2', branch: 'main', plan: make(root) }]);
        assert.strictEqual(history.openPlan(root, 'main', 3), null);
    }
});

test('another branch, or a count that stops short', () =>
{
    const root = project();
    const open = writePlan(root, 'open.md', 'Resume: task 3\n');
    const done = writePlan(root, 'done.md', 'Completed: 2026-10-29\n');
    records(root, [{ session: 'r1', branch: 'main', plan: open }, { session: 'r2', branch: 'main', plan: done }]);
    assert.strictEqual(history.openPlan(root, 'feat/x', 3), null);
    assert.strictEqual(history.openPlan(root, 'main', 1), null);
});

test('the Resume text drops its label, then scrubs and cuts', () =>
{
    const root = project();
    const long = writePlan(root, 'long.md', `Resume:   ${'a'.repeat(120)}\n`);
    records(root, [{ session: 'r1', branch: 'main', plan: long }]);
    const got = history.openPlan(root, 'main', 3);
    assert.strictEqual(got.resume, `${'a'.repeat(77)}...`);
    assert.ok(!got.resume.includes('Resume:'));
    const root2 = project();
    const secret = writePlan(root2, 's.md', `Resume: push with ghp_${'A'.repeat(24)} now\n`);
    records(root2, [{ session: 'r1', branch: 'main', plan: secret }]);
    assert.strictEqual(history.openPlan(root2, 'main', 3).resume, 'push with [redacted] now');
});

test('entryFor reads the record', () =>
{
    const root = project();
    records(root, [{ session: 's1', branch: 'feat/y' }]);
    assert.strictEqual(history.entryFor(root, 's1').branch, 'feat/y');
    assert.strictEqual(history.entryFor(root, 'absent'), null);
    fs.writeFileSync(path.join(root, '.alfred', 'state', 'history', 'bad.json'), '{ not json');
    assert.strictEqual(history.entryFor(root, 'bad'), null);
    fs.writeFileSync(path.join(root, '.alfred', 'state', 'history', 'arr.json'), '[1]');
    assert.strictEqual(history.entryFor(root, 'arr'), null, 'not a JSON object');
});

// --- session-status.js (plan task 3) -----------------------------------------------------------------------------
const { spawnSync, execFileSync } = require('node:child_process');
const SLOW_HOST_GIT_TIMEOUT_MS = 30000;
const { scrubbed, strayRoots, statusAccount } = require('./hook-test-env');
const STATUS = path.join(HOOKS, 'session-status.js');
const S = () => require(STATUS);
// removeStatus checks the process's age against the exclude deadline; pinned, so a slow runner never reads 'late' (the Windows VM gate)
const removeStatus = (root, deps, options) => S().removeStatus(root, { uptime: () => 0, ...deps }, options);
const ACCOUNT = statusAccount();   // settings.json enabling alfred-mods: the one thing that opens the status gate
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = ACCOUNT;   // the in-process writers' gate and the account settings fresh-session reads: a throwaway, never the runner's
const statusOf = (base, id) => path.join(base, '.alfred', 'state', 'sessions', 'status', `${id}.json`);
const legacyStatusOf = (base, id) => path.join(base, '.claude', 'session-inspector', 'status', `${id}.json`);
const readStatus = (base, id) => JSON.parse(fs.readFileSync(statusOf(base, id), 'utf8'));
const transcript = (root, model, name = 't.jsonl') =>
{
    const file = path.join(root, name);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { model } })}\n`);
    return file;
};
const dayMs = 86400000;
const age = (file, ms) => { const at = (Date.now() - ms) / 1000; fs.utimesSync(file, at, at); };
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
// The field cases run in a child: fresh-session reads its variables once, at load (P1).
function inChild(env, code)
{
    const base = scrubbed(process.env);
    for (const k of ['ANTHROPIC_MODEL', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']) delete base[k];
    const script = `const S = require(${JSON.stringify(STATUS)}); const F = require(${JSON.stringify(path.join(HOOKS, 'fresh-session.js'))}); const out = (() => { ${code} })(); process.stdout.write(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['-e', script], { env: { ...base, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: ACCOUNT, ...env }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

test('T1 the file appears with every field', () =>
{
    const root = project();
    const t = transcript(root, 'claude-sonnet-4-5');
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `return S.writeStatus({ session_id: 's1', cwd: ${JSON.stringify(root)}, transcript_path: ${JSON.stringify(t)}, hook_event_name: 'SessionStart' }, {}, { when: 'always' });`);
    assert.strictEqual(got, 'written');
    const s = readStatus(root, 's1');
    assert.deepStrictEqual(Object.keys(s), S().FIELDS);
    assert.deepStrictEqual(S().FIELDS, ['schema', 'session', 'fullContext', 'updatedAt', 'model', 'window', 'resumeAt', 'autoRun', 'scorer', 'autoCompact', 'handoffPrompt', 'plan']);
    assert.strictEqual(s.schema, 1);
    assert.strictEqual(s.session, 's1');
    assert.strictEqual(new Date(s.updatedAt).toISOString(), s.updatedAt);
    assert.strictEqual(typeof s.model, 'string');
    for (const k of ['window', 'resumeAt']) assert.ok(Number.isInteger(s[k]) && s[k] > 0, k);
    assert.strictEqual(typeof s.autoRun, 'boolean');
    assert.ok(s.scorer === null || (typeof s.scorer.on === 'boolean' && s.scorer.level >= 1 && s.scorer.level <= 100 && s.scorer.rounds >= 1 && s.scorer.rounds <= 10));
    assert.ok(s.handoffPrompt === null || (s.handoffPrompt.length >= 1 && s.handoffPrompt.length <= 1000));
    assert.strictEqual(s.plan, null);
    assert.ok(fs.readFileSync(statusOf(root, 's1'), 'utf8').endsWith('}\n'), 'a final newline');
});

test('T2 fullContext', () =>
{
    const root = project();
    const sonnet = transcript(root, 'claude-sonnet-4-5');
    const build = (env, t = sonnet) => inChild({ CLAUDE_PROJECT_DIR: root, ...env }, `return S.buildStatus({ session_id: 's1', cwd: ${JSON.stringify(root)}, transcript_path: ${JSON.stringify(t)} }, { entry: null });`);
    assert.strictEqual(build({ ALFRED_CODE_AUTO_COMPACT: '1' }).fullContext, 'compact');
    const off = build({ ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '0' });
    assert.strictEqual(off.fullContext, 'off');
    assert.strictEqual(off.resumeAt, null);
    assert.strictEqual(build({ ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0' }).fullContext, 'off', 'the session\'s own tier switched off');
    assert.strictEqual(build({}).fullContext, 'fresh-session');
    // mode commands v2: a v1 session switch file left behind is not read; the mode file's variable compacts every session
    const mine = path.join(root, '.alfred', 'state', 'sessions', 'AUTO-COMPACT-s1');
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, 'on\nat: 2026-11-12T00:00:00.000Z\n');
    assert.strictEqual(build({}).fullContext, 'fresh-session', 'a v1 session file is not read');
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_AUTO_COMPACT: '1' } }));
    assert.strictEqual(build({}).fullContext, 'compact', 'the mode file\'s variable');
});

// Auto-run offers no fresh session (guard-fresh-session-start's context line), so the file says compact while it is on,
// whatever the trigger; resumeAt, window and model stay the engine's.
const OFF4 = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '0' };
const sonnetSession = () =>
{
    const root = project();
    const p = { session_id: 's1', cwd: root, transcript_path: transcript(root, 'claude-sonnet-4-5') };
    return { root, p, P: JSON.stringify(p), FILE: JSON.stringify(statusOf(root, 's1')) };
};
test('T2b fullContext under auto-run', () =>
{
    const { root, P } = sonnetSession();
    const build = (env, fields, deps = 'undefined') => inChild({ CLAUDE_PROJECT_DIR: root, ...env }, `return S.buildStatus(${P}, ${JSON.stringify(fields)}, ${deps});`);
    const on = build({}, { entry: null, autoRun: true });
    const off = build({}, { entry: null, autoRun: false });
    assert.strictEqual(on.fullContext, 'compact');
    assert.strictEqual(off.fullContext, 'fresh-session');
    assert.ok(Number.isInteger(on.resumeAt) && on.resumeAt > 0);
    assert.deepStrictEqual([on.resumeAt, on.window, on.model], [off.resumeAt, off.window, off.model], 'the engine\'s numbers either way');
    const offOn = build(OFF4, { entry: null, autoRun: true });
    assert.deepStrictEqual([offOn.fullContext, offOn.resumeAt], ['compact', null], 'FRESH_OFF under auto-run');
    assert.strictEqual(build(OFF4, { entry: null, autoRun: false }).fullContext, 'off');
    for (const autoRun of [true, false]) assert.strictEqual(build({ ALFRED_CODE_AUTO_COMPACT: '1' }, { entry: null, autoRun }).fullContext, 'compact', `AUTO_COMPACT, autoRun ${autoRun}`);
    const derived = build({}, { entry: null }, '{ prelude: { autoRunFor: () => true } }');
    assert.deepStrictEqual([derived.autoRun, derived.fullContext], [true, 'compact'], 'the derived autoRun counts too');
});

// --- mode commands v2 stage 3, Task 7: the autoCompact field ----------------------------------------------------
const putMode = (root, obj) => { fs.mkdirSync(path.join(root, '.claude'), { recursive: true }); fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify(obj)); };
const SONNET = 'claude-sonnet-4-5';
test('FIELDS: autoCompact after scorer, schema still 1', () =>
{
    assert.strictEqual(S().FIELDS[S().FIELDS.indexOf('scorer') + 1], 'autoCompact');
});
test('autoCompact: on with the window, on with none, off, and null without the engine', () =>
{
    const field = (mode, deps = 'undefined') =>
    {
        const { root, P } = sonnetSession();
        if (mode) putMode(root, mode);
        return inChild({ CLAUDE_PROJECT_DIR: root }, `return S.buildStatus(${P}, { entry: null }, ${deps}).autoCompact;`);
    };
    assert.deepStrictEqual(field({ env: { ALFRED_CODE_AUTO_COMPACT: '1' }, modelSettings: { [SONNET]: { autoCompactWindow: 400000 } } }), { on: true, at: 400000 });
    assert.deepStrictEqual(field({ env: { ALFRED_CODE_AUTO_COMPACT: '1' } }), { on: true, at: null });
    assert.deepStrictEqual(field({ env: { ALFRED_CODE_AUTO_COMPACT: '0' }, modelSettings: { [SONNET]: { autoCompactWindow: 400000 } } }), { on: false, at: null });
    assert.strictEqual(field(null, '{ fresh: null }'), null);
    assert.strictEqual(S().buildStatus({ session_id: 's1', cwd: project() }, { entry: null, autoRun: true }, { env: {}, fresh: null, prelude: null, history: null }).autoCompact, null);
    const { root, P } = sonnetSession();
    const viaAutoRun = inChild({ CLAUDE_PROJECT_DIR: root }, `return S.buildStatus(${P}, { entry: null }, { prelude: { ...require(${JSON.stringify(path.join(HOOKS, 'hook-prelude.js'))}), compactCause: () => 'auto-run' } }).autoCompact;`);
    assert.strictEqual(viaAutoRun.on, true, 'auto-run is a cause');
});
test('an auto-compact-only change is written at the prompt, not a turn later', () =>
{
    const { root, P, FILE } = sonnetSession();
    const prompt = `S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: false, scoring: null })`;
    inChild({ CLAUDE_PROJECT_DIR: root }, `return S.writeStatus({ ...${P}, hook_event_name: 'SessionStart' }, {}, { when: 'always' });`);
    assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${prompt};`), 'unchanged');
    putMode(root, { env: { ALFRED_CODE_AUTO_COMPACT: '1' } });
    assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${prompt};`), 'written');
    assert.strictEqual(JSON.parse(fs.readFileSync(JSON.parse(FILE), 'utf8')).autoCompact.on, true);
    assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${prompt};`), 'unchanged');
});
test('an older file with no autoCompact key is rewritten once', () =>
{
    const { root, P, FILE } = sonnetSession();
    const prompt = `S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: false, scoring: null })`;
    inChild({ CLAUDE_PROJECT_DIR: root }, `return S.writeStatus({ ...${P}, hook_event_name: 'SessionStart' }, {}, { when: 'always' });`);
    const file = JSON.parse(FILE);
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete s.autoCompact;
    fs.writeFileSync(file, JSON.stringify(s));
    assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${prompt};`), 'written');
    assert.ok('autoCompact' in JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${prompt};`), 'unchanged');
});

test('modesLine: the ON line\'s words, in its order', () =>
{
    assert.strictEqual(S().modesLine({ autoRun: true, scorer: { on: true, level: 80, rounds: 3 }, autoCompact: { on: true, at: 400000 } }), 'Modes ON: auto-run, scoring (level 80), auto-compact (at 400k)');
    assert.strictEqual(S().modesLine({ autoRun: false, scorer: { on: false, level: 80, rounds: 3 }, autoCompact: { on: true, at: null } }), 'Modes ON: auto-compact');
    assert.strictEqual(S().modesLine({ autoRun: false, scorer: null, autoCompact: null }), '');
    assert.strictEqual(S().modesLine(null), '');
});

test('auto-run reads compact without the fresh engine', () =>
{
    const root = project();
    for (const [autoRun, want] of [[true, 'compact'], [false, 'off']])
    {
        const s = S().buildStatus({ session_id: 's1', cwd: root }, { entry: null, autoRun }, { env: {}, fresh: null, prelude: null, history: null });
        assert.strictEqual(s.fullContext, want, `autoRun ${autoRun}`);
        assert.deepStrictEqual([s.model, s.window, s.resumeAt], [null, null, null]);
    }
});

// Nobody at the terminal (hook-prelude.js unattended) is never offered a fresh session either - the gate leaves the
// pointer and the session compacts - though autoRunFor, which needs the session's own stamp, reads false there.
test('nobody at the terminal reads compact, autoRun false', () =>
{
    const handWritten = (root, tp) =>
    {
        const file = require(path.join(HOOKS, 'layout.js')).statePath(root, 'approvals', 'APPROVAL', {});
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'AUTO - the user is away\n');
        // the user TYPED the words the stamp quotes (audit 2026-10-30 HK-03, hook-prelude.js autoStampVerified)
        fs.appendFileSync(tp, JSON.stringify({ type: 'user', message: { role: 'user', content: 'the user is away' } }) + '\n');
    };
    for (const [label, env, setUp] of [['UNATTENDED', { ALFRED_CODE_UNATTENDED: '1' }], ['print mode', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }], ['a hand-written AUTO stamp', {}, handWritten]])
    {
        const { root, p, P } = sonnetSession();
        if (setUp) setUp(root, p.transcript_path);
        const build = (more) => inChild({ CLAUDE_PROJECT_DIR: root, ...env, ...more }, `return S.buildStatus(${P}, { entry: null });`);
        const s = build({});
        assert.deepStrictEqual([s.autoRun, s.fullContext], [false, 'compact'], label);
        assert.ok(Number.isInteger(s.resumeAt) && s.resumeAt > 0, `${label}: the engine's numbers stay`);
        assert.strictEqual(build(OFF4).fullContext, 'compact', `${label}: FRESH_OFF`);
        const bare = inChild({ CLAUDE_PROJECT_DIR: root, ...env }, `return S.buildStatus(${P}, { entry: null }, { fresh: null, history: null });`);
        assert.strictEqual(bare.fullContext, 'compact', `${label}: without the fresh engine`);
    }
    const { root, P } = sonnetSession();
    assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_ENTRYPOINT: 'cli' }, `return S.buildStatus(${P}, { entry: null });`).fullContext, 'fresh-session', 'a person at the terminal');
});

test('the prompt\'s auto-run flip rewrites fullContext', () =>
{
    for (const [env, offValue] of [[{}, 'fresh-session'], [OFF4, 'off']])
    {
        const { root, P, FILE } = sonnetSession();
        const got = inChild({ CLAUDE_PROJECT_DIR: root, ...env }, `const read = () => JSON.parse(require('fs').readFileSync(${FILE}, 'utf8'));
            const p = { ...${P}, hook_event_name: 'UserPromptSubmit' };
            const on = S.onPrompt(p, { autoRun: true, scoring: null }); const a = read();
            const off = S.onPrompt(p, { autoRun: false, scoring: null }); const b = read();
            return [on, a.autoRun, a.fullContext, off, b.autoRun, b.fullContext];`);
        assert.deepStrictEqual(got, ['written', true, 'compact', 'written', false, offValue]);
    }
});

test('a Stop keeps compact while the file says auto-run', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `const fs = require('fs');
        S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scoring: null });
        const bytes = fs.readFileSync(${FILE}, 'utf8');
        const r = [1, 2].map(() => S.onStop({ ...${P}, hook_event_name: 'Stop' }, null));
        return { r, same: fs.readFileSync(${FILE}, 'utf8') === bytes, s: JSON.parse(bytes) };`);
    assert.deepStrictEqual(got.r, ['unchanged', 'unchanged']);
    assert.ok(got.same, 'the bytes the prompt wrote');
    assert.strictEqual(got.s.fullContext, 'compact');
});

// Every fixture is a whole buildStatus object (readStatusFile takes nothing less), the named fields then set by hand.
const fixture = (FILE, P, fields, patch) => `const fs = require('fs');
    fs.mkdirSync(require('path').dirname(${FILE}), { recursive: true });
    fs.writeFileSync(${FILE}, JSON.stringify({ ...S.buildStatus(${P}, ${JSON.stringify(fields)}), ...${JSON.stringify(patch)} }));`;
test('a 3.3.0 file under auto-run is corrected at the next Stop', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `${fixture(FILE, P, { entry: null, autoRun: true, scorer: null }, { fullContext: 'fresh-session' })}
        const prompt = S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scoring: null });
        const stop = S.onStop({ ...${P}, hook_event_name: 'Stop' }, null);
        return { prompt, stop, s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
    // R116: the prompt no longer leaves an auto-run file reading anything but compact for a turn.
    assert.strictEqual(got.prompt, 'written', 'the prompt corrects it at once');
    assert.deepStrictEqual([got.stop, got.s.autoRun, got.s.fullContext], ['unchanged', true, 'compact']);
});

// buildStatus calls history.entryFor when the fields carry no entry and no handoffPrompt - after the Stop's first read
// and before its second, where a prompt landing mid-write shows up.
test('the second read\'s autoRun decides fullContext', () =>
{
    for (const [from, to, want] of [[false, true, 'compact'], [true, false, 'fresh-session']])
    {
        const { root, P, FILE } = sonnetSession();
        // R117: the rebuild carries the first build's handoffPrompt (entryFor read once) and the second read's scorer.
        const b = writePlan(root, 'b.md', '# B\n\nResume: task 4 - write the router\n');
        records(root, [{ session: 'r2', branch: 'feat/x', plan: b }]);
        const scorer = { on: true, level: 80, rounds: 2 };
        const got = inChild({ CLAUDE_PROJECT_DIR: root }, `${fixture(FILE, P, { entry: null, autoRun: from, scorer: { on: false, level: 70, rounds: 1 } }, { fullContext: from ? 'compact' : 'fresh-session', model: null })}
            let calls = 0;
            const entryFor = () => { calls++; fs.writeFileSync(${FILE}, JSON.stringify({ ...JSON.parse(fs.readFileSync(${FILE}, 'utf8')), autoRun: ${to}, scorer: ${JSON.stringify(scorer)} })); return { branch: 'feat/x' }; };
            const history = { ...require(${JSON.stringify(path.join(HOOKS, 'history.js'))}), entryFor };
            const r = S.writeStatus({ ...${P}, hook_event_name: 'Stop' }, {}, { when: 'changed', deps: { history } });
            return { r, calls, want: S.handoffPrompt(${JSON.stringify(root)}, 'feat/x', {}), s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
        assert.deepStrictEqual([got.r, got.s.autoRun, got.s.fullContext], ['written', to, want], `autoRun ${from} then ${to}`);
        assert.ok(got.want, 'the plan gives a handoff prompt');
        assert.strictEqual(got.s.handoffPrompt, got.want, 'the handoff prompt is carried into the rebuild');
        assert.deepStrictEqual(got.s.scorer, scorer, 'the second read\'s scorer');
        assert.strictEqual(got.calls, 1, 'entryFor is read once');
    }
});

// R116 (burn-down 2026-11-04): the prompt's early return compared autoRun and scorer only.
test('R116: a prompt over a file reading autoRun true and not compact rewrites it compact', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `${fixture(FILE, P, { entry: null, autoRun: true, scorer: null }, { fullContext: 'fresh-session' })}
        const r = S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scoring: null });
        return { r, s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
    assert.deepStrictEqual([got.r, got.s.fullContext], ['written', 'compact']);
});

// R137 (burn-down 2026-11-04): communication-reminder ran history-session's stand-down on every prompt, before the compare.
test('R137: the prompt\'s stand-down runs only when a write is due', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `let n = 0; const gate = () => { n++; return true; };
        const p = { ...${P}, hook_event_name: 'UserPromptSubmit' };
        const a = S.onPrompt(p, { autoRun: false, scoring: null }, gate); const na = n;
        const b = S.onPrompt(p, { autoRun: false, scoring: null }, gate); const nb = n;
        const c = S.onPrompt({ ...p, session_id: 's2' }, { autoRun: false, scoring: null }, () => false);
        return [a, na, b, nb, c, require('fs').existsSync(${FILE}.replace('s1.json', 's2.json'))];`);
    assert.deepStrictEqual(got, ['written', 1, 'unchanged', 1, 'skipped', false]);
});

// R118 (burn-down 2026-11-04): the prelude's answer went into the file as given.
test('R118: a truthy non-boolean autoRunFor reads true, a falsy one false', () =>
{
    const root = project();
    for (const [given, want] of [['yes', true], [1, true], [0, false], ['', false], [null, false]])
        assert.strictEqual(S().buildStatus({ session_id: 's1', cwd: root }, {}, { env: {}, prelude: { autoRunFor: () => given } }).autoRun, want, JSON.stringify(given));
});

// R135 (burn-down 2026-11-04): the prompt's write renamed over a handoffPrompt a Stop wrote after its read.
test('R135: a prompt\'s write keeps a handoffPrompt written between its read and its rename', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `${fixture(FILE, P, { entry: null, autoRun: false, scorer: null, handoffPrompt: 'Read OLD' }, {})}
        const fresh = { ...F, use(p) { fs.writeFileSync(${FILE}, JSON.stringify({ ...JSON.parse(fs.readFileSync(${FILE}, 'utf8')), handoffPrompt: 'Read NEW' })); return F.use(p); } };
        const r = S.writeStatus({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scorer: null }, { when: 'modes', deps: { fresh } });
        return { r, s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
    assert.deepStrictEqual([got.r, got.s.autoRun, got.s.handoffPrompt], ['written', true, 'Read NEW']);
});

// R136 (burn-down 2026-11-04): the Stop carried a hand-edited "false" string, which read as true.
test('R136: a hand-edited "false" autoRun and a string scorer read false and null at the next Stop', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `${fixture(FILE, P, { entry: null, autoRun: false, scorer: null }, { autoRun: 'false', scorer: 'on' })}
        const r = S.onStop({ ...${P}, hook_event_name: 'Stop' }, null);
        return { r, s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
    assert.deepStrictEqual([got.r, got.s.autoRun, got.s.scorer], ['written', false, null]);
    assert.notStrictEqual(got.s.fullContext, 'compact');
});

// R134 (burn-down 2026-11-04): the folder list was read with no regular-file test or size cap.
test('R134: the legacy folder list as a link to a FIFO, or a large file, reads as none - within a second', () =>
{
    const cases = [['a large file', (list) => fs.writeFileSync(list, JSON.stringify(Array.from({ length: 5000 }, (_, i) => `/x/${'y'.repeat(20)}${i}`)))]];
    if (process.platform !== 'win32') cases.push(['a link to a FIFO', (list) => { const fifo = path.join(path.dirname(list), 'pipe'); assert.strictEqual(spawnSync('mkfifo', [fifo]).status, 0); fs.symlinkSync(fifo, list); }]);
    for (const [why, make] of cases)
    {
        const root = project();
        const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
        fs.mkdirSync(path.dirname(list), { recursive: true });
        make(list);
        const p = JSON.stringify({ session_id: 's1', cwd: root, hook_event_name: 'SessionStart' });
        const code = `const S = require(${JSON.stringify(STATUS)}); const fs = require('fs');
            const r = S.writeStatus(${p}, { autoRun: false, scorer: null, handoffPrompt: null }, {});
            S.onSessionStart(${p}, null, {});
            const n = S.pruneStatus(${JSON.stringify(root)}, 's1', Date.now(), {});
            process.stdout.write(JSON.stringify({ r, n }));`;
        const t0 = Date.now();
        const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000, env: { ...scrubbed(process.env), HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: root } });
        assert.ok(!r.error, `${why}: ${r.error}`);
        assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
        assert.ok(Date.now() - t0 < 3000, `${why}: ${Date.now() - t0} ms`);
        const got = JSON.parse(r.stdout);
        assert.strictEqual(got.r, 'written', why);
        assert.strictEqual(fs.lstatSync(list).isSymbolicLink(), why !== 'a large file', `${why}: the list is left as it was`);
        assert.ok(fs.existsSync(newStatusOf(root, 's1')), `${why}: the file is written in the data root`);
    }
});

test('T3 model, window and resumeAt are the engine\'s', () =>
{
    const root = project();
    for (const model of ['claude-sonnet-4-5', 'claude-opus-5-5'])
    {
        const t = transcript(root, model, `${model}.jsonl`);
        const p = JSON.stringify({ session_id: 's1', cwd: root, transcript_path: t });
        const got = inChild({ CLAUDE_PROJECT_DIR: root }, `const b = S.buildStatus(${p}, { entry: null }); F.use(${p}); return { b, model: F.sessionModelId(), window: F.knownWindow(), at: F.ctxThreshold() };`);
        assert.strictEqual(got.b.model, model);
        assert.strictEqual(got.b.model, got.model);
        assert.strictEqual(got.b.window, got.window);
        assert.strictEqual(got.b.resumeAt, got.at);
        assert.ok(got.b.resumeAt < got.b.window, `${model}: resumeAt under the window`);
        if (model === 'claude-opus-5-5')
        {
            assert.strictEqual(got.b.window, 1000000);
            const off = inChild({ CLAUDE_PROJECT_DIR: root, ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0' }, `return S.buildStatus(${p}, { entry: null });`);
            assert.strictEqual(off.resumeAt, null);
        }
        else assert.strictEqual(got.b.window, 200000);
    }
});

test('no model row yet', () =>
{
    const root = project();
    const p = { session_id: 's1', cwd: root, hook_event_name: 'SessionStart' };
    const first = inChild({ CLAUDE_PROJECT_DIR: root }, `S.writeStatus(${JSON.stringify(p)}, { entry: null }, { when: 'always' }); return { at: F.ctxThreshold() };`);
    const s = readStatus(root, 's1');
    assert.strictEqual(s.model, null);
    assert.strictEqual(s.window, null);
    assert.strictEqual(s.resumeAt, first.at);
    assert.strictEqual(s.resumeAt, 180000, 'the default trigger with no variable (P2)');
    assert.strictEqual(s.fullContext, 'fresh-session');
    const t = transcript(root, 'claude-sonnet-4-5');
    const again = inChild({ CLAUDE_PROJECT_DIR: root }, `return S.writeStatus(${JSON.stringify({ ...p, transcript_path: t, hook_event_name: 'Stop' })}, { entry: null }, { when: 'changed' });`);
    assert.strictEqual(again, 'written');
    assert.strictEqual(readStatus(root, 's1').model, 'claude-sonnet-4-5');
});

test('T6 handoffPrompt', () =>
{
    const root = project();
    const b = writePlan(root, 'b.md', '# B\n\nResume: task 4 - write the router\n');
    records(root, [{ session: 'r2', branch: 'feat/x', plan: b }]);
    const env = {};
    assert.strictEqual(S().handoffPrompt(root, 'feat/x', { env }),
        'Read .alfred/docs/work/plans/b.md, check that branch feat/x is checked out, and continue from its Resume: line (task 4 - write the router).');
    assert.strictEqual(S().buildStatus({ session_id: 's9', cwd: root }, { entry: { branch: 'feat/x' } }, { env }).handoffPrompt,
        S().handoffPrompt(root, 'feat/x', { env }), 'the entry\'s branch');
    for (const branch of ['HEAD', '']) assert.strictEqual(S().handoffPrompt(root, branch, { env }), null, `branch '${branch}'`);
    assert.strictEqual(S().handoffPrompt(root, 'feat/x', { env: { ALFRED_CODE_HISTORY: '0' } }), null, 'history off');
    const none = project();
    records(none, [{ session: 'r1', branch: 'feat/x' }]);
    assert.strictEqual(S().handoffPrompt(none, 'feat/x', { env }), null, 'no plan');
    const done = project();
    records(done, [{ session: 'r1', branch: 'feat/x', plan: writePlan(done, 'd.md', 'Completed: 2026-10-29\nResume: x\n') }]);
    assert.strictEqual(S().handoffPrompt(done, 'feat/x', { env }), null, 'every plan completed');
    const long = project();
    records(long, [{ session: 'r1', branch: 'feat/x', plan: writePlan(long, 'l.md', `Resume: ${'r'.repeat(2000)}\n`) }]);
    assert.ok(S().handoffPrompt(long, 'feat/x', { env }).length <= 1000);
    const sentence = (branch) => `Read ${b}, check that branch ${branch} is checked out, and continue from its Resume: line (task 4 - write the router).`;
    const fixed = sentence('').length;
    for (const [target, want] of [[999, 999], [1000, 1000], [1001, 1000]])
    {
        const edge = project();
        const branch = `f/${'x'.repeat(target - fixed - 2)}`;
        records(edge, [{ session: 'r1', branch, plan: writePlan(edge, 'b.md', '# B\n\nResume: task 4 - write the router\n') }]);
        assert.strictEqual(sentence(branch).length, target);
        assert.strictEqual(S().handoffPrompt(edge, branch, { env }).length, want, `a ${target}-character sentence`);
    }
});

// A subfolder base an older release left behind: a status file in it and its entry in the project's folder list.
function legacyStray(root, sub, id)
{
    const file = legacyStatusOf(sub, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}');
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    let held = [];
    try { held = JSON.parse(fs.readFileSync(list, 'utf8')); } catch { /* no list yet */ }
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, JSON.stringify([...held, sub.split(path.sep).join('/')]));
    return file;
}

test('baseOf is the project root: a subfolder cwd never makes a base (the root decides)', () =>
{
    assert.strictEqual(S().baseOf({ cwd: '/r/sub' }, { CLAUDE_PROJECT_DIR: '/r' }), '/r');
    assert.strictEqual(S().baseOf({ cwd: '/r/sub' }, {}), '/r/sub', 'no project dir: the cwd stands in');
    assert.strictEqual(S().baseOf({}, { CLAUDE_PROJECT_DIR: '/r' }), '/r');
    assert.strictEqual(S().baseOf(null, {}), null);
});

test('T9 ids and payloads', () =>
{
    const root = project();
    const env = { CLAUDE_CONFIG_DIR: ACCOUNT };
    const write = (p) => S().writeStatus({ cwd: root, hook_event_name: 'Stop', ...p }, { entry: null }, { when: 'always', deps: { env } });
    assert.strictEqual(write({ session_id: 'a'.repeat(128) }), 'written');
    assert.strictEqual(write({ session_id: 'a'.repeat(129) }), 'skipped');
    assert.ok(!fs.existsSync(statusOf(root, 'a'.repeat(129))));
    for (const id of ['a/b', '..', 'a.b']) assert.strictEqual(write({ session_id: id }), 'skipped', id);
    assert.strictEqual(write({ session_id: 's1', agent_id: 'x' }), 'skipped', 'a seat writes nothing');
    assert.strictEqual(S().writeStatus({ session_id: 's1', hook_event_name: 'Stop' }, {}, { when: 'always', deps: { env } }), 'skipped', 'no cwd, no project dir');
    const elsewhere = project();
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: elsewhere }, {}, { when: 'always', deps: { env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT } } }), 'written', 'a cwd outside the project writes at the root');
    assert.ok(fs.existsSync(statusOf(root, 's1')), 'the root holds the file');
    assert.ok(!fs.existsSync(path.join(elsewhere, '.claude')), 'no folder made outside the project');
});

test('the legacy sweep leaves a listed base whose .claude links out of the project alone (A8)', () =>
{
    const root = project();
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    const outside = project();
    link(outside, path.join(sub, '.claude'));
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: sub }, {}, { when: 'always', deps: { env } }), 'written', 'the write goes to the root\'s data root');
    assert.ok(!fs.existsSync(path.join(outside, 'session-inspector')), 'nothing written through the link');
    const old = path.join(outside, 'session-inspector', 'status', 'aaaaaaaa.json');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, '{}');
    age(old, 8 * dayMs);
    fs.mkdirSync(path.dirname(listOf(root)), { recursive: true });
    fs.writeFileSync(listOf(root), JSON.stringify([sub.split(path.sep).join('/')]));
    assert.strictEqual(removeStatus(root, { env }, { rootMinAgeMs: SWEEP_MS }).files, 0);
    assert.ok(fs.existsSync(old), 'nothing swept through the link');
});

test('a control character in the base\'s path writes no exclude line', { skip: process.platform === 'win32' && 'no newline in a Windows file name' }, () =>
{
    const { execFileSync } = require('node:child_process');
    const gitEnv = { ...scrubbed(process.env), HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ACCOUNT, 'gitconfig') };
    fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
    const root = project();
    execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnv, stdio: 'pipe' });
    const odd = path.join(root, 'x\n*\n#');
    fs.mkdirSync(odd);
    const exclude = path.join(root, '.git', 'info', 'exclude');
    const before = fs.readFileSync(exclude, 'utf8');
    // the deadline pinned, as every other call here: a loaded runner past 8 s of uptime would read 'late' (2026-11-19)
    assert.deepStrictEqual(S().ensureExcluded([odd], { env: {}, uptime: () => 0 }), ['skipped']);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), before, 'no line, so no `*` pattern');
    const env = { CLAUDE_PROJECT_DIR: odd, CLAUDE_CONFIG_DIR: ACCOUNT };
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: odd }, {}, { when: 'always', deps: { env } }), 'skipped', 'and no file the exclude cannot cover');
    assert.ok(!fs.existsSync(path.join(odd, '.claude')));
});

test('a vanished project root writes nothing', () =>
{
    const root = project();
    const gone = path.join(root, 'gone');
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: gone }, {}, { when: 'always', deps: { env: { CLAUDE_PROJECT_DIR: gone, CLAUDE_CONFIG_DIR: ACCOUNT } } }), 'skipped');
    assert.ok(!fs.existsSync(gone));
});

test('the legacy sweep ignores garbage folder-list entries and a base outside the project', () =>
{
    const root = project();
    const sub = path.join(root, 'sub');
    const elsewhere = path.join(TMP, `elsewhere-${seq++}`);
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    const posix = (p) => p.split(path.sep).join('/');
    fs.writeFileSync(list, JSON.stringify([42, 'rel/x', `${posix(root)}/../${path.basename(elsewhere)}`, posix(sub)]));
    const a = legacyStatusOf(sub, 'bbbbbbbb');
    const c = legacyStatusOf(elsewhere, 'cccccccc');
    for (const f of [a, c]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}'); age(f, 8 * dayMs); }
    assert.strictEqual(removeStatus(root, { env: {} }, { rootMinAgeMs: SWEEP_MS }).files, 1);
    assert.ok(!fs.existsSync(a), 'the sub file is gone');
    assert.ok(fs.existsSync(c), 'the elsewhere file stays');
    assert.ok(!fs.existsSync(list), 'the emptied list is removed');
});

test('the prune\'s 7-day edge', () =>
{
    const root = project();
    const now = Math.floor(Date.now() / 1000) * 1000;
    const { PRUNE_MS } = S();
    const files = [['aaaaaaaa', now - PRUNE_MS + 60000], ['bbbbbbbb', now - PRUNE_MS], ['cccccccc', now - PRUNE_MS - 60000]].map(([id, at]) =>
    {
        const f = statusOf(root, id);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '{}');
        fs.utimesSync(f, at / 1000, at / 1000);
        return f;
    });
    assert.strictEqual(S().pruneStatus(root, 's1', now, { env: {} }), 1);
    assert.deepStrictEqual(files.map((f) => fs.existsSync(f)), [true, true, false], 'one under kept, at kept, one over removed');
});

test('T11 probe rows and cost', (t) =>
{
    const root = project();
    const rows = () => fs.readFileSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', 's1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, { entry: null }, { when: 'always', deps: { env: { CLAUDE_CONFIG_DIR: ACCOUNT } } }), 'written');
    const [ok] = rows();
    assert.deepStrictEqual([ok.mode, ok.kind, ok.result, ok.event, ok.hook, typeof ok.ms], ['probe', 'status-write', 'ok', 'SessionStart', 'session-status.js', 'number']);
    const bad = project();
    fs.mkdirSync(path.join(bad, '.alfred', 'state', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(bad, '.alfred', 'state', 'sessions', 'status'), 'a file');
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: bad, hook_event_name: 'Stop' }, { entry: null }, { when: 'always', deps: { env: { CLAUDE_CONFIG_DIR: ACCOUNT } } }), 'skipped');
    const failed = fs.readFileSync(path.join(bad, '.alfred', 'statistics', 'hook-blocks', 's1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(failed[0].result, 'failed');
    assert.deepStrictEqual(fs.readdirSync(path.join(bad, '.alfred', 'state', 'sessions')), ['status'], 'no tmp left');
    const ticks = [0, 250];
    const clock = () => (ticks.length ? ticks.shift() : 250);
    S().writeStatus({ session_id: 's1', cwd: root, hook_event_name: 'Stop' }, { entry: null, autoRun: true }, { when: 'always', deps: { env: { CLAUDE_CONFIG_DIR: ACCOUNT }, clock } });
    assert.strictEqual(rows().pop().result, 'slow');
    // the worst case: 200 records, a 1MB plan, a 9MB transcript whose only model row is its first line
    const worst = project();
    const plan = writePlan(worst, 'big.md', 'Resume: task 1 - big\n');
    fs.appendFileSync(path.join(worst, plan), 'x'.repeat(1024 * 1024 - fs.statSync(path.join(worst, plan)).size));
    records(worst, Array.from({ length: 200 }, (_, i) => ({ session: `w${i}`, branch: i < 10 ? 'feat/x' : 'other', plan })));
    const big = transcript(worst, 'claude-sonnet-4-5', 'big.jsonl');
    fs.appendFileSync(big, `${JSON.stringify({ type: 'user', message: { content: 'y'.repeat(9 * 1024 * 1024) } })}\n`);
    const start = Date.now();
    S().buildStatus({ session_id: 's1', cwd: worst, transcript_path: big }, { entry: { branch: 'feat/x' } }, { env: {} });
    const ms = Date.now() - start;
    t.diagnostic(`worst-case build: ${ms}ms`);
    assert.ok(ms < 5000, `${ms}ms`);
});

test('the stray check watches the temp dir\'s status folder', () =>
{
    assert.ok(strayRoots().includes(path.join(os.tmpdir(), '.claude', 'session-inspector')));
});

test('one spawn per common dir, none past the deadline', () =>
{
    const { execFileSync } = require('node:child_process');
    const gitEnv = { ...scrubbed(process.env), HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ACCOUNT, 'gitconfig') };
    fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
    const g = (cwd, ...a) => execFileSync('git', a, { cwd, env: gitEnv, stdio: 'pipe' });
    const root = project();
    g(root, 'init', '-q', '-b', 'main');
    g(root, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '--allow-empty', '-m', 'start');
    const wts = [1, 2].map((n) => { const wt = `${root}-wt${n}`; g(root, 'worktree', 'add', '-q', '-b', `w${n}`, wt); return wt; });
    try
    {
        const exclude = path.join(root, '.git', 'info', 'exclude');
        const before = fs.readFileSync(exclude, 'utf8');
        let spawns = 0;
        const late = S().ensureExcluded([root, ...wts], { env: {}, uptime: () => 9000, exec: (cmd, argv, opts) => { spawns++; return execFileSync(cmd, argv, { ...opts, timeout: SLOW_HOST_GIT_TIMEOUT_MS }); } });
        assert.deepStrictEqual(late, ['late', 'late', 'late']);
        assert.strictEqual(spawns, 0, 'no spawn past the deadline');
        assert.strictEqual(fs.readFileSync(exclude, 'utf8'), before, 'the exclude file untouched');
        const got = S().ensureExcluded([root, ...wts], { env: {}, uptime: () => 0, exec: (cmd, argv, opts) => { spawns++; return execFileSync(cmd, argv, { ...opts, timeout: SLOW_HOST_GIT_TIMEOUT_MS }); } });
        assert.deepStrictEqual(got, ['added', 'present', 'present']);
        assert.strictEqual(spawns, 1, 'one spawn for the main checkout and its two worktrees');
        const text = fs.readFileSync(exclude, 'utf8');
        assert.strictEqual(text.split('\n').filter((l) => l === '/.claude/session-inspector/status/').length, 1, 'the line lands once');
        // a SessionStart through the hook writes no line
        fs.writeFileSync(exclude, before);
        const r = spawnSync(process.execPath, [path.join(HOOKS, 'history-session.js')], {
            input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', source: 'startup', cwd: root }), encoding: 'utf8',
            env: { ...gitEnv, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT }, cwd: root,
        });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(fs.readFileSync(exclude, 'utf8'), before, 'the hook adds no line: the file is in the data root');
        assert.ok(fs.existsSync(newStatusOf(root, 's1')), 'and writes the file there');
    }
    finally { for (const wt of wts) { try { g(root, 'worktree', 'remove', '--force', wt); } catch { /* gone */ } fs.rmSync(wt, { recursive: true, force: true }); } }
});

// Audit 2026-11-03 SYS-03: uninstall takes back what this module wrote - the status files and their emptied folders under
// the project root and each listed base, and the exclude lines it added for them - and nothing else: a file
// session-inspector keeps beside status/, a file no status write names, the user's own exclude lines, a pair another
// project in the same repository added, a linked status folder.
test('removeStatus takes back the status files and the exclude lines this project added, and nothing else', () =>
{
    const { execFileSync } = require('node:child_process');
    const gitEnv = { ...scrubbed(process.env), HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ACCOUNT, 'gitconfig') };
    fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
    const top = project();
    execFileSync('git', ['init', '-q'], { cwd: top, env: gitEnv, stdio: 'pipe' });
    const root = path.join(top, 'app');
    const sub = path.join(root, 'sub');
    const other = path.join(top, 'other');
    for (const d of [sub, other]) fs.mkdirSync(d, { recursive: true });
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    const exclude = path.join(top, '.git', 'info', 'exclude');
    // the line the user typed for root is there before any session: nothing is added for root, so it stays theirs
    fs.writeFileSync(exclude, '# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n/app/.claude/session-inspector/status/\n');
    // uptime pinned: the exclude check has an 8 s deadline on the PROCESS's age, and on a slow runner this test starts past
    // it, so every check read 'late' (the Windows VM gate on 547ede2c)
    const fast = () => 0;
    // an older release's files in the root and in a stray sub; nothing the hooks write now lands there
    legacyStray(root, root, 's1');
    legacyStray(root, sub, 's1');
    // the check adds the stray sub's pair and the other project's (root's line is the user's own)
    assert.deepStrictEqual(S().ensureExcluded([root, sub, other], { env: {}, uptime: fast }), ['present', 'added', 'added']);
    // another project's pair is one in use: its status folder is there (E-batch SYS-03 sweeps a pair whose folder is gone)
    fs.mkdirSync(path.join(other, '.claude', 'session-inspector', 'status'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector', 'HANDOFF.md'), '# handoff\n');
    fs.mkdirSync(path.join(root, '.claude', 'session-inspector', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector', 'status', 'notes.txt'), 'mine\n');
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector', 'status', 's2.json.123.tmp'), '{');
    const before = fs.readFileSync(exclude, 'utf8');
    const got = removeStatus(root, { env });
    assert.strictEqual(got.files, 3, 'two status files and a crashed write\'s tmp');
    assert.ok(!fs.existsSync(legacyStatusOf(root, 's1')) && !fs.existsSync(legacyStatusOf(sub, 's1')));
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'session-inspector', 'status', 'notes.txt'), 'utf8'), 'mine\n', 'a file no status write names stays');
    assert.ok(fs.existsSync(path.join(root, '.claude', 'session-inspector', 'HANDOFF.md')), 'session-inspector\'s own files stay');
    assert.ok(!fs.existsSync(path.join(sub, '.claude')), 'a base\'s emptied folders go, up to and with its .claude');
    const after = fs.readFileSync(exclude, 'utf8');
    assert.strictEqual(got.lines, 1, 'the one pair this project added');
    assert.strictEqual(before.replace(`${S().EXCLUDE_COMMENT}\n/app/sub/.claude/session-inspector/status/\n`, ''), after, 'only that pair left the file');
    assert.ok(after.includes('*.log\n/app/.claude/session-inspector/status/\n'), 'the user\'s own lines stay');
    assert.ok(after.includes(`${S().EXCLUDE_COMMENT}\n/other/.claude/session-inspector/status/\n`), 'another project\'s pair stays');
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json')), 'the list of bases goes with them');
    // a re-run changes nothing
    assert.deepStrictEqual(removeStatus(root, { env }), { files: 0, folders: [], lines: 0 });
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), after);
    // nothing there, no git, a garbage list, no root: no throw, nothing done
    const bare = project();
    const list = path.join(bare, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, '{ not json');
    assert.deepStrictEqual(removeStatus(bare, { env: { CLAUDE_PROJECT_DIR: bare } }), { files: 0, folders: [], lines: 0 });
    assert.deepStrictEqual(removeStatus('', {}), { files: 0, folders: [], lines: 0 });
    assert.deepStrictEqual(removeStatus('relative/path', {}), { files: 0, folders: [], lines: 0 });
    // a linked status folder is never followed
    const linked = project();
    const outside = project();
    fs.writeFileSync(path.join(outside, 'aaaa.json'), '{}');
    fs.mkdirSync(path.join(linked, '.claude', 'session-inspector'), { recursive: true });
    link(outside, path.join(linked, '.claude', 'session-inspector', 'status'));
    assert.strictEqual(removeStatus(linked, { env: { CLAUDE_PROJECT_DIR: linked } }).files, 0);
    assert.ok(fs.existsSync(path.join(outside, 'aaaa.json')), 'nothing removed through the link');
});

// The fixed root (3.11.0): an uninstall over a folder an update has not moved yet names it; a hook never does.
test('fixed root: removeStatus reads the list under the dataRoot it is handed', () =>
{
    const { execFileSync } = require('node:child_process');
    const gitEnv = { ...scrubbed(process.env), HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ACCOUNT, 'gitconfig') };
    fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
    const root = project();
    execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnv, stdio: 'pipe' });
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    legacyStray(root, root, 's1');
    legacyStray(root, sub, 's1');
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    const moved = path.join(root, 'var', 'data', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(list, moved);
    assert.strictEqual(removeStatus(root, { env, dataRoot: 'var/data' }).files, 2);
    assert.ok(!fs.existsSync(legacyStatusOf(sub, 's1')), 'the base the list names is swept');
    assert.ok(!fs.existsSync(moved), 'the list goes with them');
});


// E-batch SYS-03 (the stated ceiling it closes: a pair for a base the list dropped stayed): uninstall also sweeps every
// stack pair - the comment with an anchored line right under it - whose status folder exists in none of the repository's
// work trees; a pair still in use anywhere, a lone line of the user's and the root-form pair are left as they were.
function sweepRepo()
{
    const { execFileSync } = require('node:child_process');
    const gitEnv = { ...scrubbed(process.env), HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ACCOUNT, 'gitconfig') };
    fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
    const top = fs.realpathSync(project());
    const git = (...a) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: top, env: gitEnv, stdio: 'pipe' });
    git('init', '-q');
    fs.writeFileSync(path.join(top, 'seed.txt'), 'seed\n');
    git('add', 'seed.txt'); git('commit', '-qm', 'seed');
    const wt = path.join(fs.realpathSync(project()), 'wt');
    git('worktree', 'add', '-q', '-b', 'side', wt);
    const exclude = path.join(top, '.git', 'info', 'exclude');
    const pair = (rel) => `${S().EXCLUDE_COMMENT}\n/${rel}/.claude/session-inspector/status/\n`;
    const folder = (at, rel) => fs.mkdirSync(path.join(at, rel, '.claude', 'session-inspector', 'status'), { recursive: true });
    return { top, wt, exclude, pair, folder, git };
}
test('SYS-03: an unlisted pair whose folder is gone in every worktree is removed', () =>
{
    const { top, wt, exclude, pair, folder } = sweepRepo();
    const user = '# my own lines\n*.log\nbuild/\n';
    folder(wt, 'b');
    folder(top, 'c');
    fs.writeFileSync(exclude, user + pair('a') + pair('b') + pair('c') + '# trailing note of mine\n');
    // a was listed once and dropped: the list now names none of the three
    const list = path.join(top, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, JSON.stringify([]));
    const got = removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } });
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), user + pair('b') + pair('c') + '# trailing note of mine\n', 'a\'s pair goes whole, b and c stay, every user line byte-equal');
    assert.strictEqual(got.lines, 1);
    // a re-run changes nothing
    assert.strictEqual(removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }).lines, 0);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), user + pair('b') + pair('c') + '# trailing note of mine\n');
    // CRLF rows keep their endings
    fs.writeFileSync(exclude, (user + pair('a') + pair('c')).replace(/\n/g, '\r\n'));
    removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } });
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), (user + pair('c')).replace(/\n/g, '\r\n'));
});
test('SYS-03: a lone anchored line with no comment above it is not the stack\'s', () =>
{
    const { top, exclude, pair } = sweepRepo();
    const text = '/d/.claude/session-inspector/status/\n' + '# unrelated comment\n/e/.claude/session-inspector/status/\n' + pair('f').split('\n')[0] + '\n\n/g/.claude/session-inspector/status/\n';
    fs.writeFileSync(exclude, text);
    assert.strictEqual(removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }).lines, 0);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), text, 'a lone line, one under another comment, and a comment with a blank row under it all stay');
});
test('SYS-03: the root pair is removed only as today', () =>
{
    const { top, exclude, pair } = sweepRepo();
    const app = path.join(top, 'app');
    fs.mkdirSync(app, { recursive: true });
    const rootForm = `${S().EXCLUDE_COMMENT}\n/.claude/session-inspector/status/\n`;
    // uninstalling app: its own pair goes through the listed path, the top's root-form pair is never swept
    fs.writeFileSync(exclude, rootForm + pair('app'));
    assert.strictEqual(removeStatus(app, { env: { CLAUDE_PROJECT_DIR: app } }).lines, 1);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), rootForm);
    // uninstalling the top: its own root-form pair goes, as it always did
    assert.strictEqual(removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }).lines, 1);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), '');
});
test('SYS-03: no worktree listing, no sweep', () =>
{
    const { top, exclude, pair } = sweepRepo();
    fs.writeFileSync(exclude, pair('a'));
    const fail = (cmd, argv, opts) => { if (argv.includes('worktree')) throw new Error('timed out'); return require('node:child_process').execFileSync(cmd, argv, opts); };
    assert.strictEqual(removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top }, exec: fail }).lines, 0);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), pair('a'), 'today\'s behaviour: the unlisted pair stays');
});

const planStatus = require(path.join(HOOKS, 'plan-status.js'));
const planDir = (root, id = 'csv') => { const dir = path.join(root, PLANS, id); fs.mkdirSync(dir, { recursive: true }); return dir; };
const putStatus = (dir, change = () => {}) => { const s = planStatus.emptyStatus('CSV export', '2026-11-13T10:00Z'); change(s); fs.writeFileSync(path.join(dir, 'status.json'), `${JSON.stringify(s, null, 2)}\n`); };

test('planField: the folder relative to the root, forward slashes, one trailing slash - or null', () =>
{
    const root = project();
    const dir = planDir(root);
    const F = S().planField;
    for (const given of [`${PLANS}/csv/`, `${PLANS}/csv`, `${PLANS}/csv`.replace(/\//g, '\\'), `${PLANS}/csv/`.replace(/\//g, '\\'), dir]) assert.strictEqual(F(root, given), `${PLANS}/csv/`, given);
    assert.strictEqual(F(root, planDir(path.join(root, 'apps', 'api'))), `apps/api/${PLANS}/csv/`, 'a workspace member below the root');
    fs.writeFileSync(path.join(dir, 'status.json'), '{');
    assert.strictEqual(F(root, dir), `${PLANS}/csv/`, 'kept beside garbage');
    putStatus(dir);
    assert.strictEqual(F(root, dir), `${PLANS}/csv/`, 'an open plan');
    putStatus(dir, (s) => { s.completedAt = '2026-11-13T12:00Z'; });
    assert.strictEqual(F(root, dir), null, 'completed');
    fs.mkdirSync(path.join(root, 'src'));
    const outside = planDir(project());
    for (const none of [outside, `../${path.basename(path.dirname(outside))}/${PLANS}/csv/`, `${PLANS}/gone/`, 'src', `${PLANS}/`, '', null, 7, {}]) assert.strictEqual(F(root, none), null, String(none));
    assert.strictEqual(F(null, dir), null);
});

test('a 3.11.0 file with no plan key is upgraded in place, once: at a prompt and at a Stop, autoRun and scorer kept', () =>
{
    for (const event of ['prompt', 'stop'])
    {
        const { root, P, FILE } = sonnetSession();
        const file = JSON.parse(FILE);
        // the Stop case carries modes that are on, so a lost carry shows; the prompt case starts as the autoCompact case above does
        const fields = event === 'stop' ? { autoRun: true, scorer: { on: true, level: 90, rounds: 3 } } : {};
        inChild({ CLAUDE_PROJECT_DIR: root }, `return S.writeStatus({ ...${P}, hook_event_name: 'SessionStart' }, ${JSON.stringify(fields)}, { when: 'always' });`);
        const old = JSON.parse(fs.readFileSync(file, 'utf8'));
        delete old.plan;                                                  // the eleven keys 3.11.0 wrote
        fs.writeFileSync(file, `${JSON.stringify(old, null, 2)}\n`);
        const write = event === 'stop' ? `S.writeStatus({ ...${P}, hook_event_name: 'Stop' }, {}, { when: 'changed' })`
            : `S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: false, scoring: null })`;
        assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${write};`), 'written', event);
        const now = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual([Object.keys(now), now.plan, now.autoRun, now.scorer], [[...S().FIELDS], null, old.autoRun, old.scorer], event);
        if (event === 'stop') assert.deepStrictEqual([now.autoRun, now.scorer], [true, fields.scorer]);
        assert.strictEqual(inChild({ CLAUDE_PROJECT_DIR: root }, `return ${write};`), 'unchanged', event);
        assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)], 'no second file');
    }
});

test('plan: set through the fields, carried by every later write, null once the plan is completed or its folder is gone', () =>
{
    const { root, P, FILE } = sonnetSession();
    const file = JSON.parse(FILE);
    const dir = planDir(root);
    const now = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    const start = (fields) => inChild(env, `return S.writeStatus({ ...${P}, hook_event_name: 'SessionStart' }, ${JSON.stringify(fields)}, { when: 'always' });`);
    const stop = () => inChild(env, `return S.writeStatus({ ...${P}, hook_event_name: 'Stop' }, {}, { when: 'changed' });`);
    start({ plan: dir });
    assert.deepStrictEqual([now().plan, Object.keys(now()).pop()], [`${PLANS}/csv/`, 'plan']);
    assert.strictEqual(stop(), 'unchanged', 'a Stop carries it');
    start({});
    assert.strictEqual(now().plan, `${PLANS}/csv/`, 'a SessionStart carries it');
    putMode(root, { env: { ALFRED_CODE_AUTO_COMPACT: '1' } });
    assert.strictEqual(inChild(env, `return S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: false, scoring: null });`), 'written');
    assert.strictEqual(now().plan, `${PLANS}/csv/`, 'a prompt write carries it');
    putStatus(dir, (s) => { s.completedAt = '2026-11-13T12:00Z'; });
    assert.deepStrictEqual([stop(), now().plan], ['written', null], 'the close\'s own Stop');
    assert.strictEqual(stop(), 'unchanged');
    const next = planDir(root, 'next');
    start({ plan: next });
    assert.strictEqual(now().plan, `${PLANS}/next/`);
    fs.rmSync(next, { recursive: true });
    assert.deepStrictEqual([stop(), now().plan], ['written', null], 'the folder is gone');
});

// ---- PF1 plan 2: onPlan (R28, R29), the Stop fallback (R30), the handoff text by shape (R26) ----
test('onPlan: sets the key, compares first, carries the modes, and says nothing for a seat', () =>
{
    const { root, P, FILE } = sonnetSession();
    const file = JSON.parse(FILE);
    const now = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    const dir = planDir(root);
    const call = (folder, extra = '') => inChild(env, `return S.onPlan({ ...${P}, hook_event_name: 'PreToolUse'${extra} }, ${JSON.stringify(folder)}, () => true);`);
    inChild(env, `return S.writeStatus({ ...${P}, hook_event_name: 'SessionStart' }, { autoRun: true, scorer: { on: true, level: 90, rounds: 3 } }, { when: 'always' });`);
    const before = now();
    assert.strictEqual(call(dir), 'written');
    assert.deepStrictEqual([now().plan, now().autoRun, now().scorer, now().handoffPrompt], [`${PLANS}/csv/`, true, before.scorer, before.handoffPrompt]);
    const mtime = fs.statSync(file).mtimeMs;
    assert.strictEqual(call(dir), 'unchanged', 'the same plan again');
    assert.strictEqual(call(`${PLANS}/csv`), 'unchanged', 'the same folder, relative and with no trailing slash');
    assert.strictEqual(fs.statSync(file).mtimeMs, mtime, 'an unchanged call does not touch the file');
    assert.strictEqual(call(dir, ", agent_id: 'a1'"), 'skipped', 'a seat sets nothing');
    assert.strictEqual(inChild(env, `return S.onPlan({ ...${P}, hook_event_name: 'PreToolUse' }, ${JSON.stringify(planDir(root, 'next'))}, () => false);`), 'skipped', 'the gate says no');
    for (const not of [null, '', 7]) assert.strictEqual(inChild(env, `return S.onPlan({ ...${P}, hook_event_name: 'PreToolUse' }, ${JSON.stringify(not)}, () => true);`), 'skipped', String(not));
    assert.strictEqual(now().plan, `${PLANS}/csv/`);
});

test('onPlan: a second plan\'s call moves the key; a plan outside the root nulls it (R29)', () =>
{
    const { root, P, FILE } = sonnetSession();
    const now = () => JSON.parse(fs.readFileSync(JSON.parse(FILE), 'utf8'));
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    const call = (folder) => inChild(env, `return S.onPlan({ ...${P}, hook_event_name: 'PreToolUse' }, ${JSON.stringify(folder)}, () => true);`);
    call(planDir(root));
    call(planDir(root, 'next'));
    assert.strictEqual(now().plan, `${PLANS}/next/`);
    putStatus(planDir(root), (s) => { s.completedAt = '2026-11-13T12:00Z'; });
    inChild(env, `return S.writeStatus({ ...${P}, hook_event_name: 'Stop' }, {}, { when: 'changed' });`);
    assert.strictEqual(now().plan, `${PLANS}/next/`, 'the first plan\'s close leaves the second');
    assert.strictEqual(call(planDir(project())), 'written');
    assert.strictEqual(now().plan, null);
});

test('onPlan: a mistyped --plan (no such folder) leaves the session\'s plan as it is (PF1 final review, finding 3)', () =>
{
    const { root, P, FILE } = sonnetSession();
    const now = () => JSON.parse(fs.readFileSync(JSON.parse(FILE), 'utf8'));
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    const call = (folder) => inChild(env, `return S.onPlan({ ...${P}, hook_event_name: 'PreToolUse' }, ${JSON.stringify(folder)}, () => true);`);
    assert.strictEqual(call(planDir(root)), 'written');
    for (const typo of [`${PLANS}/cvs`, path.join(root, PLANS, 'cvs'), `${PLANS}/csv/nope`]) {
        assert.strictEqual(call(typo), 'unchanged', typo);
        assert.strictEqual(now().plan, `${PLANS}/csv/`, `${typo} keeps the plan`);
    }
    putStatus(planDir(root), (s) => { s.completedAt = '2026-11-13T12:00Z'; });
    assert.deepStrictEqual([call(planDir(root)), now().plan], ['written', null], 'a completed plan that exists still nulls it');
});

test('the Stop fallback: with no plan in the file, the history record\'s folder plan is taken (R30)', () =>
{
    const { root, P, FILE } = sonnetSession();
    const now = () => JSON.parse(fs.readFileSync(JSON.parse(FILE), 'utf8'));
    const env = { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT };
    planDir(root);
    fs.writeFileSync(path.join(root, PLANS, 'csv', 'csv.md'), '# Feature - plan\n');
    const stop = (entry) => inChild(env, `return S.writeStatus({ ...${P}, hook_event_name: 'Stop' }, { entry: ${JSON.stringify(entry)} }, { when: 'changed' });`);
    stop({ branch: 'main', plan: `${PLANS}/old.md` });
    assert.strictEqual(now().plan, null, 'a flat plan sets nothing');
    stop({ branch: 'main', plan: '~/elsewhere/plans/csv/csv.md' });
    assert.strictEqual(now().plan, null, 'a plan under the home folder sets nothing');
    stop({ branch: 'main', plan: `${PLANS}/csv/csv.md` });
    assert.strictEqual(now().plan, `${PLANS}/csv/`);
});

test('handoffPrompt: the resume call for a folder plan, the Read line for a flat one (R26)', () =>
{
    const history = (open) => ({ openPlan: () => open, historyCount: () => 5 });
    const text = (open) => S().handoffPrompt('/r', 'feature/x', { history: history(open), env: {} });
    assert.strictEqual(text({ plan: `${PLANS}/csv/csv.md`, resume: 'next task 2', dir: `${PLANS}/csv/` }),
        `Run node .claude/hooks/plan-status.js resume --plan ${PLANS}/csv/, check that branch feature/x is checked out, and continue from its Resume: line (next task 2).`);
    assert.strictEqual(text({ plan: `${PLANS}/old.md`, resume: 'next task 2' }),
        `Read ${PLANS}/old.md, check that branch feature/x is checked out, and continue from its Resume: line (next task 2).`);
});

test('a plan call landing between a prompt\'s two reads is kept', () =>
{
    const { root, P, FILE } = sonnetSession();
    planDir(root);
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `${fixture(FILE, P, { entry: null, autoRun: false, scorer: null, handoffPrompt: null }, {})}
        const fresh = { ...F, use(p) { fs.writeFileSync(${FILE}, JSON.stringify({ ...JSON.parse(fs.readFileSync(${FILE}, 'utf8')), plan: '${PLANS}/csv/' })); return F.use(p); } };
        const r = S.writeStatus({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scorer: null }, { when: 'modes', deps: { fresh } });
        return { r, s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
    assert.deepStrictEqual([got.r, got.s.autoRun, got.s.plan], ['written', true, `${PLANS}/csv/`]);
});

// --- the reader gate (status-file-root design, Part 2) -----------------------------------------------------------
// readerOn: the file is written only while alfred-mods or session-inspector is enabled in the merged enabledPlugins;
// nothing overrides it.
const LAYOUT = require(path.join(HOOKS, 'layout.js'));
let gateSeq = 0;
const enabled = (key = 'alfred-mods@market', value = true) => ({ enabledPlugins: { [key]: value } });
function gateSetup()
{
    const n = gateSeq++;
    const root = project();
    const account = path.join(TMP, `gate-account-${n}`);
    const managed = path.join(TMP, `gate-managed-${n}`, 'managed-settings.json');
    const put = (file, data) =>
    {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
    };
    fs.mkdirSync(account, { recursive: true });
    const layout = { ...LAYOUT, managedSettingsFile: () => managed };
    return {
        root, account, managed, layout,
        user: (data) => put(path.join(account, 'settings.json'), data),
        project: (data) => put(path.join(root, '.claude', 'settings.json'), data),
        local: (data) => put(path.join(root, '.claude', 'settings.local.json'), data),
        managedFile: (data) => put(managed, data),
        dropIn: (name, data) => put(path.join(path.dirname(managed), 'managed-settings.d', name), data),
        on: (env = {}, at = root) => S().readerOn(at, { CLAUDE_CONFIG_DIR: account, ...env }, { layout }),
    };
}

test('readerOn: each layer alone opens the gate', () =>
{
    for (const layer of ['user', 'project', 'local', 'managedFile'])
    {
        const g = gateSetup();
        assert.strictEqual(g.on(), false, `${layer}: nothing yet`);
        g[layer](enabled());
        assert.strictEqual(g.on(), true, layer);
    }
});

test('readerOn: a drop-in opens it, and a dot file does not', () =>
{
    const g = gateSetup();
    g.dropIn('.hidden.json', enabled());
    assert.strictEqual(g.on(), false, 'a dot file adds nothing');
    g.dropIn('10-mods.json', enabled());
    assert.strictEqual(g.on(), true);
});

test('readerOn: a later layer wins per key - local false over user true, managed true over local false', () =>
{
    const g = gateSetup();
    g.user(enabled());
    g.local(enabled('alfred-mods@market', false));
    assert.strictEqual(g.on(), false, 'local false over user true');
    g.managedFile(enabled());
    assert.strictEqual(g.on(), true, 'managed true over local false');
    g.dropIn('90-off.json', enabled('alfred-mods@market', false));
    assert.strictEqual(g.on(), false, 'a drop-in is merged after the managed file');
});

test('readerOn: the two plugin names match under any marketplace, nothing else does', () =>
{
    for (const key of ['session-inspector@x', 'alfred-mods@any-market', 'alfred-mods@'])
    {
        const g = gateSetup();
        g.user(enabled(key));
        assert.strictEqual(g.on(), true, key);
    }
    for (const key of ['other@x', 'alfred-mods', 'my-alfred-mods@x', 'alfred-mods-extra@x'])
    {
        const g = gateSetup();
        g.user(enabled(key));
        assert.strictEqual(g.on(), false, key);
    }
    const g = gateSetup();
    g.user({ enabledPlugins: { 'alfred-mods@market': 'true' } });
    assert.strictEqual(g.on(), false, 'only the boolean true counts');
});

test('readerOn: a file that is garbage, or whose enabledPlugins is no plain object, adds nothing', () =>
{
    const g = gateSetup();
    g.user('{ not json');
    g.project(enabled());
    assert.strictEqual(g.on(), true, 'garbage in the user file, the mod in the project');
    const h = gateSetup();
    h.user(enabled());
    h.project({ enabledPlugins: [] });
    assert.strictEqual(h.on(), true, 'an array in the project does not mask the user layer');
    h.local({ enabledPlugins: 'alfred-mods@market' });
    h.managedFile('[1]');
    assert.strictEqual(h.on(), true, 'a string, a top-level array');
    const none = gateSetup();
    none.user('{ not json');
    none.project('');
    none.local('null');
    assert.strictEqual(none.on(), false, 'garbage everywhere');
});

test('readerOn: no files is off, a mod set false is off, and session-inspector enabled is on', () =>
{
    const g = gateSetup();
    assert.strictEqual(g.on(), false, 'no files');
    g.user(enabled('alfred-mods@market', false));
    assert.strictEqual(g.on(), false, 'a mod set false');
    g.user(enabled('session-inspector@x', true));
    assert.strictEqual(g.on(), true, 'session-inspector@x: true');
    g.user(enabled('alfred-mods@market', true));
    assert.strictEqual(g.on(), true, 'alfred-mods enabled');
});

test('readerOn: the account is CLAUDE_CONFIG_DIR, never HOME, and a throw reads as off', () =>
{
    const g = gateSetup();
    g.user(enabled());
    assert.strictEqual(S().readerOn(g.root, { CLAUDE_CONFIG_DIR: path.join(TMP, 'another-account') }, { layout: g.layout }), false, 'another account holds no mod');
    assert.strictEqual(S().readerOn(g.root, { CLAUDE_CONFIG_DIR: g.account }, { layout: { ...g.layout, modeFile: () => { throw new Error('boom'); } } }), false, 'a throw');
    assert.strictEqual(S().readerOn(null, { CLAUDE_CONFIG_DIR: g.account }, { layout: g.layout }), false, 'no root');
    assert.strictEqual(S().readerOn(g.root, { CLAUDE_CONFIG_DIR: g.account }, { layout: null }), false, 'no layout engine');
});

// The local file is the one Claude Code reads for the start folder (`layout.localSettingsFile`): the main checkout's on
// macOS and Linux, the start folder's own on Windows (R171), so each platform is asserted on its own rule.
test('readerOn: a linked worktree start sees the local file Claude Code reads there - the main checkout\'s, on Windows its own', () =>
{
    const g = gateSetup();
    const main = project();
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    const tree = project();
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
    assert.strictEqual(g.on({}, tree), false, 'not enabled yet');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', 'settings.local.json'), JSON.stringify(enabled()));
    fs.mkdirSync(path.join(tree, 'sub'));
    if (process.platform === 'win32')
    {
        assert.strictEqual(g.on({}, tree), false, 'Windows: the main checkout\'s local file is not read');
        fs.mkdirSync(path.join(tree, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(tree, '.claude', 'settings.local.json'), JSON.stringify(enabled()));
        assert.strictEqual(g.on({}, tree), true, 'Windows: the worktree\'s own local file');
        return;
    }
    assert.strictEqual(g.on({}, tree), true, 'the main checkout\'s local file');
    assert.strictEqual(g.on({}, path.join(tree, 'sub')), true, 'and from a subfolder of the worktree');
});

test('readerOn: the median of 50 calls on a project holding all four files', (t) =>
{
    const g = gateSetup();
    g.user({ enabledPlugins: { 'other@x': true } });
    g.project({ enabledPlugins: { 'other@y': true } });
    g.local({ enabledPlugins: { 'other@z': true } });
    g.managedFile(enabled());
    assert.strictEqual(g.on(), true, 'warm');
    const spent = [];
    for (let i = 0; i < 50; i++)
    {
        const from = process.hrtime.bigint();
        g.on();
        spent.push(Number(process.hrtime.bigint() - from) / 1e6);
    }
    spent.sort((a, b) => a - b);
    const median = spent[25];
    t.diagnostic(`readerOn median over 50 calls: ${median.toFixed(3)} ms (max ${spent[49].toFixed(3)} ms)`);
    assert.ok(median < 25, `${median} ms`);
});

// the gate's wiring, in a child like the field cases: a hook's own entry points, the real process env
const GATE_ENV = (g) => ({ CLAUDE_PROJECT_DIR: g.root, CLAUDE_CONFIG_DIR: g.account });
const GATE_PATCH = (g) => `require(${JSON.stringify(path.join(HOOKS, 'layout.js'))}).managedSettingsFile = () => ${JSON.stringify(g.managed)};`;
const gateRows = (root, id) =>
{
    try { return fs.readFileSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', `${id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); }
    catch { return []; }
};

test('the gate off: a start makes no status folder and leaves one status-gate row; a Stop and a prompt leave none', () =>
{
    const g = gateSetup();
    const payload = (event) => JSON.stringify({ session_id: 'gate-off', cwd: g.root, hook_event_name: event, source: 'startup' });
    inChild(GATE_ENV(g), `${GATE_PATCH(g)}
        S.onSessionStart(${payload('SessionStart')}, null);
        S.onStop(${payload('Stop')}, null);
        S.onPrompt(${payload('UserPromptSubmit')}, { autoRun: false, scoring: null });
        S.onPlan(${payload('PreToolUse')}, 'plans/x/');
        return null;`);
    assert.ok(!fs.existsSync(path.join(g.root, '.claude', 'session-inspector')), 'no folder');
    const rows = gateRows(g.root, 'gate-off');
    assert.strictEqual(rows.filter((r) => r.kind === 'status-gate').length, 1, 'one row per session');
    const [row] = rows;
    assert.deepStrictEqual([row.mode, row.kind, row.result, row.event, row.hook, typeof row.ms], ['probe', 'status-gate', 'off', 'SessionStart', 'session-status.js', 'number']);
    assert.strictEqual(rows.length, 1, 'nothing else was written');
});

test('the gate on: the file is written, the status-write row carries a numeric gateMs and no status-gate row is left', () =>
{
    const g = gateSetup();
    g.user(enabled());
    const start = JSON.stringify({ session_id: 'gate-on', cwd: g.root, hook_event_name: 'SessionStart', source: 'startup' });
    inChild(GATE_ENV(g), `${GATE_PATCH(g)} S.onSessionStart(${start}, null); return null;`);
    assert.strictEqual(readStatus(g.root, 'gate-on').session, 'gate-on');
    const rows = gateRows(g.root, 'gate-on');
    const write = rows.find((r) => r.kind === 'status-write');
    assert.strictEqual(write.result, 'ok');
    assert.strictEqual(typeof write.gateMs, 'number');
    assert.ok(write.gateMs >= 0);
    assert.ok(!rows.some((r) => r.kind === 'status-gate'));
});

test('the gate re-reads at each write moment: enabling the mod mid-session writes the file at the next Stop (A6)', () =>
{
    const g = gateSetup();
    const payload = (event) => JSON.stringify({ session_id: 'gate-mid', cwd: g.root, hook_event_name: event, source: 'startup' });
    inChild(GATE_ENV(g), `${GATE_PATCH(g)} S.onSessionStart(${payload('SessionStart')}, null); return null;`);
    assert.ok(!fs.existsSync(statusOf(g.root, 'gate-mid')));
    g.user(enabled());
    inChild(GATE_ENV(g), `${GATE_PATCH(g)} return S.onStop(${payload('Stop')}, null);`);
    assert.strictEqual(readStatus(g.root, 'gate-mid').session, 'gate-mid');
});

// The sweep (status-file-root design, Part 3): onSessionStart takes the status files earlier versions left in subfolders.
// A git repository root with a status file in it, in `a` and in `a/b` (each a minute old), the stack's exclude pair for all
// three beside a user line, a file of session-inspector's and one of the user's under `a/.claude`, and the list of bases.
const SWEEP_MS = 25 * 3600 * 1000;
const ROOT_FORM = '/.claude/session-inspector/status/';
const sweepGit = () =>
{
    const gitEnv = { ...scrubbed(process.env), HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ACCOUNT, 'gitconfig') };
    fs.writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
    return (cwd, ...a) => require('node:child_process').execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, env: gitEnv, stdio: 'pipe' });
};
const stackPair = (rel) => `${S().EXCLUDE_COMMENT}\n${rel ? `/${rel}` : ''}${ROOT_FORM}\n`;
const posixOf = (p) => p.split(path.sep).join('/');
function sweepProject()
{
    const git = sweepGit();
    const root = project();
    git(root, 'init', '-q');
    const a = path.join(root, 'a');
    const ab = path.join(a, 'b');
    fs.mkdirSync(ab, { recursive: true });
    const files = {};
    for (const [name, base] of [['root', root], ['a', a], ['ab', ab]])
    {
        files[name] = legacyStatusOf(base, `s-${name}`);
        fs.mkdirSync(path.dirname(files[name]), { recursive: true });
        fs.writeFileSync(files[name], '{}');
        age(files[name], 60000);
    }
    const handoff = path.join(a, '.claude', 'session-inspector', 'HANDOFF.md');
    const notes = path.join(a, '.claude', 'notes.md');
    fs.writeFileSync(handoff, '# handoff\n');
    fs.writeFileSync(notes, 'mine\n');
    const exclude = path.join(root, '.git', 'info', 'exclude');
    fs.writeFileSync(exclude, `/mine/\n${stackPair('')}${stackPair('a')}${stackPair('a/b')}`);
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, JSON.stringify([root, a, ab].map(posixOf)));
    return { root, a, ab, files, handoff, notes, exclude, list, git, held: () => JSON.parse(fs.readFileSync(list, 'utf8')) };
}
// `gate` 'on' hands the hook the account that enables alfred-mods, 'off' one that holds no settings at all
const BARE_ACCOUNT = path.join(TMP, 'account-bare');
fs.mkdirSync(BARE_ACCOUNT, { recursive: true });
const sweepEnv = (root, gate) => ({ CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: gate === 'on' ? ACCOUNT : BARE_ACCOUNT });
const startAt = (f, gate, extra = {}) => S().onSessionStart({ session_id: 'sweeper', cwd: f.root, hook_event_name: 'SessionStart', source: 'startup' }, null,
    { env: sweepEnv(f.root, gate), uptime: () => 0, ...extra });
const sweepRows = (root) => gateRows(root, 'sweeper').filter((r) => r.kind === 'status-sweep');

test('the sweep, reader on: the subfolders lose their files and pairs at any age, the root keeps its own', () =>
{
    const f = sweepProject();
    startAt(f, 'on');
    assert.ok(!fs.existsSync(f.files.a) && !fs.existsSync(f.files.ab), 'a and a/b hold no status file');
    assert.ok(fs.existsSync(f.handoff) && fs.existsSync(f.notes), 'session-inspector\'s file and the user\'s stay');
    assert.ok(!fs.existsSync(path.join(f.ab, '.claude')), 'the emptied folders go, a subfolder\'s .claude too');
    assert.ok(fs.existsSync(f.files.root), 'the root\'s file stays');
    assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the root\'s pair and the user\'s line stay, the subfolders\' pairs go');
    assert.deepStrictEqual(f.held(), [posixOf(f.root)]);
    const rows = sweepRows(f.root);
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].files, rows[0].lines, rows[0].bases, typeof rows[0].ms], [2, 2, 1, 'number']);
});

test('the sweep, reader off: the root\'s file goes once 25 hours old and the list with it, a fresh one stays with its pair', () =>
{
    const old = sweepProject();
    age(old.files.root, 26 * 3600 * 1000);
    startAt(old, 'off');
    assert.ok(!fs.existsSync(old.files.root) && !fs.existsSync(old.files.a) && !fs.existsSync(old.files.ab));
    assert.strictEqual(fs.readFileSync(old.exclude, 'utf8'), '/mine/\n', 'every stack pair goes, the user\'s line stays');
    assert.ok(!fs.existsSync(old.list), 'the list is removed');
    assert.ok(fs.existsSync(path.join(old.root, '.claude')), 'the root\'s own .claude stays');
    const fresh = sweepProject();
    startAt(fresh, 'off');
    assert.ok(fs.existsSync(fresh.files.root), 'a root file under 25 hours old stays');
    assert.ok(!fs.existsSync(fresh.files.a) && !fs.existsSync(fresh.files.ab));
    assert.strictEqual(fs.readFileSync(fresh.exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the kept file keeps its pair');
    assert.deepStrictEqual(fresh.held(), [posixOf(fresh.root)]);
});

test('the sweep: the root\'s age bound is 25 hours, kept below it, removed at it and above', () =>
{
    const root = project();
    const file = legacyStatusOf(root, 's-edge');
    const now = Math.floor(Date.now() / 1000) * 1000;
    const hour = 3600 * 1000;
    for (const [ms, kept] of [[24 * hour + 59 * 60000, true], [25 * hour, false], [25 * hour + 60000, false]])
    {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{}');
        fs.utimesSync(file, (now - ms) / 1000, (now - ms) / 1000);
        removeStatus(root, { env: { CLAUDE_PROJECT_DIR: root }, clock: () => now, uptime: () => 0 }, { rootMinAgeMs: SWEEP_MS });
        assert.strictEqual(fs.existsSync(file), kept, `${ms / 60000} minutes old`);
    }
});

test('the sweep: the exclude deadline is the strict > of ensureExcluded, and a group not reached stays listed', () =>
{
    const { execFileSync } = require('node:child_process');
    for (const [uptime, spawns] of [[7999, true], [8000, true], [8001, false]])
    {
        const f = sweepProject();
        let count = 0;
        const exec = (...a) => { count++; return execFileSync(...a); };
        removeStatus(f.root, { env: { CLAUDE_PROJECT_DIR: f.root }, uptime: () => uptime, exec }, { except: f.root, rootMinAgeMs: SWEEP_MS });
        assert.strictEqual(count > 0, spawns, `uptime ${uptime}`);
        assert.ok(!fs.existsSync(f.files.a), 'the files go whatever the clock says');
        if (spawns) assert.deepStrictEqual(f.held(), [posixOf(f.root)]);
        else
        {
            assert.deepStrictEqual(f.held(), [f.root, f.a, f.ab].map(posixOf), 'the bases not reached stay listed');
            assert.ok(fs.readFileSync(f.exclude, 'utf8').includes(stackPair('a/b')), 'and keep their pairs for the next start');
        }
    }
});

test('the sweep: a list that is a symbolic link is neither read nor replaced', { skip: process.platform === 'win32' && 'a file link needs a privilege' }, () =>
{
    const f = sweepProject();
    const target = path.join(TMP, `list-target-${seq++}.json`);
    fs.renameSync(f.list, target);
    fs.symlinkSync(target, f.list);
    const before = fs.readFileSync(target, 'utf8');
    // the session's file exists already, so the writer appends no base and leaves the list alone: only the sweep is judged
    S().onSessionStart({ session_id: 's-root', cwd: f.root, hook_event_name: 'SessionStart', source: 'startup' }, null, { env: sweepEnv(f.root, 'on'), uptime: () => 0 });
    assert.ok(fs.existsSync(f.files.a) && fs.existsSync(f.files.ab), 'nothing swept through it');
    removeStatus(f.root, { env: { CLAUDE_PROJECT_DIR: f.root }, uptime: () => 0 }, { rootMinAgeMs: SWEEP_MS });
    assert.ok(fs.lstatSync(f.list).isSymbolicLink(), 'the link stays a link');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), before, 'its target is untouched');
});

// A linked worktree of `top`, a commit behind it, its status folder holding one file of the given age.
function sweepWorktree(top, git, ageMs)
{
    git(top, 'commit', '-q', '--allow-empty', '-m', 'start');
    const wt = `${top}-wt`;
    git(top, 'worktree', 'add', '-q', '-b', 'side', wt);
    const file = legacyStatusOf(wt, 's-wt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}');
    age(file, ageMs);
    return { wt, file, drop: () => { try { git(top, 'worktree', 'remove', '--force', wt); } catch { /* gone */ } fs.rmSync(wt, { recursive: true, force: true }); } };
}

test('the sweep, Windows forms: bases are compared through layout.dirKey, so a spelling that maps to the root\'s key is the root', () =>
{
    const f = sweepProject();
    const winKey = (p) => path.win32.normalize(String(p)).replace(/\//g, '\\').toLowerCase();
    const layout = { ...LAYOUT, dirKey: winKey };
    const alias = f.root.toUpperCase();
    assert.notStrictEqual(alias, f.root);
    assert.strictEqual(winKey(alias), winKey(f.root));
    const deps = { env: { CLAUDE_PROJECT_DIR: f.root }, uptime: () => 0, layout };
    const side = sweepWorktree(f.root, f.git, 26 * 3600 * 1000);
    try
    {
        // only `except` can keep this file: it is far past 25 hours, and the alias is a different string from the root
        age(f.files.root, 26 * 3600 * 1000);
        fs.writeFileSync(f.list, JSON.stringify([alias, posixOf(side.wt)]));
        removeStatus(f.root, deps, { except: alias, rootMinAgeMs: SWEEP_MS });
        assert.ok(fs.existsSync(f.files.root), 'the except base is compared by key, so it is the root');
        assert.ok(!fs.existsSync(side.file), 'a sibling worktree past 25 hours is still swept');
        assert.ok(fs.readFileSync(f.exclude, 'utf8').includes(stackPair('')), 'the root keeps its pair');
        // the alias listed beside a young root file is one base: the list holds it once, spelled as the root
        age(f.files.root, 60000);
        fs.writeFileSync(f.list, JSON.stringify([alias]));
        removeStatus(f.root, deps, { rootMinAgeMs: SWEEP_MS });
        assert.ok(fs.existsSync(f.files.root));
        assert.deepStrictEqual(f.held(), [posixOf(f.root)], 'no second entry for the same folder');
    }
    finally { side.drop(); }
});

test('the sweep: no except, a young root file keeps its pair, while the subfolders\' pairs go', () =>
{
    const f = sweepProject();
    removeStatus(f.root, { env: { CLAUDE_PROJECT_DIR: f.root } }, { rootMinAgeMs: SWEEP_MS });
    assert.ok(fs.existsSync(f.files.root), 'the young root file stays');
    assert.ok(!fs.existsSync(f.files.a) && !fs.existsSync(f.files.ab));
    assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the pair of a base still holding a file is never dropped');
    assert.deepStrictEqual(f.held(), [posixOf(f.root)]);
});

test('the sweep: a young linked worktree file keeps the root-form line it shares with a root that holds none', () =>
{
    const git = sweepGit();
    const top = project();
    git(top, 'init', '-q', '-b', 'main');
    const side = sweepWorktree(top, git, 60000);
    try
    {
        const exclude = path.join(top, '.git', 'info', 'exclude');
        fs.writeFileSync(exclude, `/mine/\n${stackPair('')}`);
        const mine = legacyStatusOf(top, 's-main');
        fs.mkdirSync(path.dirname(mine), { recursive: true });
        fs.writeFileSync(mine, '{}');
        age(mine, 26 * 3600 * 1000);
        const list = path.join(top, '.alfred', 'state', 'sessions', 'status-folders.json');
        fs.mkdirSync(path.dirname(list), { recursive: true });
        fs.writeFileSync(list, JSON.stringify([top, side.wt].map(posixOf)));
        removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }, { rootMinAgeMs: SWEEP_MS });
        assert.ok(!fs.existsSync(mine), 'the root\'s old file goes');
        assert.ok(fs.existsSync(side.file), 'the worktree\'s young file stays');
        assert.strictEqual(fs.readFileSync(exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the shared root-form line stays for it');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(list, 'utf8')), [posixOf(side.wt)]);
    }
    finally { side.drop(); }
});

test('the sweep: with an except folder that does not exist yet, the root-form line is still never dropped', () =>
{
    const git = sweepGit();
    const top = project();
    git(top, 'init', '-q', '-b', 'main');
    const side = sweepWorktree(top, git, 26 * 3600 * 1000);
    try
    {
        const exclude = path.join(top, '.git', 'info', 'exclude');
        fs.writeFileSync(exclude, `/mine/\n${stackPair('')}`);
        const list = path.join(top, '.alfred', 'state', 'sessions', 'status-folders.json');
        fs.mkdirSync(path.dirname(list), { recursive: true });
        fs.writeFileSync(list, JSON.stringify([posixOf(side.wt)]));
        removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }, { except: top, rootMinAgeMs: SWEEP_MS });
        assert.ok(!fs.existsSync(side.file), 'the worktree\'s old file is swept');
        assert.strictEqual(fs.readFileSync(exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the root-form line is the except root\'s whatever the worktree held');
    }
    finally { side.drop(); }
});

// The main checkout holds an old legacy file and no list; an unlisted linked worktree holds one of the given age; the
// stack's root-form pair sits in the shared exclude beside a line of the user's.
function unlistedWorktreeSweep(worktreeFileAgeMs)
{
    const git = sweepGit();
    const top = project();
    git(top, 'init', '-q', '-b', 'main');
    const side = sweepWorktree(top, git, worktreeFileAgeMs);
    const exclude = path.join(top, '.git', 'info', 'exclude');
    fs.writeFileSync(exclude, `/mine/\n${stackPair('')}`);
    const mine = legacyStatusOf(top, 's-main');
    const leaveOldFile = () => { fs.mkdirSync(path.dirname(mine), { recursive: true }); fs.writeFileSync(mine, '{}'); age(mine, 26 * 3600 * 1000); };
    leaveOldFile();
    return { top, side, exclude, mine, leaveOldFile, start: () => startAt({ root: top }, 'on') };
}

test('the sweep keeps the root-form pair while an unlisted linked worktree holds a young legacy file', () =>
{
    const f = unlistedWorktreeSweep(60000);
    try
    {
        f.start();
        assert.ok(!fs.existsSync(f.mine), 'the main checkout\'s old file goes');
        assert.ok(fs.existsSync(f.side.file), 'the worktree\'s young file stays');
        assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the shared root-form pair stays for it');
    }
    finally { f.side.drop(); }
});

test('the next sweep drops the root-form pair once no worktree holds a legacy file', () =>
{
    const f = unlistedWorktreeSweep(60000);
    try
    {
        f.start();
        assert.ok(fs.readFileSync(f.exclude, 'utf8').includes(stackPair('')), 'kept while the worktree holds its file');
        fs.rmSync(f.side.file);
        f.leaveOldFile();
        f.start();
        assert.ok(!fs.existsSync(f.mine));
        assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), '/mine/\n', 'the pair is gone, the user\'s line stays');
    }
    finally { f.side.drop(); }
});

test('uninstall past the exclude deadline keeps the list and the pairs it could not reach, and says how many bases were not reached', () =>
{
    const { execFileSync } = require('node:child_process');
    const f = sweepProject();
    let spawns = 0;
    const exec = (...a) => { spawns++; return execFileSync(...a); };
    const late = removeStatus(f.root, { env: { CLAUDE_PROJECT_DIR: f.root }, uptime: () => 9000, exec });
    assert.strictEqual(spawns, 0, 'no git spawn past the deadline');
    assert.ok(late.late > 0, 'the count of bases not reached is returned');
    assert.strictEqual(late.files, 3, 'the files went all the same');
    assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), `/mine/\n${stackPair('')}${stackPair('a')}${stackPair('a/b')}`, 'every pair stays for the next run');
    assert.deepStrictEqual(f.held(), [f.root, f.a, f.ab].map(posixOf), 'the list that names their bases stays');
    const again = removeStatus(f.root, { env: { CLAUDE_PROJECT_DIR: f.root }, uptime: () => 0 });
    assert.strictEqual(again.late, undefined, 'a run in time reaches them');
    assert.strictEqual(again.lines, 3);
    assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), '/mine/\n');
    assert.ok(!fs.existsSync(f.list), 'and takes the list');
});

test('uninstall with nothing to drop is never late: a fresh repository, no status folder, past the deadline, writes no list and counts no base', () =>
{
    const git = sweepGit();
    const root = project();
    git(root, 'init', '-q');
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    const out = removeStatus(root, { env: { CLAUDE_PROJECT_DIR: root }, uptime: () => 9000 });
    assert.strictEqual(out.late, undefined, 'no base counted late');
    assert.ok(!fs.existsSync(list), 'no list written');
});

test('uninstall: a worktree list cut by the deadline marks its group late and keeps the list', () =>
{
    const { execFileSync } = require('node:child_process');
    const f = sweepProject();
    let calls = 0;
    const out = removeStatus(f.root, { env: { CLAUDE_PROJECT_DIR: f.root }, uptime: () => (++calls <= 1 ? 0 : 9000), exec: (cmd, argv, opts) => execFileSync(cmd, argv, { ...opts, timeout: SLOW_HOST_GIT_TIMEOUT_MS }) });
    assert.ok(out.late > 0, `late: ${JSON.stringify(out)}`);
    assert.ok(fs.existsSync(f.list), 'the list stays for the next run');
    assert.deepStrictEqual(f.held().sort(), [f.root, f.a, f.ab].map(posixOf).sort(), 'every base stays on it');
});

test('the sweep: a listed linked worktree owns its young file (the root\'s 25 hour rule), and the root-form exclude line is never dropped while the root is except', () =>
{
    const git = sweepGit();
    const top = project();
    git(top, 'init', '-q', '-b', 'main');
    git(top, 'commit', '-q', '--allow-empty', '-m', 'start');
    const wt = `${top}-wt`;
    git(top, 'worktree', 'add', '-q', '-b', 'side', wt);
    try
    {
        const mine = legacyStatusOf(top, 's-main');
        const theirs = legacyStatusOf(wt, 's-wt');
        for (const f of [mine, theirs]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}'); age(f, 60000); }
        const exclude = path.join(top, '.git', 'info', 'exclude');
        fs.writeFileSync(exclude, `/mine/\n${stackPair('')}`);
        const list = path.join(top, '.alfred', 'state', 'sessions', 'status-folders.json');
        fs.mkdirSync(path.dirname(list), { recursive: true });
        fs.writeFileSync(list, JSON.stringify([top, wt].map(posixOf)));
        const sweep = () => removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top }, uptime: () => 0 }, { except: top, rootMinAgeMs: SWEEP_MS });
        sweep();
        assert.ok(fs.existsSync(theirs), 'a minute old: a new-version session started in the worktree owns it');
        assert.ok(fs.existsSync(mine));
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(list, 'utf8')), [top, wt].map(posixOf));
        age(theirs, 26 * 3600 * 1000);
        sweep();
        assert.ok(!fs.existsSync(theirs), 'past 25 hours it goes');
        assert.ok(fs.existsSync(mine), 'the except base is untouched');
        assert.ok(fs.readFileSync(exclude, 'utf8').includes(stackPair('')), 'the root-form line the worktree shares stays');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(list, 'utf8')), [posixOf(top)]);
    }
    finally { try { git(top, 'worktree', 'remove', '--force', wt); } catch { /* gone */ } fs.rmSync(wt, { recursive: true, force: true }); }
});

// The status file in the data root (the later-items design, Parts 1 and 3): <root>/.alfred/state/sessions/status/<id>.json,
// no folder list entry and no exclude line for it - the data root's own .gitignore keeps it out of git. The old folder, the
// list and the old pairs belong to the legacy sweep alone.
const DATA_PARTS = ['.alfred', 'state', 'sessions', 'status'];
const newStatusOf = (root, id) => path.join(root, ...DATA_PARTS, `${id}.json`);
const listOf = (root) => path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
const startPayload = (root, id = 's1', extra = {}) => ({ session_id: id, cwd: root, hook_event_name: 'SessionStart', source: 'startup', ...extra });
const execSpy = () => { const calls = []; return { calls, exec: (...a) => { calls.push(a); return ''; } }; };

test('the status file is written under the data root', () =>
{
    const root = project();
    const spy = execSpy();
    const env = { CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: root };
    assert.strictEqual(S().writeStatus(startPayload(root), { entry: null }, { when: 'always', deps: { env, exec: spy.exec } }), 'written');
    assert.ok(fs.existsSync(newStatusOf(root, 's1')), 'the file is in the data root');
    assert.strictEqual(JSON.parse(fs.readFileSync(newStatusOf(root, 's1'), 'utf8')).session, 's1');
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'session-inspector')), 'no old folder');
    assert.ok(!fs.existsSync(listOf(root)), 'no folder list');
    S().onSessionStart(startPayload(root, 's2'), null, { env, exec: spy.exec, uptime: () => 0 });
    assert.ok(fs.existsSync(newStatusOf(root, 's2')));
    assert.ok(!fs.existsSync(listOf(root)) && !fs.existsSync(path.join(root, '.claude', 'session-inspector')), 'a start leaves none either');
    assert.deepStrictEqual(spy.calls, [], 'no git call');
});

test('an absolute ALFRED_CODE_DATA_PATH is the data root', () =>
{
    const root = project();
    const data = path.join(TMP, `data-${seq++}`);
    fs.mkdirSync(data, { recursive: true });
    const env = { CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DATA_PATH: data };
    assert.strictEqual(S().writeStatus(startPayload(root), { entry: null }, { when: 'always', deps: { env } }), 'written');
    assert.ok(fs.existsSync(path.join(data, 'state', 'sessions', 'status', 's1.json')));
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'state', 'sessions', 'status')), 'nothing under the project\'s own .alfred');
    assert.strictEqual(S().statusFolder(root, { env }), path.join(data, 'state', 'sessions', 'status'));
});

test('a linked status folder refuses the write and the prune; a link inside the root is followed', () =>
{
    const env = (root) => ({ CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: root });
    DATA_PARTS.forEach((segment, index) =>
    {
        const root = project();
        const outside = project();
        const rest = DATA_PARTS.slice(index + 1);
        const target = path.join(outside, ...rest);
        fs.mkdirSync(target, { recursive: true });
        const stale = path.join(target, 'x.json');
        fs.writeFileSync(stale, '{}');
        age(stale, 10 * dayMs);
        fs.mkdirSync(path.join(root, ...DATA_PARTS.slice(0, index)), { recursive: true });
        link(outside, path.join(root, ...DATA_PARTS.slice(0, index + 1)));
        const given = { env: env(root) };
        assert.strictEqual(S().linkedState(root, given), true, `${segment}: judged linked`);
        assert.strictEqual(S().writeStatus(startPayload(root), { entry: null }, { when: 'always', deps: given }), 'skipped', `${segment}: no write`);
        assert.ok(!fs.existsSync(path.join(target, 's1.json')), `${segment}: nothing written through the link`);
        const refused = gateRows(root, 's1').filter((r) => r.kind === 'status-write');
        assert.deepStrictEqual(refused.map((r) => r.result), ['refused'], `${segment}: one refused row`);
        assert.strictEqual(S().pruneStatus(root, 's1', Date.now(), given), 0, `${segment}: nothing pruned`);
        assert.ok(fs.existsSync(stale), `${segment}: the old file at the link's target stays`);
    });
    for (const [index, segment] of DATA_PARTS.entries())
    {
        const root = project();
        const inside = path.join(root, 'inside');
        const rest = DATA_PARTS.slice(index + 1);
        fs.mkdirSync(path.join(inside, ...rest), { recursive: true });
        fs.mkdirSync(path.join(root, ...DATA_PARTS.slice(0, index)), { recursive: true });
        link(inside, path.join(root, ...DATA_PARTS.slice(0, index + 1)));
        assert.strictEqual(S().writeStatus(startPayload(root), { entry: null }, { when: 'always', deps: { env: env(root) } }), 'written', `${segment}: a link inside the root is followed`);
        assert.ok(fs.existsSync(path.join(inside, ...rest, 's1.json')), `${segment}: the file is at the link's target`);
    }
});

test('the 7-day prune runs in the new folder alone', () =>
{
    const root = project();
    const sub = path.join(root, 'sub');
    const folder = path.dirname(newStatusOf(root, 'x'));
    fs.mkdirSync(folder, { recursive: true });
    const eight = newStatusOf(root, 'aaaaaaaa');
    const six = newStatusOf(root, 'bbbbbbbb');
    const legacy = legacyStatusOf(sub, 'cccccccc');
    const legacyRoot = legacyStatusOf(root, 'dddddddd');
    for (const [file, days] of [[eight, 8], [six, 6], [legacy, 8], [legacyRoot, 8]])
    {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{}');
        age(file, days * dayMs);
    }
    fs.writeFileSync(listOf(root), JSON.stringify([posixOf(sub)]));
    const before = fs.readFileSync(listOf(root));
    assert.strictEqual(S().pruneStatus(root, 's1', Date.now(), { env: {} }), 1);
    assert.deepStrictEqual([eight, six, legacy, legacyRoot].map((f) => fs.existsSync(f)), [false, true, true, true], 'only the new folder\'s 8-day file goes');
    assert.ok(fs.readFileSync(listOf(root)).equals(before), 'the list is byte-identical');
});

// The legacy sweep with the reader on: nothing writes in the old folders any more, so the sweep runs at every start.
test('the legacy sweep runs with the reader on', () =>
{
    const git = sweepGit();
    const root = project();
    git(root, 'init', '-q');
    const now = Math.floor(Date.now() / 1000) * 1000;
    const a = path.join(root, 'a');
    const ab = path.join(a, 'b');
    fs.mkdirSync(ab, { recursive: true });
    const put = (base, id, ageMs) =>
    {
        const file = legacyStatusOf(base, id);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{}');
        fs.utimesSync(file, (now - ageMs) / 1000, (now - ageMs) / 1000);
        return file;
    };
    const rootFiles = { younger: put(root, 's-younger', SWEEP_MS - 60000), older: put(root, 's-older', SWEEP_MS + 60000), exact: put(root, 's-exact', SWEEP_MS) };
    const subFiles = [put(a, 's-a', 60000), put(ab, 's-ab', 60000)];
    const exclude = path.join(root, '.git', 'info', 'exclude');
    fs.writeFileSync(exclude, `/mine/\n${stackPair('')}${stackPair('a')}${stackPair('a/b')}`);
    fs.mkdirSync(path.dirname(listOf(root)), { recursive: true });
    fs.writeFileSync(listOf(root), JSON.stringify([root, a, ab].map(posixOf)));
    const slowHostExec = (cmd, argv, opts) => execFileSync(cmd, argv, { ...opts, timeout: SLOW_HOST_GIT_TIMEOUT_MS });
    S().onSessionStart(startPayload(root, 'sweeper'), null, { env: sweepEnv(root, 'on'), clock: () => now, uptime: () => 0, exec: slowHostExec });
    assert.ok(subFiles.every((f) => !fs.existsSync(f)), 'the subfolder files are gone');
    assert.ok(!fs.existsSync(path.join(ab, '.claude')), 'the emptied subfolders go');
    assert.ok(!fs.existsSync(rootFiles.older), 'the root file at 25 h plus 60 s is gone');
    assert.ok(fs.existsSync(rootFiles.younger), 'the root file at 25 h minus 60 s stays');
    assert.ok(!fs.existsSync(rootFiles.exact), 'the root file at exactly 25 h is gone: a file stays only while now - mtime < 25 h');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(listOf(root), 'utf8')), [posixOf(root)], 'the root stays listed while it holds a file');
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), `/mine/\n${stackPair('')}`, 'the emptied folders\' pairs are dropped, the root\'s stays');
    assert.ok(fs.existsSync(newStatusOf(root, 'sweeper')), 'and the new file is written');
});

test('the start writes no exclude pair', () =>
{
    const git = sweepGit();
    const root = project();
    git(root, 'init', '-q');
    const exclude = path.join(root, '.git', 'info', 'exclude');
    const before = fs.readFileSync(exclude);
    assert.ok(!before.includes(S().EXCLUDE_COMMENT), 'the fixture holds no stack pair');
    const spy = execSpy();
    const deps = { env: sweepEnv(root, 'on'), uptime: () => 0, exec: spy.exec };
    S().onSessionStart(startPayload(root), null, deps);
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: root, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scorer: null }, { when: 'modes', deps }), 'written');
    assert.ok(fs.existsSync(newStatusOf(root, 's1')));
    const after = fs.readFileSync(exclude);
    assert.ok(after.equals(before), 'the exclude file is byte-identical');
    assert.strictEqual(after.toString('utf8').split('\n').filter((l) => l === S().EXCLUDE_COMMENT).length, 0);
    assert.deepStrictEqual(spy.calls, [], 'no git call');
});

test('a start past the deadline keeps every base and its pair; a start in time removes them', () =>
{
    const f = sweepProject();
    const before = fs.readFileSync(f.exclude, 'utf8');
    startAt(f, 'on', { uptime: () => 9000 });
    assert.deepStrictEqual(f.held(), [f.root, f.a, f.ab].map(posixOf), 'every listed base stays');
    assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), before, 'every pair stays and none is written');
    startAt(f, 'on', { uptime: () => 0 });
    assert.deepStrictEqual(f.held(), [posixOf(f.root)], 'a start in time removes the subfolder bases');
    assert.strictEqual(fs.readFileSync(f.exclude, 'utf8'), `/mine/\n${stackPair('')}`);
});

test('a garbage, empty or absent list starts without a throw and writes the new file', () =>
{
    for (const [why, text] of [['garbage', '{ not json'], ['empty', ''], ['an empty array', '[]'], ['absent', null]])
    {
        const root = project();
        if (text !== null) { fs.mkdirSync(path.dirname(listOf(root)), { recursive: true }); fs.writeFileSync(listOf(root), text); }
        assert.doesNotThrow(() => S().onSessionStart(startPayload(root), null, { env: sweepEnv(root, 'on'), uptime: () => 0 }), why);
        assert.ok(fs.existsSync(newStatusOf(root, 's1')), `${why}: the file is written`);
        if (text === null) assert.ok(!fs.existsSync(listOf(root)), `${why}: no list is made`);
        else assert.strictEqual(fs.readFileSync(listOf(root), 'utf8'), text, `${why}: the list's bytes are unchanged`);
    }
});

test('the failed status-write row carries gateMs', () =>
{
    const root = project();
    const folder = path.dirname(newStatusOf(root, 'x'));
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    fs.writeFileSync(folder, 'a file where the folder should be');
    assert.strictEqual(S().writeStatus(startPayload(root), { entry: null }, { when: 'always', deps: { env: sweepEnv(root, 'on') } }), 'skipped');
    const [row] = gateRows(root, 's1').filter((r) => r.kind === 'status-write');
    assert.strictEqual(row.result, 'failed');
    assert.strictEqual(typeof row.gateMs, 'number');
});

test('a start reads the reader gate once', () =>
{
    const root = project();
    let reads = 0;
    const layout = { ...LAYOUT, managedSettingsFile: () => { reads++; return LAYOUT.managedSettingsFile(); } };   // settingsLayers asks for it once per read
    S().onSessionStart(startPayload(root), null, { env: sweepEnv(root, 'on'), uptime: () => 0, layout });
    assert.strictEqual(reads, 1);
    assert.ok(fs.existsSync(newStatusOf(root, 's1')));
});

// Pins from the later-items design (Part 5): the start's root and the managed drop-ins, guarded from here on.
test('a start with CLAUDE_PROJECT_DIR at the main checkout and the cwd in its linked worktree writes under the main checkout\'s data root', () =>
{
    const main = project();
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    const tree = project();
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
    const env = { CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: main };
    S().onSessionStart(startPayload(tree, 'wt1'), null, { env, exec: execSpy().exec, uptime: () => 0 });
    assert.ok(fs.existsSync(newStatusOf(main, 'wt1')), 'the file is in the main checkout\'s data root');
    assert.ok(!fs.existsSync(newStatusOf(tree, 'wt1')), 'none in the linked worktree');
});

test('a start whose cwd vanished but whose root is live writes at the root', () =>
{
    const root = project();
    const gone = path.join(root, 'gone');
    const env = { CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: root };
    S().onSessionStart(startPayload(gone, 'gone1'), null, { env, exec: execSpy().exec, uptime: () => 0 });
    assert.ok(fs.existsSync(newStatusOf(root, 'gone1')), 'the file is at the live root');
    assert.ok(!fs.existsSync(gone), 'the vanished cwd is not recreated');
});

test('two managed drop-ins merge in name order: the later one\'s enabledPlugins key wins', () =>
{
    const g = gateSetup();
    g.dropIn('20-off.json', enabled('alfred-mods@market', false));
    g.dropIn('10-on.json', enabled());
    assert.strictEqual(g.on(), false, '20 is merged after 10 and turns it off');
    const h = gateSetup();
    h.dropIn('10-off.json', enabled('alfred-mods@market', false));
    h.dropIn('20-on.json', enabled());
    assert.strictEqual(h.on(), true, '20 is merged after 10 and turns it on');
});

test('a non-.json drop-in is skipped', () =>
{
    const g = gateSetup();
    g.dropIn('10-mods.txt', enabled());
    g.dropIn('20-mods.json.bak', enabled());
    g.dropIn('30-mods', enabled());
    assert.strictEqual(g.on(), false, 'no .json file, nothing enabled');
    g.dropIn('40-mods.json', enabled());
    assert.strictEqual(g.on(), true, 'a .json drop-in opens it');
});

test('readerOn: with no plugin key set the answer is false, whatever the machine\'s managed file holds', () =>
{
    const g = gateSetup();
    const real = fs.existsSync(LAYOUT.managedSettingsFile());
    assert.strictEqual(S().readerOn(g.root, { CLAUDE_CONFIG_DIR: g.account }, { layout: { ...LAYOUT, managedSettingsFile: () => g.managed } }), false, `the stubbed managed path, a real one ${real ? 'exists' : 'is absent'} on this machine`);
    g.managedFile({ enabledPlugins: { 'some-other-plugin@market': true } });
    assert.strictEqual(g.on(), false, 'a managed file with another plugin only');
});
