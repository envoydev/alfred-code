// The workspace file (scripts/install/workspace.js, spec 2.1): a root's children list, a child's parent line and its
// ignores, one machine-local file per project under its data root, written under a lock so two sibling inits never
// overwrite each other's `child` line.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ws = require('./install/workspace.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const project = (text) =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'p-'));
    if (text !== undefined)
    {
        fs.mkdirSync(path.join(root, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(root, '.alfred', 'workspace'), text);
    }
    return root;
};
const fileOf = (root, dataRoot = '.alfred') => path.join(root, ...dataRoot.split('/'), 'workspace');
const lockOf = (root) => path.join(root, '.alfred', 'workspace.lock');
// A fake clock whose sleep advances it, so a 2 s lock wait runs in no time; `onSleep` sees the clock after each step.
const clock = (start = Date.now(), onSleep = () => {}) =>
{
    const state = { t: start, sleeps: 0 };
    return {
        state,
        now: () => state.t,
        sleep: (ms) => { state.t += ms; state.sleeps += 1; onSleep(state.t - start); },
    };
};

test('parse and render keep comments and unknown lines byte for byte and drop duplicate entries', () =>
{
    const model = ws.parseWorkspace('parent ..\n# note\nchild api\nchild api\ncolour red\n');
    assert.strictEqual(ws.renderWorkspace(model), 'parent ..\n# note\nchild api\ncolour red\n');
    const view = ws.viewOf(model);
    assert.strictEqual(view.parent, '..');
    assert.deepStrictEqual(view.children, ['api']);
    assert.deepStrictEqual(view.unknown, ['colour red']);
});

test('values that would leave the tree read as unknown', () =>
{
    const lines = ['parent /abs', 'parent ../x', 'child ../a', 'child C:/a', 'child a\\b', 'ignore colour x', 'ignore skill'];
    const view = ws.viewOf(ws.parseWorkspace(lines.join('\n') + '\n'));
    assert.deepStrictEqual(view.unknown, lines);
    assert.strictEqual(view.parent, null);
    assert.deepStrictEqual(view.children, []);
    assert.deepStrictEqual(view.ignores, []);
});

test('ignore forms', () =>
{
    const view = ws.viewOf(ws.parseWorkspace('ignore docs root\nignore memory root\nignore instructions .claude/AGENTS.md\nignore skill typescript\n'));
    assert.deepStrictEqual(view.ignores, [
        { category: 'docs', name: 'root' },
        { category: 'memory', name: 'root' },
        { category: 'instructions', name: '.claude/AGENTS.md' },
        { category: 'skill', name: 'typescript' },
    ]);
    assert.deepStrictEqual(view.unknown, []);
    const bad = ws.viewOf(ws.parseWorkspace('ignore docs other\nignore doc a/../b\nignore skill a/b\n'));
    assert.strictEqual(bad.unknown.length, 3, 'only docs root is a docs form, a doc name has no .. segment, and a skill name no slash');
});

test('parent none, and a second parent line is unknown', () =>
{
    const view = ws.viewOf(ws.parseWorkspace('parent none\nparent ..\n'));
    assert.strictEqual(view.parentNone, true);
    assert.strictEqual(view.parent, null);
    assert.deepStrictEqual(view.unknown, ['parent ..']);
});

test('CRLF, a BOM and trailing spaces read the same as LF', () =>
{
    const lf = ws.viewOf(ws.parseWorkspace('parent ../..\nchild api\nignore skill x\n'));
    const odd = ws.viewOf(ws.parseWorkspace('\uFEFFparent ../..  \r\nchild api\t\r\nignore skill x \r\n'));
    assert.deepStrictEqual(odd, lf);
});

