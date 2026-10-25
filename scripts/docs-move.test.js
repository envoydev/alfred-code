'use strict';
// ONE DOCS ROOT - `<data root>/docs` (2.8.0, the user's ruling of 2026-10-20, D7).
//
// ALFRED_CODE_DOCS_PATH is retired: no run writes it, and a run that finds it in settings.json or settings.local.json
// moves the stack's own docs from the root it names to <data root>/docs and then takes it out. Only the stack's
// entries move - a hand-set root may be a folder the project uses too - and a clash (a file at both places) moves
// nothing and keeps the key, so the hooks keep reading where the docs are until it is cleared. With no key the root
// to drain is the earlier data root's docs, or the old default `.claude/docs` an install from before 2.0.0 left.
// A HAND-SET root - one the stack never seeded and no ledger row records - is asked once (the user's answers of
// 2026-10-20): it moves only on `--docs-root-move move`, and `--docs-root-leave` names the entries that are the team's own,
// left in place. There is no keep: every docs file of the stack's belongs under the data root. With no answer the key
// stays until update asks.
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
const put = (root, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
function repo(files = {}, { commit = [] } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'x@example.invalid');
    git(root, 'config', 'user.name', 'x');
    for (const [rel, body] of Object.entries(files)) put(root, rel, body);
    if (commit.length) { git(root, 'add', '-f', ...commit); git(root, 'commit', '-qm', 'docs'); }
    return root;
}
// A hand-set root the project shares with its own files: four stack entries, two of the project's.
const EXT = {
    'docs-ext/architecture/ARCHITECTURE.md': '# arch\n',
    'docs-ext/ORIENTATION.md': '# map\n',
    'docs-ext/mydomain/watch.json': '{}\n',
    'docs-ext/mydomain/NOTES.md': '# notes\n',
    'docs-ext/flow/COMMIT-GATE': 'VERIFIED x\n',
    'docs-ext/README.md': '# the project\'s own\n',
    'docs-ext/guides/setup.md': '# setup\n',
};
const plan = (root, over = {}) => docs.docsMovePlan({ projectRoot: root, shared: { ALFRED_CODE_DOCS_PATH: 'docs-ext' }, personal: {}, scope: 'project', stamped: true, to: '.alfred/docs', ...over });

test('the catalog no longer carries ALFRED_CODE_DOCS_PATH - no run seeds it', () =>
{
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8')).env;
    assert.strictEqual(rows.find((r) => r.key === 'ALFRED_CODE_DOCS_PATH'), undefined);
});

