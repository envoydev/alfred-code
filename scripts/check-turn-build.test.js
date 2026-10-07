'use strict';
// check-turn-build.js (improvement plan 2.4): PostToolUse on Write|Edit|MultiEdit records the path; at
// Stop, when the turn's list holds source files, ONE scoped check per root runs - tsc --noEmit -p for
// TypeScript, dotnet build --no-restore -v q for C# - and the first 20 error lines go back as a Stop
// block, once per turn. Seeded OFF: nothing runs unless ALFRED_CODE_TURN_CHECK=1.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'check-turn-build.js');
const { runChecks, groupRoots, commandFor, MAX_LINES } = require(HOOK);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-build-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const posix = process.platform !== 'win32';

const BASE_ENV = { ...process.env };
for (const k of ['ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_TURN_CHECK', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE']) delete BASE_ENV[k];

let seq = 0;
function project()
{
    const root = fs.mkdtempSync(path.join(TMP, `p${seq++}-`));
    const log = path.join(root, 'spawned.log');
    const run = (payload, env = {}) => spawnSync(process.execPath, [HOOK], {
        input: typeof payload === 'string' ? payload : JSON.stringify({ session_id: 'sess', cwd: root, ...payload }),
        encoding: 'utf8', env: { ...BASE_ENV, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_TURN_CHECK: '1', ...env },
    });
    const write = (rel) => run({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(root, rel), content: 'x' } });
    const list = path.join(root, '.alfred', 'docs', 'flow', 'turn-edits-sess');
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
    return { root, run, write, list, tsc, file, spawned, log };
}

test('turn-build: off by default - no list, and a Stop never spawns a check', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 3);
    const off = { ALFRED_CODE_TURN_CHECK: '' };
    assert.strictEqual(p.run({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'src/a.ts') } }, off).status, 0);
    assert.ok(!fs.existsSync(p.list), 'the off hook kept a list');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }, { ALFRED_CODE_TURN_CHECK: '0' }).status, 0);
    assert.deepStrictEqual(p.spawned(), []);
});

test('turn-build: a TypeScript error blocks the Stop with the first 20 error lines, and the list is consumed', { skip: !posix && 'stub binaries are shell scripts' }, () =>
{
    const p = project();
    p.file('tsconfig.json', '{}');
    p.tsc('.', 25);
    p.write('src/a.ts');
    p.write('src/a.ts');
    p.write('README.md');
    assert.deepStrictEqual(fs.readFileSync(p.list, 'utf8').trim().split('\n').length, 3, 'every write is recorded');
    const r = p.run({ hook_event_name: 'Stop' });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /problem 20$/m);
    assert.doesNotMatch(r.stderr, /problem 21/);
    assert.match(r.stderr, /tsc --noEmit -p tsconfig\.json/);
    assert.deepStrictEqual(p.spawned().length, 1, 'one check for one root');
    assert.match(p.spawned()[0], /--noEmit -p .*tsconfig\.json/);
    assert.ok(!fs.existsSync(p.list), 'the list outlived the check');
    const row = fs.readFileSync(path.join(p.root, '.alfred', 'docs', 'hook-blocks', 'sess.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
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
        p.run({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(p.root, 'src/a.ts') } }, env);
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
    assert.ok(fs.existsSync(p.list), 'the fix-up edits are kept for the next turn');
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
    fs.mkdirSync(path.dirname(p.list), { recursive: true });
    fs.writeFileSync(p.list, '\u0000\n\n{]\n');
    assert.strictEqual(p.run({ hook_event_name: 'Stop' }).status, 0);
    const off = project();
    off.run({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(off.root, 'a.ts') } }, { ALFRED_CODE_HOOKS_OFF: 'check-turn-build' });
    assert.ok(!fs.existsSync(off.list));
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

// I12 (the user's ruling of 2026-09-29): the navigation server keeps rename_symbol and safe_delete_symbol on, and
// both change a source file - named in `relative_path`, from the project root. Both routes' spellings (built at run
// time - lint check 54 bans the bare server spelling as literal text).
test('turn-build: the navigation server\'s two kept edit tools record their file, on both routes', () =>
{
    const p = project();
    const sub = path.join(p.root, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    for (const server of ['plugin_alfred-navigation_alfred-navigation', 'alfred-navigation', 'plugin_navigation_navigation', 'navigation'])
        for (const tool of ['rename_symbol', 'safe_delete_symbol'])
            assert.strictEqual(p.run({ hook_event_name: 'PostToolUse', cwd: sub, tool_name: `mcp__${server}__${tool}`, tool_input: { name_path: 'A/b', relative_path: 'src/a.ts' } }).status, 0);
    p.run({ hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_alfred-navigation_alfred-navigation__find_symbol', tool_input: { name_path: 'A', relative_path: 'src/b.ts' } });
    p.run({ hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_alfred-navigation_alfred-navigation__rename_symbol', tool_input: { name_path: 'A' } });
    assert.deepStrictEqual(fs.readFileSync(p.list, 'utf8').trim().split('\n'), Array(8).fill(path.join(p.root, 'src', 'a.ts')),
        'eight edits, each from the project root whatever the cwd; a lookup and an edit with no file record nothing');
});