test('a lock released at 1.9 s is waited for; one held 2.1 s gives up with why locked', () =>
{
    const root = project('parent ..\n');
    fs.writeFileSync(lockOf(root), '');
    const fake = clock(Date.now(), (elapsed) => { if (elapsed >= 1900) fs.rmSync(lockOf(root), { force: true }); });
    const got = ws.writeWorkspace(root, (m) => ws.addChild(m, 'api'), { now: fake.now, sleep: fake.sleep });
    assert.strictEqual(got.ok, true);
    assert.strictEqual(got.wrote, true);
    assert.ok(fake.state.sleeps >= 38, 'it waited about 1.9 s in 50 ms steps');
    assert.strictEqual(fs.readFileSync(fileOf(root), 'utf8'), 'parent ..\nchild api\n');
    assert.strictEqual(fs.existsSync(lockOf(root)), false, 'the lock is released');

    const held = project('parent ..\n');
    fs.writeFileSync(lockOf(held), '');
    const never = clock();
    const stuck = ws.writeWorkspace(held, (m) => ws.addChild(m, 'api'), { now: never.now, sleep: never.sleep });
    assert.strictEqual(stuck.ok, false);
    assert.strictEqual(stuck.why, 'locked');
    assert.strictEqual(fs.readFileSync(fileOf(held), 'utf8'), 'parent ..\n', 'the file is unchanged');
    assert.strictEqual(fs.existsSync(lockOf(held)), true, 'another run\'s lock is never removed');
    assert.ok(never.state.t - Date.now() < 2200, 'it gave up at about 2 s');
});

test('a lock aged 29 s is waited on; one aged 31 s is taken over', () =>
{
    const aged = (seconds) =>
    {
        const root = project('');
        fs.writeFileSync(lockOf(root), '');
        const at = (Date.now() - seconds * 1000) / 1000;
        fs.utimesSync(lockOf(root), at, at);
        const fake = clock();
        const got = ws.writeWorkspace(root, (m) => ws.addChild(m, 'web'), { now: fake.now, sleep: fake.sleep });
        return { got, sleeps: fake.state.sleeps };
    };
    const young = aged(29);
    assert.ok(young.sleeps > 0, 'a 29 s lock is waited on until it passes 30 s');
    assert.strictEqual(young.got.ok, true);
    const old = aged(31);
    assert.strictEqual(old.sleeps, 0, 'a 31 s lock is taken over at once');
    assert.strictEqual(old.got.ok, true);
    assert.deepStrictEqual(old.got.view.children, ['web']);
});

test('a write that changes nothing leaves the file untouched', () =>
{
    const root = project('parent ..\nchild api\n');
    const at = (Date.now() - 60000) / 1000;
    fs.utimesSync(fileOf(root), at, at);
    const before = fs.statSync(fileOf(root)).mtimeMs;
    const got = ws.writeWorkspace(root, (m) => ws.addChild(m, 'api'));
    assert.strictEqual(got.ok, true);
    assert.strictEqual(got.wrote, false);
    assert.strictEqual(fs.statSync(fileOf(root)).mtimeMs, before);
    const crlf = project('parent ..\r\n# mine\r\n');
    ws.writeWorkspace(crlf, () => {});
    assert.strictEqual(fs.readFileSync(fileOf(crlf), 'utf8'), 'parent ..\r\n# mine\r\n', 'a no-op never rewrites a hand-saved CRLF file');
});

test('dataRoot passed to writeWorkspace writes under that folder', () =>
{
    const root = project();
    const got = ws.writeWorkspace(root, (m) => ws.setParent(m, '..'), { dataRoot: '.kid-data' });
    assert.strictEqual(got.ok, true);
    assert.strictEqual(fs.readFileSync(fileOf(root, '.kid-data'), 'utf8'), 'parent ..\n');
    assert.strictEqual(fs.existsSync(path.join(root, '.alfred')), false);
    assert.strictEqual(ws.readWorkspace(root, { dataRoot: '.kid-data' }).view.parent, '..');
    for (const bad of ['../x', '.claude/x'])
    {
        const refused = ws.writeWorkspace(root, (m) => ws.addChild(m, 'x'), { dataRoot: bad });
        assert.deepStrictEqual([refused.ok, refused.why], [false, 'unwritable'], bad);
    }
});

test('readWorkspace states: absent and ok', () =>
{
    assert.strictEqual(ws.readWorkspace(project()).state, 'absent');
    const got = ws.readWorkspace(project('child api\n'));
    assert.strictEqual(got.state, 'ok');
    assert.deepStrictEqual(got.view.children, ['api']);
});

test('the mutators set, add and remove, and setParent replaces both parent forms', () =>
{
    const model = ws.parseWorkspace('parent none\n# keep\n');
    ws.setParent(model, '../..');
    ws.addChild(model, 'api');
    ws.addChild(model, 'web');
    ws.removeChild(model, 'api');
    ws.addIgnore(model, 'skill', 'x');
    ws.addIgnore(model, 'skill', 'x');
    ws.addIgnore(model, 'env', 'ALFRED_CODE_SCORER');
    ws.removeIgnore(model, 'env', 'ALFRED_CODE_SCORER');
    assert.strictEqual(ws.renderWorkspace(model), 'parent ../..\n# keep\nchild web\nignore skill x\n');
    ws.setParent(model, null);
    assert.strictEqual(ws.viewOf(model).parent, null);
    assert.throws(() => ws.addChild(model, '../a'), /child/);
    assert.ok(ws.CATEGORIES.includes('instructions'));
});