test('plan: a key equal to <data root>/docs is a drop with nothing moved', () =>
{
    const root = repo({ '.alfred/docs/architecture/ARCHITECTURE.md': '# a\n' });
    const p = plan(root, { shared: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' } });
    assert.deepStrictEqual([p.state, p.tracked, p.untracked], ['drop', [], []]);
    assert.deepStrictEqual(p.keys, [{ file: 'settings.json', value: '.alfred/docs' }]);
});

test('plan: a leftover root holding the project\'s own files moves only the stack\'s entries', () =>
{
    const root = repo(EXT, { commit: ['docs-ext/architecture/ARCHITECTURE.md', 'docs-ext/README.md'] });
    const p = plan(root);
    assert.strictEqual(p.state, 'move');
    assert.strictEqual(p.from, 'docs-ext');
    assert.deepStrictEqual(p.tracked, ['architecture/ARCHITECTURE.md']);
    assert.deepStrictEqual(p.untracked, ['ORIENTATION.md', 'flow/COMMIT-GATE', 'mydomain/NOTES.md', 'mydomain/watch.json']);
    assert.deepStrictEqual(p.left, ['README.md', 'guides'], 'the project\'s own entries are named, never moved');
    // The side note of 2026-10-20: the ask names WHAT moves, so a team spots its own decisions/ or architecture/.
    assert.deepStrictEqual(p.moves, ['ORIENTATION.md', 'architecture/', 'flow/', 'mydomain/']);
});

test('plan: a clash keeps the key and names the files', () =>
{
    const root = repo({ ...EXT, '.alfred/docs/ORIENTATION.md': '# theirs\n' });
    const p = plan(root);
    assert.deepStrictEqual([p.state, p.conflicts], ['clash', ['ORIENTATION.md']]);
});

test('plan: settings.local.json\'s root is the one in effect; settings.json\'s shadowed one is named', () =>
{
    const root = repo({ ...EXT, 'notes/architecture/ARCHITECTURE.md': '# old\n' });
    const p = plan(root, { shared: { ALFRED_CODE_DOCS_PATH: 'notes' }, personal: { ALFRED_CODE_DOCS_PATH: 'docs-ext/' } });
    assert.deepStrictEqual([p.state, p.from, p.shadowed], ['move', 'docs-ext', ['notes']]);
    assert.deepStrictEqual(p.keys.map((k) => k.file), ['settings.json', 'settings.local.json']);
});

test('plan: a local-scope run cannot take a settings.json key out - nothing moves', () =>
{
    const root = repo(EXT);
    assert.strictEqual(plan(root, { scope: 'local' }).state, 'blocked');
    // the same key in settings.local.json, which a local run writes, moves
    assert.strictEqual(plan(root, { scope: 'local', shared: {}, personal: { ALFRED_CODE_DOCS_PATH: 'docs-ext' } }).state, 'move');
    // a settings.json key that already names the root blocks nothing
    assert.strictEqual(plan(root, { scope: 'local', shared: { ALFRED_CODE_DOCS_PATH: '.alfred/docs' }, personal: { ALFRED_CODE_DOCS_PATH: 'docs-ext' } }).state, 'move');
});

test('plan: with no key the earlier data root\'s docs move with the root, and an old default is drained', () =>
{
    const root = repo({ '.data/docs/architecture/ARCHITECTURE.md': '# a\n', '.claude/docs/flow/COMMIT-GATE': 'VERIFIED x\n' });
    const p = plan(root, { shared: {}, prior: '.data' });
    assert.deepStrictEqual([p.state, p.from, p.untracked], ['move', '.data/docs', ['architecture/ARCHITECTURE.md']]);
    const legacy = plan(root, { shared: {} });
    assert.deepStrictEqual([legacy.state, legacy.from, legacy.untracked], ['move', '.claude/docs', ['flow/COMMIT-GATE']]);
    assert.strictEqual(plan(root, { shared: {}, stamped: false }).state, 'none', 'a fresh install has no earlier root');
});

test('plan: an earlier data root\'s tickets/ moves with its docs; in a hand-set root it is named among the moves (item 5)', () =>
{
    const root = repo({ '.data/docs/tickets/fix-api-retry.md': '# Fix API retry\n', '.data/docs/architecture/ARCHITECTURE.md': '# a\n' });
    const p = plan(root, { shared: {}, prior: '.data' });
    assert.deepStrictEqual([p.state, p.from], ['move', '.data/docs']);
    assert.ok(p.untracked.includes('tickets/fix-api-retry.md'), JSON.stringify(p.untracked));
    const ext = repo({ ...EXT, 'docs-ext/tickets/team-board.md': '# the team\'s own\n' });
    const q = plan(ext);
    assert.ok(q.untracked.includes('tickets/team-board.md'), 'a hand-set root\'s tickets/ is a stack entry, so the ask names it');
    assert.ok(q.moves.includes('tickets/'), 'the ask\'s moves name it: ' + JSON.stringify(q.moves));
    assert.ok(plan(ext, { leave: ['tickets'] }).left.includes('tickets'), '--docs-root-leave tickets keeps the team\'s own');
});

// The boundary: an EMPTY key names no root - every reader takes the default, as Claude Code's merge hands it on - so it is a
// key to drop, with the no-key drain behind it; and an empty settings.local.json key over a set settings.json one leaves
// that one shadowed, not in effect.
test('plan: an empty key is dropped and read as no key; one that empties settings.json\'s root shadows it', () =>
{
    const root = repo({ '.claude/docs/architecture/ARCHITECTURE.md': '# a\n', 'notes/architecture/ARCHITECTURE.md': '# old\n' });
    const p = plan(root, { shared: { ALFRED_CODE_DOCS_PATH: '' } });
    assert.deepStrictEqual([p.state, p.from, p.keys], ['move', '.claude/docs', [{ file: 'settings.json', value: '' }]]);
    assert.strictEqual(plan(root, { shared: { ALFRED_CODE_DOCS_PATH: '' }, stamped: false }).state, 'drop', 'nothing to drain on a fresh install, the key still goes');
    assert.strictEqual(plan(root, { scope: 'local', shared: { ALFRED_CODE_DOCS_PATH: '' }, stamped: false }).state, 'drop', 'an empty settings.json key blocks no local run');
    const hid = plan(root, { shared: { ALFRED_CODE_DOCS_PATH: 'notes' }, personal: { ALFRED_CODE_DOCS_PATH: '' }, stamped: false });
    assert.deepStrictEqual([hid.state, hid.from, hid.shadowed], ['drop', null, ['notes']]);
});

test('plan: a root the stack never wrote is hand-set; a seeded or ledgered one is not', () =>
{
    const root = repo({ ...EXT, '.claude/docs/ORIENTATION.md': '# map\n', '.data/docs/ORIENTATION.md': '# map\n' });
    assert.strictEqual(plan(root).handSet, true, 'docs-ext, no ledger row');
    assert.strictEqual(plan(root, { ledgered: [valueHash('docs-ext')] }).handSet, false, 'a value the ledger records is the stack\'s');
    assert.strictEqual(plan(root, { shared: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }).handSet, false, 'the pre-2.0.0 default');
    assert.strictEqual(plan(root, { shared: { ALFRED_CODE_DOCS_PATH: '.data/docs' }, prior: '.data' }).handSet, false, 'the earlier data root\'s docs');
    assert.strictEqual(plan(root, { shared: {} }).handSet, false, 'no key: the drain is the stack\'s own');
});

test('plan: --docs-root-leave entries stay with the project\'s own; a name that is not the stack\'s is reported', () =>
{
    const root = repo(EXT);
    const p = plan(root, { leave: ['architecture'] });
    assert.deepStrictEqual([p.state, p.moves, p.left, p.unknown], ['move', ['ORIENTATION.md', 'flow/', 'mydomain/'], ['README.md', 'architecture', 'guides'], []]);
    assert.ok(!p.tracked.concat(p.untracked).some((f) => f.startsWith('architecture/')), 'nothing under a left entry moves');
    assert.deepStrictEqual(plan(root, { leave: ['architektur', 'README.md'] }).unknown, ['architektur', 'README.md']);
    const all = plan(root, { leave: ['ORIENTATION.md', 'architecture', 'flow', 'mydomain'] });
    assert.deepStrictEqual([all.state, all.moves, all.unknown], ['drop', [], []], 'every entry left: nothing moves, the key still goes');
});

test('plan: a settings file that does not parse moves nothing', () =>
{
    const root = repo(EXT);
    const p = plan(root, { broken: 'settings.json' });
    assert.deepStrictEqual([p.state, p.why], ['none', 'settings.json cannot be read']);
});

test('views: the two settings files are read apart, and an unparseable one is named', () =>
{
    const root = repo();
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'a' } }));
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'b' } }));
    assert.deepStrictEqual(docs.docsMoveViews({ claudeDir: path.join(root, '.claude') }), { shared: { ALFRED_CODE_DOCS_PATH: 'a' }, personal: { ALFRED_CODE_DOCS_PATH: 'b' }, broken: null });
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{ not json');
    assert.strictEqual(docs.docsMoveViews({ claudeDir: path.join(root, '.claude') }).broken, 'settings.local.json');
    // Final review C3: settings.js reads an empty file as {} and writes it; read as broken here, it stopped every drain.
    for (const blank of ['', ' \n\t\r\n'])
    {
        fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), blank);
        assert.deepStrictEqual(docs.docsMoveViews({ claudeDir: path.join(root, '.claude') }), { shared: { ALFRED_CODE_DOCS_PATH: 'a' }, personal: {}, broken: null }, JSON.stringify(blank));
    }
});

