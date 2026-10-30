'use strict';
// check-turn-build.js (improvement plan 2.4; Stop only since the hooks review of 2026-10-16): at Stop the turn's
// changed files come from git - every path git status lists whose mtime is past the previous Stop's marker, or the
// session's start - and when they hold source files, ONE scoped check per root runs - tsc --noEmit -p for
// TypeScript, dotnet build --no-restore -v q for C# - and the first 20 error lines go back as a Stop block, once per
// turn. Seeded OFF: nothing runs unless ALFRED_CODE_TURN_CHECK=1.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'check-turn-build.js');
const { runChecks, groupRoots, commandFor, changedSince, sessionStartMs, MAX_LINES } = require(HOOK);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-build-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const posix = process.platform !== 'win32';

const BASE_ENV = { ...process.env };
for (const k of ['ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_TURN_CHECK', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE']) delete BASE_ENV[k];

let seq = 0;
// A git repo whose session began a minute ago (its transcript's first timestamp); `write` is an edit made this turn -
// its mtime set past any marker a Stop just wrote, so a same-millisecond write never reads as last turn's.
function project({ git = true } = {})
{
    const root = fs.mkdtempSync(path.join(TMP, `p${seq++}-`));
    if (git) spawnSync('git', ['init', '-q', root]);
    const log = path.join(root, 'spawned.log');
    const transcript = path.join(TMP, `t${seq}.jsonl`);
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - 60000).toISOString() })}\n`);
    const run = (payload, env = {}) => spawnSync(process.execPath, [HOOK], {
        input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: 'sess', cwd: root, transcript_path: transcript, ...payload }),
        // The Stop-chain marker (hook-prelude.js) lives in the project, so no case reads another's.
        encoding: 'utf8', env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_TURN_CHECK: '1', ALFRED_CODE_HOOK_LOG_DIR: root, ...env },
    });
    let tick = Date.now() / 1000 + 1;
    const write = (rel) =>
    {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'x');
        tick += 1;
        fs.utimesSync(file, tick, tick);
    };
    // 2.8.0 layout: the marker is session scratch, <data root>/state/sessions/
    const marker = path.join(root, '.alfred', 'state', 'sessions', 'turn-check-sess');
    // A stub tsc: logs where and how it ran, prints `errors` error lines, exits 2 when there are any.
    const tsc = (dir, errors) =>
    {
        const bin = path.join(root, dir, 'node_modules', '.bin');
        fs.mkdirSync(bin, { recursive: true });
        const lines = Array.from({ length: errors }, (_, i) => `src/a.ts(${i + 1},1): error TS2322: problem ${i + 1}`);
        fs.writeFileSync(path.join(bin, 'tsc'), `#!/bin/sh\necho "tsc $PWD $*" >> '${log}'\n${lines.map((l) => `echo '${l}'`).join('\n')}\n${errors ? 'exit 2' : 'exit 0'}\n`);
        fs.chmodSync(path.join(bin, 'tsc'), 0o755);
    };
    const file = (rel, text = '') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    const spawned = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
    return { root, run, write, marker, tsc, file, spawned, log, transcript };
}

