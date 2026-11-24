// Workspace versioning, task 4: one ranked docs versioning answer (D2) and the firm mark the seed rule gives it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const docs = require('./install/docs.js');
const copy = require('./install/copy.js');
const stampLib = require('./install/stamp.js');
const { rankVersioning, seedLeaves } = require('./install/versioning/rank.js');
const { effectiveVersioning } = require('./install/versioning/effects.js');
const { putWorkspace } = require('./workspace-fixture.js');

const KEY = 'ALFRED_CODE_DOCS_VERSIONING';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-versioning-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ON = { CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ALFRED_CODE_WORKSPACE: '1' };

let seq = 0;
const repo = () =>
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    return fs.realpathSync.native(root);
};
const put = (root, rel, text = 'x\n') => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const advice = (root, docsPath = '.alfred/docs', extra = {}) => docs.docsVersioningAdvice({ projectRoot: root, docsPath, ...extra });

const GIT = { value: 'git', firm: false };
const FIRM_LOCAL = { value: 'local', firm: true };
const FIRM_GIT = { value: 'git', firm: true };

const RANK_TABLE = [
    ['the flag wins over all', { flag: 'git', carry: 'local', reseed: 'local', own: 'local', firm: FIRM_LOCAL, chain: 'local', linked: true }, 'git', 'flag'],
    ['the carry beats the reseed and the own value', { carry: 'local', reseed: 'git', own: 'git', firm: GIT, chain: 'git', linked: true }, 'local', 'carry'],
    ['the reseed beats the own value', { reseed: 'git', own: 'local', firm: GIT, linked: false }, 'git', 'reseed'],
    ['the reseed is skipped in a linked child whose chain holds a value', { reseed: 'git', own: 'local', firm: GIT, chain: 'local', linked: true }, 'local', 'own'],
    ['the reseed stands in a linked child with no chain value', { reseed: 'git', firm: GIT, chain: undefined, linked: true }, 'git', 'reseed'],
    ['the own value beats a firm answer', { own: 'git', firm: FIRM_LOCAL, chain: 'local', linked: true }, 'git', 'own'],
    ['a firm local beats a chain git', { firm: FIRM_LOCAL, chain: 'git', linked: true }, 'local', 'firm'],
    ['a firm git beats a chain local', { firm: FIRM_GIT, chain: 'local', linked: true }, 'git', 'firm'],
    ['the chain beats a non-firm seed', { firm: { value: 'local', firm: false }, chain: 'git', linked: true }, 'git', 'chain'],
    ['no chain: the seed answers', { firm: { value: 'local', firm: false }, linked: false }, 'local', 'seed'],
    ['nothing at all reads git', {}, 'git', 'seed'],
];
for (const [name, input, value, source] of RANK_TABLE)
    test(`rank: ${name}`, () => assert.deepStrictEqual(rankVersioning(input), { value, source }));

const LEAVES_TABLE = [
    ['a standalone non-firm seed at its hash stays', { value: 'git', atLedgerHash: true, answeredEnv: [], firm: false, chain: undefined, linked: false }, false],
    ['a linked child with no chain value keeps its seed', { value: 'git', atLedgerHash: true, answeredEnv: [], firm: false, chain: undefined, linked: true }, false],
    ['a non-firm seed at its hash leaves', { value: 'git', atLedgerHash: true, answeredEnv: [], firm: false, chain: 'local', linked: true }, true],
    ['a firm value equal to the chain leaves', { value: 'local', atLedgerHash: true, answeredEnv: [], firm: true, chain: 'local', linked: true }, true],
    ['a firm value that differs stays', { value: 'git', atLedgerHash: true, answeredEnv: [], firm: true, chain: 'local', linked: true }, false],
    ['a typed value (off its hash) stays', { value: 'git', atLedgerHash: false, answeredEnv: [], firm: false, chain: 'local', linked: true }, false],
    ['an answered value stays', { value: 'git', atLedgerHash: true, answeredEnv: [KEY], firm: false, chain: 'local', linked: true }, false],
    ['a value another layer holds keeps the line', { value: 'git', atLedgerHash: true, answeredEnv: [], firm: false, chain: 'local', linked: true, heldElsewhere: true }, false],
];
for (const [name, input, leaves] of LEAVES_TABLE)
    test(`remover: ${name}`, () => assert.strictEqual(seedLeaves(input), leaves));

test('the stack\'s own data-root file is no own rule', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode: 'local' }), 'written');
    put(root, '.alfred/docs/architecture/A.md');
    const got = advice(root);
    assert.deepStrictEqual([got.value, got.firm], ['local', false]);
});