test('move: tracked files go through git mv (staged as renames), the rest by rename, the project\'s own files stay', () =>
{
    const root = repo(EXT, { commit: ['docs-ext/architecture/ARCHITECTURE.md'] });
    const r = docs.moveDocsRoot({ projectRoot: root, plan: plan(root) });
    assert.deepStrictEqual({ ok: r.ok, moved: r.moved, gitMoved: r.gitMoved }, { ok: true, moved: 5, gitMoved: 1 });
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), 'utf8'), '# arch\n');
    assert.ok(fs.existsSync(path.join(root, '.alfred', 'docs', 'mydomain', 'NOTES.md')), 'a folder holding a watch.json is a domain, the stack\'s');
    assert.ok(fs.existsSync(path.join(root, 'docs-ext', 'README.md')) && fs.existsSync(path.join(root, 'docs-ext', 'guides', 'setup.md')));
    assert.ok(!fs.existsSync(path.join(root, 'docs-ext', 'architecture')), 'the emptied stack folders are removed');
    assert.match(git(root, 'status', '--porcelain'), /^R {2}docs-ext\/architecture\/ARCHITECTURE\.md -> \.alfred\/docs\/architecture\/ARCHITECTURE\.md$/m);
});

test('move: a failure part way puts every file back where it was', POSIX_ONLY, () =>
{
    const root = repo({ ...EXT, 'docs-ext/zz/watch.json': '{}\n', 'docs-ext/zz/last.md': 'z\n' }, { commit: ['docs-ext/architecture/ARCHITECTURE.md'] });
    const p = plan(root);
    fs.mkdirSync(path.join(root, '.alfred', 'docs', 'zz'), { recursive: true });
    fs.chmodSync(path.join(root, '.alfred', 'docs', 'zz'), 0o500);
    try
    {
        const r = docs.moveDocsRoot({ projectRoot: root, plan: p });
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /zz\/(last\.md|watch\.json)/);
    }
    finally { fs.chmodSync(path.join(root, '.alfred', 'docs', 'zz'), 0o700); }
    for (const rel of Object.keys(EXT)) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is back`);
    assert.strictEqual(git(root, 'status', '--porcelain', '--', 'docs-ext/architecture'), '', 'the git mv is undone too');
});

// --- the installer ---------------------------------------------------------------------------------
// An older install, simulated on the current seed: the settings key and the ledger name `value`, the rule is stamped
// with it, and `files` sit where the case puts them.
const SELECTION = 'rule alfred-docs-root\nrule alfred-git\n';
function olderInstall(repoDir, { value = 'docs-ext', files = EXT, file = 'settings.json', ledgered = value } = {})
{
    const claude = path.join(repoDir, '.claude');
    const target = path.join(claude, file);
    const settings = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
    (settings.env ??= {}).ALFRED_CODE_DOCS_PATH = value;
    fs.writeFileSync(target, JSON.stringify(settings, null, 2));
    const stamp = path.join(claude, 'alfred-code.stamp');
    const row = `${file}:ALFRED_CODE_DOCS_PATH=${valueHash(ledgered)}`;
    fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/^managed-env: ?(.*)$/m, (_, rest) => `managed-env: ${rest ? `${rest},` : ''}${row}`));
    const rule = path.join(claude, 'rules', 'alfred-docs-root.md');
    fs.writeFileSync(rule, fs.readFileSync(rule, 'utf8').replace(/This install's root: `[^`]*`/, `This install's root: \`${value}\``));
    fs.rmSync(path.join(repoDir, '.alfred', 'docs'), { recursive: true, force: true });
    for (const [rel, body] of Object.entries(files)) put(repoDir, rel, body);
    return null;
}
const envOf = (repoDir, file) => { try { return JSON.parse(fs.readFileSync(path.join(repoDir, '.claude', file), 'utf8')).env || {}; } catch { return null; } };
const look = (repoDir) => ({
    key: (envOf(repoDir, 'settings.json') || {}).ALFRED_CODE_DOCS_PATH,
    local: (envOf(repoDir, 'settings.local.json') || {}).ALFRED_CODE_DOCS_PATH,
    rule: /This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(repoDir, '.claude', 'rules', 'alfred-docs-root.md'), 'utf8'))[1],
    ledger: /ALFRED_CODE_DOCS_PATH/.test(fs.readFileSync(path.join(repoDir, '.claude', 'alfred-code.stamp'), 'utf8')),
    moved: ['architecture/ARCHITECTURE.md', 'ORIENTATION.md', 'mydomain/NOTES.md'].filter((rel) => fs.existsSync(path.join(repoDir, '.alfred', 'docs', ...rel.split('/')))),
    gate: fs.existsSync(path.join(repoDir, '.alfred', 'state', 'approvals', 'COMMIT-GATE')),
    left: fs.existsSync(path.join(repoDir, 'docs-ext')) ? fs.readdirSync(path.join(repoDir, 'docs-ext')).sort() : null,
});
const updateArgs = (...extra) => ['--scope', 'project', '--installed-only', ...extra];