// The user's ruling of 2026-10-16: the check rides history-session's Stop process - one node start fewer per turn - with
// its OWN gates, so either hook switched off leaves the other running, and only the check can block.
const HISTORY_HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'history-session.js');
test('turn-build: history-session\'s Stop runs the check with its own gates; either one off leaves the other', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 3);
    const viaHistory = (env = {}, event = 'Stop') => spawnSync(process.execPath, [HISTORY_HOOK], {
        input: JSON.stringify({ hook_event_name: event, session_id: 'sess', cwd: p.root, transcript_path: p.transcript }),
        encoding: 'utf8', env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: p.root, ALFRED_CODE_TURN_CHECK: '1', ALFRED_CODE_HOOK_LOG_DIR: p.root, ...env },
    });
    const runs = () => p.spawned().length;
    p.write('src/a.ts');
    const first = viaHistory();
    assert.strictEqual(first.status, 2, first.stderr);
    assert.match(first.stderr, /^This turn changed source files and the build check for them fails - tsc --noEmit -p tsconfig\.json \(in \.\)\.\nThe first 3 error line\(s\):/);
    assert.match(first.stderr, /ALFRED_CODE_TURN_CHECK=0 in the data root's \.variables switches it off/, 'the switch lives in .variables since 3.0.0, not the settings env');
    for (const env of [{ ALFRED_CODE_HISTORY: '0' }, { ALFRED_CODE_HOOKS_OFF: 'history-session' }])
    {
        p.write('src/a.ts');
        assert.strictEqual(viaHistory(env).status, 2, `history off (${JSON.stringify(env)}) leaves the check on`);
    }
    const before = runs();
    for (const env of [{ ALFRED_CODE_HOOKS_OFF: 'check-turn-build' }, { ALFRED_CODE_TURN_CHECK: '0' }])
    {
        p.write('src/a.ts');
        const r = viaHistory(env);
        assert.deepStrictEqual([r.status, r.stderr], [0, ''], `the check off (${JSON.stringify(env)}) runs nothing`);
    }
    p.write('src/a.ts');
    assert.deepStrictEqual([viaHistory({}, 'SessionStart').status, runs()], [0, before], 'a start never runs it');
    // The plugin's copy steps aside for a copied history-session, which carries the check on the copy route - once, not twice.
    p.file('.claude/alfred-code.stamp', 'source: x\n');
    const plugin = { CLAUDE_PLUGIN_ROOT: path.join(__dirname, '..') };
    p.write('src/a.ts');
    assert.strictEqual(viaHistory(plugin).status, 2, 'the plugin route runs it');
    // HK-02: a twin is its file on disk, wired on every row the core wires it on (SessionStart and Stop)
    const twin = { type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/history-session.js"' };
    p.file('.claude/hooks/history-session.js', '// copied\n');
    p.file('.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [twin] }], Stop: [{ hooks: [twin] }] } }));
    const copied = runs();
    p.write('src/a.ts');
    assert.deepStrictEqual([viaHistory(plugin).status, runs()], [0, copied], 'beside a copied history-session the plugin\'s stands down');
});

test('turn-build: its Stop row folds into history-session\'s wherever that row is wired; alone it keeps its own', () =>
{
    const { wiringRows } = require(HISTORY_HOOK);
    assert.deepStrictEqual(wiringRows(['history-session.js::@SessionStart', 'check-turn-build.js::@Stop', 'history-session.js::@Stop', 'docs-session.js::@Stop']),
        ['history-session.js::@SessionStart', 'history-session.js::@Stop', 'docs-session.js::@Stop']);
    assert.deepStrictEqual(wiringRows(['check-turn-build.js::@Stop', 'history-session.js::@SessionStart']), ['check-turn-build.js::@Stop', 'history-session.js::@SessionStart'],
        'no history Stop row to ride');
    assert.deepStrictEqual(wiringRows([{ file: 'history-session.js', matcher: '@Stop' }, { file: 'check-turn-build.js', matcher: '@Stop', note: 'x' }]).map((r) => r.file), ['history-session.js'],
        'the manifest\'s row shape');
    assert.deepStrictEqual(wiringRows(['history-session.js::@Stop', 'check-turn-build.js::@Stop::--x']), ['history-session.js::@Stop', 'check-turn-build.js::@Stop::--x'], 'a row with args is its own');
    // The generated core: no wiring of the check's own, and the Stop process that carries it at the check's 60s.
    const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8'));
    const hooks = [];
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.command === 'string') hooks.push(v); Object.values(v).forEach(walk); } };
    walk(entries);
    assert.ok(!hooks.some((h) => /check-turn-build\.js/.test(h.command)), 'the check has no process of its own');
    assert.deepStrictEqual(hooks.filter((h) => /history-session\.js/.test(h.command)).map((h) => h.timeout).sort(), [10, 60]);
});