test('a root .gitignore line keeping the docs out is firm', () =>
{
    const root = repo();
    put(root, '.gitignore', '.alfred/docs/\n');
    const got = advice(root);
    assert.deepStrictEqual([got.value, got.firm], ['local', true]);
});

test('docs exist, none committed is not firm', () =>
{
    const root = repo();
    put(root, '.alfred/docs/architecture/A.md');
    const got = advice(root);
    assert.deepStrictEqual([got.value, got.firm], ['local', false]);
});

test('a fresh project is git and not firm', () =>
{
    const got = advice(repo());
    assert.deepStrictEqual([got.value, got.firm], ['git', false]);
});

test('no repository and local scope are firm local', () =>
{
    const plain = path.join(TMP, 'plain');
    fs.mkdirSync(plain, { recursive: true });
    const outside = docs.docsVersioningAdvice({ projectRoot: plain, docsPath: '.alfred/docs', git: { inRepo: () => false } });
    assert.deepStrictEqual([outside.value, outside.firm], ['local', true]);
    const scoped = advice(repo(), '.alfred/docs', { scope: 'local', child: true });
    assert.deepStrictEqual([scoped.value, scoped.firm], ['local', true]);
});

test('a tracked domain is firm git', () =>
{
    const root = repo();
    put(root, '.alfred/docs/architecture/A.md');
    execFileSync('git', ['add', '.alfred/docs/architecture/A.md'], { cwd: root });
    const got = advice(root);
    assert.deepStrictEqual([got.value, got.firm], ['git', true]);
});

test('branch overlays make local firm', () =>
{
    const root = repo();
    docs.ensureDataIgnore({ projectRoot: root, root: '.alfred', docsPath: '.alfred/docs', mode: 'local' });
    put(root, '.alfred/docs/architecture/A.md');
    put(root, '.alfred/docs/.branches/x/architecture/A/s1.md');
    const got = advice(root);
    assert.deepStrictEqual([got.value, got.firm], ['local', true]);
});

test('a docs path with backslashes reads the same', () =>
{
    const root = repo();
    put(root, '.gitignore', '.alfred/docs/\n');
    assert.deepStrictEqual(advice(root, '.alfred\\docs'), advice(root, '.alfred/docs'));
    const other = repo();
    put(other, '.alfred/docs/architecture/A.md');
    assert.deepStrictEqual(advice(other, '.alfred\\docs'), advice(other, '.alfred/docs'));
});

test('docsVersioningSeed keeps returning the value', () =>
{
    const root = repo();
    put(root, '.gitignore', '.alfred/docs/\n');
    assert.strictEqual(docs.docsVersioningSeed({ projectRoot: root, docsPath: '.alfred/docs' }), 'local');
});

// A root and a joined child, as `workspace.js join` leaves them.
const joined = ({ root = `${KEY}=local\n`, child, childStamp = 'sha: x\nmanaged-env: \n' } = {}) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 'j-'));
    const dirs = { root: path.join(top, 'ws'), child: path.join(top, 'ws', 'api') };
    for (const dir of Object.values(dirs)) fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dirs.child });
    fs.writeFileSync(path.join(dirs.root, '.claude', 'alfred-code.stamp'), 'sha: x\nmanaged-env: \n');
    fs.writeFileSync(path.join(dirs.child, '.claude', 'alfred-code.stamp'), childStamp);
    putWorkspace(dirs.root, { children: ['api'] });
    putWorkspace(dirs.child, { parent: '..' });
    if (root !== null) fs.writeFileSync(path.join(dirs.root, '.alfred', '.variables'), root);
    if (child !== undefined) fs.writeFileSync(path.join(dirs.child, '.alfred', '.variables'), child);
    return { root: fs.realpathSync.native(dirs.root), child: fs.realpathSync.native(dirs.child) };
};
const rank = (at, extra = {}) => effectiveVersioning({ projectRoot: at.child, scope: 'project', docsPath: '.alfred/docs', env: ON, ...extra });

test('a child with no value of its own reads the chain', () =>
{
    const got = rank(joined());
    assert.deepStrictEqual([got.value, got.source, got.linked, got.chain], ['local', 'chain', true, 'local']);
});

test('workspace switch 0 gives no chain value', () =>
{
    const got = rank(joined(), { env: { ...ON, ALFRED_CODE_WORKSPACE: '0' } });
    assert.notStrictEqual(got.source, 'chain');
    assert.deepStrictEqual([got.value, got.linked], ['git', false]);
});