for (const scope of ['project', 'user', 'local'])
test(`installer (${scope} scope): a fresh install writes no ALFRED_CODE_DOCS_PATH and stamps the rule with <data root>/docs`, POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, { args: ['--scope', scope], inspect: (r) => ({ shared: envOf(r, 'settings.json'), personal: envOf(r, 'settings.local.json'), rule: look(r).rule }) });
    assert.strictEqual((result.shared || {}).ALFRED_CODE_DOCS_PATH, undefined);
    assert.strictEqual((result.personal || {}).ALFRED_CODE_DOCS_PATH, undefined);
    assert.strictEqual(result.rule, '.alfred/docs');
});

test('installer: update moves the stack\'s docs from a leftover root and removes the key; a re-run changes nothing', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs(), updateArgs()],
        each: (r, i) => { if (i === 0) olderInstall(r); return i === 0 ? null : look(r); },
    });
    assert.match(outs[1], /docs root: moved docs-ext -> \.alfred\/docs \(5 file\(s\), 0 through git mv\)/, outs[1]);
    assert.match(outs[1], /docs root: docs-ext keeps README\.md, guides - not the stack's, left in place/, outs[1]);
    assert.match(outs[1], /settings\.json env: ALFRED_CODE_DOCS_PATH 'docs-ext' removed/, outs[1]);
    assert.deepStrictEqual(steps[1], {
        key: undefined, local: undefined, rule: '.alfred/docs', ledger: false,
        moved: ['architecture/ARCHITECTURE.md', 'ORIENTATION.md', 'mydomain/NOTES.md'], gate: true, left: ['README.md', 'guides'],
    });
    assert.doesNotMatch(outs[2], /docs root:|ALFRED_CODE_DOCS_PATH/, 'a second update finds nothing to do');
    assert.deepStrictEqual(steps[2], steps[1]);
});

