'use strict';
// THE ONE-TIME DOCS-ROOT MOVE - an install whose docs live under the old default `.claude/docs`.
//
// The default moved to `.alfred/docs` (Claude Code prompts for every write under `.claude/`). An existing
// install is never moved silently: update OFFERS the move once (docs.docsMovePlan decides whether there
// is anything to offer), a yes moves the tree in one step (`git mv` for tracked files, so history
// follows; a plain rename for the rest), and a no pins the old root as the user's own so no later update
// asks again. Until an answer arrives nothing moves and the hooks keep reading the root the docs are in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const docs = require('./install/docs.js');
const { valueHash } = require('./install/stamp.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-move-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const git = (root, ...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
function repo(files = {}, { commit = [] } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'x@example.invalid');
    git(root, 'config', 'user.name', 'x');
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    if (commit.length) { git(root, 'add', '-f', ...commit); git(root, 'commit', '-qm', 'docs'); }
    return root;
}
const OLD = { '.claude/docs/architecture/ARCHITECTURE.md': '# arch\n', '.claude/docs/flow/COMMIT-GATE': 'VERIFIED x\n' };
const seeded = { ALFRED_CODE_DOCS_PATH: '.claude/docs' };
const ledgerOf = (value) => ({ ALFRED_CODE_DOCS_PATH: valueHash(value) });
const plan = (root, over = {}) => docs.docsMovePlan({ projectRoot: root, env: seeded, ledger: ledgerOf('.claude/docs'), stamped: true, launchEnv: {}, ...over });

test('the old root and the catalog agree on what the stack used to seed', () =>
{
    const row = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8')).env.find((r) => r.key === 'ALFRED_CODE_DOCS_PATH');
    assert.deepStrictEqual(row.former_defaults, [docs.LEGACY_DOCS_ROOT]);
    assert.strictEqual(docs.LEGACY_DOCS_ROOT, '.claude/docs');
});

test('plan: the stack\'s own seed over docs at the old root is offered, with what would move', () =>
{
    const root = repo(OLD, { commit: ['.claude/docs/architecture/ARCHITECTURE.md'] });
    const p = plan(root);
    assert.strictEqual(p.state, 'offer', p.why);
    assert.strictEqual(p.from, '.claude/docs');
    assert.strictEqual(p.to, '.alfred/docs');
    assert.deepStrictEqual(p.tracked, ['architecture/ARCHITECTURE.md']);
    assert.deepStrictEqual(p.untracked, ['flow/COMMIT-GATE']);
    assert.deepStrictEqual(p.conflicts, []);
});

test('plan: no ledger (a stamp from before it) - the old seed value is the evidence', () =>
{
    assert.strictEqual(plan(repo(OLD), { ledger: null }).state, 'offer');
    assert.strictEqual(plan(repo(OLD), { ledger: null, env: { CLAUDE_STACK_DOCS_PATH: '.claude/docs' } }).state, 'offer', 'the 1.x spelling'); // legacy-name
});

test('plan: an absent key on an installed project means the old default applied', () =>
{
    assert.strictEqual(plan(repo(OLD), { env: {} }).state, 'offer');
});

test('plan: every explicit root is left alone - never offered', () =>
{
    const root = repo(OLD);
    const cases = [
        [{ env: { ALFRED_CODE_DOCS_PATH: 'docs' } }, 'another root'],
        [{ ledger: {} }, 'a ledger that does not record the key - the value is the user\'s'],
        [{ ledger: ledgerOf('something else') }, 'changed since the stack wrote it'],
        [{ env: {}, launchEnv: { ALFRED_CODE_DOCS_PATH: 'notes/docs' } }, 'a root exported in the shell, with nothing in settings'],
        [{ env: {}, launchEnv: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }, 'even the old root, when the shell is what sets it'],
        [{ stamped: false }, 'no install record - a fresh install'],
    ];
    for (const [over, what] of cases) assert.strictEqual(plan(root, over).state, 'none', what);
});

