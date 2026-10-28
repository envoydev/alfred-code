'use strict';
// The writer of `<data root>/.variables` and its CLI (workspace roles and variables, D5 writer, D6 tracked-file rule, D7
// writer half): routing, the lock, the rename, the refusals and `show`'s sources. Each case reads the files it left.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const variables = require('./install/variables.js');

const CLI = path.join(__dirname, 'variables.js');
const MOD = path.join(__dirname, 'install', 'variables.js');
// Built at run time: a literal of this shape in a tracked file is the staged scan's credential.
const TOKEN = `ghp_${'Q7'.repeat(14)}`;

function sandbox(t)
{
    // .native: Windows CI's temp is an 8.3 name (RUNNER~1); a worktree's main checkout is read back long.
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-vars-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const env = { CLAUDE_CONFIG_DIR: path.join(dir, 'acct') };
    fs.mkdirSync(env.CLAUDE_CONFIG_DIR);
    return { dir, env };
}
function project(dir, rel = 'p', { stamp = true } = {})
{
    const root = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    if (stamp) fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'sha: x\nscope: project\n');
    return root;
}
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const varsOf = (root, data = '.alfred') => path.join(root, ...data.split('/'), '.variables');
const localOf = (root) => path.join(root, '.claude', 'settings.local.json');
const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
const logger = () => { const lines = []; const log = (l) => lines.push(String(l)); log.lines = lines; return log; };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

test('set writes a catalog key into .variables and reports it', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    const log = logger();
    const got = variables.set(root, ['ALFRED_CODE_SCORER_LEVEL=80'], { env, log });
    assert.deepStrictEqual(got, { written: ['ALFRED_CODE_SCORER_LEVEL'], toLocal: [], toSettings: [], refused: [] });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_SCORER_LEVEL=80\n');
    assert.ok(log.lines.some((l) => l.includes('ALFRED_CODE_SCORER_LEVEL') && l.includes('.alfred/.variables')), log.lines.join('\n'));
});

test('set routes a key settings.local.json holds to that file and prints the variables: ... overrides line', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(localOf(root), `${JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { ALFRED_CODE_HISTORY: '3' } }, null, 2)}\n`);
    put(varsOf(root), '# mine\nALFRED_CODE_HISTORY=5\n');
    const before = read(varsOf(root));
    const log = logger();
    const got = variables.set(root, ['ALFRED_CODE_HISTORY=9'], { env, log });
    assert.deepStrictEqual(got, { written: [], toLocal: ['ALFRED_CODE_HISTORY'], toSettings: [], refused: [] });
    const local = JSON.parse(read(localOf(root)));
    assert.strictEqual(local.env.ALFRED_CODE_HISTORY, '9');
    assert.deepStrictEqual(local.permissions, { allow: ['Bash(ls)'] }, 'the rest of the file is kept');
    assert.strictEqual(read(varsOf(root)), before, '.variables is left as it was (AC10)');
    assert.ok(log.lines.includes('variables: ALFRED_CODE_HISTORY set in .claude/settings.local.json (it overrides .variables here)'), log.lines.join('\n'));
});

// T12c, C7: a seed of the TEAM's value (stamp-docs-root's --seed-versioning at project scope) writes the shared file even
// where a developer's settings.local.json holds the key - their file is theirs and stays as it was.
test('set with team: true writes .variables where settings.local.json holds the key, and leaves that file byte-identical', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(localOf(root), `${JSON.stringify({ env: { ALFRED_CODE_DOCS_VERSIONING: 'local' } }, null, 2)}\n`);
    const before = read(localOf(root));
    const got = variables.set(root, ['ALFRED_CODE_DOCS_VERSIONING=git'], { env, log: logger(), team: true });
    assert.deepStrictEqual(got, { written: ['ALFRED_CODE_DOCS_VERSIONING'], toLocal: [], toSettings: [], refused: [] });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_DOCS_VERSIONING=git\n');
    assert.strictEqual(read(localOf(root)), before);
});