test('installer: a clash keeps the key and names it; clearing it lets the next update move', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs(), updateArgs()],
        each: (r, i) =>
        {
            if (i === 0) { olderInstall(r); put(r, '.alfred/docs/ORIENTATION.md', '# theirs\n'); return null; }
            const seen = look(r);
            if (i === 1) fs.rmSync(path.join(r, '.alfred', 'docs', 'ORIENTATION.md'));
            return seen;
        },
    });
    assert.match(outs[1], /!! docs root: docs-ext not moved - 1 file\(s\) already at \.alfred\/docs: ORIENTATION\.md - ALFRED_CODE_DOCS_PATH stays, so the hooks keep reading docs-ext/, outs[1]);
    // The kept key carries its ledger row as recorded, so the next run still knows the stack wrote it.
    assert.deepStrictEqual([steps[1].key, steps[1].rule, steps[1].ledger, steps[1].moved], ['docs-ext', 'docs-ext', true, ['ORIENTATION.md']], 'only their own file sits at the new root');
    assert.match(outs[2], /docs root: moved docs-ext -> \.alfred\/docs/, outs[2]);
    assert.deepStrictEqual([steps[2].key, steps[2].rule, steps[2].ledger], [undefined, '.alfred/docs', false]);
});

// Found by the temp-project matrix: over a 2.7.0 ledger row (the seeded `.alfred/docs`) and a hand-set root, a clash also
// printed 'changed since the stack wrote it - yours from here on, kept' - a retired key is nobody's to keep, and the docs
// step's `!!` line already says why it stays.
test('installer: a clash over a hand-changed key says only the docs step\'s line, never that the key is the user\'s', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()], inspect: look,
        each: (r, i) => { if (i === 0) { olderInstall(r, { ledgered: '.alfred/docs' }); put(r, '.alfred/docs/ORIENTATION.md', '# theirs\n'); } return null; },
    });
    assert.match(outs[1], /!! docs root: docs-ext not moved/, outs[1]);
    assert.doesNotMatch(outs[1], /ALFRED_CODE_DOCS_PATH[^\n]*(yours|is yours)/, outs[1]);
    assert.deepStrictEqual([result.key, result.rule], ['docs-ext', 'docs-ext'], 'the key stays until the clash is cleared');
});

// The side note of 2026-10-20: a root the user set by hand may be the team's own docs/ folder, and the stack picks its
// entries by NAME - so it moves only on the answer to update's ask.
test('installer: a hand-set root is not moved unasked - the key stays and a !! line names the ask; --docs-root-move move moves it', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs(), updateArgs('--docs-root-move', 'move'), updateArgs()],
        each: (r, i) => (i === 0 ? olderInstall(r, { ledgered: '.alfred/docs' }) : look(r)),
    });
    assert.match(outs[1], /!! docs root: docs-ext was set by hand - nothing moved yet; \/alfred-code:update asks which of ORIENTATION\.md, architecture\/, flow\/, mydomain\/ are the team's own - those stay, the rest move to \.alfred\/docs/, outs[1]);
    assert.deepStrictEqual([steps[1].key, steps[1].rule, steps[1].moved], ['docs-ext', 'docs-ext', []]);
    // 'Nothing moved yet' means nothing: the 2.8.0 layout pass leaves an unanswered hand-set root alone too - it re-laid
    // the team's folder out by name, flow/ into the data root's state/ (final review 2026-10-20b).
    assert.ok(steps[1].left.includes('flow'), `the hand-set root keeps flow/ until the ask is answered: ${steps[1].left}`);
    assert.strictEqual(steps[1].gate, false, 'no receipt left the hand-set root');
    assert.match(outs[2], /docs root: moved docs-ext -> \.alfred\/docs/, outs[2]);
    assert.deepStrictEqual([steps[2].key, steps[2].rule, steps[2].left], [undefined, '.alfred/docs', ['README.md', 'guides']]);
    assert.doesNotMatch(outs[3], /docs root/, outs[3]);
    assert.deepStrictEqual(steps[3], steps[2], 'a re-run changes nothing');
});

// No keep (the user's answer of 2026-10-20): the entries the user marks as the team's own stay, the rest move, and the
// key goes in the same run - nothing of the stack's is left outside the data root.
test('installer: --docs-root-leave keeps the team\'s own entries in place, moves the rest and drops the key', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-root-move', 'move', '--docs-root-leave', 'architecture/'), updateArgs()],
        each: (r, i) => (i === 0 ? olderInstall(r, { ledgered: '.alfred/docs' }) : look(r)),
    });
    assert.match(outs[1], /docs root: moved docs-ext -> \.alfred\/docs/, outs[1]);
    assert.match(outs[1], /docs root: docs-ext keeps README\.md, architecture, guides/, outs[1]);
    assert.deepStrictEqual([steps[1].key, steps[1].rule, steps[1].moved, steps[1].left], [undefined, '.alfred/docs', ['ORIENTATION.md', 'mydomain/NOTES.md'], ['README.md', 'architecture', 'guides']]);
    assert.doesNotMatch(outs[2], /docs root/, outs[2]);
    assert.deepStrictEqual(steps[2], steps[1], 'a re-run changes nothing');
});

