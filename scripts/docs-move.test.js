'use strict';
// THE ONE-TIME DOCS-ROOT MOVE - an install whose docs live under the old default `.claude/docs`.
//
// The default moved to `.alfred/docs` (Claude Code prompts for every write under `.claude/`). An existing
// install is never moved silently: update OFFERS the move once (docs.docsMovePlan decides whether there
// is anything to offer), a yes moves the tree in one step (`git mv` for tracked files, so history
// follows; a plain rename for the rest), and a no pins the old root as the user's own so no later update
// asks again. Until an answer arrives nothing moves and the hooks keep reading the root the docs are in.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
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
        [{ env: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' }, ledger: {} }, 'the default root, set by hand'],
        [{ personal: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }, 'a root the user keeps in settings.local.json'],
        [{ stamped: false }, 'no install record - a fresh install'],
        [{ env: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' } }, 'already at the data root\'s docs folder'],
    ];
    for (const [over, what] of cases) assert.strictEqual(plan(root, over).state, 'none', what);
});

// M1: a 2.0.0 keep made the key the user's own - out of the ledger - and 2.0.0 promised no update offers again.
// Offered once more, an unattended update took the recommended move over the user's answer.
test('plan: the old default the user kept in 2.0.0 is offered again, marked yours - a 2.1 keep ends it', () =>
{
    // 2026-10-06 ruling: every Alfred Code file belongs under the data root, so a 2.0.0 keep is asked once more.
    const root = repo(OLD);
    for (const [over, what] of [[{ ledger: {} }, 'a ledger that does not record the key (the 2.0.0 keep)'], [{ ledger: ledgerOf('something else') }, 'changed since the stack wrote it']])
    {
        const p = plan(root, over);
        assert.deepStrictEqual([p.state, p.yours], ['offer', true], what);
    }
    assert.strictEqual(plan(root).yours, undefined, 'the stack\'s own seed, which the ledger records, is offered unmarked');
    assert.strictEqual(plan(root).state, 'offer');
    assert.strictEqual(plan(root, { ledger: {}, kept: true }).state, 'none', 'the data move was answered keep');
    const own = repo({ 'notes/architecture/ARCHITECTURE.md': '# a\n' });
    assert.match(plan(own, { env: { ALFRED_CODE_DOCS_PATH: 'notes' }, ledger: {} }).why, /set by hand/, 'a root of the user\'s own elsewhere is never offered');
});

test('plan: the stack\'s docs under an earlier data root move with the root', () =>
{
    const root = repo({ '.alfred/docs/architecture/ARCHITECTURE.md': '# a\n' });
    const p = plan(root, { env: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' }, ledger: ledgerOf('.alfred/docs'), to: '.data/docs' });
    assert.deepStrictEqual([p.state, p.from, p.to, p.untracked], ['offer', '.alfred/docs', '.data/docs', ['architecture/ARCHITECTURE.md']]);
    assert.strictEqual(plan(root, { env: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' }, ledger: null, to: '.data/docs' }).state, 'offer', 'no ledger: the catalog default is the stack\'s');
    assert.strictEqual(plan(root, { env: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' }, ledger: {}, to: '.data/docs' }).state, 'none', 'set by hand');
});

test('plan: the launch environment never decides - settings apply over a shell export, and the seed writes one anyway', () =>
{
    // Review M2: a local install moved to project scope loses its local key earlier in the run while the
    // session still exports it; reading the export as the user's orphaned the docs with no offer.
    assert.strictEqual(plan(repo(OLD), { env: {}, launchEnv: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }).state, 'offer');
    assert.strictEqual(plan(repo(OLD), { launchEnv: { CLAUDE_STACK_DOCS_PATH: 'stale/value' } }).state, 'offer'); // legacy-name
});

test('plan: the old root git ignored, with nothing tracked, is named so the move keeps it out of git', () =>
{
    const ignored = repo({ ...OLD, '.gitignore': '.claude/*\n' });
    assert.strictEqual(plan(ignored).ignored, true);
    assert.strictEqual(plan(repo(OLD)).ignored, false, 'visible to git, not ignored');
    const tracked = repo({ ...OLD, '.gitignore': '.claude/*\n' }, { commit: ['.claude/docs/architecture/ARCHITECTURE.md'] });
    assert.strictEqual(plan(tracked).ignored, false, 'a tracked file means git sees the root');
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
const SELECTION = 'rule alfred-docs-root\nrule alfred-git\n';
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
    const rule = path.join(claude, 'rules', 'alfred-docs-root.md');
    fs.writeFileSync(rule, fs.readFileSync(rule, 'utf8').replace(/This install's root: `[^`]*`/, "This install's root: `.claude/docs`"));
    fs.rmSync(path.join(repoDir, '.alfred'), { recursive: true, force: true });
    for (const [rel, body] of Object.entries(OLD)) { fs.mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true }); fs.writeFileSync(path.join(repoDir, rel), body); }
    return null;
}
const look = (repoDir) => ({
    env: JSON.parse(fs.readFileSync(path.join(repoDir, '.claude', 'settings.json'), 'utf8')).env,
    rule: /This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(repoDir, '.claude', 'rules', 'alfred-docs-root.md'), 'utf8'))[1],
    stamp: fs.readFileSync(path.join(repoDir, '.claude', 'alfred-code.stamp'), 'utf8'),
    old: fs.existsSync(path.join(repoDir, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md')),
    moved: fs.existsSync(path.join(repoDir, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md')),
});
const updateArgs = (...extra) => ['--scope', 'project', '--installed-only', ...extra];

test('installer: no answer - nothing moves, the offer is named, and the root in effect stays the old one', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs()], each: (r, i) => (i === 0 ? olderInstall(r) : null), inspect: look });
    assert.match(outs[1], /docs root: \.claude\/docs is the old default and holds 2 file\(s\) - \/alfred-code:update offers the move to \.alfred\/docs \(--data-move move\|keep\); nothing moved/);
    assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old, result.moved], ['.claude/docs', '.claude/docs', true, false]);
});

test('installer: an absent key with docs at the old root is written back as the old root, still the stack\'s', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs()], each: (r, i) => (i === 0 ? olderInstall(r, { key: false }) : null), inspect: look });
    assert.strictEqual(result.env.ALFRED_CODE_DOCS_PATH, '.claude/docs', 'the hooks keep reading the root the docs are in');
    assert.match(result.stamp, new RegExp(`settings\\.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`), 'the stack\'s own value - a later update still offers');
});