test('moveWorkspace moves, reports absent, and never overwrites', () =>
{
    const said = [];
    const log = (l) => said.push(l);
    const root = project('child api\n');
    assert.strictEqual(ws.moveWorkspace({ projectRoot: root, from: '.alfred', to: '.ws-data', log }), 'moved');
    assert.strictEqual(fs.readFileSync(fileOf(root, '.ws-data'), 'utf8'), 'child api\n');
    assert.strictEqual(fs.existsSync(fileOf(root)), false);
    assert.strictEqual(ws.moveWorkspace({ projectRoot: root, from: '.alfred', to: '.ws-data', log }), 'absent');
    const both = project('child api\n');
    fs.mkdirSync(path.join(both, '.ws-data'));
    fs.writeFileSync(fileOf(both, '.ws-data'), 'child web\n');
    assert.strictEqual(ws.moveWorkspace({ projectRoot: both, from: '.alfred', to: '.ws-data', log }), 'clash');
    assert.strictEqual(fs.readFileSync(fileOf(both), 'utf8'), 'child api\n');
    assert.strictEqual(fs.readFileSync(fileOf(both, '.ws-data'), 'utf8'), 'child web\n');
    assert.match(said.join('\n'), /!! workspace: \.alfred\/workspace left in place - \.ws-data\/workspace already exists/);
});

test('ancestorEnv keeps only the account', () =>
{
    assert.deepStrictEqual(ws.ancestorEnv({ CLAUDE_CONFIG_DIR: '/acct', ALFRED_CODE_DATA_PATH: '.x' }), { CLAUDE_CONFIG_DIR: '/acct' });
});

// ------------------------------------------------------------------ the tree (Task 3)

const { execFileSync } = require('node:child_process');
const STAMP = 'sha: x\n';
// A tree under TMP: `spec` maps a relative folder to { stamp, git, file } - `file` is its workspace file's text.
const tree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        if (o.stamp) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), STAMP); }
        if (o.file !== undefined) { fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true }); fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), o.file); }
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const runtime = require('./install/runtime.js');
const exec = runtime.execCommand;
const env0 = { CLAUDE_CONFIG_DIR: path.join(TMP, 'no-account') };

test('findParent finds the nearest stamped ancestor and skips the account dir', () =>
{
    const at = tree({ 'home': {}, 'home/.claude': {}, 'home/ws': { stamp: true }, 'home/ws/api': { stamp: true } });
    fs.writeFileSync(path.join(at('home'), '.claude', 'alfred-code.stamp'), STAMP);
    const env = { CLAUDE_CONFIG_DIR: path.join(at('home'), '.claude') };
    assert.deepStrictEqual(ws.findParent(at('home/ws/api'), { env }), { root: at('home/ws'), rel: '..' });
    fs.rmSync(path.join(at('home/ws'), '.claude'), { recursive: true });
    assert.strictEqual(ws.findParent(at('home/ws/api'), { env }), null, 'the account dir is never a parent');
});

test('findParent returns null at the filesystem root', () =>
{
    assert.strictEqual(ws.findParent(path.parse(TMP).root, { env: env0 }), null);
});

test('sameRepo is true for a sub-folder of the parent\'s repo; isCheckout is false for a plain folder', () =>
{
    const at = tree({ 'ws': { git: true }, 'ws/sub': {}, 'ws/api': { git: true }, 'plain': {} });
    assert.strictEqual(ws.sameRepo(at('ws/sub'), at('ws'), { exec }), true);
    assert.strictEqual(ws.sameRepo(at('ws/api'), at('ws'), { exec }), false);
    assert.strictEqual(ws.isCheckout(at('plain'), { exec }), false);
    assert.strictEqual(ws.isCheckout(at('ws/sub'), { exec }), false, 'a sub-folder is not its own checkout');
    assert.strictEqual(ws.isCheckout(at('ws/api'), { exec }), true);
});