test('installer: a --docs-root-leave name that is not the stack\'s moves nothing - a typo never moves the folder it meant to keep', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--docs-root-move', 'move', '--docs-root-leave', 'architektur')], inspect: look,
        each: (r, i) => (i === 0 ? olderInstall(r, { ledgered: '.alfred/docs' }) : null),
    });
    assert.match(outs[1], /!! docs root: --docs-root-leave names architektur, not one of the stack's entries at docs-ext \(ORIENTATION\.md, architecture\/, flow\/, mydomain\/\) - nothing moved; ALFRED_CODE_DOCS_PATH stays/, outs[1]);
    assert.deepStrictEqual([result.key, result.rule, result.moved], ['docs-ext', 'docs-ext', []]);
    assert.ok(result.left.includes('flow') && !result.gate, `nothing re-laid out either: ${result.left}`);
});

test('installer: a key equal to <data root>/docs is removed with nothing moved', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()], inspect: look,
        each: (r, i) => (i === 0 ? olderInstall(r, { value: '.alfred/docs', files: { '.alfred/docs/architecture/ARCHITECTURE.md': '# arch\n' } }) : null),
    });
    assert.match(outs[1], /settings\.json env: ALFRED_CODE_DOCS_PATH '\.alfred\/docs' removed/, outs[1]);
    assert.doesNotMatch(outs[1], /docs root: moved/);
    assert.deepStrictEqual([result.key, result.rule, result.ledger, result.moved], [undefined, '.alfred/docs', false, ['architecture/ARCHITECTURE.md']]);
});

test('installer: a root in settings.local.json at project scope moves too, and both files lose the key', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()], inspect: look,
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r, { value: '.alfred/docs', files: {} });
            olderInstall(r, { file: 'settings.local.json' });
            return null;
        },
    });
    assert.match(outs[1], /docs root: moved docs-ext -> \.alfred\/docs/, outs[1]);
    assert.match(outs[1], /settings\.local\.json env: ALFRED_CODE_DOCS_PATH 'docs-ext' removed/, outs[1]);
    assert.deepStrictEqual([result.key, result.local, result.rule], [undefined, undefined, '.alfred/docs']);
});

test('installer: a local-scope run leaves a settings.json key it does not write, and moves nothing', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'local'], ['--scope', 'local', '--installed-only']], inspect: look,
        each: (r, i) => (i === 0 ? olderInstall(r) : null),
    });
    assert.match(outs[1], /!! docs root: settings\.json sets ALFRED_CODE_DOCS_PATH 'docs-ext', which a local-scope run does not write - nothing moved/, outs[1]);
    assert.deepStrictEqual([result.key, result.rule, result.moved], ['docs-ext', 'docs-ext', []]);
});

test('installer: a settings file that does not parse moves nothing and leaves the stamped rule', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()], failOk: true,
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r);
            const f = path.join(r, '.claude', 'settings.json');
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\}\s*$/, ',}'));
            return null;
        },
        inspect: (r) => ({ rule: /This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(r, '.claude', 'rules', 'alfred-docs-root.md'), 'utf8'))[1], ext: fs.existsSync(path.join(r, 'docs-ext', 'architecture')) }),
    });
    assert.doesNotMatch(outs[1], /docs root: moved/);
    assert.deepStrictEqual(result, { rule: 'docs-ext', ext: true });
});

test('installer: tracked docs move as staged renames, and an ignored old root stays out of git as a local root', POSIX_ONLY, () =>
{
    const tracked = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()],
        each: (r, i) => { if (i === 0) { olderInstall(r); git(r, 'add', '-f', 'docs-ext/architecture/ARCHITECTURE.md'); git(r, '-c', 'user.email=x@example.invalid', '-c', 'user.name=x', 'commit', '-qm', 'docs'); } return null; },
        inspect: (r) => git(r, 'status', '--porcelain', '--', 'docs-ext', '.alfred/docs/architecture'),
    });
    assert.match(tracked.outs[1], /docs root: moved docs-ext -> \.alfred\/docs \(5 file\(s\), 1 through git mv - staged as renames, commit them\)/, tracked.outs[1]);
    assert.match(tracked.result, /^R {2}docs-ext\/architecture\/ARCHITECTURE\.md -> \.alfred\/docs\/architecture\/ARCHITECTURE\.md$/m);

    const ignored = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()],
        prepare: (r) => fs.writeFileSync(path.join(r, '.gitignore'), '/docs-ext/\n'),
        each: (r, i) =>
        {
            if (i !== 0) return null;
            olderInstall(r, { files: Object.fromEntries(Object.entries(EXT).filter(([rel]) => !/README|guides/.test(rel))) });
            const f = path.join(r, '.claude', 'settings.json');
            const st = JSON.parse(fs.readFileSync(f, 'utf8'));
            st.env.ALFRED_CODE_DOCS_VERSIONING = 'git';
            fs.writeFileSync(f, JSON.stringify(st, null, 2));
            return null;
        },
        inspect: (r) => ({ versioning: envOf(r, 'settings.json').ALFRED_CODE_DOCS_VERSIONING, status: git(r, 'status', '--porcelain', '--untracked-files=all', '--', '.alfred/docs') }),
    });
    assert.match(ignored.outs[1], /ALFRED_CODE_DOCS_VERSIONING 'git' -> 'local' \(the old root was kept out of git\)/, ignored.outs[1]);
    assert.deepStrictEqual(ignored.result, { versioning: 'local', status: '' });
});