test('a garbage workspace.json gives no chain value', () =>
{
    const at = joined();
    fs.writeFileSync(path.join(at.child, '.alfred', 'workspace.json'), '{ not json');
    const got = rank(at);
    assert.notStrictEqual(got.source, 'chain');
    assert.strictEqual(got.linked, false);
});

test('a typed value in the child outranks the chain', () =>
{
    const at = joined({ child: `${KEY}=git\n` });
    const got = rank(at, { answeredEnv: [], ledgerRows: {} });
    assert.deepStrictEqual([got.value, got.source], ['git', 'own']);
});

test('a non-firm seed at its ledger hash is treated as absent under a chain', () =>
{
    const at = joined({ child: `${KEY}=git\n` });
    const got = rank(at, { ledgerRows: { [KEY]: stampLib.valueHash('git') }, answeredEnv: [] });
    assert.deepStrictEqual([got.value, got.source], ['local', 'chain']);
});

test('an answered value at its ledger hash stays the child\'s own', () =>
{
    const at = joined({ child: `${KEY}=git\n` });
    const got = rank(at, { ledgerRows: { [KEY]: stampLib.valueHash('git') }, answeredEnv: [KEY] });
    assert.deepStrictEqual([got.value, got.source], ['git', 'own']);
});

test('the ledger and the answers come from the project\'s own stamp when the caller passes none', () =>
{
    const stamp = `sha: x\nmanaged-env: .variables:${KEY}=${stampLib.valueHash('git')}\n`;
    const at = joined({ child: `${KEY}=git\n`, childStamp: stamp });
    assert.strictEqual(rank(at).source, 'chain');
    const answered = joined({ child: `${KEY}=git\n`, childStamp: `${stamp}answered-env: ${KEY}\n` });
    assert.deepStrictEqual([rank(answered).value, rank(answered).source], ['git', 'own']);
});

test('copy.resolveDocsVersioning ranked falls back to the chain; unranked still reads the own value only', () =>
{
    const at = joined();
    process.env.ALFRED_CODE_WORKSPACE = '1';
    try
    {
        assert.strictEqual(copy.resolveDocsVersioning(at.child, 'project'), null);
        assert.strictEqual(copy.resolveDocsVersioning(at.child, 'project', { ranked: true }), 'local');
    }
    finally { delete process.env.ALFRED_CODE_WORKSPACE; }
    const typed = joined({ child: `${KEY}=git\n` });
    assert.strictEqual(copy.resolveDocsVersioning(typed.child, 'project', { ranked: true }), 'git');
});

test('a seed another layer answers stays the child\'s own, in the ranking and in the remover', () =>
{
    const at = joined({ child: `${KEY}=git\n` });
    const ledgerRows = { [KEY]: stampLib.valueHash('git') };
    fs.writeFileSync(path.join(at.child, '.claude', 'settings.json'), JSON.stringify({ env: { [KEY]: 'local' } }));
    const got = rank(at, { ledgerRows, answeredEnv: [] });
    assert.deepStrictEqual([got.value, got.source], ['git', 'own'], 'the ranking keeps the line the loader reads first');
    const kept = require('./install/workspace.js').pruneVersioningSeed(at.child, { env: ON, advice: { firm: false }, answeredEnv: [], log: () => {} });
    assert.deepStrictEqual([kept.dropped, kept.kept], [false, 'git']);
});

test('layerHolding names the first layer between .variables and the members that holds the key', () =>
{
    const ws = require('./install/workspace.js');
    const at = joined();
    const acct = path.join(TMP, 'acct');
    fs.mkdirSync(acct, { recursive: true });
    assert.strictEqual(ws.layerHolding(at.child, KEY, { env: ON }), undefined);
    assert.deepStrictEqual(ws.layerHolding(at.child, KEY, { env: { ...ON, [KEY]: 'git' } }), ['the run\'s environment', 'git']);
    fs.writeFileSync(path.join(acct, 'settings.json'), JSON.stringify({ env: { [KEY]: 'local' } }));
    assert.deepStrictEqual(ws.layerHolding(at.child, KEY, { env: ON }), ['account settings', 'local']);
    fs.writeFileSync(path.join(at.child, '.claude', 'settings.json'), JSON.stringify({ env: { [KEY]: 'git' } }));
    assert.deepStrictEqual(ws.layerHolding(at.child, KEY, { env: ON }), ['settings.json', 'git']);
    fs.writeFileSync(path.join(at.child, '.claude', 'settings.json'), '{ not json');
    assert.strictEqual(ws.layerHolding(at.child, KEY, { env: ON })[0], 'account settings', 'a garbage file reads as empty, as the loader reads it');
    fs.rmSync(acct, { recursive: true, force: true });
});