test('joinVerdict names same-repo and not-a-checkout, and is ok for a nested checkout', () =>
{
    const at = tree({ 'ws': { git: true, stamp: true }, 'ws/sub': { stamp: true }, 'ws/api': { git: true, stamp: true } });
    assert.deepStrictEqual(ws.joinVerdict(at('ws/sub'), { env: env0, exec }), { parent: { root: at('ws'), rel: '..' }, ok: false, why: 'same-repo' });
    assert.deepStrictEqual(ws.joinVerdict(at('ws/api'), { env: env0, exec }), { parent: { root: at('ws'), rel: '..' }, ok: true });
    const lone = tree({ 'p': { git: true, stamp: true } });
    assert.deepStrictEqual(ws.joinVerdict(lone('p'), { env: env0, exec }), { parent: null, ok: false });
    const plain = tree({ 'ws': { stamp: true }, 'ws/kid': { stamp: true } });
    assert.deepStrictEqual(ws.joinVerdict(plain('ws/kid'), { env: env0, exec }).why, 'not-a-checkout');
});

test('chain follows parent lines nearest first and needs the back-reference', () =>
{
    const at = tree({
        'ws': { stamp: true, file: 'child api\n' },
        'ws/api': { stamp: true, file: 'parent ..\nchild tool\n' },
        'ws/api/tool': { stamp: true, file: 'parent ..\n' },
    });
    const got = ws.chain(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(got.members.map((m) => [m.root, m.rel, m.dataRoot]), [[at('ws/api'), '..', '.alfred'], [at('ws'), '../..', '.alfred']]);
    assert.deepStrictEqual(got.notes, []);
    fs.writeFileSync(path.join(at('ws'), '.alfred', 'workspace'), '# no children\n');
    const cut = ws.chain(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(cut.members.map((m) => m.rel), ['..']);
    assert.deepStrictEqual(cut.notes, ['!! workspace: parent .. in ../.alfred/workspace ignored - ../.. does not list this folder as a child']);
});

test('chain reads the project\'s own file from ownDataRoot', () =>
{
    const at = tree({ 'ws': { stamp: true, file: 'child api\n' }, 'ws/api': { stamp: true } });
    fs.mkdirSync(path.join(at('ws/api'), '.kid-data'));
    fs.writeFileSync(path.join(at('ws/api'), '.kid-data', 'workspace'), 'parent ..\n');
    assert.strictEqual(ws.chain(at('ws/api'), { env: env0 }).members.length, 0, 'the default root holds no parent line');
    assert.strictEqual(ws.chain(at('ws/api'), { env: env0, ownDataRoot: '.kid-data' }).members.length, 1);
});

test('chain refuses a parent line that is not a strict ancestor, has no stamp, or loops', () =>
{
    const unstamped = tree({ 'ws': { file: 'child api\n' }, 'ws/api': { stamp: true, file: 'parent ..\n' } });
    const one = ws.chain(unstamped('ws/api'), { env: env0 });
    assert.deepStrictEqual(one.members, []);
    assert.deepStrictEqual(one.notes, ['!! workspace: parent .. in .alfred/workspace ignored - .. holds no Alfred install']);
    // A link makes `..` of the child resolve to a folder that is not its real ancestor.
    if (process.platform !== 'win32')
    {
        const at = tree({ 'ws': { stamp: true, file: 'child api\n' }, 'other': { stamp: true, file: 'child api\n' }, 'other/api': { stamp: true, file: 'parent ..\n' } });
        fs.symlinkSync(at('other/api'), path.join(at('ws'), 'api'));
        const linked = ws.chain(path.join(at('ws'), 'api'), { env: env0 });
        assert.deepStrictEqual(linked.members.map((m) => m.root), [at('other')], 'the real path decides the parent');
    }
    const loop = tree({ 'ws': { stamp: true, file: 'parent ..\nchild ws\n' } });
    const top = path.dirname(loop('ws'));
    fs.mkdirSync(path.join(top, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(top, '.claude', 'alfred-code.stamp'), STAMP);
    fs.mkdirSync(path.join(top, '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(top, '.alfred', 'workspace'), 'child ws\n');
    assert.strictEqual(ws.chain(loop('ws'), { env: env0 }).members.length, 1);
});

test('chain depth 7, 8 and 9', () =>
{
    for (const [depth, want] of [[7, 7], [8, 8], [9, 8]])
    {
        const spec = {};
        const names = Array.from({ length: depth + 1 }, (_, i) => `d${i}`);
        for (let i = 0; i <= depth; i++)
        {
            const rel = names.slice(0, i + 1).join('/');
            const lines = [];
            if (i > 0) lines.push('parent ..');
            if (i < depth) lines.push(`child ${names[i + 1]}`);
            spec[rel] = { stamp: true, file: lines.join('\n') + '\n' };
        }
        const at = tree(spec);
        const got = ws.chain(at(names.join('/')), { env: env0 });
        assert.strictEqual(got.members.length, want, `depth ${depth}`);
    }
});

test('subtree is pre-order and marks a missing or unstamped child gone', () =>
{
    const at = tree({
        'ws': { stamp: true, file: 'child api\nchild web\nchild gone\nchild bare\n' },
        'ws/api': { stamp: true, file: 'parent ..\nchild tool\n' },
        'ws/api/tool': { stamp: true, file: 'parent ..\n' },
        'ws/web': { stamp: true, file: 'parent ..\n' },
        'ws/bare': {},
    });
    const got = ws.subtree(at('ws'), { env: env0 });
    assert.deepStrictEqual(got.map((r) => [r.rel, r.depth, r.parentRel, r.state]), [
        ['.', 0, null, 'ok'],
        ['api', 1, '.', 'ok'],
        ['api/tool', 2, 'api', 'ok'],
        ['web', 1, '.', 'ok'],
        ['gone', 1, '.', 'gone'],
        ['bare', 1, '.', 'gone'],
    ]);
});

test('rescan depth 4, 5 and 6', () =>
{
    const at = tree({
        'ws': { stamp: true },
        'ws/a/b/c/d4': { stamp: true },
        'ws/e/f/g/h/d5': { stamp: true },
        'ws/i/j/k/l/m/d6': { stamp: true },
        'ws/joined': { stamp: true, file: 'parent ..\n' },
        'ws/declined': { stamp: true, file: 'parent none\n' },
        'ws/node_modules/x': { stamp: true },
        'ws/.claude/y': { stamp: true },
        'ws/.alfred/z': { stamp: true },
        'ws/d4/inner': { stamp: true },
    });
    fs.mkdirSync(path.join(at('ws/d4'), '.claude'), { recursive: true });
    fs.writeFileSync(path.join(at('ws/d4'), '.claude', 'alfred-code.stamp'), STAMP);
    if (process.platform !== 'win32') fs.symlinkSync(at('ws/a'), path.join(at('ws'), 'link'));
    assert.deepStrictEqual(ws.rescan(at('ws')), ['a/b/c/d4', 'd4', 'e/f/g/h/d5']);
});

test('the /tmp spelling and the real spelling are one member', { skip: process.platform === 'win32' && 'links need privileges on Windows' }, () =>
{
    const at = tree({ 'ws': { stamp: true, file: 'child api\n' }, 'ws/api': { stamp: true, file: 'parent ..\nchild tool\n' }, 'ws/api/tool': { stamp: true, file: 'parent ..\n' } });
    const link = path.join(TMP, `link-${process.pid}`);
    fs.symlinkSync(path.dirname(at('ws')), link);
    const viaLink = ws.chain(path.join(link, 'ws', 'api', 'tool'), { env: env0 });
    const viaReal = ws.chain(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(viaLink.members.map((m) => m.root), viaReal.members.map((m) => m.root));
    assert.strictEqual(ws.realKey(path.join(link, 'ws')), ws.realKey(at('ws')));
});

// ------------------------------------------------------------------ lists, env and excludes (Task 4)

const { valueHash } = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');
const CATALOG = [
    { key: 'ALFRED_CODE_DATA_PATH', default: '.alfred' },
    { key: 'ALFRED_CODE_DOCS_VERSIONING', default: 'git' },
    { key: 'ALFRED_CODE_SCORER', default: '0' },
    { key: 'ALFRED_CODE_HISTORY', default: '1' },
    { key: 'ALFRED_CODE_MEMORY', default: 'claude' },
    { key: 'ALFRED_CODE_HOOKS_OFF', default: '' },
    { key: 'ALFRED_CODE_WORKSPACE', default: '1', seed: false },
];
const envOf = (o) => ws.childEnv({ catalog: CATALOG, parentEnv: {}, childEnv: {}, beneath: {}, ownPrior: [], ledgerRows: {}, flagKeys: [], ignores: [], ...o });

test('planLines spells every category the way --add takes it', () =>
{
    const lines = ws.planLines({ skills: ['typescript'], agents: ['planner'], rules: ['alfred-x'], hooks: ['docs-session'], mcps: [], plugins: [{ name: 'typescript-lsp', scope: 'project' }] });
    assert.deepStrictEqual(lines, ['agent planner', 'hook docs-session', 'plugin typescript-lsp', 'rule alfred-x', 'skill typescript']);
});

test('effectiveLists takes the parent minus the ignored plus own', () =>
{
    const got = ws.effectiveLists({ parentLines: ['skill a', 'skill b', 'agent p'], ignores: [{ category: 'skill', name: 'b' }, { category: 'env', name: 'X' }], own: ['skill c', 'skill a'] });
    assert.deepStrictEqual(got, ['agent p', 'skill a', 'skill c']);
});

test('delta adds what is missing and drops what is neither inherited nor own', () =>
{
    assert.deepStrictEqual(ws.delta({ effective: ['skill a', 'skill c'], installed: ['skill a', 'skill b'] }), { add: ['skill c'], drop: ['skill b'] });
});

test('ownPicksAfter, one case per rule', () =>
{
    const final = ['skill a', 'skill b', 'skill own'];
    assert.deepStrictEqual(ws.ownPicksAfter({ prior: null, final, parentLines: ['skill a', 'skill b'], added: [] }), ['skill own']);
    assert.deepStrictEqual(ws.ownPicksAfter({ prior: null, final, parentLines: null, added: [] }), final);
    assert.deepStrictEqual(ws.ownPicksAfter({ prior: ['skill a', 'skill gone'], final, parentLines: ['skill a', 'skill b'], added: [] }), ['skill a', 'skill own']);
    assert.deepStrictEqual(ws.ownPicksAfter({ prior: ['skill a'], final, parentLines: null, added: ['skill b'] }), ['skill a', 'skill b']);
    assert.deepStrictEqual(ws.ownPicksAfter({ prior: ['skill unseen'], final, parentLines: ['skill a'], added: [], blind: true }), ['skill unseen']);
    assert.strictEqual(ws.ownPicksAfter({ prior: null, final, parentLines: ['skill a'], added: [], blind: true }), null);
});

test('childEnv: a key absent in the child is seeded with the parent\'s value', () =>
{
    const got = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' } });
    assert.strictEqual(got.seeds.ALFRED_CODE_SCORER, '1');
    assert.strictEqual(got.seeds.ALFRED_CODE_HISTORY, '1', 'a key the parent lacks seeds its catalog default');
    assert.deepStrictEqual(got.force, []);
});

test('childEnv: a key not own and at its ledgered hash is forced to the parent\'s value', () =>
{
    const got = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, childEnv: { ALFRED_CODE_SCORER: '0' }, ledgerRows: { ALFRED_CODE_SCORER: valueHash('0') } });
    assert.deepStrictEqual(got.force, ['ALFRED_CODE_SCORER']);
    assert.strictEqual(got.seeds.ALFRED_CODE_SCORER, '1');
});

test('childEnv: a value off its ledger row is own, and own stays own', () =>
{
    const got = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, childEnv: { ALFRED_CODE_SCORER: '0' }, ledgerRows: { ALFRED_CODE_SCORER: valueHash('1') } });
    assert.deepStrictEqual(got.own, ['ALFRED_CODE_SCORER']);
    assert.deepStrictEqual(got.force, []);
    assert.strictEqual(Object.hasOwn(got.seeds, 'ALFRED_CODE_SCORER'), false);
    const again = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, childEnv: { ALFRED_CODE_SCORER: '1' }, ledgerRows: { ALFRED_CODE_SCORER: valueHash('1') }, ownPrior: ['ALFRED_CODE_SCORER'] });
    assert.deepStrictEqual(again.own, ['ALFRED_CODE_SCORER']);
});