test('a local-scope set on a git-tracked .variables writes nothing and prints the tracked line (AC16)', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), 'ALFRED_CODE_HISTORY=5\n');
    git(root, 'init', '-q');
    git(root, 'add', '-f', '.alfred/.variables');
    git(root, 'commit', '-qm', 'team values');
    const log = logger();
    const got = variables.set(root, ['ALFRED_CODE_HISTORY=9'], { env, scope: 'local', log });
    assert.deepStrictEqual(got, { written: [], toLocal: [], toSettings: [], refused: ['ALFRED_CODE_HISTORY'] });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=5\n', 'byte-identical');
    assert.ok(log.lines.includes('!! variables: ALFRED_CODE_HISTORY - .variables is tracked here; change it with the team (no .variables.local yet)'), log.lines.join('\n'));
    // The same set at project scope writes: the team's file is the place.
    assert.deepStrictEqual(variables.set(root, ['ALFRED_CODE_HISTORY=9'], { env, scope: 'project', log: () => {} }).written, ['ALFRED_CODE_HISTORY']);
});

test('show prints the HOOKS_OFF line, the not-read line and the credential line for a hand-edited .variables, never a value (AC17)', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), `ALFRED_CODE_HISTORY=4\nALFRED_CODE_HOOKS_OFF=guard-secret-value\nALFRED_CODE_CONFIG_PROTECT=0\nALFRED_CODE_X_TOKEN=${TOKEN}\n`);
    const run = cli(['show', '--root', root], env);
    assert.strictEqual(run.status, 0, run.stderr);
    const out = run.stdout + run.stderr;
    assert.match(out, /^!! variables: ALFRED_CODE_HOOKS_OFF in \.variables is not read - it lives in \.claude\/settings\.json$/m);
    assert.match(out, /^!! variables: ALFRED_CODE_CONFIG_PROTECT in \.variables is not read - only the stack's variables are; a guard switch stays in \.claude\/settings\.json$/m);
    assert.match(out, /^!! variables: ALFRED_CODE_X_TOKEN in \.variables looks like a credential - keep it in \.alfred\/\.secrets$/m);
    assert.strictEqual((out.match(/ALFRED_CODE_X_TOKEN/g) || []).length, 1, 'one line for the key: the credential line, not the not-read line too');
    assert.ok(!out.includes(TOKEN) && !out.includes('guard-secret-value'), 'no value printed');
});

test('set ALFRED_CODE_HOOKS_OFF=x exits 1 naming settings.json', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    const run = cli(['set', '--root', root, 'ALFRED_CODE_HOOKS_OFF=guard-secret-value'], env);
    assert.strictEqual(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout + run.stderr, /ALFRED_CODE_HOOKS_OFF.*\.claude\/settings\.json/);
    assert.strictEqual(read(varsOf(root)), null, 'no file written');
    // The data root and a key outside the catalog are refused the same way, each named.
    const other = variables.set(root, ['ALFRED_CODE_DATA_PATH=x', 'ALFRED_CODE_PUSH_GATE=0', 'ALFRED_CODE_HISTORY=4'], { env, log: () => {} });
    assert.deepStrictEqual(other, { written: ['ALFRED_CODE_HISTORY'], toLocal: [], toSettings: [], refused: ['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_PUSH_GATE'] });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=4\n');
});

test('a credential-shaped value is refused, the key named, the value in no output or file (AC17)', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), 'ALFRED_CODE_HISTORY=5\n');
    const run = cli(['set', '--root', root, `ALFRED_CODE_FORGE_WATCH=${TOKEN}`], env);
    assert.strictEqual(run.status, 1);
    const out = run.stdout + run.stderr;
    assert.match(out, /ALFRED_CODE_FORGE_WATCH/);
    assert.ok(!out.includes(TOKEN) && !out.includes(TOKEN.slice(4, 16)), 'the value is in no output');
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=5\n');
    assert.ok(!fs.readdirSync(path.dirname(varsOf(root))).some((f) => (read(path.join(path.dirname(varsOf(root)), f)) || '').includes(TOKEN)), 'nor in any file');
    // A value on more than one line would write a second line: refused too.
    assert.deepStrictEqual(variables.set(root, [['ALFRED_CODE_HISTORY', '4\nALFRED_CODE_SCORER=1']], { env, log: () => {} }).refused, ['ALFRED_CODE_HISTORY']);
});