test('plan: where settings hold the key, a launch value never decides - settings apply over the shell', () =>
{
    assert.strictEqual(plan(repo(OLD), { launchEnv: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }).state, 'offer', 'the session\'s own echo');
    assert.strictEqual(plan(repo(OLD), { launchEnv: { CLAUDE_STACK_DOCS_PATH: 'stale/value' } }).state, 'offer', 'a stale export'); // legacy-name
});

test('plan: nothing under the old root is a re-point, not an offer', () =>
{
    assert.strictEqual(plan(repo()).state, 'repoint', 'no folder');
    const root = repo();
    fs.mkdirSync(path.join(root, '.claude', 'docs', 'empty'), { recursive: true });
    assert.strictEqual(plan(root).state, 'repoint', 'only empty folders');
});

test('plan: a file already at the new root is a conflict, and the offer says so', () =>
{
    const root = repo({ ...OLD, '.alfred/docs/architecture/ARCHITECTURE.md': '# theirs\n' });
    assert.deepStrictEqual(plan(root).conflicts, ['architecture/ARCHITECTURE.md']);
});

test('move: tracked files go through git mv (staged as renames), the rest by rename, the old root is gone', () =>
{
    const root = repo({ ...OLD, '.claude/docs/.branches/b/x.md': 'o\n', '.claude/keep.txt': 'install\n' }, { commit: ['.claude/docs/architecture/ARCHITECTURE.md'] });
    const p = plan(root);
    const r = docs.moveDocsRoot({ projectRoot: root, plan: p });
    assert.deepStrictEqual({ ok: r.ok, moved: r.moved, gitMoved: r.gitMoved }, { ok: true, moved: 3, gitMoved: 1 });
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), 'utf8'), '# arch\n');
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'docs', 'flow', 'COMMIT-GATE')));
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'docs', '.branches', 'b', 'x.md')), 'a dot folder moves too');
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'docs')), 'the emptied old root is removed');
    assert.ok(fs.existsSync(path.join(root, '.claude', 'keep.txt')), 'nothing else under .claude/ is touched');
    assert.match(git(root, 'status', '--porcelain'), /^R {2}\.claude\/docs\/architecture\/ARCHITECTURE\.md -> \.alfred\/docs\/architecture\/ARCHITECTURE\.md$/m);
    git(root, 'commit', '-qm', 'move');
    assert.strictEqual(git(root, 'log', '--follow', '--format=%s', '--', '.alfred/docs/architecture/ARCHITECTURE.md').trim().split('\n').length, 2, 'history follows the file');
});

test('move: a failure part way puts every file back where it was', POSIX_ONLY, () =>
{
    const root = repo({ ...OLD, '.claude/docs/zz/last.md': 'z\n' }, { commit: ['.claude/docs/architecture/ARCHITECTURE.md'] });
    const p = plan(root);
    fs.mkdirSync(path.join(root, '.alfred', 'docs', 'zz'), { recursive: true });
    fs.chmodSync(path.join(root, '.alfred', 'docs', 'zz'), 0o500);
    try
    {
        const r = docs.moveDocsRoot({ projectRoot: root, plan: p });
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /zz\/last\.md/);
    }
    finally { fs.chmodSync(path.join(root, '.alfred', 'docs', 'zz'), 0o700); }
    for (const rel of Object.keys(OLD)) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is back`);
    assert.strictEqual(git(root, 'status', '--porcelain', '--', '.claude/docs/architecture'), '', 'the git mv is undone too');
});

// --- the installer ---------------------------------------------------------------------------------
// An older install, simulated on the current seed: the settings key and the ledger hold the old seed,
// the rule is stamped with it, and docs sit under it.
const SELECTION = 'rule baseline-docs-root\nrule baseline-git\n';
function olderInstall(repoDir, { ledger = true, key = true } = {})
{
    const claude = path.join(repoDir, '.claude');
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    if (key) settings.env.ALFRED_CODE_DOCS_PATH = '.claude/docs'; else delete settings.env.ALFRED_CODE_DOCS_PATH;
    fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify(settings, null, 2));
    const stamp = path.join(claude, 'alfred-code.stamp');
    let text = fs.readFileSync(stamp, 'utf8').replace(/settings\.json:ALFRED_CODE_DOCS_PATH=[0-9a-f]{64}/, `settings.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`);
    if (!ledger) text = text.split('\n').filter((l) => !l.startsWith('managed-')).join('\n');
    fs.writeFileSync(stamp, text);
    const rule = path.join(claude, 'rules', 'baseline-docs-root.md');
    fs.writeFileSync(rule, fs.readFileSync(rule, 'utf8').replace(/This install's root: `[^`]*`/, "This install's root: `.claude/docs`"));
    fs.rmSync(path.join(repoDir, '.alfred'), { recursive: true, force: true });
    for (const [rel, body] of Object.entries(OLD)) { fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true }); fs.writeFileSync(path.join(repoDir, rel), body); }
    return null;
}
const look = (repoDir) => ({
    env: JSON.parse(fs.readFileSync(path.join(repoDir, '.claude', 'settings.json'), 'utf8')).env,
    rule: /This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(repoDir, '.claude', 'rules', 'baseline-docs-root.md'), 'utf8'))[1],
    stamp: fs.readFileSync(path.join(repoDir, '.claude', 'alfred-code.stamp'), 'utf8'),
    old: fs.existsSync(path.join(repoDir, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md')),
    moved: fs.existsSync(path.join(repoDir, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md')),
});
const updateArgs = (...extra) => ['--scope', 'project', '--installed-only', ...extra];

test('installer: no answer - nothing moves, the offer is named, and the root in effect stays the old one', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs()], each: (r, i) => (i === 0 ? olderInstall(r) : null), inspect: look });
    assert.match(outs[1], /docs root: \.claude\/docs is the old default and holds 2 file\(s\) - \/alfred-code:update offers the move to \.alfred\/docs \(--docs-move move\|keep\); nothing moved/);
    assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old, result.moved], ['.claude/docs', '.claude/docs', true, false]);
});