test('childEnv: with no ledger row, a value off both the default and the parent is own', () =>
{
    assert.deepStrictEqual(envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, childEnv: { ALFRED_CODE_SCORER: '2' } }).own, ['ALFRED_CODE_SCORER']);
    const atDefault = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, childEnv: { ALFRED_CODE_SCORER: '0' } });
    assert.deepStrictEqual(atDefault.own, []);
    assert.deepStrictEqual(atDefault.force, ['ALFRED_CODE_SCORER']);
});

test('childEnv: on a first run every key off the parent\'s value is own (the join rule)', () =>
{
    const got = envOf({ ownPrior: null, parentEnv: { ALFRED_CODE_SCORER: '0' }, childEnv: { ALFRED_CODE_SCORER: '1', ALFRED_CODE_HISTORY: '1' }, ledgerRows: { ALFRED_CODE_SCORER: valueHash('1') } });
    assert.deepStrictEqual(got.own, ['ALFRED_CODE_SCORER']);
    assert.deepStrictEqual(got.force, []);
});

test('childEnv: flag keys are own', () =>
{
    assert.deepStrictEqual(envOf({ parentEnv: { ALFRED_CODE_MEMORY: 'alfred' }, childEnv: { ALFRED_CODE_MEMORY: 'claude' }, flagKeys: ['ALFRED_CODE_MEMORY'] }).own, ['ALFRED_CODE_MEMORY']);
});