// Task 3 (2.1.0): an unstamped legacy copy-route install - no stamp, no copied engine, but the stack's hooks
// and skills on disk - is update's to take, so its docs under the old default are the stack's own too: held
// and offered, never left behind while the root silently becomes the new default.
test('installer: an unstamped legacy install with docs at the old root keeps them in effect and names the offer', POSIX_ONLY, () =>
{
    const { renamed } = require('./install/manifest.js').loadManifest(path.join(__dirname, '..'));
    const prepare = (r) =>
    {
        const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), body); };
        for (const n of Object.keys(renamed.skills).slice(0, 3)) put(`.claude/skills/${n}/SKILL.md`, `---\nname: ${n}\n---\n`);
        put('.claude/hooks/guard-catastrophic-rm.js', '// old\n');
        put('.claude/rules/alfred-interaction.md', '# old\n');
        put('.claude/settings.json', '{}\n');
        for (const [rel, body] of Object.entries(OLD)) put(rel, body);
    };
    const { out, result } = seedRun('update', '', { args: updateArgs(), prepare, inspect: look });
    assert.match(out, /docs root: \.claude\/docs is the old default and holds 2 file\(s\) - \/alfred-code:update offers the move to \.alfred\/docs \(--data-move move\|keep\); nothing moved/, out);
    assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old, result.moved], ['.claude/docs', '.claude/docs', true, false]);

    // The 1.x key holding the old default is the stack's own seed there too - no ledger says otherwise, so the
    // installer offers what the preflight offered, and a 'move' answer moves the tree.
    const keyed = (r) => { prepare(r); fs.writeFileSync(path.join(r, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_STACK_DOCS_PATH: '.claude/docs' } })); }; // legacy-name
    const held = seedRun('update', '', { args: updateArgs(), prepare: keyed, inspect: look });
    assert.match(held.out, /docs root: \.claude\/docs is the old default and holds 2 file\(s\)/, held.out);
    // With no answer the held root stays the stack's in the new ledger, so the next update offers again: an
    // unstamped install has no ledger, which is not an empty one saying the stack managed nothing here.
    assert.match(held.result.stamp, new RegExp(`settings\\.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`), 'the stack\'s own value - a later update still offers');
    const moved = seedRun('update', '', { args: updateArgs('--docs-move', 'move'), prepare: keyed, inspect: look });
    assert.match(moved.out, /docs root: moved \.claude\/docs -> \.alfred\/docs \(2 file\(s\)/, moved.out);
    assert.deepStrictEqual([moved.result.env.ALFRED_CODE_DOCS_PATH, moved.result.rule, moved.result.old, moved.result.moved], ['.alfred/docs', '.alfred/docs', false, true]);
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

test('M1 installer: a .claude/docs root the user kept in 2.0.0 moves only on an explicit answer - no flag moves nothing', POSIX_ONLY, () =>
{
    const kept20 = (r, i) =>
    {
        if (i !== 0) return null;
        olderInstall(r);
        // What 2.0.0's keep wrote: the key stays, the ledger no longer records it.
        const stamp = path.join(r, '.claude', 'alfred-code.stamp');
        fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/,?settings\.json:ALFRED_CODE_DOCS_PATH=[0-9a-f]{64}/, ''));
        return null;
    };
    // An unattended update passes no --data-move for a yours=yes offer (update.md): nothing moves, the key stays.
    const quiet = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs()], each: kept20, inspect: look });
    assert.doesNotMatch(quiet.outs[1], /docs root: moved/, quiet.outs[1]);
    assert.deepStrictEqual([quiet.result.env.ALFRED_CODE_DOCS_PATH, quiet.result.old, quiet.result.moved], ['.claude/docs', true, false]);
    // The user's own 'move' answer moves it.
    const moved = seedRun(['install', 'update'], SELECTION, { args: [['--scope', 'project'], updateArgs('--data-move', 'move')], each: kept20, inspect: look });
    assert.match(moved.outs[1], /docs root: moved/, moved.outs[1]);
    assert.strictEqual(moved.result.moved, true);
});

