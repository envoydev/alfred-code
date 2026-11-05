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

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'session-status-')));
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
const { spawnSync } = require('node:child_process');
const { scrubbed, strayRoots } = require('./hook-test-env');
const STATUS = path.join(HOOKS, 'session-status.js');
const S = () => require(STATUS);
const ACCOUNT = path.join(TMP, 'account');
const HOME = path.join(TMP, 'home');
fs.mkdirSync(ACCOUNT, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = ACCOUNT;   // the account settings fresh-session reads: a throwaway, never the runner's
const statusOf = (base, id) => path.join(base, '.claude', 'session-inspector', 'status', `${id}.json`);
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
    assert.deepStrictEqual(S().FIELDS, ['schema', 'session', 'fullContext', 'updatedAt', 'model', 'window', 'resumeAt', 'autoRun', 'scorer', 'handoffPrompt']);
    assert.strictEqual(s.schema, 1);
    assert.strictEqual(s.session, 's1');
    assert.strictEqual(new Date(s.updatedAt).toISOString(), s.updatedAt);
    assert.strictEqual(typeof s.model, 'string');
    for (const k of ['window', 'resumeAt']) assert.ok(Number.isInteger(s[k]) && s[k] > 0, k);
    assert.strictEqual(typeof s.autoRun, 'boolean');
    assert.ok(s.scorer === null || (typeof s.scorer.on === 'boolean' && s.scorer.level >= 1 && s.scorer.level <= 100 && s.scorer.rounds >= 1 && s.scorer.rounds <= 10));
    assert.ok(s.handoffPrompt === null || (s.handoffPrompt.length >= 1 && s.handoffPrompt.length <= 1000));
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
            const on = S.onPrompt(p, { autoRun: true, scorer: null }); const a = read();
            const off = S.onPrompt(p, { autoRun: false, scorer: null }); const b = read();
            return [on, a.autoRun, a.fullContext, off, b.autoRun, b.fullContext];`);
        assert.deepStrictEqual(got, ['written', true, 'compact', 'written', false, offValue]);
    }
});

test('a Stop keeps compact while the file says auto-run', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `const fs = require('fs');
        S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scorer: null });
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
        const prompt = S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scorer: null });
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
        const r = S.onPrompt({ ...${P}, hook_event_name: 'UserPromptSubmit' }, { autoRun: true, scorer: null });
        return { r, s: JSON.parse(fs.readFileSync(${FILE}, 'utf8')) };`);
    assert.deepStrictEqual([got.r, got.s.fullContext], ['written', 'compact']);
});

// R137 (burn-down 2026-11-04): guard-answer ran history-session's stand-down on every prompt, before the compare.
test('R137: the prompt\'s stand-down runs only when a write is due', () =>
{
    const { root, P, FILE } = sonnetSession();
    const got = inChild({ CLAUDE_PROJECT_DIR: root }, `let n = 0; const gate = () => { n++; return true; };
        const p = { ...${P}, hook_event_name: 'UserPromptSubmit' };
        const a = S.onPrompt(p, { autoRun: false, scorer: null }, gate); const na = n;
        const b = S.onPrompt(p, { autoRun: false, scorer: null }, gate); const nb = n;
        const c = S.onPrompt({ ...p, session_id: 's2' }, { autoRun: false, scorer: null }, () => false);
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
test('R134: the folder list as a link to a FIFO, or a large file, reads as none - within a second', () =>
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
            const written = JSON.parse(fs.readFileSync(${JSON.stringify(list)}, 'utf8'));
            const n = S.pruneStatus(${JSON.stringify(root)}, ${JSON.stringify(root)}, 's1', Date.now(), {});
            process.stdout.write(JSON.stringify({ r, n, list: written }));`;
        const t0 = Date.now();
        const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000, env: { ...scrubbed(process.env), HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: ACCOUNT, CLAUDE_PROJECT_DIR: root } });
        assert.ok(!r.error, `${why}: ${r.error}`);
        assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
        assert.ok(Date.now() - t0 < 3000, `${why}: ${Date.now() - t0} ms`);
        const got = JSON.parse(r.stdout);
        assert.strictEqual(got.r, 'written', why);
        assert.deepStrictEqual(got.list, [root.split(path.sep).join('/')], `${why}: the list holds this base alone`);
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

test('T9 ids and payloads', () =>
{
    const root = project();
    const env = {};
    const write = (p) => S().writeStatus({ cwd: root, hook_event_name: 'Stop', ...p }, { entry: null }, { when: 'always', deps: { env } });
    assert.strictEqual(write({ session_id: 'a'.repeat(128) }), 'written');
    assert.strictEqual(write({ session_id: 'a'.repeat(129) }), 'skipped');
    assert.ok(!fs.existsSync(statusOf(root, 'a'.repeat(129))));
    for (const id of ['a/b', '..', 'a.b']) assert.strictEqual(write({ session_id: id }), 'skipped', id);
    assert.strictEqual(write({ session_id: 's1', agent_id: 'x' }), 'skipped', 'a seat writes nothing');
    assert.strictEqual(S().writeStatus({ session_id: 's1', hook_event_name: 'Stop' }, {}, { when: 'always', deps: { env } }), 'skipped', 'no cwd, no project dir');
    const elsewhere = project();
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: elsewhere }, {}, { when: 'always', deps: { env: { CLAUDE_PROJECT_DIR: root } } }), 'skipped', 'a cwd outside the project');
    assert.ok(!fs.existsSync(path.join(elsewhere, '.claude')), 'no folder made outside the project');
});

test('a symlinked status folder is refused', () =>
{
    for (const at of [['.claude', 'session-inspector', 'status'], ['.claude', 'session-inspector']])
    {
        const root = project();
        const outside = project();
        // where the prune would look through this link: the link IS the status folder, or holds it
        const old = at.length === 3 ? path.join(outside, 'aaaaaaaa.json') : path.join(outside, 'status', 'aaaaaaaa.json');
        fs.mkdirSync(path.dirname(old), { recursive: true });
        fs.writeFileSync(old, '{}');
        age(old, 8 * dayMs);
        fs.mkdirSync(path.join(root, ...at.slice(0, -1)), { recursive: true });
        link(outside, path.join(root, ...at));
        S().onSessionStart({ session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, null);
        assert.ok(!fs.existsSync(path.join(outside, 's1.json')) && !fs.existsSync(path.join(outside, 'status', 's1.json')), `${at.join('/')}: nothing written through the link`);
        assert.ok(fs.existsSync(old), `${at.join('/')}: the old file stays`);
    }
    const root = project();
    const real = project();
    link(real, path.join(root, '.claude'));
    S().onSessionStart({ session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, null);
    assert.ok(fs.existsSync(path.join(real, 'session-inspector', 'status', 's1.json')), 'a linked .claude still writes');
});

test('a .claude link below the project root is refused, write and prune (A8)', () =>
{
    const root = project();
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);
    const outside = project();
    link(outside, path.join(sub, '.claude'));
    const env = { CLAUDE_PROJECT_DIR: root };
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: sub }, {}, { when: 'always', deps: { env } }), 'skipped');
    assert.ok(!fs.existsSync(path.join(outside, 'session-inspector')), 'nothing written through the link');
    const old = path.join(outside, 'session-inspector', 'status', 'aaaaaaaa.json');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, '{}');
    age(old, 8 * dayMs);
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, JSON.stringify([sub.split(path.sep).join('/')]));
    assert.strictEqual(S().pruneStatus(root, sub, 's1', Date.now(), { env }), 0);
    assert.ok(fs.existsSync(old), 'nothing pruned through the link');
    assert.deepStrictEqual(S().statusBases(root, sub, { env }), [], 'and nothing excluded there');
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
    assert.deepStrictEqual(S().ensureExcluded([odd], { env: {} }), ['skipped']);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), before, 'no line, so no `*` pattern');
    const env = { CLAUDE_PROJECT_DIR: root };
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: odd }, {}, { when: 'always', deps: { env } }), 'skipped', 'and no file the exclude cannot cover');
    assert.ok(!fs.existsSync(path.join(odd, '.claude')));
});

test('a vanished cwd writes nothing', () =>
{
    const root = project();
    const gone = path.join(root, 'gone');
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: gone }, {}, { when: 'always', deps: { env: { CLAUDE_PROJECT_DIR: root } } }), 'skipped');
    assert.ok(!fs.existsSync(gone));
});

test('garbage folder-list entries are dropped', () =>
{
    const root = project();
    const sub = path.join(root, 'sub');
    const elsewhere = path.join(TMP, `elsewhere-${seq++}`);
    const list = path.join(root, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    const posix = (p) => p.split(path.sep).join('/');
    fs.writeFileSync(list, JSON.stringify([42, 'rel/x', `${posix(root)}/../${path.basename(elsewhere)}`, posix(sub)]));
    const a = statusOf(sub, 'bbbbbbbb');
    const c = statusOf(elsewhere, 'cccccccc');
    for (const f of [a, c]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}'); age(f, 8 * dayMs); }
    assert.strictEqual(S().pruneStatus(root, root, 's1', Date.now(), { env: {} }), 1);
    assert.ok(!fs.existsSync(a), 'the sub file is gone');
    assert.ok(fs.existsSync(c), 'the elsewhere file stays');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(list, 'utf8')), [posix(sub)]);
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
    assert.strictEqual(S().pruneStatus(root, root, 's1', now, { env: {} }), 1);
    assert.deepStrictEqual(files.map((f) => fs.existsSync(f)), [true, true, false], 'one under kept, at kept, one over removed');
});

test('T11 probe rows and cost', (t) =>
{
    const root = project();
    const rows = () => fs.readFileSync(path.join(root, '.alfred', 'statistics', 'hook-blocks', 's1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, { entry: null }, { when: 'always', deps: { env: {} } }), 'written');
    const [ok] = rows();
    assert.deepStrictEqual([ok.mode, ok.kind, ok.result, ok.event, ok.hook, typeof ok.ms], ['probe', 'status-write', 'ok', 'SessionStart', 'session-status.js', 'number']);
    const bad = project();
    fs.mkdirSync(path.join(bad, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(bad, '.claude', 'session-inspector'), 'a file');
    assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: bad, hook_event_name: 'Stop' }, { entry: null }, { when: 'always', deps: { env: {} } }), 'skipped');
    const failed = fs.readFileSync(path.join(bad, '.alfred', 'statistics', 'hook-blocks', 's1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(failed[0].result, 'failed');
    assert.deepStrictEqual(fs.readdirSync(path.join(bad, '.claude')), ['session-inspector'], 'no tmp left');
    const ticks = [0, 250];
    const clock = () => (ticks.length ? ticks.shift() : 250);
    S().writeStatus({ session_id: 's1', cwd: root, hook_event_name: 'Stop' }, { entry: null, autoRun: true }, { when: 'always', deps: { env: {}, clock } });
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
        const late = S().ensureExcluded([root, ...wts], { env: {}, uptime: () => 9000, exec: (...a) => { spawns++; return execFileSync(...a); } });
        assert.deepStrictEqual(late, ['late', 'late', 'late']);
        assert.strictEqual(spawns, 0, 'no spawn past the deadline');
        assert.strictEqual(fs.readFileSync(exclude, 'utf8'), before, 'the exclude file untouched');
        const got = S().ensureExcluded([root, ...wts], { env: {}, uptime: () => 0, exec: (...a) => { spawns++; return execFileSync(...a); } });
        assert.deepStrictEqual(got, ['added', 'present', 'present']);
        assert.strictEqual(spawns, 1, 'one spawn for the main checkout and its two worktrees');
        const text = fs.readFileSync(exclude, 'utf8');
        assert.strictEqual(text.split('\n').filter((l) => l === '/.claude/session-inspector/status/').length, 1, 'the line lands once');
        // a SessionStart through the hook, after a late check, adds the line
        fs.writeFileSync(exclude, before);
        const r = spawnSync(process.execPath, [path.join(HOOKS, 'history-session.js')], {
            input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', source: 'startup', cwd: root }), encoding: 'utf8',
            env: { ...gitEnv, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: ACCOUNT }, cwd: root,
        });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(fs.readFileSync(exclude, 'utf8').split('\n').includes('/.claude/session-inspector/status/'), 'the hook adds the line');
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
    const env = { CLAUDE_PROJECT_DIR: root };
    const exclude = path.join(top, '.git', 'info', 'exclude');
    // the line the user typed for root is there before any session: nothing is added for root, so it stays theirs
    fs.writeFileSync(exclude, '# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n/app/.claude/session-inspector/status/\n');
    // uptime pinned: the exclude check has an 8 s deadline on the PROCESS's age, and on a slow runner this test starts past
    // it, so every check read 'late' (the Windows VM gate on 547ede2c)
    const fast = () => 0;
    for (const base of [root, sub]) assert.strictEqual(S().writeStatus({ session_id: 's1', cwd: base }, {}, { when: 'always', deps: { env, uptime: fast } }), 'written', base);
    // a write outside SessionStart that made the folder added sub's pair itself
    assert.deepStrictEqual(S().ensureExcluded([root, sub, other], { env: {}, uptime: fast }), ['present', 'present', 'added']);
    // another project's pair is one in use: its status folder is there (E-batch SYS-03 sweeps a pair whose folder is gone)
    fs.mkdirSync(path.join(other, '.claude', 'session-inspector', 'status'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector', 'HANDOFF.md'), '# handoff\n');
    fs.mkdirSync(path.join(root, '.claude', 'session-inspector', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector', 'status', 'notes.txt'), 'mine\n');
    fs.writeFileSync(path.join(root, '.claude', 'session-inspector', 'status', 's2.json.123.tmp'), '{');
    const before = fs.readFileSync(exclude, 'utf8');
    const got = S().removeStatus(root, { env });
    assert.strictEqual(got.files, 3, 'two status files and a crashed write\'s tmp');
    assert.ok(!fs.existsSync(statusOf(root, 's1')) && !fs.existsSync(statusOf(sub, 's1')));
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
    assert.deepStrictEqual(S().removeStatus(root, { env }), { files: 0, folders: [], lines: 0 });
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), after);
    // nothing there, no git, a garbage list, no root: no throw, nothing done
    const bare = project();
    const list = path.join(bare, '.alfred', 'state', 'sessions', 'status-folders.json');
    fs.mkdirSync(path.dirname(list), { recursive: true });
    fs.writeFileSync(list, '{ not json');
    assert.deepStrictEqual(S().removeStatus(bare, { env: { CLAUDE_PROJECT_DIR: bare } }), { files: 0, folders: [], lines: 0 });
    assert.deepStrictEqual(S().removeStatus('', {}), { files: 0, folders: [], lines: 0 });
    assert.deepStrictEqual(S().removeStatus('relative/path', {}), { files: 0, folders: [], lines: 0 });
    // a linked status folder is never followed
    const linked = project();
    const outside = project();
    fs.writeFileSync(path.join(outside, 'aaaa.json'), '{}');
    fs.mkdirSync(path.join(linked, '.claude', 'session-inspector'), { recursive: true });
    link(outside, path.join(linked, '.claude', 'session-inspector', 'status'));
    assert.strictEqual(S().removeStatus(linked, { env: { CLAUDE_PROJECT_DIR: linked } }).files, 0);
    assert.ok(fs.existsSync(path.join(outside, 'aaaa.json')), 'nothing removed through the link');
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
    const got = S().removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } });
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), user + pair('b') + pair('c') + '# trailing note of mine\n', 'a\'s pair goes whole, b and c stay, every user line byte-equal');
    assert.strictEqual(got.lines, 1);
    // a re-run changes nothing
    assert.strictEqual(S().removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }).lines, 0);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), user + pair('b') + pair('c') + '# trailing note of mine\n');
    // CRLF rows keep their endings
    fs.writeFileSync(exclude, (user + pair('a') + pair('c')).replace(/\n/g, '\r\n'));
    S().removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } });
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), (user + pair('c')).replace(/\n/g, '\r\n'));
});
test('SYS-03: a lone anchored line with no comment above it is not the stack\'s', () =>
{
    const { top, exclude, pair } = sweepRepo();
    const text = '/d/.claude/session-inspector/status/\n' + '# unrelated comment\n/e/.claude/session-inspector/status/\n' + pair('f').split('\n')[0] + '\n\n/g/.claude/session-inspector/status/\n';
    fs.writeFileSync(exclude, text);
    assert.strictEqual(S().removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }).lines, 0);
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
    assert.strictEqual(S().removeStatus(app, { env: { CLAUDE_PROJECT_DIR: app } }).lines, 1);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), rootForm);
    // uninstalling the top: its own root-form pair goes, as it always did
    assert.strictEqual(S().removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top } }).lines, 1);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), '');
});
test('SYS-03: no worktree listing, no sweep', () =>
{
    const { top, exclude, pair } = sweepRepo();
    fs.writeFileSync(exclude, pair('a'));
    const fail = (cmd, argv, opts) => { if (argv.includes('worktree')) throw new Error('timed out'); return require('node:child_process').execFileSync(cmd, argv, opts); };
    assert.strictEqual(S().removeStatus(top, { env: { CLAUDE_PROJECT_DIR: top }, exec: fail }).lines, 0);
    assert.strictEqual(fs.readFileSync(exclude, 'utf8'), pair('a'), 'today\'s behaviour: the unlisted pair stays');
});