test('installer: an absent key with docs at the old root is written back as the old root, still the stack\'s', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs()], each: (r, i) => (i === 0 ? olderInstall(r, { key: false }) : null), inspect: look });
    assert.strictEqual(result.env.ALFRED_CODE_DOCS_PATH, '.claude/docs', 'the hooks keep reading the root the docs are in');
    assert.match(result.stamp, new RegExp(`settings\\.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`), 'the stack\'s own value - a later update still offers');
});

test('installer: --docs-move move moves the tree, re-points the key and re-stamps the rule', POSIX_ONLY, () =>
{
    for (const ledger of [true, false])
    {
        const { outs, result } = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs('--docs-move', 'move')], each: (r, i) => (i === 0 ? olderInstall(r, { ledger }) : null), inspect: look });
        assert.match(outs[1], /docs root: moved \.claude\/docs -> \.alfred\/docs \(2 file\(s\), 0 through git mv\)/, `ledger=${ledger}`);
        assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old, result.moved], ['.alfred/docs', '.alfred/docs', false, true], `ledger=${ledger}`);
        assert.match(result.stamp, new RegExp(`settings\\.json:ALFRED_CODE_DOCS_PATH=${valueHash('.alfred/docs')}`), 'the new value is the stack\'s');
    }
});

test('installer: --docs-move keep pins the old root as the user\'s own, and no later run offers again', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-move', 'keep'), updateArgs()], each: (r, i) => (i === 0 ? olderInstall(r) : null), inspect: look,
    });
    assert.match(outs[1], /docs root: kept at \.claude\/docs - ALFRED_CODE_DOCS_PATH is yours from here on; no update offers the move again/);
    assert.doesNotMatch(outs[2], /offers the move/);
    assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old, result.moved], ['.claude/docs', '.claude/docs', true, false]);
    assert.doesNotMatch(result.stamp, /ALFRED_CODE_DOCS_PATH=/, 'out of the stack\'s ledger');
});

test('installer: a conflict refuses the move and changes nothing', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-move', 'move')], inspect: look,
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r);
            fs.mkdirSync(path.join(r, '.alfred', 'docs', 'flow'), { recursive: true });
            fs.writeFileSync(path.join(r, '.alfred', 'docs', 'flow', 'COMMIT-GATE'), 'theirs\n');
            return null;
        },
    });
    assert.match(outs[1], /!! docs root: not moved - 1 file\(s\) already at \.alfred\/docs: flow\/COMMIT-GATE/);
    assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old], ['.claude/docs', '.claude/docs', true]);
});