test('installer: --data-path carries the docs to the new root\'s docs/ and writes no key', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs('--data-path', '.data', '--data-move', 'move')],
        each: (r, i) => { if (i === 0) put(r, '.alfred/docs/architecture/ARCHITECTURE.md', '# arch\n'); return null; },
        inspect: (r) => ({ key: envOf(r, 'settings.json').ALFRED_CODE_DOCS_PATH, data: envOf(r, 'settings.json').ALFRED_CODE_DATA_PATH, rule: look(r).rule,
            moved: fs.existsSync(path.join(r, '.data', 'docs', 'architecture', 'ARCHITECTURE.md')), old: fs.existsSync(path.join(r, '.alfred', 'docs')) }),
    });
    assert.match(outs[1], /docs root: moved \.alfred\/docs -> \.data\/docs/, outs[1]);
    assert.deepStrictEqual(result, { key: undefined, data: '.data', rule: '.data/docs', moved: true, old: false });
});

test('installer: hook state a stale session writes under the old default after the move is folded in at the next start', POSIX_ONLY, () =>
{
    const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
    const run = (r, file, payload) => execFileSync(process.execPath, [path.join(HOOKS, file)], { cwd: r, input: JSON.stringify(payload), encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: r, ALFRED_CODE_TURN_CHECK: '1' } });
    const OLD = { '.claude/docs/architecture/ARCHITECTURE.md': '# arch\n', '.claude/docs/flow/COMMIT-GATE': 'VERIFIED x\n' };
    const { outs, result } = seedRun(['install', 'update'], SELECTION, {
        args: [['--scope', 'project'], updateArgs()],
        each: (r, i) => (i === 0 ? olderInstall(r, { value: '.claude/docs', files: OLD }) : null),
        inspect: (r) =>
        {
            // a pre-2.8.0 hook's marker, as it wrote it under the old root (a 2.8.0 hook writes <data root>/state/ instead)
            put(r, '.claude/docs/flow/turn-check-stale', `${new Date().toISOString()}\n`);
            run(r, 'docs-session.js', { hook_event_name: 'SessionStart', session_id: 'fresh', cwd: r });
            run(r, 'docs-session.js', { hook_event_name: 'SessionStart', session_id: 'again', cwd: r });
            const at = (rel) => path.join(r, rel);
            // its 2.8.0 home, never the docs root's retired flow/ (audit 2026-10-20b, the hooks track)
            return { key: envOf(r, 'settings.json').ALFRED_CODE_DOCS_PATH, old: fs.existsSync(at('.claude/docs')), row: fs.readFileSync(at('.alfred/state/sessions/turn-check-stale'), 'utf8'),
                retired: fs.existsSync(at('.alfred/docs/flow')),
                log: fs.readFileSync(at('.alfred/statistics/docs-log.jsonl'), 'utf8'), moved: fs.existsSync(at('.alfred/docs/architecture/ARCHITECTURE.md')) };
        },
    });
    assert.match(outs[1], /docs root: moved \.claude\/docs -> \.alfred\/docs/, outs[1]);
    assert.strictEqual(result.key, undefined);
    assert.strictEqual(result.old, false, 'the stranded root is gone after the next start');
    assert.match(result.row, /^\d{4}-\d{2}-\d{2}T/, 'its marker now sits under the data root\'s state/sessions/');
    assert.strictEqual(result.retired, false, 'the fold writes no docs-root flow/');
    assert.strictEqual(result.moved, true, 'the moved docs are untouched');
    assert.strictEqual(result.log.match(/"event":"stranded-root"/g).length, 1, 'a second start finds nothing');
});