// 2.2.0 upgrade: the move's own Bash call ends in PostToolUse hooks that still hold the session's old root, and the
// monitor's recursive mkdir rebuilt .claude/docs/flow; the next session start folds it into the live root.
test('installer: hook state a stale session writes after the move is folded in at the next session start', POSIX_ONLY, () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const run = (r, file, payload, env) => execFileSync(process.execPath, [path.join(HOOKS, file)], { cwd: r, input: JSON.stringify(payload), encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: r, CLAUDE_DOCS_PATH: '', ALFRED_CODE_MONITOR: 'log', ...env } }); // legacy-name
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--data-move', 'move')],
        each: (r, i) => (i === 0 ? olderInstall(r) : null),
        inspect: (r) =>
        {
            const settings = JSON.parse(fs.readFileSync(path.join(r, '.claude', 'settings.json'), 'utf8'));
            run(r, 'monitor-session.js', { hook_event_name: 'PostToolUse', session_id: 'stale', tool_name: 'Bash', tool_input: { command: 'update' }, cwd: r }, { ALFRED_CODE_DOCS_PATH: '.claude/docs' });
            const raced = fs.existsSync(path.join(r, '.claude', 'docs', 'flow', 'monitor-stale.jsonl'));
            const live = { ALFRED_CODE_DOCS_PATH: settings.env.ALFRED_CODE_DOCS_PATH };
            run(r, 'docs-session.js', { hook_event_name: 'SessionStart', session_id: 'fresh', cwd: r }, live);
            run(r, 'docs-session.js', { hook_event_name: 'SessionStart', session_id: 'again', cwd: r }, live);
            const at = (rel) => path.join(r, rel);
            return {
                raced, docsPath: settings.env.ALFRED_CODE_DOCS_PATH,
                old: fs.existsSync(at('.claude/docs')), row: fs.readFileSync(at('.alfred/docs/flow/monitor-stale.jsonl'), 'utf8'),
                log: fs.readFileSync(at('.alfred/docs/docs-log.jsonl'), 'utf8'), moved: fs.existsSync(at('.alfred/docs/architecture/ARCHITECTURE.md')),
            };
        },
    });
    assert.match(outs[1], /docs root: moved \.claude\/docs -> \.alfred\/docs/, outs[1]);
    assert.strictEqual(result.raced, true, 'the stale hook rebuilt the old root - the case this guards');
    assert.strictEqual(result.docsPath, '.alfred/docs');
    assert.strictEqual(result.old, false, 'the stranded root is gone after the next start');
    assert.match(result.row, /"t":"Bash"/, 'its row now sits under the live root');
    assert.strictEqual(result.moved, true, 'the moved docs are untouched');
    assert.strictEqual(result.log.match(/"event":"stranded-root"/g).length, 1, 'a second start finds nothing');
});