test('comments and unknown lines survive every write (AC10)', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    const text = '# team values\n; old style\nexport ALFRED_CODE_HISTORY=5\nNOT A LINE\nMY_OWN=1\n\nALFRED_CODE_PUSH_GATE=0\n';
    put(varsOf(root), text);
    variables.set(root, ['ALFRED_CODE_HISTORY=6', 'ALFRED_CODE_SCORER_LEVEL=70', 'ALFRED_CODE_TURN_CHECK=1'], { env, log: () => {} });
    assert.strictEqual(read(varsOf(root)), '# team values\n; old style\nexport ALFRED_CODE_HISTORY=6\nNOT A LINE\nMY_OWN=1\n\nALFRED_CODE_PUSH_GATE=0\n'
        + 'ALFRED_CODE_TURN_CHECK=1\nALFRED_CODE_SCORER_LEVEL=70\n', 'kept in place, a new key appended in catalog order');
    // An empty value removes the key's line; the rest stays.
    variables.set(root, ['ALFRED_CODE_TURN_CHECK='], { env, log: () => {} });
    assert.ok(!/ALFRED_CODE_TURN_CHECK/.test(read(varsOf(root))));
    assert.ok(read(varsOf(root)).startsWith('# team values\n; old style\n'));
    // A set that changes nothing writes nothing: the bytes and the inode stay.
    const ino = fs.statSync(varsOf(root)).ino;
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '6' }), { changed: false });
    assert.strictEqual(fs.statSync(varsOf(root)).ino, ino);
    // CRLF stays CRLF.
    put(varsOf(root), '# crlf\r\nALFRED_CODE_HISTORY=5\r\n');
    variables.set(root, ['ALFRED_CODE_HISTORY=7', 'ALFRED_CODE_SCORER=1'], { env, log: () => {} });
    assert.strictEqual(read(varsOf(root)), '# crlf\r\nALFRED_CODE_HISTORY=7\r\nALFRED_CODE_SCORER=1\r\n');
});

test('a quoted value survives an unrelated set (Review Focus 3)', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), 'ALFRED_CODE_SCORER_OUTPUTS="spec, plan"\nALFRED_CODE_FORGE_WATCH=\'on\'\n');
    variables.set(root, ['ALFRED_CODE_HISTORY=2'], { env, log: () => {} });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_SCORER_OUTPUTS="spec, plan"\nALFRED_CODE_FORGE_WATCH=\'on\'\nALFRED_CODE_HISTORY=2\n');
    assert.deepStrictEqual(variables.read(varsOf(root)).values.ALFRED_CODE_SCORER_OUTPUTS, 'spec, plan');
    // A value the reader would strip is quoted on the way in, so it reads back as written.
    variables.set(root, ['ALFRED_CODE_SCORER_OUTPUTS="x"'], { env, log: () => {} });
    assert.strictEqual(variables.read(varsOf(root)).values.ALFRED_CODE_SCORER_OUTPUTS, '"x"');
});

test('two writers at once both land through the lock (AC11)', async (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), '# shared\n');
    const writer = (key) => new Promise((resolve) =>
    {
        const code = `const v = require(${JSON.stringify(MOD)}); for (let i = 1; i <= 50; i++) { const r = v.set(${JSON.stringify(root)}, [\`${key}=\${i}\`], { env: ${JSON.stringify(env)}, log: () => {} }); if (r.written.length !== 1) { console.error('lost', i); process.exit(3); } }`;
        const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (status) => resolve({ status, err }));
    });
    // A reader beside them: every read is a whole file (the rename, Review Focus 4).
    const reader = new Promise((resolve) =>
    {
        const code = `const fs = require('fs'); let bad = 0; const end = Date.now() + 1500; while (Date.now() < end) { let t = ''; try { t = fs.readFileSync(${JSON.stringify(varsOf(root))}, 'utf8'); } catch { continue; } if (!t.startsWith('# shared\\n') || !t.endsWith('\\n')) bad++; } console.log(bad);`;
        const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.on('close', () => resolve(Number(out.trim())));
    });
    const [a, b, partial] = await Promise.all([writer('ALFRED_CODE_HISTORY'), writer('ALFRED_CODE_SCORER_LEVEL'), reader]);
    assert.strictEqual(a.status, 0, a.err);
    assert.strictEqual(b.status, 0, b.err);
    assert.strictEqual(partial, 0, 'no reader saw a partial file');
    const values = variables.read(varsOf(root)).values;
    assert.strictEqual(values.ALFRED_CODE_HISTORY, '50');
    assert.strictEqual(values.ALFRED_CODE_SCORER_LEVEL, '50');
    assert.ok(read(varsOf(root)).startsWith('# shared\n'));
    assert.ok(!fs.existsSync(`${varsOf(root)}.lock`), 'the lock is released');
});