test('installer: --docs-move with nothing to offer is said and ignored; an empty old root is re-pointed', POSIX_ONLY, () =>
{
    const custom = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs('--docs-move', 'move')], inspect: look });
    assert.match(custom.outs[1], /docs move: nothing to offer \([^)]*\) - --docs-move ignored/);
    const empty = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()], inspect: look,
        each: (r, i) => { if (i === 0) { olderInstall(r); fs.rmSync(path.join(r, '.claude', 'docs'), { recursive: true, force: true }); } return null; },
    });
    assert.match(empty.outs[1], /docs root: \.claude\/docs \(the old default\) holds nothing - re-pointed to \.alfred\/docs/);
    assert.deepStrictEqual([empty.result.env.ALFRED_CODE_DOCS_PATH, empty.result.rule], ['.alfred/docs', '.alfred/docs']);
});

test('preflight: the offer is one line the update command asks from', POSIX_ONLY, () =>
{
    const root = repo(OLD, { commit: ['.claude/docs/architecture/ARCHITECTURE.md'] });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: seeded }));
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `version: 2.0.0\nsha: 0000000\nmanaged-env: settings.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}\n`);
    const out = docs.docsMoveLine(docs.docsMovePlan({ projectRoot: root, env: seeded, ledger: ledgerOf('.claude/docs'), stamped: true }));
    assert.strictEqual(out, 'docs-move: offer .claude/docs -> .alfred/docs\ttracked=1 untracked=1');
    assert.strictEqual(docs.docsMoveLine({ state: 'none', why: 'set by hand' }), 'docs-move: none (set by hand)');
    const snap = path.join(__dirname, '..');
    const res = require('node:child_process').spawnSync(process.execPath, [path.join(snap, 'scripts', 'update-preflight.js'), '--snapshot', snap, '--root', root, '--fixture', path.join(TMP, 'none.json')], { encoding: 'utf8' });
    assert.match(res.stdout, /^docs-move: offer \.claude\/docs -> \.alfred\/docs\ttracked=1 untracked=1$/m, res.stdout + res.stderr);
});

test('preflight --log: a moved docs root asks for a restart - the loaded rule still names the old one', () =>
{
    const log = path.join(TMP, `install-${seq++}.log`);
    const logMode = () => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'update-preflight.js'), '--log', log], { encoding: 'utf8' }).stdout;
    fs.writeFileSync(log, '==> mcps=0\n');
    assert.match(logMode(), /^restart: no$/m);
    fs.writeFileSync(log, '==> mcps=0\n==> docs root: moved .claude/docs -> .alfred/docs (2 file(s), 0 through git mv) - the rule is re-stamped\n');
    assert.match(logMode(), /^restart: yes$/m);
});

test('installer: a root the user keeps in settings.local.json is what applies - never offered, never re-pointed', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-move', 'move')],
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r);
            fs.writeFileSync(path.join(r, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'notes/docs' } }));
            return null;
        },
        inspect: (r) => ({ ...look(r), local: JSON.parse(fs.readFileSync(path.join(r, '.claude', 'settings.local.json'), 'utf8')).env }),
    });
    assert.match(outs[1], /docs move: nothing to offer \(the docs root is notes\/docs\) - --docs-move ignored/);
    assert.strictEqual(result.local.ALFRED_CODE_DOCS_PATH, 'notes/docs');
    assert.ok(result.old && !result.moved, 'nothing moved');
});

test('installer: a settings file that does not parse moves nothing - its owner cannot be read', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-move', 'move')], failOk: true,
        each: (r, i) => { if (i === 0) { olderInstall(r); fs.writeFileSync(path.join(r, '.claude', 'settings.json'), '{ not json'); } return null; },
        inspect: (r) => ({ old: fs.existsSync(path.join(r, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md')), moved: fs.existsSync(path.join(r, '.alfred', 'docs', 'architecture')) }),
    });
    assert.match(outs[1], /docs move: nothing to offer \(settings\.json cannot be read\) - --docs-move ignored/);
    assert.doesNotMatch(outs[1], /docs root: moved/);
});