test('turn-build: off by default - no marker, and a Stop never spawns a check', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 3);
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }, { ALFRED_CODE_TURN_CHECK: '' }).status, 0);
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }, { ALFRED_CODE_TURN_CHECK: '0' }).status, 0);
    assert.ok(!fs.existsSync(p.marker), 'the off hook kept a marker');
    assert.deepStrictEqual(p.spawned(), []);
});

// The PostToolUse half is gone: an edit costs no hook process; a stale wiring of it does nothing.
test('turn-build: a PostToolUse payload does nothing', () =>
{
    const p = project();
    assert.strictEqual(p.run({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'src/a.ts') } }).status, 0);
    assert.ok(!fs.existsSync(path.join(p.root, '.alfred')), 'it wrote state');
});

test('turn-build: a TypeScript error blocks the Stop with the first 20 error lines, and the marker moves', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 25);
    p.write('src/a.ts');
    p.write('src/a.ts');
    p.write('README.md');
    const r = p.run({ hook_event_name: 'Stop' });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /problem 20$/m);
    assert.doesNotMatch(r.stderr, /problem 21/);
    assert.match(r.stderr, /tsc --noEmit -p tsconfig\.json/);
    assert.deepStrictEqual(p.spawned().length, 1, 'one check for one root');
    assert.match(p.spawned()[0], /--noEmit -p .*tsconfig\.json/);
    assert.ok(fs.existsSync(p.marker), 'the Stop set the next turn\'s start');
    assert.strictEqual(p.run({ hook_event_name: 'Stop', session_id: 'sess2' }).status, 2, 'another session, no marker yet: measured from its start');
    fs.utimesSync(path.join(p.root, 'src', 'a.ts'), new Date(Date.now() - 30000), new Date(Date.now() - 30000));
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 0, 'a file last changed before the marker is no edit of this turn');
    const row = fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', 'sess.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    assert.strictEqual(row.hook, 'check-turn-build.js');
    assert.strictEqual(row.event, 'Stop');
    // A row carrying a `mode` is a PROBE to analyze-usage.js (every guard's block row has none), so a
    // real block written with mode 'block' was tallied as a probe and left out of the block rate.
    assert.strictEqual(row.mode, undefined, 'a block row carries no mode');
    assert.strictEqual(row.tool, '', 'and the tool field every block row has');
});

// R13: the core's hook_profile userConfig - strict runs the check over the seeded ALFRED_CODE_TURN_CHECK=0,
// the project's csv still switches it off, and minimal stands it down even where the project set it on.
test('turn-build: profile strict runs the check over a seeded 0; the csv and profile minimal still keep it off', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const setUp = (env) =>
    {
        const p = project();
        p.file('tsconfig.json', '{}');
        p.tsc('.', 2);
        p.write('src/a.ts');
        return { p, stop: p.run({ hook_event_name: 'Stop' }, env) };
    };
    const strict = setUp({ ALFRED_CODE_TURN_CHECK: '0', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'strict' });
    assert.strictEqual(strict.stop.status, 2, strict.stop.stderr);
    assert.match(strict.stop.stderr, /problem 2$/m);
    const standard = setUp({ ALFRED_CODE_TURN_CHECK: '0', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard' });
    assert.strictEqual(standard.stop.status, 0);
    assert.deepStrictEqual(standard.p.spawned(), [], 'standard reads the seeded 0');
    const csv = setUp({ ALFRED_CODE_TURN_CHECK: '0', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'strict', ALFRED_CODE_HOOKS_OFF: 'check-turn-build' });
    assert.strictEqual(csv.stop.status, 0);
    assert.deepStrictEqual(csv.p.spawned(), [], 'the csv wins over strict');
    const minimal = setUp({ ALFRED_CODE_TURN_CHECK: '1', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(minimal.stop.status, 0);
    assert.deepStrictEqual(minimal.p.spawned(), [], 'minimal keeps only the protective guards');
});

test('turn-build: once per turn - the continuation Stop after a block passes, even with errors still there', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 2);
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 2);
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop', stop_hook_active: true }).status, 0);
    assert.strictEqual(p.spawned().length, 1, 'the continuation ran a second check');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 2, 'the fix-up edits are the next turn\'s check');
    assert.strictEqual(p.spawned().length, 2);
});