// The Windows gate leg (2026-10-27): a rename over a file another process holds open fails with a transient EPERM, and
// the hook loader reads .variables at every hook start - the write retries it inside the lock's budget.
test('a rename a reader blocks for a moment (EPERM, EACCES, EBUSY) is retried; one blocked past the budget is unwritable', (t) =>
{
    const { dir } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), 'ALFRED_CODE_HISTORY=5\n');
    let clock = 0;
    const seams = { now: () => clock, sleep: (ms) => { clock += ms; } };
    const blocked = (codes) => (from, to) =>
    {
        const code = codes.shift();
        if (code) throw Object.assign(new Error(code), { code });
        fs.renameSync(from, to);
    };
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '6' }, { ...seams, rename: blocked(['EPERM', 'EACCES', 'EBUSY']) }), { changed: true });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=6\n');
    const always = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '7' }, { ...seams, retryMs: 200, rename: always }), { changed: false, why: 'unwritable' });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=6\n');
    const other = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
    let slept = 0;
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '7' }, { now: () => 0, sleep: () => { slept++; }, rename: other }), { changed: false, why: 'unwritable' });
    assert.strictEqual(slept, 0, 'any other failure is not retried');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(varsOf(root))).sort(), ['.variables'], 'no temp file or lock left');
});

test('the write is a rename - no reader sees a partial file (Review Focus 4)', (t) =>
{
    const { dir } = sandbox(t);
    const root = project(dir);
    put(varsOf(root), 'ALFRED_CODE_HISTORY=5\n');
    const ino = fs.statSync(varsOf(root)).ino;
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '6' }), { changed: true });
    assert.notStrictEqual(fs.statSync(varsOf(root)).ino, ino, 'a new file renamed into place, never a write in place');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(varsOf(root))).sort(), ['.variables'], 'no temp file or lock left');
    // A lock a live run holds: the write waits, then reports it, and the file is unchanged.
    put(`${varsOf(root)}.lock`, '');
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '7' }, { retryMs: 120 }), { changed: false, why: 'locked' });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=6\n');
    // One a dead run left (older than the stale bound) is taken over.
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(`${varsOf(root)}.lock`, old, old);
    assert.deepStrictEqual(variables.write(varsOf(root), { ALFRED_CODE_HISTORY: '7' }), { changed: true });
    assert.strictEqual(read(varsOf(root)), 'ALFRED_CODE_HISTORY=7\n');
});

test('set writes under the moved root (Review Focus 2)', (t) =>
{
    const { dir, env } = sandbox(t);
    const root = project(dir);
    put(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'data/al' } }));
    assert.strictEqual(variables.fileOf(root, { env }), varsOf(root, 'data/al'));
    variables.set(root, ['ALFRED_CODE_HISTORY=3'], { env, log: () => {} });
    assert.strictEqual(read(varsOf(root, 'data/al')), 'ALFRED_CODE_HISTORY=3\n');
    assert.strictEqual(read(varsOf(root)), null);
});

test('a linked worktree with no own file reads and writes the main worktree\'s', (t) =>
{
    const { dir, env } = sandbox(t);
    const main = project(dir, 'main');
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'base');
    put(varsOf(main), 'ALFRED_CODE_HISTORY=5\n');
    const wt = path.join(dir, 'wt');
    git(main, 'worktree', 'add', '-q', '--detach', wt);
    assert.strictEqual(variables.fileOf(wt, { env }), varsOf(main));
    put(varsOf(wt), 'ALFRED_CODE_HISTORY=6\n');
    assert.strictEqual(variables.fileOf(wt, { env }), varsOf(wt), 'its own once it has one');
});