test('childEnv: a key only beneath is own and never seeded or forced', () =>
{
    const got = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, beneath: { ALFRED_CODE_SCORER: '0' } });
    assert.deepStrictEqual(got.own, ['ALFRED_CODE_SCORER']);
    assert.strictEqual(Object.hasOwn(got.seeds, 'ALFRED_CODE_SCORER'), false);
    assert.deepStrictEqual(got.force, []);
});

test('childEnv: ignore env K seeds the catalog default', () =>
{
    const got = envOf({ parentEnv: { ALFRED_CODE_SCORER: '1' }, childEnv: { ALFRED_CODE_SCORER: '1' }, ledgerRows: { ALFRED_CODE_SCORER: valueHash('1') }, ignores: [{ category: 'env', name: 'ALFRED_CODE_SCORER' }] });
    assert.strictEqual(got.seeds.ALFRED_CODE_SCORER, '0');
    assert.deepStrictEqual(got.force, ['ALFRED_CODE_SCORER']);
});

test('childEnv: the data root, docs versioning and a seed:false row never pass down', () =>
{
    const got = envOf({ parentEnv: { ALFRED_CODE_DATA_PATH: '.ws', ALFRED_CODE_DOCS_VERSIONING: 'local', ALFRED_CODE_WORKSPACE: '0' } });
    for (const key of ['ALFRED_CODE_DATA_PATH', 'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_WORKSPACE'])
        assert.strictEqual(Object.hasOwn(got.seeds, key), false, key);
});

