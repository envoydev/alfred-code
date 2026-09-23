'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build, copyInto } = require('./template.js');
const { cellPaths } = require('./cells.js');

const SESSION = { model: 'm', effort: 'medium', permissionMode: 'acceptEdits', settings: {}, env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, auth: ['ANTHROPIC_API_KEY'], scrub: [] };

function fixture(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-tpl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const src = path.join(dir, 'fixture');
    fs.mkdirSync(src);
    const git = (...a) => execFileSync('git', ['-C', src, ...a], { stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    fs.writeFileSync(path.join(src, 'app.txt'), 'app\n');
    git('add', '.');
    git('-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '-m', 'fixture');
    git('tag', 'bench-fixture-v1');
    return { bench: path.join(dir, 'bench'), source: src, lock: { tag: 'bench-fixture-v1', commit: git('rev-parse', 'HEAD') } };
}

// A setup step that counts its own runs in a file outside the template, and leaves a mark in the
// template's config that names the config's absolute path.
const counter = (file) => ['node', '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(file)},'x');fs.writeFileSync(process.argv[1]+'/where.json',JSON.stringify({config:process.argv[1],home:process.env.HOME}))`, '{config}'];

function arm(setup, extra = {})
{
    return { name: 'solo', pin: { kind: 'tag', value: 'v1' }, setup, onboarding: [], env: {}, hash: 'abcdef0123456789', ...extra };
}

test('a template is built once per arm and pin, and serves every cell', (t) =>
{
    const f = fixture(t);
    const runs = path.join(path.dirname(f.bench), 'runs.txt');
    const a = arm([counter(runs)]);
    const first = build({ arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const second = build({ arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    assert.strictEqual(first.built, true);
    assert.strictEqual(second.built, false);
    assert.strictEqual(fs.readFileSync(runs, 'utf8'), 'x');
    assert.ok(fs.existsSync(path.join(first.paths.repo, 'app.txt')));
    assert.deepStrictEqual(execFileSync('git', ['-C', first.paths.repo, 'remote'], { stdio: 'pipe' }).toString().trim(), '', 'no way back to the source repo');
});

test('each cell gets its own copy: what one cell writes into its config or home the next never sees', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ arm: arm([counter(path.join(path.dirname(f.bench), 'runs.txt'))]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const one = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    const two = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 2 });
    copyInto(paths, one);
    fs.writeFileSync(path.join(one.config, 'leak.txt'), 'x');
    fs.mkdirSync(one.home, { recursive: true });
    fs.writeFileSync(path.join(one.home, 'leak.txt'), 'x');
    fs.writeFileSync(path.join(one.repo, 'app.txt'), 'changed\n');
    copyInto(paths, two);
    assert.ok(!fs.existsSync(path.join(two.config, 'leak.txt')));
    assert.ok(!fs.existsSync(path.join(two.home, 'leak.txt')));
    assert.ok(!fs.existsSync(path.join(paths.config, 'leak.txt')), 'the template itself is never written');
    assert.strictEqual(fs.readFileSync(path.join(two.repo, 'app.txt'), 'utf8'), 'app\n');
});

test('an absolute template path inside a copied file is rewritten to the cell\'s own', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ arm: arm([counter(path.join(path.dirname(f.bench), 'runs.txt'))]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const cell = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    copyInto(paths, cell);
    const where = JSON.parse(fs.readFileSync(path.join(cell.config, 'where.json'), 'utf8'));
    assert.deepStrictEqual(where, { config: cell.config, home: cell.home });
});

test('a failed setup step leaves no template, and names the step', (t) =>
{
    const f = fixture(t);
    const a = arm([['node', '-e', '0'], ['node', '-e', 'process.exit(3)']]);
    assert.throws(() => build({ arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock }), /solo setup step 2 \(node\) exited 3/);
    assert.ok(!fs.existsSync(path.join(f.bench, 'work', 'templates', 'solo-abcdef01')));
});

test('a failed onboarding leaves no template either', (t) =>
{
    const f = fixture(t);
    const a = arm([], { onboarding: ['/init'] });
    const onboard = () => { throw new Error('session exited 1'); };
    assert.throws(() => build({ arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, onboard }), /solo onboarding 1: session exited 1/);
    assert.ok(!fs.existsSync(path.join(f.bench, 'work', 'templates', 'solo-abcdef01')));
});

test('onboarding runs each prompt in the template repo with the template\'s own account and home', (t) =>
{
    const f = fixture(t);
    const seen = [];
    const onboard = (prompt, where) => seen.push({ prompt, cwd: where.cwd, config: where.config, home: where.home });
    const { paths } = build({ arm: arm([], { onboarding: ['/init', 'second'] }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, onboard });
    assert.deepStrictEqual(seen.map((s) => s.prompt), ['/init', 'second']);
    for (const s of seen) assert.deepStrictEqual([s.cwd, s.config, s.home], [paths.repo, paths.config, paths.home]);
});

test('a template left half-built by a killed driver is rebuilt, never served', (t) =>
{
    const f = fixture(t);
    const runs = path.join(path.dirname(f.bench), 'runs.txt');
    const half = path.join(f.bench, 'work', 'templates', 'solo-abcdef01', 'repo');
    fs.mkdirSync(half, { recursive: true });
    fs.writeFileSync(path.join(half, 'stale.txt'), 'x');
    const out = build({ arm: arm([counter(runs)]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    assert.strictEqual(out.built, true);
    assert.ok(!fs.existsSync(path.join(out.paths.repo, 'stale.txt')));
});