// 2.2.2: the plans left superpowers/ (the dropped superpowers plugin's folder name) for <docs-path>/plans/.
test('installer: an update moves superpowers/plans up to plans/, a fresh install makes no superpowers/, a re-run is quiet', POSIX_ONLY, () =>
{
    const at = (r, rel) => path.join(r, '.alfred', 'docs', ...rel.split('/'));
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs(), updateArgs()],
        each: (r, i) =>
        {
            const seen = { superpowers: fs.existsSync(at(r, 'superpowers')), plan: fs.existsSync(at(r, 'plans/cart.md')) && fs.readFileSync(at(r, 'plans/cart.md'), 'utf8') };
            if (i === 0)
            {
                fs.mkdirSync(at(r, 'superpowers/plans'), { recursive: true });
                fs.writeFileSync(at(r, 'superpowers/plans/cart.md'), '# cart - plan\n');
            }
            return seen;
        },
    });
    assert.deepStrictEqual(steps[0], { superpowers: false, plan: false }, 'a fresh install creates no superpowers/');
    assert.match(outs[1], /docs migration \(plans\): superpowers\/plans\/ -> plans\//, outs[1]);
    assert.deepStrictEqual(steps[1], { superpowers: false, plan: '# cart - plan\n' }, 'the plan moved and the emptied folder went');
    assert.doesNotMatch(outs[2], /docs migration \(plans\)/, 'a re-run moves nothing');
    assert.deepStrictEqual(steps[2], steps[1]);
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
    assert.match(custom.outs[1], /docs move: nothing to offer \([^)]*\) - the docs stay where they are/);
    const empty = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()], inspect: look,
        each: (r, i) => { if (i === 0) { olderInstall(r); fs.rmSync(path.join(r, '.claude', 'docs'), { recursive: true, force: true }); } return null; },
    });
    assert.match(empty.outs[1], /docs root: \.claude\/docs holds nothing - re-pointed to \.alfred\/docs/);
    assert.deepStrictEqual([empty.result.env.ALFRED_CODE_DOCS_PATH, empty.result.rule], ['.alfred/docs', '.alfred/docs']);
});

test('preflight: the offer is one line the update command asks from', POSIX_ONLY, () =>
{
    const root = repo(OLD, { commit: ['.claude/docs/architecture/ARCHITECTURE.md'] });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: seeded }));
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `version: 2.0.0\nsha: 0000000\nmanaged-env: settings.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}\n`);
    const snap = path.join(__dirname, '..');
    const res = require('node:child_process').spawnSync(process.execPath, [path.join(snap, 'scripts', 'update-preflight.js'), '--snapshot', snap, '--root', root, '--fixture', path.join(TMP, 'none.json')], { encoding: 'utf8' });
    assert.match(res.stdout, /^data-move: offer \.alfred\tfrom=\.claude\/docs\tdocs=2 serena=no browser=none memory=no$/m, res.stdout + res.stderr);
});

test('preflight --log: a moved docs root asks for a restart - the loaded rule still names the old one', () =>
{
    const log = path.join(TMP, `install-${seq++}.log`);
    const logMode = () => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'update-preflight.js'), '--log', log], { encoding: 'utf8' }).stdout;
    fs.writeFileSync(log, '==> mcps=0\n');
    assert.match(logMode(), /^restart: no$/m);
    fs.writeFileSync(log, '==> mcps=0\n==> docs root: moved .claude/docs -> .alfred/docs (2 file(s), 0 through git mv) - the rule is re-stamped\n');
    assert.match(logMode(), /^restart: yes$/m);
    // A server's data waits for that server's next start - the restart is what moves it.
    fs.writeFileSync(log, '==> mcps=0\n==> data root: .alfred - 0 moved now, 2 waiting for a server\'s next start; restart the session\n');
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
    assert.match(outs[1], /docs move: nothing to offer \(settings\.local\.json holds your own docs root\) - the docs stay where they are/);
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
    assert.match(outs[1], /docs move: nothing to offer \(settings\.json cannot be read\) - the docs stay where they are/);
    assert.doesNotMatch(outs[1], /docs root: moved/);
});

test('validate never re-points a missing docs key over docs still under the old default', () =>
{
    const body = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'commands', 'validate.md'), 'utf8');
    assert.match(body, /`ALFRED_CODE_DOCS_PATH` MISSING while\s+`\.claude\/docs` holds files[\s\S]{0,400}never offered[\s\S]{0,300}`\/alfred-code:update`/);
});


// --- review fixes (opus review, 2026-09-26) ---------------------------------------------------------