// The Stop chain (audit 2026-10-08 S1): `stop_hook_active` is set after ANY Stop hook's block, so the fix-up edits of
// a continuation a SIBLING caused (the stop contract held the close) are this turn's and get checked - once.
test('turn-build: a continuation a sibling Stop hook caused is checked, and blocks at most once', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 2);
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop', stop_hook_active: true }).status, 2, 'a sibling caused this continuation');
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop', stop_hook_active: true }).status, 0, 'never twice in one cycle');
    assert.strictEqual(p.spawned().length, 1);
});

test('turn-build: a clean build, a turn with no source file, and a root with no compiler all pass', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const clean = project();
    clean.file('tsconfig.json', '{}');
    clean.tsc('.', 0);
    clean.write('src/a.ts');
    assert.strictEqual(clean.run({ hook_event_name: 'Stop' }).status, 0);
    assert.strictEqual(clean.spawned().length, 1);

    const docs = project();
    docs.file('tsconfig.json', '{}');
    docs.tsc('.', 3);
    docs.write('README.md');
    docs.write('notes/plan.txt');
    assert.strictEqual(docs.run({ hook_event_name: 'Stop' }).status, 0);
    assert.deepStrictEqual(docs.spawned(), [], 'a docs-only turn ran a check');

    const bare = project();
    bare.file('tsconfig.json', '{}');
    bare.write('src/a.ts');
    const r = bare.run({ hook_event_name: 'Stop' });
    assert.strictEqual(r.status, 0, 'no local tsc is a skip, never a block');
});

test('turn-build: one check per nearest root - two tsconfig roots, three files, two runs', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('web/tsconfig.json', '{}');
    p.file('api/tsconfig.json', '{}');
    p.tsc('.', 0);
    p.write('web/src/a.ts');
    p.write('web/src/b.tsx');
    p.write('api/src/c.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 0);
    const ran = p.spawned();
    assert.strictEqual(ran.length, 2, ran.join('\n'));
    // Each root's check runs FROM that root, on its own tsconfig.
    assert.ok(ran.some((l) => /\/web --noEmit -p tsconfig\.json$/.test(l)) && ran.some((l) => /\/api --noEmit -p tsconfig\.json$/.test(l)), ran.join('\n'));
});

test('turn-build: a C# file runs dotnet build --no-restore -v q on its nearest project, and its errors block', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('src/Api/Api.csproj', '<Project />');
    const bin = path.join(p.root, 'bin-stub');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'dotnet'), `#!/bin/sh\necho "dotnet $*" >> '${p.log}'\necho '/r/src/Api/A.cs(3,5): error CS0103: The name x does not exist [/r/src/Api/Api.csproj]'\necho '/r/src/Api/A.cs(3,5): error CS0103: The name x does not exist [/r/src/Api/Api.csproj]'\necho 'Build FAILED.'\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'dotnet'), 0o755);
    p.write('src/Api/Controllers/A.cs');
    const r = p.run({ hook_event_name: 'Stop' }, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(p.spawned()[0], /^dotnet build --no-restore -v q .*src\/Api\/Api\.csproj$/);
    assert.strictEqual((r.stderr.match(/error CS0103/g) || []).length, 1, 'the duplicate summary line was repeated');
});

// Audit 2026-10-08 row 45: a never-restored C# project failed `dotnet build --no-restore` with NETSDK1004 on every line
// and blocked the turn - the check never restores, so that is no error of the turn's. A pass with a probe row.
test('turn-build: a C# project never restored is a pass with a probe row, and a real error beside NETSDK1004 still blocks', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('src/Api/Api.csproj', '<Project />');
    const bin = path.join(p.root, 'bin-stub');
    fs.mkdirSync(bin);
    const stub = (extra) => fs.writeFileSync(path.join(bin, 'dotnet'), `#!/bin/sh\necho "dotnet $*" >> '${p.log}'\necho "/r/obj/x.targets(266,5): error NETSDK1004: Assets file '/r/src/Api/obj/project.assets.json' not found. Run a NuGet package restore to generate this file. [/r/src/Api/Api.csproj]"\n${extra}\necho 'Build FAILED.'\nexit 1\n`, { mode: 0o755 });
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    stub('');
    p.write('src/Api/Controllers/A.cs');
    const r = p.run({ hook_event_name: 'Stop' }, env);
    assert.strictEqual(r.status, 0, r.stderr);
    const rows = fs.readFileSync(path.join(p.root, '.alfred', 'statistics', 'hook-blocks', 'sess.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(rows.map((x) => [x.mode, x.kind, x.detail.roots]), [['probe', 'not-restored', ['src/Api/Api.csproj']]]);
    stub(`echo '/r/src/Api/A.cs(3,5): error CS0103: The name x does not exist [/r/src/Api/Api.csproj]'`);
    p.write('src/Api/Controllers/A.cs');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }, env).status, 2, 'a compile error beside it is still the turn\'s');
});