test('childEnv: HOOKS_OFF keeps the child\'s whole-hook entries and takes the parent\'s part entries', () =>
{
    const row = { ALFRED_CODE_HOOKS_OFF: valueHash('docs-session') };
    const got = envOf({ parentEnv: { ALFRED_CODE_HOOKS_OFF: 'guard-x,guard-ungated-commit:push' }, childEnv: { ALFRED_CODE_HOOKS_OFF: 'docs-session' }, ledgerRows: row });
    assert.strictEqual(got.seeds.ALFRED_CODE_HOOKS_OFF, 'docs-session,guard-ungated-commit:push');
    assert.deepStrictEqual(got.force, ['ALFRED_CODE_HOOKS_OFF']);
    const left = envOf({ parentEnv: { ALFRED_CODE_HOOKS_OFF: '' }, childEnv: { ALFRED_CODE_HOOKS_OFF: 'docs-session,guard-ungated-commit:push' }, ledgerRows: { ALFRED_CODE_HOOKS_OFF: valueHash('docs-session,guard-ungated-commit:push') } });
    assert.strictEqual(left.seeds.ALFRED_CODE_HOOKS_OFF, 'docs-session', 'a part entry the parent dropped leaves');
    const own = envOf({ parentEnv: { ALFRED_CODE_HOOKS_OFF: 'guard-ungated-commit:push' }, childEnv: { ALFRED_CODE_HOOKS_OFF: 'docs-session' }, ownPrior: ['ALFRED_CODE_HOOKS_OFF'] });
    assert.deepStrictEqual([own.own, own.force, Object.hasOwn(own.seeds, 'ALFRED_CODE_HOOKS_OFF')], [['ALFRED_CODE_HOOKS_OFF'], [], false]);
});

test('stampedAncestors lists every stamped folder above, linked or not, nearest first', () =>
{
    const at = tree({ 'ws': { stamp: true }, 'ws/mid': { stamp: true }, 'ws/mid/plain': {}, 'ws/mid/plain/kid': { stamp: true } });
    assert.deepStrictEqual(ws.stampedAncestors(at('ws/mid/plain/kid'), { env: env0 }), [at('ws/mid'), at('ws')]);
});