test('show names own, from <rel>, settings.local.json and default', (t) =>
{
    const { dir, env } = sandbox(t);
    const parent = project(dir, 'ws');
    const kid = project(dir, 'ws/kid');
    put(path.join(parent, '.alfred', 'workspace'), 'child kid\n');
    put(path.join(kid, '.alfred', 'workspace'), 'parent ..\n');
    put(varsOf(parent), 'ALFRED_CODE_HISTORY=7\nALFRED_CODE_SCORER_LEVEL=60\n');
    put(varsOf(kid), 'ALFRED_CODE_SCORER_LEVEL=80\n');
    put(localOf(kid), JSON.stringify({ env: { ALFRED_CODE_TURN_CHECK: '1' } }));
    const on = { ...env, ALFRED_CODE_WORKSPACE: '1' };
    const rows = Object.fromEntries(variables.show(kid, { env: on }).map((r) => [r.key, r]));
    assert.deepStrictEqual(rows.ALFRED_CODE_SCORER_LEVEL, { key: 'ALFRED_CODE_SCORER_LEVEL', value: '80', source: 'own' });
    assert.deepStrictEqual(rows.ALFRED_CODE_HISTORY, { key: 'ALFRED_CODE_HISTORY', value: '7', source: 'from ..' });
    assert.deepStrictEqual(rows.ALFRED_CODE_TURN_CHECK, { key: 'ALFRED_CODE_TURN_CHECK', value: '1', source: 'settings.local.json' });
    const catalog = require('../meta/environment.json').env;
    const memory = catalog.find((r) => r.key === 'ALFRED_CODE_MEMORY');
    assert.deepStrictEqual(rows.ALFRED_CODE_MEMORY, { key: 'ALFRED_CODE_MEMORY', value: String(memory.default ?? ''), source: 'default' });
    assert.ok(!rows.ALFRED_CODE_HOOKS_OFF && !rows.ALFRED_CODE_DATA_PATH, 'the two settings keys are no variables');
    // The CLI prints the same rows, one per key, and the loader's notes.
    put(varsOf(kid), 'ALFRED_CODE_SCORER_LEVEL=80\nNOT A LINE\n');
    const run = cli(['show', '--root', kid], on);
    assert.strictEqual(run.status, 0, run.stderr);
    assert.match(run.stdout, /^ALFRED_CODE_HISTORY=7 \(from \.\.\)$/m);
    assert.match(run.stdout, /^ALFRED_CODE_SCORER_LEVEL=80 \(own\)$/m);
    assert.match(run.stdout, /^!! variables: \.variables line 2 is not a KEY=value line - not read$/m);
});

test('the CLI names its usage on a bad call', (t) =>
{
    const { env } = sandbox(t);
    for (const args of [[], ['nope'], ['set', '--root'], ['set', '--root', '.', 'NOEQUALS']])
    {
        const run = cli(args, env);
        assert.strictEqual(run.status, 2, `${args.join(' ')}: ${run.stdout}${run.stderr}`);
        assert.match(run.stderr, /usage: node scripts\/variables\.js/);
    }
});

// F3 / F15: `recommend` states the docs-versioning answer the walk lists first.
test('recommend: a folder with no repository, a local-scope child, a bad flag', () =>
{
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    try
    {
        const none = cli(['recommend', '--root', bare]);
        assert.strictEqual(none.status, 0, none.stderr);
        assert.strictEqual(none.stdout, 'docs-versioning: recommend local - no git repository, so nothing can commit the docs\n');
        git(bare, 'init', '-q');
        const kid = cli(['recommend', '--root', bare, '--scope', 'local', '--child']);
        assert.strictEqual(kid.stdout, 'docs-versioning: recommend local - a local-scope child keeps its data root out of git\n');
        const plain = cli(['recommend', '--root', bare]);
        assert.strictEqual(plain.stdout, 'docs-versioning: recommend git - a git repository - the docs are committed and versioned per branch\n');
        assert.strictEqual(cli(['recommend', '--bogus']).status, 2);
    }
    finally { fs.rmSync(bare, { recursive: true, force: true }); }
});