test('turn-build: runChecks - a timeout or a missing binary is a pass, and the budget is shared across roots', () =>
{
    const roots = [{ kind: 'ts', config: '/r/a/tsconfig.json', cwd: '/r/a', bin: '/r/node_modules/.bin/tsc' }, { kind: 'ts', config: '/r/b/tsconfig.json', cwd: '/r/b', bin: '/r/node_modules/.bin/tsc' }];
    const seen = [];
    const timedOut = runChecks(roots, { budgetMs: 1000, spawn: (bin, args, opts) => { seen.push(opts.timeout); return { status: null, signal: 'SIGTERM', error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' }; } });
    assert.deepStrictEqual(timedOut.errors, []);
    assert.deepStrictEqual(timedOut.outcomes.map((o) => o.outcome), ['timeout', 'timeout']);
    assert.ok(seen.every((t) => t > 0 && t <= 1000), seen.join(','));
    const missing = runChecks(roots, { budgetMs: 1000, spawn: () => ({ status: null, error: Object.assign(new Error('x'), { code: 'ENOENT' }), stdout: '', stderr: '' }) });
    assert.deepStrictEqual(missing.errors, []);
    assert.deepStrictEqual(missing.outcomes.map((o) => o.outcome), ['missing', 'missing']);
    const many = runChecks(roots.slice(0, 1), { budgetMs: 1000, spawn: () => ({ status: 2, stdout: Array.from({ length: 30 }, (_, i) => `a.ts(1,1): error TS1: e${i}`).join('\n'), stderr: '' }) });
    assert.strictEqual(many.errors.length, MAX_LINES);
});

test('turn-build: groupRoots ignores a path outside the project and a non-source file', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'g-'));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    const outside = path.join(os.tmpdir(), 'elsewhere', 'x.ts');
    const roots = groupRoots([path.join(root, 'src', 'a.ts'), outside, path.join(root, 'README.md')], root);
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].config, path.join(root, 'tsconfig.json'));
});

test('turn-build: garbage stdin, garbage list lines and the hooks-off switch never block', () =>
{
    const p = project();
    assert.strictEqual(p.run('{nope').status, 0);
    fs.mkdirSync(path.dirname(p.marker), { recursive: true });
    fs.writeFileSync(p.marker, '\u0000\n\n{]\n');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 0, 'only the marker\'s time is read');
    const off = project();
    off.file('tsconfig.json', '{}');
    off.tsc('.', 2);
    off.write('a.ts');
    assert.strictEqual(off.run({ hook_event_name: 'Stop' }, { ALFRED_CODE_HOOKS_OFF: 'check-turn-build' }).status, 0);
    assert.ok(!fs.existsSync(off.marker));
    assert.deepStrictEqual(off.spawned(), []);
});