test('installer: a root in settings.local.json at project scope is the user\'s - never moved, the rule stays settings.json\'s', POSIX_ONLY, () =>
{
    // Review B1: the move wrote the overlay alone, so settings.json and the stamped rule kept the old root while
    // the hooks read the new one; a keep let the seed write .alfred/docs into settings.json under a local .claude/docs.
    for (const answer of ['move', 'keep'])
    {
        const { outs, result } = seedRun(['install', 'update', 'update'], SELECTION, {
            args: [['--scope', 'project'], updateArgs('--docs-move', answer), updateArgs()],
            each: (r, i) =>
            {
                if (i !== 0) return null;
                olderInstall(r);
                fs.writeFileSync(path.join(r, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }));
                return null;
            },
            inspect: (r) => ({ ...look(r), local: JSON.parse(fs.readFileSync(path.join(r, '.claude', 'settings.local.json'), 'utf8')).env }),
        });
        assert.match(outs[1], /docs move: nothing to offer \(settings\.local\.json holds your own docs root\) - the docs stay where they are/, answer);
        assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.local.ALFRED_CODE_DOCS_PATH, result.rule, result.old, result.moved],
            ['.claude/docs', '.claude/docs', '.claude/docs', true, false], answer);
    }
});

test('installer: an unreadable settings file leaves the stamped rule as it was', POSIX_ONLY, () =>
{
    // Review M3: the plan said 'cannot be read', the rule was re-stamped to the new default anyway.
    const { result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-move', 'move')], failOk: true,
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r);
            const f = path.join(r, '.claude', 'settings.json');
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\}\s*$/, ',}'));
            return null;
        },
        inspect: (r) => /This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(r, '.claude', 'rules', 'alfred-docs-root.md'), 'utf8'))[1],
    });
    assert.strictEqual(result, '.claude/docs');
});

test('installer: a move keeps what git saw - an ignored old root becomes a local root, nothing new shows in git status', POSIX_ONLY, () =>
{
    // Review M4: an older install seeded git versioning while the project's .claude/* line kept the docs out of
    // git; after the move the plans and task cards showed as untracked, one git add -A from being committed.
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-move', 'move')],
        prepare: (r) => fs.writeFileSync(path.join(r, '.gitignore'), '.claude/*\n'),
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r);
            const f = path.join(r, '.claude', 'settings.json');
            const st = JSON.parse(fs.readFileSync(f, 'utf8'));
            st.env.ALFRED_CODE_DOCS_VERSIONING = 'git';
            fs.writeFileSync(f, JSON.stringify(st, null, 2));
            return null;
        },
        inspect: (r) => ({ ...look(r), status: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.alfred'], { cwd: r, encoding: 'utf8' }) }),
    });
    assert.match(outs[1], /docs root: moved \.claude\/docs -> \.alfred\/docs/);
    assert.match(outs[1], /ALFRED_CODE_DOCS_VERSIONING 'git' -> 'local' \(the old root was kept out of git\)/);
    assert.strictEqual(result.env.ALFRED_CODE_DOCS_VERSIONING, 'local');
    // The root's own .gitignore is the one file meant to be committed (I1: it re-includes itself so a teammate's
    // clone inherits it); nothing the move carried shows.
    assert.strictEqual(result.status, '?? .alfred/.gitignore\n', 'git sees nothing under the new root but its ignore file, as it saw nothing under the old');
});

test('installer: a local install moved to project scope while its session still exports the old root is offered, never orphaned', POSIX_ONLY, () =>
{
    // Review M2, end to end: the move off local drops the stack's local key; the exported variable must not read as the user's.
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'local'], ['--scope', 'project', '--installed-only']],
        env: [{}, { ALFRED_CODE_DOCS_PATH: '.claude/docs' }],
        each: (r, i) =>
        {
            if (i !== 0) return null;
            const f = path.join(r, '.claude', 'settings.local.json');
            const st = JSON.parse(fs.readFileSync(f, 'utf8'));
            st.env.ALFRED_CODE_DOCS_PATH = '.claude/docs';
            fs.writeFileSync(f, JSON.stringify(st, null, 2));
            const stamp = path.join(r, '.claude', 'alfred-code.stamp');
            fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/settings\.local\.json:ALFRED_CODE_DOCS_PATH=[0-9a-f]{64}/, `settings.local.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`));
            for (const [rel, body] of Object.entries(OLD)) { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), body); }
            return null;
        },
        inspect: look,
    });
    assert.match(outs[1], /docs root: \.claude\/docs is the old default and holds 2 file\(s\) - \/alfred-code:update offers the move/);
    assert.deepStrictEqual([result.env.ALFRED_CODE_DOCS_PATH, result.rule, result.old], ['.claude/docs', '.claude/docs', true]);
});