// 2.2.2: superpowers/ (the dropped superpowers plugin's folder name) goes - every folder in it moves up to the docs root.
for (const scope of ['project', 'user', 'local'])
test(`installer (${scope} scope): an update moves every folder under superpowers/ up to the docs root, a fresh install makes none, a re-run is quiet`, POSIX_ONLY, () =>
{
    const at = (r, rel) => path.join(r, '.alfred', 'docs', ...rel.split('/'));
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [['--scope', scope], ['--scope', scope, '--installed-only'], ['--scope', scope, '--installed-only']],
        each: (r, i) =>
        {
            const read = (rel) => fs.existsSync(at(r, rel)) && fs.readFileSync(at(r, rel), 'utf8');
            // 2.8.0: a plan the superpowers/ move brings up continues to work/plans/ in the same run (docs.migrateLayout)
            const seen = { superpowers: fs.existsSync(at(r, 'superpowers')), plan: read('work/plans/cart.md'), sdd: read('sdd/ledger.md') };
            if (i === 0)
            {
                fs.mkdirSync(at(r, 'superpowers/plans'), { recursive: true });
                fs.writeFileSync(at(r, 'superpowers/plans/cart.md'), '# cart - plan\n');
                fs.mkdirSync(at(r, 'superpowers/sdd'), { recursive: true });
                fs.writeFileSync(at(r, 'superpowers/sdd/ledger.md'), 'ledger\n');
            }
            return seen;
        },
    });
    assert.deepStrictEqual(steps[0], { superpowers: false, plan: false, sdd: false }, 'a fresh install creates no superpowers/');
    assert.match(outs[1], /docs migration \(superpowers\): superpowers\/plans\/ -> plans\//, outs[1]);
    assert.match(outs[1], /docs migration \(superpowers\): superpowers\/sdd\/ -> sdd\//, outs[1]);
    assert.match(outs[1], /layout: \.alfred\/docs\/plans -> \.alfred\/docs\/work\/plans \(1 file\)/, outs[1]);
    assert.match(outs[2], /layout: current/, 'a re-run moves nothing');
    assert.deepStrictEqual(steps[1], { superpowers: false, plan: '# cart - plan\n', sdd: 'ledger\n' }, 'every folder moved and the emptied one went');
    assert.doesNotMatch(outs[2], /docs migration \(superpowers\)/, 'a re-run moves nothing');
    assert.deepStrictEqual(steps[2], steps[1]);
});

// M10 (final review): a `data-pending:` row an earlier run recorded under `.sensitive-data` is the same move once the store
// is renamed `.secrets` - the offer leaves it out under either name, or update offers a move the run already retries.
test('dataOffer: a pending move recorded under either store name matches the store under the other', () =>
{
    for (const [onDisk, recorded] of [['.secrets', '.sensitive-data'], ['.sensitive-data', '.secrets'], ['.secrets', '.secrets']])
    {
        const root = fs.mkdtempSync(path.join(TMP, 'offer-'));
        put(root, `.alfred/${onDisk}`, 'K=v\n');
        const stampText = `data-root: .alfred\ndata-pending: sensitive .alfred/${recorded} -> .data/${recorded}\n`;
        const offer = docs.dataOffer({ projectRoot: root, stamped: true, stampText, root: '.data' });
        assert.deepStrictEqual([offer.state, offer.why], ['none', 'nothing to move'], `${recorded} recorded, ${onDisk} on disk`);
    }
    const root = fs.mkdtempSync(path.join(TMP, 'offer-'));
    put(root, '.alfred/.secrets', 'K=v\n');
    const other = docs.dataOffer({ projectRoot: root, stamped: true, stampText: 'data-root: .alfred\ndata-pending: sensitive .alfred/.secrets -> .store/.secrets\n', root: '.data' });
    assert.strictEqual(other.state, 'offer', 'a pending move to another root is no match');
});

test('preflight: the docs are no part of the data-move offer; only a hand-set root gets a docs-move offer', POSIX_ONLY, () =>
{
    const root = repo(EXT);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs-ext' } }));
    const stampWith = (value) => fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `version: 2.7.0\nsha: 0000000\nmanaged-env: settings.json:ALFRED_CODE_DOCS_PATH=${valueHash(value)}\n`);
    const snap = path.join(__dirname, '..');
    const run = () => require('node:child_process').spawnSync(process.execPath, [path.join(snap, 'scripts', 'update-preflight.js'), '--snapshot', snap, '--root', root, '--fixture', path.join(TMP, 'none.json')], { encoding: 'utf8' });
    stampWith('docs-ext');
    const seeded = run();
    assert.match(seeded.stdout, /^data-move: none \(nothing to move\)$/m, seeded.stdout + seeded.stderr);
    assert.match(seeded.stdout, /^docs-move: none \(the stack's own root - it moves unasked\)$/m, seeded.stdout);
    stampWith('.alfred/docs');
    const hand = run();
    assert.match(hand.stdout, /^docs-move: offer docs-ext -> \.alfred\/docs\tmoves=ORIENTATION\.md,architecture\/,flow\/,mydomain\/\tstack=5\town=README\.md,guides$/m, hand.stdout);
});

test('preflight --log: a moved docs root asks for a restart - the loaded rule still names the old one', () =>
{
    const log = path.join(TMP, `install-${seq++}.log`);
    const logMode = () => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'update-preflight.js'), '--log', log], { encoding: 'utf8' }).stdout;
    fs.writeFileSync(log, '==> mcps=0\n');
    assert.match(logMode(), /^restart: no$/m);
    fs.writeFileSync(log, '==> mcps=0\n==> docs root: moved docs-ext -> .alfred/docs (2 file(s), 0 through git mv) - the rule is re-stamped\n');
    assert.match(logMode(), /^restart: yes$/m);
    // A server's data waits for that server's next start - the restart is what moves it.
    fs.writeFileSync(log, '==> mcps=0\n==> data root: .alfred - 0 moved now, 2 waiting for a server\'s next start; restart the session\n');
    assert.match(logMode(), /^restart: yes$/m);
});