test('turn-build: on Windows the tsc.cmd shim runs through the shell QUOTED - a path with a space still runs', () =>
{
    const app = path.join(path.sep, 'Users', 'First Last', 'app');
    const bin = path.join(app, 'node_modules', '.bin', 'tsc.cmd');
    const ts = { kind: 'ts', config: path.join(app, 'tsconfig.json'), cwd: app, bin };
    assert.deepStrictEqual(commandFor(ts, true), { cmd: `"${bin}"`, args: ['--noEmit', '-p', 'tsconfig.json'], shell: true });
    assert.deepStrictEqual(commandFor({ ...ts, bin: '/p q/node_modules/.bin/tsc' }, false), { cmd: '/p q/node_modules/.bin/tsc', args: ['--noEmit', '-p', 'tsconfig.json'], shell: false });
    const cs = { kind: 'cs', config: 'C:\\a b\\App.csproj', cwd: 'C:\\a b', bin: 'dotnet' };
    assert.deepStrictEqual(commandFor(cs, true), { cmd: 'dotnet', args: ['build', '--no-restore', '-v', 'q', 'C:\\a b\\App.csproj'], shell: false });
});

// Git is the record now: any edit counts - the navigation server's rename, a shell `sed -i`, a new file - and what
// this turn did not touch, or git cannot see, does not.
test('turn-build: git names the turn\'s files - untracked and renamed ones too; older, deleted and ignored ones are not this turn\'s', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    const g = (...a) => spawnSync('git', ['-C', p.root, '-c', 'user.email=t@e.x', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
    p.file('web/tsconfig.json', '{}');
    p.file('api/tsconfig.json', '{}');
    p.file('lib/tsconfig.json', '{}');
    p.file('gone/tsconfig.json', '{}');
    p.file('.gitignore', 'gen/\nnode_modules/\n');
    p.tsc('.', 0);
    for (const f of ['api/src/old.ts', 'lib/src/keep.ts', 'gone/src/x.ts', 'web/src/from.ts']) p.file(f, 'x');
    g('add', '-A'); g('commit', '-qm', 'seed');
    const past = new Date(Date.now() - 3600000);
    p.file('api/src/old.ts', 'dirty before the session');
    fs.utimesSync(path.join(p.root, 'api/src/old.ts'), past, past);
    g('mv', 'web/src/from.ts', 'web/src/to.ts');
    p.write('web/src/to.ts');
    fs.rmSync(path.join(p.root, 'gone/src/x.ts'));
    p.write('lib/src/new.ts');
    p.write('gen/out.ts');
    const since = Date.now() - 60000;
    const files = changedSince(p.root, since).map((f) => path.relative(p.root, f)).sort();
    assert.deepStrictEqual(files, ['lib/src/new.ts', 'web/src/to.ts']);
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 0);
    const ran = p.spawned().map((l) => path.basename(l.split(' ')[1])).sort();
    assert.deepStrictEqual(ran, ['lib', 'web'], p.spawned().join('\n'));
    const sub = path.join(p.root, 'web', 'src');
    assert.deepStrictEqual(changedSince(sub, since).map((f) => path.relative(p.root, f)).filter((f) => f.endsWith('.ts')).sort(), files, 'from a subfolder too (the Stop has since written its marker - no source file)');
});

test('turn-build: outside git, or with no session start and no marker, nothing is this turn\'s - the first Stop only sets the marker', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const bare = project({ git: false });
    bare.file('tsconfig.json', '{}');
    bare.tsc('.', 2);
    bare.write('src/a.ts');
    assert.strictEqual(bare.run({ hook_event_name: 'Stop' }).status, 0);
    assert.deepStrictEqual(bare.spawned(), [], 'no git, no check');
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 2);
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop', transcript_path: path.join(TMP, 'missing.jsonl') }).status, 0);
    assert.deepStrictEqual(p.spawned(), [], 'an unknown start judges nothing');
    assert.ok(fs.existsSync(p.marker), 'but the next turn is measured from here');
    p.write('src/a.ts');
    assert.strictEqual(p.run({ hook_event_name: 'Stop', transcript_path: undefined }).status, 2);
    assert.strictEqual(sessionStartMs(''), 0);
    assert.ok(sessionStartMs(p.transcript) > 0 && sessionStartMs(p.transcript) < Date.now());
});