test('ancestorExcludes lists the stack\'s copies and the unedited seed, never the user\'s own', () =>
{
    const at = tree({ 'ws': { stamp: true } });
    const root = at('ws');
    const rules = path.join(root, '.claude', 'rules');
    fs.mkdirSync(rules, { recursive: true });
    for (const n of ['alfred-house', 'alfred-agent-awareness', 'my-own']) fs.writeFileSync(path.join(rules, `${n}.md`), `# ${n}\n`);
    fs.writeFileSync(path.join(root, '.claude', 'AGENTS.md'), '# seed\n');
    fs.writeFileSync(path.join(root, 'NOTES.md'), '# notes\n');
    const seedHash = hashItem(path.join(root, '.claude', 'AGENTS.md'));
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `sha: x\nlibrary-rules: alfred-house=${'a'.repeat(64)}\nmanaged-env: \nmanaged-files: AGENTS.md=${seedHash}\n`);
    const got = ws.ancestorExcludes(root, { childIgnores: [{ category: 'instructions', name: 'NOTES.md' }, { category: 'instructions', name: 'MISSING.md' }] }).sort();
    assert.deepStrictEqual(got, [
        path.join(root, '.claude', 'AGENTS.md'),
        path.join(rules, 'alfred-agent-awareness.md'),
        path.join(rules, 'alfred-house.md'),
        path.join(root, 'NOTES.md'),
    ].sort());
    fs.writeFileSync(path.join(root, '.claude', 'AGENTS.md'), '# seed, edited by the user\n');
    assert.ok(!ws.ancestorExcludes(root, {}).includes(path.join(root, '.claude', 'AGENTS.md')), 'an edited AGENTS.md is the user\'s');
});

test('excludeGlobs on darwin and win32 writes a class per cased letter and each metacharacter as a one-character class', () =>
{
    assert.deepStrictEqual(ws.excludeGlobs(['C:\\a (b) [c]\\r.md'], 'win32'), ['[cC]:/[aA] [(][bB][)] [[][cC]]/[rR].[mM][dD]']);
    assert.deepStrictEqual(ws.excludeGlobs(['/x/Ünï dir/{a}*?.md'], 'darwin'), ['/[xX]/[üÜ][nN][ïÏ] [dD][iI][rR]/[{][aA][}][*][?].[mM][dD]']);
    assert.deepStrictEqual(ws.excludeGlobs(['/x/A (b)/r.md'], 'linux'), ['/x/A [(]b[)]/r.md']);
    assert.deepStrictEqual(ws.excludeGlobs(['/x/ß9.md'], 'darwin'), ['/[xX]/ß9.[mM][dD]'], 'a letter with no one-letter upper case stays as it is');
    const real = fs.realpathSync.native(TMP);
    const glob = ws.excludeGlobs([TMP], 'linux')[0];
    assert.strictEqual(glob, real.split(path.sep).join('/').replace(/[*?[{}()]/g, (c) => `[${c}]`), 'an existing path is written by its real spelling');
});

test('workspaceOn reads the launch env first, then settings.local.json over settings.json', () =>
{
    const root = project();
    const claude = path.join(root, '.claude');
    fs.mkdirSync(claude, { recursive: true });
    const put = (name, value) => fs.writeFileSync(path.join(claude, name), value === undefined ? '{}' : JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: value } }));
    assert.strictEqual(ws.workspaceOn({ env: {}, projectRoot: root }), true, 'no value anywhere: on');
    assert.strictEqual(ws.workspaceOn({ env: { ALFRED_CODE_WORKSPACE: '0' }, projectRoot: root }), false, 'the launch env 0 freezes it');
    put('settings.json', '0');
    assert.strictEqual(ws.workspaceOn({ env: {}, projectRoot: root }), false, 'settings.json 0 freezes it');
    assert.strictEqual(ws.workspaceOn({ env: { ALFRED_CODE_WORKSPACE: '1' }, projectRoot: root }), false, 'a 0 in a settings env freezes it whatever the launch env says');
    put('settings.local.json', '1');
    assert.strictEqual(ws.workspaceOn({ env: {}, projectRoot: root }), true, 'settings.local.json 1 over settings.json 0');
    put('settings.local.json', '0');
    put('settings.json', '1');
    assert.strictEqual(ws.workspaceOn({ env: {}, projectRoot: root }), false, 'settings.local.json 0 over settings.json 1');
    fs.writeFileSync(path.join(claude, 'settings.local.json'), '{ not json');
    assert.strictEqual(ws.workspaceOn({ env: {}, projectRoot: root }), true, 'an unreadable local file is read as holding nothing');
});
