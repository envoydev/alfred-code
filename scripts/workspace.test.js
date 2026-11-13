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
const { samePath } = require('./test-paths.js');
const { putWorkspace, readWorkspaceRecord, readWorkspaceValues } = require('./workspace-fixture.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
// `content`: a record, written through the fixture - or a string, the old file's own text, where that text is the subject.
const project = (content) =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'p-'));
    if (content !== null && typeof content === 'object') putWorkspace(root, content);
    else if (content !== undefined)
    {
        fs.mkdirSync(path.join(root, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(root, '.alfred', 'workspace'), content);
    }
    return root;
};
// The file the project's record is read from (workspace.json's path when neither exists).
const fileOf = (root, dataRoot = '.alfred') => readWorkspaceRecord(root, { dataRoot }).file;
const wfLib = require('../stack/hooks/workspace-file.js');
const jsonOf = (root, dataRoot = '.alfred') => path.join(root, ...dataRoot.split('/'), 'workspace.json');
const legacyOf = (root, dataRoot = '.alfred') => path.join(root, ...dataRoot.split('/'), 'workspace');
// The file's own text is the subject: workspace.json written byte for byte as given.
const putJson = (root, text, dataRoot = '.alfred') =>
{
    fs.mkdirSync(path.dirname(jsonOf(root, dataRoot)), { recursive: true });
    fs.writeFileSync(jsonOf(root, dataRoot), text);
    return root;
};
const putOld = (root, text, dataRoot = '.alfred') =>
{
    fs.mkdirSync(path.dirname(legacyOf(root, dataRoot)), { recursive: true });
    fs.writeFileSync(legacyOf(root, dataRoot), text);
    return root;
};
// The file's mtime set a minute back, returned - a rewrite moves it.
const aged = (file) => { const t = (Date.now() - 60000) / 1000; fs.utimesSync(file, t, t); return fs.statSync(file).mtimeMs; };
const sink = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };
const GARBAGE = (rel) => `!! workspace: ${rel} is not valid JSON - fix it by hand; the workspace pass neither reads nor writes it until then`;
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

test('a lock released at 1.9 s is waited for; one held 2.1 s gives up with why locked', () =>
{
    const root = project({ parent: '..' });
    fs.writeFileSync(lockOf(root), '');
    const fake = clock(Date.now(), (elapsed) => { if (elapsed >= 1900) fs.rmSync(lockOf(root), { force: true }); });
    const got = ws.writeWorkspace(root, (m) => ws.addChild(m, 'api'), { now: fake.now, sleep: fake.sleep });
    assert.strictEqual(got.ok, true);
    assert.strictEqual(got.wrote, true);
    assert.ok(fake.state.sleeps >= 38, 'it waited about 1.9 s in 50 ms steps');
    assert.deepStrictEqual(readWorkspaceValues(root), { parent: '..', children: ['api'] });
    assert.strictEqual(fs.existsSync(lockOf(root)), false, 'the lock is released');

    const held = project({ parent: '..' });
    fs.writeFileSync(lockOf(held), '');
    const never = clock();
    const stuck = ws.writeWorkspace(held, (m) => ws.addChild(m, 'api'), { now: never.now, sleep: never.sleep });
    assert.strictEqual(stuck.ok, false);
    assert.strictEqual(stuck.why, 'locked');
    assert.deepStrictEqual(readWorkspaceValues(held), { parent: '..' }, 'the file is unchanged');
    assert.strictEqual(fs.existsSync(lockOf(held)), true, 'another run\'s lock is never removed');
    assert.ok(never.state.t - Date.now() < 2200, 'it gave up at about 2 s');
});

test('a lock aged 29 s is waited on; one aged 31 s is taken over', () =>
{
    const aged = (seconds) =>
    {
        const root = project({});
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
    const root = project();
    putWorkspace(root, { parent: '..', children: ['api'] }, { legacy: false });
    const before = aged(fileOf(root));
    const got = ws.writeWorkspace(root, (m) => ws.addChild(m, 'api'));
    assert.deepStrictEqual([got.ok, got.wrote], [true, false]);
    assert.strictEqual(fs.statSync(fileOf(root)).mtimeMs, before);
    // the file's text is the subject: a hand-saved 4-space CRLF workspace.json
    const text = '{\r\n    "parent": "..",\r\n    "children": [\r\n        "api"\r\n    ]\r\n}\r\n';
    const hand = putJson(project(), text);
    const at = aged(jsonOf(hand));
    assert.strictEqual(ws.writeWorkspace(hand, () => {}).wrote, false);
    assert.strictEqual(fs.readFileSync(jsonOf(hand), 'utf8'), text, 'a no-op never rewrites a hand-saved file');
    assert.strictEqual(fs.statSync(jsonOf(hand)).mtimeMs, at);
});

test('dataRoot passed to writeWorkspace writes under that folder', () =>
{
    const root = project();
    const got = ws.writeWorkspace(root, (m) => ws.setParent(m, '..'), { dataRoot: '.kid-data' });
    assert.strictEqual(got.ok, true);
    assert.deepStrictEqual(readWorkspaceValues(root, { dataRoot: '.kid-data' }), { parent: '..' });
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
    const got = ws.readWorkspace(project({ children: ['api'] }));
    assert.strictEqual(got.state, 'ok');
    assert.deepStrictEqual(got.view.children, ['api']);
});

test('the mutators set, add and remove on a record; setParent and setRole exclude each other', () =>
{
    const record = { ...wfLib.emptyRecord(), role: 'standalone', parentNone: true };
    ws.setParent(record, '../..');
    assert.deepStrictEqual([record.parent, record.role, record.parentNone], ['../..', null, false]);
    ws.addChild(record, 'api');
    ws.addChild(record, 'web');
    ws.addChild(record, 'web');
    ws.removeChild(record, 'api');
    ws.addIgnore(record, 'skill', 'x');
    ws.addIgnore(record, 'skill', 'x');
    ws.addIgnore(record, 'env', 'ALFRED_CODE_SCORING');
    ws.removeIgnore(record, 'env', 'ALFRED_CODE_SCORING');
    ws.addIgnore(record, 'docs', 'root');
    assert.deepStrictEqual(wfLib.viewOf(record), {
        parent: '../..', parentNone: false, role: null, above: null, children: ['web'], ignoredChildren: [],
        ignores: [{ category: 'skill', name: 'x' }, { category: 'docs', name: 'root' }],
    });
    ws.setRole(record, 'root');
    assert.deepStrictEqual([record.parent, record.role], [null, 'root']);
    ws.setParent(record, '..');
    assert.deepStrictEqual([record.parent, record.role], ['..', null]);
    ws.setAbove(record, 'none');
    assert.strictEqual(record.above, 'none');
    ws.setParent(record, null);
    assert.strictEqual(record.parent, null);
    // the 2.11 spelling: `parent none` is role standalone
    ws.setParent(record, 'none');
    assert.deepStrictEqual([record.parent, record.role], [null, 'standalone']);
    assert.throws(() => ws.addChild(record, '../a'), /child/);
    assert.throws(() => ws.setParent(record, '/abs'), /parent/);
    assert.throws(() => ws.setRole(record, 'boss'), /role/);
    assert.throws(() => ws.addIgnore(record, 'colour', 'x'), /ignore/);
    assert.ok(ws.CATEGORIES.includes('instructions'));
});

// ------------------------------------------------------------------ the tree (Task 3)

const { execFileSync } = require('node:child_process');
const STAMP = 'sha: x\n';
// A tree under TMP: `spec` maps a relative folder to { stamp, git, record, legacy } - `record` is its workspace record,
// written in the old line format when `legacy` (a test whose subject is that format or its conversion).
const tree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        if (o.stamp) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), STAMP); }
        if (o.record !== undefined) putWorkspace(dir, o.record, o.legacy ? { legacy: true } : {});
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const runtime = require('./install/runtime.js');
const exec = runtime.execCommand;
const env0 = { CLAUDE_CONFIG_DIR: path.join(TMP, 'no-account'), ALFRED_CODE_WORKSPACE: '1' };   // on by default since 3.0.0; pinned so a launch 0 in the caller's env cannot freeze it

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
        'ws': { stamp: true, record: { children: ['api'] } },
        'ws/api': { stamp: true, record: { parent: '..', children: ['tool'] } },
        'ws/api/tool': { stamp: true, record: { parent: '..' } },
    });
    const got = ws.chain(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(got.members.map((m) => [m.root, m.rel, m.dataRoot]), [[at('ws/api'), '..', '.alfred'], [at('ws'), '../..', '.alfred']]);
    assert.deepStrictEqual(got.notes, []);
    putWorkspace(at('ws'), {});
    const cut = ws.chain(at('ws/api/tool'), { env: env0 });
    assert.deepStrictEqual(cut.members.map((m) => m.rel), ['..']);
    assert.deepStrictEqual(cut.notes, [`!! workspace: parent .. in ../.alfred/${path.basename(fileOf(at('ws/api')))} ignored - ../.. does not list this folder as a child`]);
});

test('R062: a child named with a double space or a tab is a member of its root\'s chain', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['a  b'] } }, 'ws/a  b': { stamp: true, record: { parent: '..' } } });
    assert.deepStrictEqual(ws.chain(at('ws/a  b'), { env: env0 }).members.map((m) => m.rel), ['..'], 'the back-reference matches the real folder');
});

test('chain reads the project\'s own file from ownDataRoot', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true } });
    putWorkspace(at('ws/api'), { parent: '..' }, { dataRoot: '.kid-data' });
    assert.strictEqual(ws.chain(at('ws/api'), { env: env0 }).members.length, 0, 'the default root holds no parent line');
    assert.strictEqual(ws.chain(at('ws/api'), { env: env0, ownDataRoot: '.kid-data' }).members.length, 1);
});

test('chain refuses a parent line that is not a strict ancestor, has no stamp, or loops', () =>
{
    const unstamped = tree({ 'ws': { record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    const one = ws.chain(unstamped('ws/api'), { env: env0 });
    assert.deepStrictEqual(one.members, []);
    assert.deepStrictEqual(one.notes, [`!! workspace: parent .. in .alfred/${path.basename(fileOf(unstamped('ws/api')))} ignored - .. holds no Alfred install`]);
    // A link makes `..` of the child resolve to a folder that is not its real ancestor.
    if (process.platform !== 'win32')
    {
        const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'other': { stamp: true, record: { children: ['api'] } }, 'other/api': { stamp: true, record: { parent: '..' } } });
        fs.symlinkSync(at('other/api'), path.join(at('ws'), 'api'));
        const linked = ws.chain(path.join(at('ws'), 'api'), { env: env0 });
        assert.deepStrictEqual(linked.members.map((m) => m.root), [at('other')], 'the real path decides the parent');
    }
    const loop = tree({ 'ws': { stamp: true, record: { parent: '..', children: ['ws'] } } });
    const top = path.dirname(loop('ws'));
    fs.mkdirSync(path.join(top, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(top, '.claude', 'alfred-code.stamp'), STAMP);
    putWorkspace(top, { children: ['ws'] });
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
            spec[rel] = { stamp: true, record: { parent: i > 0 ? '..' : null, children: i < depth ? [names[i + 1]] : [] } };
        }
        const at = tree(spec);
        const got = ws.chain(at(names.join('/')), { env: env0 });
        assert.strictEqual(got.members.length, want, `depth ${depth}`);
    }
});

test('subtree is pre-order and marks a missing or unstamped child gone', () =>
{
    const at = tree({
        'ws': { stamp: true, record: { children: ['api', 'web', 'gone', 'bare'] } },
        'ws/api': { stamp: true, record: { parent: '..', children: ['tool'] } },
        'ws/api/tool': { stamp: true, record: { parent: '..' } },
        'ws/web': { stamp: true, record: { parent: '..' } },
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
        'ws/joined': { stamp: true, record: { parent: '..' } },
        // the 2.11 `parent none` line, still skipped while the old file holds it; workspace.json has no spelling of it -
        // its conversion is `role standalone`, which rescan offers, as v3.9.2's own rewrite at its next write already did
        'ws/declined': { stamp: true, record: { parentNone: true }, legacy: true },
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
    const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..', children: ['tool'] } }, 'ws/api/tool': { stamp: true, record: { parent: '..' } } });
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

// The chain a joined child reads at load (D4 step 5), seen from the installer's side: what envPlan compares a 2.12 copy with.
const chainTree = () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    fs.writeFileSync(path.join(at('ws'), '.alfred', '.variables'), 'ALFRED_CODE_SCORING=1\nALFRED_CODE_HISTORY=0\nALFRED_CODE_DOCS_VERSIONING=local\nALFRED_CODE_INSTRUMENT=1\n');
    return at;
};

test('chainValues reads the members\' .variables, never a MEMBER_NEVER key, and stops a key at an ignore env line', () =>
{
    const at = chainTree();
    assert.deepStrictEqual(ws.chainValues(at('ws/api'), { env: env0 }), { ALFRED_CODE_SCORING: '1', ALFRED_CODE_HISTORY: '0', ALFRED_CODE_INSTRUMENT: '1' });
    putWorkspace(at('ws/api'), { parent: '..', ignore: { env: ['ALFRED_CODE_SCORING'] } });
    assert.ok(!Object.hasOwn(ws.chainValues(at('ws/api'), { env: env0 }), 'ALFRED_CODE_SCORING'));
});

// The fixed root (3.11.0): a child's installer run keeps its chain while its parent's data still sits in the folder an
// older install named - the installer reads a member through the one reader, never the hooks' fixed .alfred.
test('fixed root: chainValues reads a parent whose data still sits in its older folder', () =>
{
    const at = tree({ 'ws': { stamp: true }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    fs.writeFileSync(path.join(at('ws'), '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }));
    putWorkspace(at('ws'), { children: ['api'] }, { dataRoot: 'var/data' });
    fs.writeFileSync(path.join(at('ws'), 'var', 'data', '.variables'), 'ALFRED_CODE_HISTORY=5\n');
    assert.deepStrictEqual(ws.chainValues(at('ws/api'), { env: env0 }), { ALFRED_CODE_HISTORY: '5' });
    assert.ok(!fs.existsSync(path.join(at('ws'), '.alfred')), 'nothing is made under the parent\'s .alfred');
});

test('chainValues reads nothing with the switch at 0 or for a project with no parent', () =>
{
    const at = chainTree();
    assert.deepStrictEqual(ws.chainValues(at('ws/api'), { env: { ...env0, ALFRED_CODE_WORKSPACE: '0' } }), {});
    assert.deepStrictEqual(ws.chainValues(at('ws'), { env: env0 }), {});
});

test('stampedAncestors lists every stamped folder above, linked or not, nearest first', () =>
{
    const at = tree({ 'ws': { stamp: true }, 'ws/mid': { stamp: true }, 'ws/mid/plain': {}, 'ws/mid/plain/kid': { stamp: true } });
    const above = ws.stampedAncestors(at('ws/mid/plain/kid'), { env: env0 });
    assert.deepStrictEqual([...above], [at('ws/mid'), at('ws')]);
    assert.deepStrictEqual({ ignored: above.ignored, cut: above.cut }, { ignored: null, cut: [] });
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
    const got = ws.ancestorExcludes(root, { childIgnores: [{ category: 'instructions', name: 'NOTES.md' }, { category: 'instructions', name: 'MISSING.md' }, { category: 'rule', name: 'alfred-house' }] }).sort();
    assert.deepStrictEqual(got, [
        path.join(root, '.claude', 'AGENTS.md'),
        path.join(rules, 'alfred-agent-awareness.md'),
        path.join(rules, 'alfred-house.md'),
        path.join(root, 'NOTES.md'),
    ].sort());
    fs.writeFileSync(path.join(root, '.claude', 'AGENTS.md'), '# seed, edited by the user\n');
    assert.ok(!ws.ancestorExcludes(root, {}).includes(path.join(root, '.claude', 'AGENTS.md')), 'an edited AGENTS.md is the user\'s');
});

// Workspace stage 4c: a library rule of an ancestor is a row only while it sits natively in that ancestor's .claude/rules
// and the child ignores it or a nearer member (the child included) holds a file of that name in either folder.
const LIB_STAMP = `sha: x\nlibrary-rules: alfred-house=${'a'.repeat(64)}\nmanaged-env: \n`;
const putRule = (dir, folder, name = 'alfred-house') => { fs.mkdirSync(path.join(dir, ...folder.split('/')), { recursive: true }); fs.writeFileSync(path.join(dir, ...folder.split('/'), `${name}.md`), `# ${name}\n`); };
const rulesTree = () =>
{
    const at = tree({ 'ws': { stamp: true }, 'ws/mid': { stamp: true }, 'ws/mid/kid': { stamp: true } });
    for (const r of ['ws', 'ws/mid']) fs.writeFileSync(path.join(at(r), '.claude', 'alfred-code.stamp'), LIB_STAMP);
    return at;
};

test('ancestorExcludes: a moved ancestor gets no library row', () =>
{
    const at = rulesTree();
    putRule(at('ws'), '.alfred/stack/rules');
    putRule(at('ws'), '.claude/rules', 'alfred-agent-awareness');
    putRule(at('ws/mid/kid'), '.alfred/stack/rules');
    const got = ws.ancestorExcludes(at('ws'), { childIgnores: [{ category: 'rule', name: 'alfred-house' }], nearer: [at('ws/mid/kid')] });
    assert.deepStrictEqual(got, [path.join(at('ws'), '.claude', 'rules', 'alfred-agent-awareness.md')], 'the generated row stays, no library row');
});

test('ancestorExcludes: of two ancestors not yet moved only the farther one\'s rows are written, and a name the child ignores or holds itself is excluded at the nearer one too', () =>
{
    const row = (root) => path.join(root, '.claude', 'rules', 'alfred-house.md');
    const rows = (at, ignores = []) => [at('ws/mid'), at('ws')].flatMap((a, i, all) => ws.ancestorExcludes(a, { childIgnores: ignores, nearer: [at('ws/mid/kid'), ...all.slice(0, i)] }));
    let at = rulesTree();
    for (const r of ['ws', 'ws/mid']) putRule(at(r), '.claude/rules');
    assert.deepStrictEqual(rows(at), [row(at('ws'))], 'the nearer copy keeps loading, the farther one is excluded');
    assert.deepStrictEqual(rows(at, [{ category: 'rule', name: 'alfred-house' }]).sort(), [row(at('ws')), row(at('ws/mid'))].sort(), 'an ignored name is excluded at both');
    at = rulesTree();
    for (const r of ['ws', 'ws/mid']) putRule(at(r), '.claude/rules');
    putRule(at('ws/mid/kid'), '.alfred/stack/rules');
    assert.deepStrictEqual(rows(at).sort(), [row(at('ws')), row(at('ws/mid'))].sort(), 'the child\'s own file replaces both');
    at = rulesTree();
    putRule(at('ws'), '.claude/rules');
    assert.deepStrictEqual(rows(at), [], 'one ancestor not yet moved and no nearer holder: it keeps loading');
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
    assert.strictEqual(ws.workspaceOn({ env: { CLAUDE_CONFIG_DIR: path.join(root, 'no-account') }, projectRoot: root }), true, 'no value anywhere: on since 3.0.0');
    assert.strictEqual(ws.workspaceOn({ env: { ALFRED_CODE_WORKSPACE: '1' }, projectRoot: root }), true, 'a launch 1 turns it on');
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
    assert.strictEqual(ws.workspaceOn({ env: {}, projectRoot: root }), true, 'an unreadable local file is read as holding nothing, so settings.json 1 stands');
});

// ------------------------------------------------------------------ D5, the account instruction key (Task 10)

// A joined child under a stamped root inside a folder that stands for HOME, with the account folder there.
const d5 = ({ md = 'ws/CLAUDE.md', joined = true } = {}) =>
{
    const at = tree({ 'home': {}, 'home/ws': { stamp: true, record: joined ? { children: ['api'] } : {} }, 'home/ws/api': { stamp: true, record: joined ? { parent: '..' } : {} } });
    if (md)
    {
        const file = path.join(at('home'), ...md.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '# team\n');
    }
    const configDir = path.join(at('home'), '.claude');
    return { at, configDir, accountFile: path.join(configDir, '.claude.json'), env: { CLAUDE_CONFIG_DIR: configDir, ALFRED_CODE_WORKSPACE: '1' } };
};
const stateOf = (f, root = f.at('home/ws/api')) => ws.instructionsBothState({ projectRoot: root, env: f.env, configDir: f.configDir, accountFile: f.accountFile });
const accountSettings = (f, data) => { fs.mkdirSync(f.configDir, { recursive: true }); fs.writeFileSync(path.join(f.configDir, 'settings.json'), typeof data === 'string' ? data : JSON.stringify(data)); };
const listProjects = (file, roots) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ projects: Object.fromEntries(roots.map((r) => [r, {}])) })); };
const markStamp = (root, line) => fs.appendFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `${line}\n`);

test('the state is ask only in a child with a CLAUDE.md on its path (its own included, so a claude-named joined child is asked), no decline on the account and no key under either id', () =>
{
    for (const md of ['ws/CLAUDE.md', 'ws/.claude/CLAUDE.md', 'ws/CLAUDE.local.md', 'ws/api/CLAUDE.md', 'CLAUDE.md'])
        assert.strictEqual(stateOf(d5({ md })), 'ask', md);
    assert.strictEqual(stateOf(d5({ md: null })), 'not-needed');
    assert.strictEqual(stateOf(d5({ md: '.claude/CLAUDE.md' })), 'not-needed', 'the account dir\'s CLAUDE.md is no project file');
    const own = d5();
    markStamp(own.at('home/ws/api'), 'instructions-both: declined');
    assert.strictEqual(stateOf(own), 'declined');
    for (const id of ['cc-plugin-agents-md@builtin', 'agents-md@builtin'])
    {
        const f = d5();
        accountSettings(f, { pluginConfigs: { [id]: { options: { instructionFiles: 'claude-md-and-agents-md' } } } });
        assert.strictEqual(stateOf(f), 'set', id);
    }
    const other = d5();
    accountSettings(other, { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'agents-md' } } } });
    assert.strictEqual(stateOf(other), 'ask', 'another value is no answer to D5');
    assert.strictEqual(stateOf(d5({ joined: false })), 'standalone');
    const garbled = d5();
    fs.mkdirSync(garbled.configDir, { recursive: true });
    fs.writeFileSync(garbled.accountFile, '{ not json');
    assert.strictEqual(stateOf(garbled), 'unreadable');
    assert.strictEqual(ws.instructionsBothLine('ask'), 'instructions-both: ask');
    assert.match(ws.instructionsBothLine('unreadable'), /^instructions-both: not asked - .*could not be read/);
    for (const s of ['set', 'declined', 'not-needed', 'standalone']) assert.strictEqual(ws.instructionsBothLine(s), null, s);
});

test('the kill switch asks nothing: off in the launch env or in the child\'s settings, the state is off and prints no line (AC16)', () =>
{
    const f = d5();
    assert.strictEqual(ws.instructionsBothState({ projectRoot: f.at('home/ws/api'), env: { ...f.env, ALFRED_CODE_WORKSPACE: '0' }, configDir: f.configDir, accountFile: f.accountFile }), 'off');
    fs.writeFileSync(path.join(f.at('home/ws/api'), '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }));
    assert.strictEqual(stateOf(f), 'off');
    assert.strictEqual(ws.instructionsBothLine('off'), null);
});

// W3 Task 1, P1 (F12): a released child keeps every rule the loader sent it - the store's rules reached it as a member's.
test('release: the rule loader sends a released child the names it sent before (F12)', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    fs.mkdirSync(path.join(at('ws'), '.alfred', 'stack', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(at('ws'), '.alfred', 'stack', 'rules', 'alfred-one.md'), '# one\n');
    const sent = () => require('../stack/hooks/rules-session.js').rulesFor(at('ws/api'), env0, { host: 'claude' }).always.map((r) => r.name);
    const before = sent();
    assert.ok(before.includes('alfred-one'), JSON.stringify(before));
    // W3 Task 6: re-pointed at the mark's route - one project released, the rules it read kept as its own.
    assert.deepStrictEqual(ws.releaseChildren({ projectRoot: at('ws'), only: at('ws/api'), keepRules: true, env: env0 }), ['api']);
    assert.deepStrictEqual(sent(), before);
    const copy = path.join(at('ws/api'), '.alfred', 'stack', 'rules', 'alfred-one.md');
    assert.strictEqual(fs.readFileSync(copy, 'utf8'), '# one\n');
    const childStamp = fs.readFileSync(path.join(at('ws/api'), '.claude', 'alfred-code.stamp'), 'utf8');
    assert.match(childStamp, new RegExp(`^library-rules: .*alfred-one=${hashItem(copy)}`, 'm'));
    assert.doesNotMatch(childStamp, /^member-picks:/m);
});

test('release: with no option no rule is copied - a root\'s uninstall, as today', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    fs.mkdirSync(path.join(at('ws'), '.alfred', 'stack', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(at('ws'), '.alfred', 'stack', 'rules', 'alfred-one.md'), '# one\n');
    markStamp(at('ws/api'), 'own-picks: skill/npm');
    const stampBefore = fs.readFileSync(path.join(at('ws/api'), '.claude', 'alfred-code.stamp'), 'utf8');
    assert.deepStrictEqual(ws.releaseChildren({ projectRoot: at('ws'), env: env0 }), ['api']);
    assert.ok(!fs.existsSync(path.join(at('ws/api'), '.alfred', 'stack', 'rules', 'alfred-one.md')));
    assert.strictEqual(readWorkspaceValues(at('ws/api')).parent, undefined);
    assert.deepStrictEqual(readWorkspaceValues(at('ws')).children || [], []);
    assert.strictEqual(fs.readFileSync(path.join(at('ws/api'), '.claude', 'alfred-code.stamp'), 'utf8'), stampBefore.replace(/^own-picks: .*\n/m, ''));
});

// W3 Task 6 [F12]: three holders - top (a grandparent), ws (the parent), api (the child, ignoring alfred-two, holding its
// own alfred-three) - and a path rule in ws.
const keepTree = () =>
{
    const at = tree({ top: { stamp: true, record: { role: 'root', children: ['ws'] } }, 'top/ws': { stamp: true, record: { parent: '..', children: ['api'] } },
        'top/ws/api': { stamp: true, git: true, record: { parent: '..', ignore: { rule: ['alfred-two'] } } } });
    const put = (rel, name, text = `# ${name}\n`) => { const d = path.join(at(rel), '.alfred', 'stack', 'rules'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${name}.md`), text); };
    for (const n of ['alfred-one', 'alfred-two', 'alfred-three']) put('top/ws', n);
    put('top/ws', 'alfred-path', '---\npaths:\n  - "src/**"\n---\n# path\n');
    put('top', 'alfred-top');
    put('top/ws/api', 'alfred-three', '# three, the child\'s\n');
    markStamp(at('top/ws/api'), `library-rules: alfred-three=${'c'.repeat(64)}`);
    return at;
};

test('keepRules: an ignored rule, a name the child holds, a rule two members up, a path rule', () =>
{
    const at = keepTree();
    const api = at('top/ws/api');
    const logs = [];
    assert.deepStrictEqual(ws.keepRules(api, { env: env0, log: (l) => logs.push(l) }), ['alfred-one', 'alfred-path', 'alfred-top']);
    const store = path.join(api, '.alfred', 'stack', 'rules');
    assert.ok(!fs.existsSync(path.join(store, 'alfred-two.md')), 'an ignored rule is not copied');
    assert.strictEqual(fs.readFileSync(path.join(store, 'alfred-three.md'), 'utf8'), '# three, the child\'s\n');
    const st = fs.readFileSync(path.join(api, '.claude', 'alfred-code.stamp'), 'utf8');
    assert.match(st, new RegExp(`alfred-three=${'c'.repeat(64)}`), 'the child\'s own row is not rewritten');
    for (const n of ['alfred-one', 'alfred-path', 'alfred-top']) assert.match(st, new RegExp(`${n}=${hashItem(path.join(store, `${n}.md`))}`));
    assert.deepStrictEqual(logs, ['workspace: 3 rules this project read from the workspace copied into its own store (alfred-one, alfred-path, alfred-top)']);
});

test('keepRules: no chain copies nothing and prints nothing', () =>
{
    const at = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    fs.mkdirSync(path.join(at('ws'), '.alfred', 'stack', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(at('ws'), '.alfred', 'stack', 'rules', 'alfred-one.md'), '# one\n');
    const logs = [];
    assert.deepStrictEqual(ws.keepRules(at('ws/api'), { env: env0, log: (l) => logs.push(l) }), []);
    assert.deepStrictEqual(logs, []);
    assert.ok(!fs.existsSync(path.join(at('ws/api'), '.alfred', 'stack', 'rules', 'alfred-one.md')));
});

test('keepRules: the process environment is untouched', () =>
{
    const at = keepTree();
    fs.writeFileSync(path.join(at('top/ws'), '.alfred', '.variables'), 'ALFRED_CODE_SCORING=1\n');
    const script = path.join(at('top'), 'probe.js');
    fs.writeFileSync(script, [
        `const ws = require(${JSON.stringify(path.join(__dirname, 'install', 'workspace.js'))});`,
        'const before = JSON.stringify(process.env);',
        `const got = ws.keepRules(${JSON.stringify(at('top/ws/api'))}, { env: ${JSON.stringify(env0)} });`,
        'const after = JSON.stringify(process.env);',
        'const prelude = Object.keys(require.cache).some((k) => k.endsWith(\'hook-prelude.js\'));',
        'process.stdout.write(JSON.stringify({ same: before === after, prelude, got }));',
    ].join('\n'));
    const env = { ...process.env };
    delete env.ALFRED_CODE_SCORING;
    const out = JSON.parse(execFileSync(process.execPath, [script], { cwd: at('top/ws'), env, encoding: 'utf8' }));
    assert.deepStrictEqual(out, { same: true, prelude: false, got: ['alfred-one', 'alfred-path', 'alfred-top'] });
});

test('release: only releases the one project and leaves the holder\'s record alone', () =>
{
    const at = tree({ ws: { stamp: true, record: { role: 'root', children: ['api', 'web'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } },
        'ws/web': { stamp: true, git: true, record: { parent: '..' } } });
    const file = path.join(at('ws'), '.alfred', 'workspace.json');
    const bytes = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(ws.releaseChildren({ projectRoot: at('ws'), only: at('ws/api'), env: env0 }), ['api']);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
    assert.strictEqual(readWorkspaceValues(at('ws/api')).parent, undefined);
    assert.strictEqual(ws.chain(at('ws/web'), { env: env0 }).members.length, 1, 'the other child still chains');
});

test('keepOnLeave: the ignored line', () =>
{
    const layout = require('../stack/hooks/layout.js');
    const at = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'ALFRED_CODE_SCORING=1\n');
    const keys = layout.VARIABLE_KEYS.filter((k) => !layout.MEMBER_NEVER.has(k) && k !== 'ALFRED_CODE_SCORING');
    const logs = [];
    ws.keepOnLeave(at('ws/api'), { env: env0, log: (l) => logs.push(l), ignored: '..' });
    assert.deepStrictEqual(logs, [`workspace: .. ignores this project - ${keys.length} values it does not hold read the stack's defaults (${keys.join(', ')}); a rule that workspace sent arrives only from this project's own store now - /alfred-code:configure adds one back`]);
    const plain = [];
    ws.keepOnLeave(at('ws/api'), { env: env0, log: (l) => plain.push(l) });
    assert.deepStrictEqual(plain, [`workspace: .. is gone - ${keys.length} values read the stack's defaults here now (${keys.join(', ')}); the next update seeds them`]);
});

test('releaseChildren leaves a listed child that names another parent as it was - its own lines kept, never named released', () =>
{
    // ws lists g/x, but x's parent line names g: a stale line in ws, and x is g's child.
    const at = tree({ 'home': {}, 'home/ws': { stamp: true, record: { children: ['g', 'g/x'] } }, 'home/ws/g': { stamp: true, record: { parent: '..', children: ['x'] } }, 'home/ws/g/x': { stamp: true, record: { parent: '..' } } });
    markStamp(at('home/ws/g/x'), 'own-picks: skill/npm');
    markStamp(at('home/ws/g/x'), 'own-env: ALFRED_CODE_SCORING');
    const logs = [];
    const released = ws.releaseChildren({ projectRoot: at('home/ws'), env: {}, log: (l) => logs.push(l) });
    assert.deepStrictEqual(released, ['g']);
    const xStamp = fs.readFileSync(path.join(at('home/ws/g/x'), '.claude', 'alfred-code.stamp'), 'utf8');
    assert.match(xStamp, /^own-picks: skill\/npm$/m);
    assert.match(xStamp, /^own-env: ALFRED_CODE_SCORING$/m);
    assert.strictEqual(readWorkspaceValues(at('home/ws/g/x')).parent, '..');
    assert.ok(!logs.some((l) => /released g\/x/.test(l)), logs.join('\n'));
});

test('apply keeps every other key value-equal and keeps the indent, CRLF and BOM', () =>
{
    const other = { model: 'opus', pluginConfigs: { other: { options: { a: 1 } } }, env: { X: '1' } };
    for (const [indent, eol, bom] of [['\t', '\r\n', '\uFEFF'], ['    ', '\n', ''], ['  ', '\r\n', '']])
    {
        const f = d5();
        accountSettings(f, bom + JSON.stringify(other, null, indent).replace(/\n/g, eol) + eol);
        const got = ws.applyAccountInstructions({ configDir: f.configDir });
        assert.deepStrictEqual(got, { written: true, hash: valueHash(JSON.stringify('claude-md-and-agents-md')) });
        const text = fs.readFileSync(path.join(f.configDir, 'settings.json'), 'utf8');
        assert.strictEqual(text.startsWith('\uFEFF'), Boolean(bom), JSON.stringify(indent));
        assert.strictEqual(text.includes('\r\n'), eol === '\r\n');
        assert.strictEqual(text.replace(/^\uFEFF/, '').split(/\r?\n/)[1].match(/^\s*/)[0], indent);
        const data = JSON.parse(text.replace(/^\uFEFF/, ''));
        assert.strictEqual(data.pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles, 'claude-md-and-agents-md');
        delete data.pluginConfigs['cc-plugin-agents-md@builtin'];
        assert.deepStrictEqual(data, other);
        assert.deepStrictEqual(fs.readdirSync(f.configDir).filter((n) => n.includes('.tmp')), [], 'a temp file was left');
    }
    const fresh = d5();
    assert.strictEqual(ws.applyAccountInstructions({ configDir: fresh.configDir }).written, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fresh.configDir, 'settings.json'), 'utf8')), { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md-and-agents-md' } } } });
});

// Review fix pass, run B (m7): a dotfiles link at the account settings.json became a plain file - the temp file was renamed
// over the LINK. writeLike, the one writer of the account file (D5's apply and remove, the auto-update answer), writes the
// link's real file instead, still a temp file and a rename in that file's own folder.
test('writeLike writes through a symlink: the link stays, the real file gets the text', { skip: process.platform === 'win32' && 'links need privileges on Windows' }, () =>
{
    const at = tree({ 'acct': {}, 'dots/real': {}, 'linked-acct-target': {} });
    const real = path.join(at('dots/real'), 'settings.json');
    const write = (file, data, text = '{\n  "a": 1\n}\n') => ws.writeLike(file, text, data);
    const tmpsIn = (...dirs) => dirs.flatMap((d) => fs.readdirSync(d)).filter((n) => n.endsWith('.tmp'));
    // an absolute link
    fs.writeFileSync(real, '{\n  "a": 1\n}\n');
    const link = path.join(at('acct'), 'settings.json');
    fs.symlinkSync(real, link);
    write(link, { a: 1, b: 2 });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link stays a link');
    assert.strictEqual(fs.readlinkSync(link), real);
    assert.strictEqual(fs.readFileSync(real, 'utf8'), '{\n  "a": 1,\n  "b": 2\n}\n');
    assert.deepStrictEqual(tmpsIn(at('acct'), at('dots/real')), [], 'no temp file left');
    // a chain of two links, the second relative
    const hop = path.join(at('dots'), 'hop.json');
    fs.symlinkSync(path.join('real', 'settings.json'), hop);
    const chained = path.join(at('acct'), 'chained.json');
    fs.symlinkSync(hop, chained);
    write(chained, { c: 3 });
    assert.ok(fs.lstatSync(chained).isSymbolicLink() && fs.lstatSync(hop).isSymbolicLink(), 'both links stay');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { c: 3 });
    // a relative link inside a linked folder resolves from the folder's REAL place, as the OS reads it
    const linkedDir = path.join(at('acct'), 'linked');
    fs.symlinkSync(at('linked-acct-target'), linkedDir);
    fs.writeFileSync(path.join(at('linked-acct-target'), '..', 'beside.json'), '{}\n');
    fs.symlinkSync(path.join('..', 'beside.json'), path.join(linkedDir, 'settings.json'));
    write(path.join(linkedDir, 'settings.json'), { d: 4 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(at('linked-acct-target'), '..', 'beside.json'), 'utf8')), { d: 4 });
    assert.ok(fs.lstatSync(path.join(linkedDir, 'settings.json')).isSymbolicLink());
    // a dangling link: its target is made, the link kept - as a plain write through it would
    const dangling = path.join(at('acct'), 'dangling.json');
    const absent = path.join(at('dots/real'), 'absent.json');
    fs.symlinkSync(absent, dangling);
    write(dangling, { e: 5 });
    assert.ok(fs.lstatSync(dangling).isSymbolicLink());
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(absent, 'utf8')), { e: 5 });
    // a loop is refused, every link left as it was
    const l1 = path.join(at('acct'), 'loop1.json');
    const l2 = path.join(at('acct'), 'loop2.json');
    fs.symlinkSync(l2, l1);
    fs.symlinkSync(l1, l2);
    assert.throws(() => write(l1, { f: 6 }), (e) => e.code === 'ELOOP');
    assert.ok(fs.lstatSync(l1).isSymbolicLink() && fs.lstatSync(l2).isSymbolicLink(), 'the loop is untouched');
    // a plain file is written as before
    const plain = path.join(at('acct'), 'plain.json');
    fs.writeFileSync(plain, '{}\n');
    write(plain, { g: 7 });
    assert.ok(fs.lstatSync(plain).isFile());
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(plain, 'utf8')), { g: 7 });
    assert.deepStrictEqual(tmpsIn(at('acct'), at('dots/real'), at('dots')), [], 'no temp file left anywhere');
});

test('D5 apply and remove keep a symlinked account settings.json a link', { skip: process.platform === 'win32' && 'links need privileges on Windows' }, () =>
{
    const f = d5();
    const realDir = path.join(path.dirname(f.configDir), 'dotfiles');
    fs.mkdirSync(realDir, { recursive: true });
    fs.mkdirSync(f.configDir, { recursive: true });
    const real = path.join(realDir, 'settings.json');
    const text = '{\n    "model": "opus",\n    "env": {\n        "X": "1"\n    }\n}\n';
    fs.writeFileSync(real, text);
    const link = path.join(f.configDir, 'settings.json');
    fs.symlinkSync(real, link);
    const { written, hash } = ws.applyAccountInstructions({ configDir: f.configDir });
    assert.strictEqual(written, true);
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'apply keeps the link');
    const data = JSON.parse(fs.readFileSync(real, 'utf8'));
    assert.strictEqual(data.pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles, 'claude-md-and-agents-md');
    assert.deepStrictEqual(ws.removeAccountInstructions({ configDir: f.configDir, hash }), { removed: true });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'remove keeps the link');
    assert.strictEqual(fs.readFileSync(real, 'utf8'), text, 'the real file is back to its bytes');
});

test('a value the user set is never replaced; garbage JSON is refused and named', () =>
{
    for (const id of ['cc-plugin-agents-md@builtin', 'agents-md@builtin'])
    {
        const f = d5();
        const text = JSON.stringify({ pluginConfigs: { [id]: { options: { instructionFiles: 'agents-md' } } } });
        accountSettings(f, text);
        const got = ws.applyAccountInstructions({ configDir: f.configDir });
        assert.strictEqual(got.written, false);
        assert.match(got.why, /agents-md/);
        assert.strictEqual(fs.readFileSync(path.join(f.configDir, 'settings.json'), 'utf8'), text);
    }
    const f = d5();
    accountSettings(f, '{ garbage');
    const got = ws.applyAccountInstructions({ configDir: f.configDir });
    assert.strictEqual(got.written, false);
    assert.match(got.why, /settings\.json/);
    assert.strictEqual(fs.readFileSync(path.join(f.configDir, 'settings.json'), 'utf8'), '{ garbage');
});

test('remove takes the key away only at its hash', () =>
{
    const f = d5();
    accountSettings(f, { model: 'opus' });
    const { hash } = ws.applyAccountInstructions({ configDir: f.configDir });
    assert.deepStrictEqual(ws.removeAccountInstructions({ configDir: f.configDir, hash: 'b'.repeat(64) }).removed, false);
    assert.deepStrictEqual(ws.removeAccountInstructions({ configDir: f.configDir, hash }), { removed: true });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(f.configDir, 'settings.json'), 'utf8')), { model: 'opus' }, 'the containers the apply made stay behind');
    const changed = d5();
    accountSettings(changed, { pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'agents-md' } } } });
    const kept = ws.removeAccountInstructions({ configDir: changed.configDir, hash });
    assert.strictEqual(kept.removed, false);
    assert.match(kept.why, /changed/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(changed.configDir, 'settings.json'), 'utf8')).pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles, 'agents-md');
});

test('a decline in one tree\'s stamp stops the ask in a second tree on the same account', () =>
{
    const one = d5();
    const two = d5();
    const shared = { ...two, configDir: one.configDir, accountFile: one.accountFile, env: one.env };
    listProjects(one.accountFile, [one.at('home/ws/api'), two.at('home/ws/api')]);
    assert.strictEqual(stateOf(shared, two.at('home/ws/api')), 'ask');
    markStamp(one.at('home/ws/api'), 'instructions-both: declined');
    assert.strictEqual(stateOf(shared, two.at('home/ws/api')), 'declined');
    assert.deepStrictEqual(ws.accountStamps({ accountFile: one.accountFile, except: two.at('home/ws/api') }), { state: 'ok', stamps: [path.join(one.at('home/ws/api'), '.claude', 'alfred-code.stamp')] });
    assert.deepStrictEqual(ws.accountStamps({ accountFile: path.join(TMP, 'absent.json') }), { state: 'ok', stamps: [] });
});

test('lastHolder is false while another listed project\'s stamp records managed-account, and the state is unreadable with garbage .claude.json', () =>
{
    const one = d5();
    const two = d5();
    listProjects(one.accountFile, [one.at('home/ws/api'), two.at('home/ws/api')]);
    assert.deepStrictEqual(ws.lastHolder({ accountFile: one.accountFile, projectRoot: one.at('home/ws/api') }), { last: true, others: [], state: 'ok' });
    markStamp(two.at('home/ws/api'), `managed-account: settings.json:${ws.INSTRUCTION_KEY}=${'a'.repeat(64)}`);
    assert.deepStrictEqual(ws.lastHolder({ accountFile: one.accountFile, projectRoot: one.at('home/ws/api') }), { last: false, others: [path.join(two.at('home/ws/api'), '.claude', 'alfred-code.stamp')], state: 'ok' });
    fs.writeFileSync(one.accountFile, '{ not json');
    assert.deepStrictEqual(ws.lastHolder({ accountFile: one.accountFile, projectRoot: one.at('home/ws/api') }), { last: false, others: [], state: 'unreadable' });
    assert.strictEqual(stateOf(one), 'unreadable');
});

test('with CLAUDE_CONFIG_DIR unset, the projects list is read from <HOME>/.claude.json and the key is written to <HOME>/.claude/settings.json', () =>
{
    const one = d5();
    const two = d5();
    const home = one.at('home');
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try
    {
        const paths = ws.accountPaths({});
        assert.deepStrictEqual(paths, { configDir: path.join(home, '.claude'), accountFile: path.join(home, '.claude.json') });
        assert.deepStrictEqual(ws.accountPaths({ CLAUDE_CONFIG_DIR: '/x/acct' }), { configDir: '/x/acct', accountFile: path.join('/x/acct', '.claude.json') });
        listProjects(paths.accountFile, [one.at('home/ws/api'), two.at('home/ws/api')]);
        const state = (root) => ws.instructionsBothState({ projectRoot: root, env: { ALFRED_CODE_WORKSPACE: '1' }, ...paths });
        assert.strictEqual(state(two.at('home/ws/api')), 'ask');
        markStamp(one.at('home/ws/api'), 'instructions-both: declined');
        assert.strictEqual(state(two.at('home/ws/api')), 'declined');
        markStamp(two.at('home/ws/api'), `managed-account: settings.json:${ws.INSTRUCTION_KEY}=${'a'.repeat(64)}`);
        assert.strictEqual(ws.lastHolder({ accountFile: paths.accountFile, projectRoot: one.at('home/ws/api') }).last, false);
        assert.strictEqual(ws.applyAccountInstructions({ configDir: paths.configDir }).written, true);
        assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json')));
        assert.ok(!fs.existsSync(path.join(home, '.claude', '.claude.json')), 'the two paths are not derived from each other');
    }
    finally
    {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
});

// ------------------------------------------------------------------ D2: the parent's local registrations (release 2)

test('parentRegistrations finds the parent\'s key case-folded with \\ as /, and says unreadable, ambiguous or nokey otherwise', () =>
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'reg-')));
    const file = path.join(root, '.claude.json');
    const servers = { a: { type: 'stdio', command: 'node', args: [] } };
    const read = (data) => { fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); return ws.parentRegistrations({ accountFile: file, parentRoot: root }); };
    assert.deepStrictEqual(read({ projects: { [root]: { mcpServers: servers } }, mcpServers: { u: {} } }), { state: 'ok', servers, keys: [root], user: { u: {} } });
    const typed = root.toUpperCase().split('/').join('\\');
    assert.strictEqual(read({ projects: { [typed]: { mcpServers: servers } } }).state, 'ok', 'a key typed in another case with backslashes is the folder');
    assert.deepStrictEqual(read({ projects: { [typed]: { mcpServers: servers } } }).servers, servers);
    assert.strictEqual(read({ projects: { [`${root}/`]: { mcpServers: servers } } }).state, 'ok', 'a trailing separator');
    const two = read({ projects: { [root]: { mcpServers: servers }, [root.toUpperCase()]: {} } });
    assert.deepStrictEqual([two.state, two.servers, two.keys.length], ['ambiguous', {}, 2]);
    assert.deepStrictEqual(read({ projects: { [path.join(root, 'other')]: { mcpServers: servers } } }).state, 'nokey');
    assert.deepStrictEqual(read({ projects: { [root]: {} } }), { state: 'ok', servers: {}, keys: [root], user: {} }, 'a key with no servers holds none');
    for (const bad of ['{ not json', '[]', '7', ''])
        assert.strictEqual(read(bad).state, 'unreadable', JSON.stringify(bad));
    assert.strictEqual(read(`\uFEFF${JSON.stringify({ projects: { [root]: { mcpServers: servers } } })}`).state, 'ok', 'a leading BOM is json-file.js\'s to strip');
    fs.rmSync(file);
    assert.strictEqual(ws.parentRegistrations({ accountFile: file, parentRoot: root }).state, 'nokey', 'no account file holds no key');
});

// ------------------------------------------------------------------ D8: the hint for a linked member's local server

test('hintLine names the server and its folder, with the approve-once clause only when approval says so', () =>
{
    const tail = 'or copy it here: claude mcp get srv in .., then claude mcp add-json -s local srv';
    assert.strictEqual(ws.APPROVE_ONCE, true, 'A8 verdict: an ancestor .mcp.json server waits for approval in each folder');
    assert.strictEqual(ws.hintLine('srv', '..', { approval: true }), `mcp srv: registered for .. only (local scope) - not seen here. Share it: claude mcp add-json -s user, or the root's .mcp.json - approve it once in this folder; ${tail}`);
    assert.strictEqual(ws.hintLine('srv', '..', { approval: false }), `mcp srv: registered for .. only (local scope) - not seen here. Share it: claude mcp add-json -s user, or the root's .mcp.json; ${tail}`);
    assert.strictEqual(ws.hintLine('srv', '..'), ws.hintLine('srv', '..', { approval: true }), 'the default is the probed verdict');
    assert.match(ws.hintLine('a b', '../..'), /^mcp "a b": registered for \.\.\/\.\. only .*claude mcp get "a b" in \.\.\/\.\./, 'a name the CLI would split is quoted');
});

// ------------------------------------------------------------------ T13: the role (roles spec D1, D2, D5's join and leave)

const { execFileSync: run } = require('node:child_process');
const layoutLib = require('../stack/hooks/layout.js');
const stampLib = require('./install/stamp.js');
const ON = { CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ALFRED_CODE_WORKSPACE: '1' };
// { rel: { stamp, git, record, legacy, vars } } under a fresh folder (`legacy` as in `tree`); returns rel -> real path.
const roleTree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 'r-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) run('git', ['init', '-q'], { cwd: dir });
        if (o.stamp) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), typeof o.stamp === 'string' ? o.stamp : 'sha: x\n'); }
        if (o.vars !== undefined) fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        if (o.record !== undefined) putWorkspace(dir, o.record, o.legacy ? { legacy: true } : {});
        if (o.vars !== undefined) fs.writeFileSync(path.join(dir, '.alfred', '.variables'), o.vars);
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const asked = (root, when, env = ON) => { const a = ws.roleAsk(root, { env, when }); return a && { case: a.case, rel: a.rel, options: a.options }; };

test('AC1: a parent none record reads as role standalone, and its next write converts it to role standalone', () =>
{
    const root = project('parent none\nignore skill x\n');
    assert.strictEqual(ws.readWorkspace(root, { env: {} }).view.role, 'standalone');
    assert.ok(ws.writeWorkspace(root, (m) => ws.addIgnore(m, 'skill', 'y'), { env: {} }).wrote);
    assert.strictEqual(fs.existsSync(legacyOf(root)), false, 'the old file is gone');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonOf(root), 'utf8')), { role: 'standalone', ignore: { skill: ['x', 'y'] } }, 'rewritten at the next write');
});

test('R062: the hooks\' chain reads a child named with a double space as a member of its root', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['a  b'] } }, 'ws/a  b': { stamp: true, record: { parent: '..' } } });
    const members = layoutLib.workspaceChain(layoutLib.chainProjectOf(at('ws/a  b'))).members.map((m) => m.root);
    assert.strictEqual(members.length, 1, JSON.stringify(members));
    assert.ok(samePath(members[0], at('ws')), `${members[0]} is the root`);
});

test('roleOf: child of .., root of 2 children, a root with no child, standalone, and standalone not asked', () =>
{
    const at = roleTree({
        ws: { stamp: true, record: { children: ['api', 'web'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } }, 'ws/web': { stamp: true, git: true, record: { parent: '..' } },
        solo: { stamp: true, git: true, record: { role: 'root', above: 'none' } }, alone: { stamp: true, git: true, record: { role: 'standalone', above: 'none' } }, fresh: { stamp: true, git: true },
    });
    assert.deepStrictEqual(ws.roleOf(at('ws/api'), { env: ON }), { kind: 'child', rel: '..', children: 0, asked: true });
    assert.deepStrictEqual(ws.roleOf(at('ws'), { env: ON }), { kind: 'root', children: 2, asked: false });
    assert.deepStrictEqual(ws.roleOf(at('solo'), { env: ON }), { kind: 'root', children: 0, asked: true });
    assert.deepStrictEqual(ws.roleOf(at('alone'), { env: ON }), { kind: 'standalone', asked: true });
    assert.deepStrictEqual(ws.roleOf(at('fresh'), { env: ON }), { kind: 'standalone', asked: false });
    assert.strictEqual(ws.roleText(ws.roleOf(at('ws'), { env: ON })), 'root of 2 children');
    assert.strictEqual(ws.roleText(ws.roleOf(at('ws/api'), { env: ON })), 'child of ..');
    assert.strictEqual(ws.roleText(ws.roleOf(at('fresh'), { env: ON })), 'standalone (no role recorded)');
    assert.strictEqual(ws.roleText(ws.roleOf(at('alone'), { env: ON })), 'standalone');
});

test('AC2: init\'s options - Child first under a root, Root first in a plain folder, Standalone first in a git checkout, the why line and Standalone first inside the parent\'s repo', () =>
{
    const at = roleTree({ ws: { stamp: true }, 'ws/api': { git: true }, plain: {}, repo: { git: true }, top: { stamp: true, git: true }, 'top/sub': {} });
    assert.deepStrictEqual(asked(at('ws/api'), 'init'), { case: 'init-child', rel: '..', options: ['Child of .. (Recommended)', 'Standalone', 'Root'] });
    assert.deepStrictEqual(asked(at('plain'), 'init'), { case: 'init-none', rel: null, options: ['Root (Recommended)', 'Standalone'] });
    assert.deepStrictEqual(asked(at('repo'), 'init'), { case: 'init-none', rel: null, options: ['Standalone (Recommended)', 'Root'] });
    const why = ws.roleAsk(at('top/sub'), { env: ON, when: 'init' });
    assert.deepStrictEqual([why.case, why.rel, why.options], ['init-why', '..', ['Standalone (Recommended)', 'Root']]);
    assert.match(why.why, /^\.\. is the same git repository/);
    assert.strictEqual(ws.roleAsk(at('ws/api'), { env: { ...ON, ALFRED_CODE_WORKSPACE: '0' }, when: 'init' }), null, 'at 0 nothing is asked');
});

test('AC4: a stamped folder above a standalone asks once, Keep quiets it; a deleted parent offers Become standalone first; a lost child line offers Rejoin first; a folder between offers Stay first; never answered offers Join first', () =>
{
    const at = roleTree({
        ws: { stamp: true, record: { children: ['mid/deep'] } }, 'ws/alone': { stamp: true, git: true, record: { role: 'standalone', above: 'none' } },
        'ws/fresh': { stamp: true, git: true }, 'ws/lost': { stamp: true, git: true, record: { parent: '..' } },
        'ws/mid': { stamp: true }, 'ws/mid/deep': { stamp: true, git: true, record: { parent: '../..', above: '../..' } },
        gone: {}, 'gone/kid': { stamp: true, git: true, record: { parent: '..' } },
    });
    assert.deepStrictEqual(asked(at('ws/alone'), 'update'), { case: 'above', rel: '..', options: ['Join .. (Recommended)', 'Keep standalone'] });
    assert.ok(ws.writeWorkspace(at('ws/alone'), (m) => ws.setAbove(m, '..'), { env: ON }).wrote);
    assert.strictEqual(asked(at('ws/alone'), 'update'), null, 'Keep wrote above .., so the same tree is never asked again');
    assert.deepStrictEqual(asked(at('ws/fresh'), 'update'), { case: 'never', rel: '..', options: ['Join .. (Recommended)', 'Stay standalone'] });
    assert.deepStrictEqual(asked(at('ws/lost'), 'update'), { case: 'rejoin', rel: '..', options: ['Rejoin .. (Recommended)', 'Become standalone'] });
    assert.deepStrictEqual(asked(at('gone/kid'), 'update'), { case: 'parent-gone', rel: '..', options: ['Become standalone (Recommended)'] });
    assert.deepStrictEqual(asked(at('ws/mid/deep'), 'update'), { case: 'between', rel: '..', options: ['Stay child of ../.. (Recommended)', 'Join ..'] });
    assert.strictEqual(asked(at('ws/fresh'), 'update', { ...ON, ALFRED_CODE_WORKSPACE: '0' }), null);
    const a = ws.roleAsk(at('ws/lost'), { env: ON, when: 'update' });
    assert.deepStrictEqual(a.answers, ['rejoin', 'leave:standalone'], 'each option carries the --answer it runs');
});

test('AC5 asks: configure lists Keep first for a standalone, a root and a child', () =>
{
    const at = roleTree({
        ws: { stamp: true, record: { children: ['kid'] } }, 'ws/kid': { stamp: true, git: true, record: { parent: '..' } },
        'ws/alone': { stamp: true, git: true, record: { role: 'standalone', above: '..' } }, 'ws/boss': { stamp: true, git: true, record: { role: 'root', above: '..' } },
    });
    assert.deepStrictEqual(asked(at('ws/alone'), 'configure').options, ['Keep (Recommended)', 'Join ..', 'Become a root']);
    assert.deepStrictEqual(asked(at('ws/boss'), 'configure').options, ['Keep (Recommended)', 'Join ..', 'Become standalone']);
    assert.deepStrictEqual(asked(at('ws/kid'), 'configure').options, ['Keep (Recommended)', 'Leave and become standalone', 'Leave and become a root']);
    assert.deepStrictEqual(asked(at('ws'), 'configure').options, ['Keep (Recommended)', 'Become standalone'], 'nothing above to join');
});

// D5's join and leave: a joiner's stack seeds leave its own file (they would beat the members); what it typed stays.
test('pruneChained (join) drops each key still at its ledger hash, keeps a typed or changed one, never DOCS_VERSIONING, and names the count kept', () =>
{
    const H = stampLib.valueHash;
    const stampText = `sha: x\nmanaged-env: .variables:ALFRED_CODE_SCORING_LEVEL=${H('80')},.variables:ALFRED_CODE_HISTORY=${H('5')},.variables:ALFRED_CODE_DOCS_VERSIONING=${H('git')},settings.json:ALFRED_CODE_DATA_PATH=${H('.alfred')}\n`;
    const at = roleTree({ p: { stamp: stampText, git: true, vars: '# mine\nALFRED_CODE_SCORING_LEVEL=80\nALFRED_CODE_HISTORY=9\nALFRED_CODE_DOCS_VERSIONING=git\nALFRED_CODE_CORRECTION_NUDGE=inject\n' } });
    const lines = [];
    const got = ws.pruneChained(at('p'), { env: ON, log: (l) => lines.push(l), seeds: true });
    assert.deepStrictEqual(got, { dropped: ['ALFRED_CODE_SCORING_LEVEL'], own: ['ALFRED_CODE_HISTORY', 'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_CORRECTION_NUDGE'] });
    assert.strictEqual(fs.readFileSync(path.join(at('p'), '.alfred', '.variables'), 'utf8'), '# mine\nALFRED_CODE_HISTORY=9\nALFRED_CODE_DOCS_VERSIONING=git\nALFRED_CODE_CORRECTION_NUDGE=inject\n');
    const ledger = stampLib.readLedger(path.join(at('p'), '.claude', 'alfred-code.stamp'));
    assert.deepStrictEqual(Object.keys(ledger.env['.variables']).sort(), ['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_HISTORY'], 'the dropped key\'s row goes with it');
    assert.deepStrictEqual(lines, ['workspace: 1 stack seeds and values equal to the workspace\'s removed from .alfred/.variables (ALFRED_CODE_SCORING_LEVEL) - 3 kept as this project\'s own (ALFRED_CODE_HISTORY, ALFRED_CODE_DOCS_VERSIONING, ALFRED_CODE_CORRECTION_NUDGE)']);
});

test('pruneChained (join) keeps an installer answer off the catalog default (--auto-compact on) as the project\'s own, though it sits at its ledger hash (D5)', () =>
{
    const H = stampLib.valueHash;
    const stampText = `sha: x\nmanaged-env: .variables:ALFRED_CODE_AUTO_COMPACT=${H('1')},.variables:ALFRED_CODE_HISTORY=${H('3')}\n`;
    const at = roleTree({ p: { stamp: stampText, git: true, vars: 'ALFRED_CODE_AUTO_COMPACT=1\nALFRED_CODE_HISTORY=3\n' } });
    const got = ws.pruneChained(at('p'), { env: ON, log: () => {}, seeds: true });
    assert.deepStrictEqual(got, { dropped: ['ALFRED_CODE_HISTORY'], own: ['ALFRED_CODE_AUTO_COMPACT'] });
    assert.strictEqual(fs.readFileSync(path.join(at('p'), '.alfred', '.variables'), 'utf8'), 'ALFRED_CODE_AUTO_COMPACT=1\n');
});

// B1 of the 2026-11-03 usage audit: the scoring's old seeds (0, empty) are a reseed's old values, so a joiner still holding
// them at their ledger hash drops them like any seed - the workspace's value reaches it; a 0 typed over the new seed stays.
test('pruneChained (join) drops an old stack seed a reseed migration names (the scoring\'s 0 and empty list), keeps one typed over the new seed', () =>
{
    const H = stampLib.valueHash;
    const old = roleTree({ p: { stamp: `sha: x\nmanaged-env: .variables:ALFRED_CODE_SCORING=${H('0')},.variables:ALFRED_CODE_SCORING_OUTPUTS=${H('')}\n`, git: true, vars: 'ALFRED_CODE_SCORING=0\nALFRED_CODE_SCORING_OUTPUTS=\n' } });
    assert.deepStrictEqual(ws.pruneChained(old('p'), { env: ON, log: () => {}, seeds: true }), { dropped: ['ALFRED_CODE_SCORING', 'ALFRED_CODE_SCORING_OUTPUTS'], own: [] });
    const typed = roleTree({ p: { stamp: `sha: x\nmanaged-env: .variables:ALFRED_CODE_SCORING=${H('1')}\n`, git: true, vars: 'ALFRED_CODE_SCORING=0\n' } });
    assert.deepStrictEqual(ws.pruneChained(typed('p'), { env: ON, log: () => {}, seeds: true }), { dropped: [], own: ['ALFRED_CODE_SCORING'] });
});

test('keepOnLeave writes each value read through the chain into the child\'s file, a seed with its ledger row; with the parent gone it names the keys that read their defaults', () =>
{
    const H = stampLib.valueHash;
    const at = roleTree({
        ws: { stamp: `sha: x\nmanaged-env: .variables:ALFRED_CODE_HISTORY=${H('5')}\n`, record: { children: ['api'] }, vars: 'ALFRED_CODE_SCORING_LEVEL=90\nALFRED_CODE_HISTORY=5\n' },
        'ws/api': { stamp: 'sha: x\nmanaged-env: \n', git: true, record: { parent: '..' }, vars: 'ALFRED_CODE_CORRECTION_NUDGE=inject\n' },
    });
    const before = layoutLib.variablesOf(at('ws/api'), { env: { ...ON } }).values;
    const got = ws.keepOnLeave(at('ws/api'), { env: ON, log: () => {} });
    assert.deepStrictEqual(got.written.sort(), ['ALFRED_CODE_HISTORY', 'ALFRED_CODE_SCORING_LEVEL']);
    assert.deepStrictEqual(got.defaults, []);
    assert.strictEqual(fs.readFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'utf8'), 'ALFRED_CODE_CORRECTION_NUDGE=inject\nALFRED_CODE_SCORING_LEVEL=90\nALFRED_CODE_HISTORY=5\n');
    const ledger = stampLib.readLedger(path.join(at('ws/api'), '.claude', 'alfred-code.stamp'));
    assert.deepStrictEqual(ledger.env['.variables'], { ALFRED_CODE_HISTORY: H('5') }, 'the root\'s seed stays a seed; its typed 90 is the child\'s own now');
    const own = { ...ON, ALFRED_CODE_WORKSPACE: '0' };
    assert.deepStrictEqual(layoutLib.variablesOf(at('ws/api'), { env: own }).values.ALFRED_CODE_SCORING_LEVEL, before.ALFRED_CODE_SCORING_LEVEL, 'the value reads the same with the chain cut');

    const gone = roleTree({ kid: { stamp: 'sha: x\n', git: true, record: { parent: '..' }, vars: 'ALFRED_CODE_DOCS_VERSIONING=git\n' } });
    const lines = [];
    const g = ws.keepOnLeave(gone('kid'), { env: ON, log: (l) => lines.push(l) });
    assert.deepStrictEqual(g.written, []);
    assert.ok(g.defaults.includes('ALFRED_CODE_SCORING_LEVEL') && !g.defaults.includes('ALFRED_CODE_DOCS_VERSIONING') && !g.defaults.includes('ALFRED_CODE_WORKSPACE'), g.defaults.join(','));
    assert.match(lines.join('\n'), /^workspace: \.\. is gone - \d+ values read the stack's defaults here now \(ALFRED_CODE_/m);
});

// W1: every run that writes a joined child's .variables drops each value equal to the one the chain hands it.
const W1 = { LEVEL: 'ALFRED_CODE_SCORING_LEVEL', HISTORY: 'ALFRED_CODE_HISTORY', NUDGE: 'ALFRED_CODE_CORRECTION_NUDGE', DOCS: 'ALFRED_CODE_DOCS_VERSIONING' };
const W1_ROOT = `${W1.LEVEL}=90\n${W1.HISTORY}=5\n${W1.NUDGE}=inject\n${W1.DOCS}=git\n`;
// ws (root) over ws/api (child) and, with `lib`, ws/api/lib (grandchild); returns the `at` of roleTree.
const w1Tree = ({ api, root = W1_ROOT, stamp = 'sha: x\nmanaged-env: \n', lib, apiRecord } = {}) => roleTree({
    ws: { stamp: 'sha: x\nmanaged-env: \n', record: { children: ['api'] }, vars: root },
    'ws/api': { stamp, git: true, record: apiRecord || (lib === undefined ? { parent: '..' } : { parent: '..', children: ['lib'] }), ...(api === undefined ? {} : { vars: api }) },
    ...(lib === undefined ? {} : { 'ws/api/lib': { stamp: 'sha: x\nmanaged-env: \n', git: true, record: { parent: '..' }, vars: lib } }),
});
const varsText = (dir) => { try { return fs.readFileSync(path.join(dir, '.alfred', '.variables'), 'utf8'); } catch { return null; } };
const stampText = (dir) => fs.readFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'utf8');
// One call, the read checked unchanged unless `seeds` (a join may drop a seed the members answer otherwise).
const prune = (dir, { env = ON, seeds = false } = {}) =>
{
    const lines = [];
    const before = layoutLib.variablesOf(dir, { env }).values;
    const got = ws.pruneChained(dir, { env, log: (l) => lines.push(l), ...(seeds ? { seeds } : {}) });
    if (!seeds) assert.deepStrictEqual(layoutLib.variablesOf(dir, { env }).values, before, 'the read never changes');
    return { ...got, lines };
};

test('pruneChained: an equal value leaves with its row, a different one stays', () =>
{
    const H = stampLib.valueHash;
    const at = w1Tree({ api: `# mine\n${W1.LEVEL}=90\n${W1.HISTORY}=9\nMY_OWN=1\nALFRED_CODE_HOOKS_OFF=x\n\nnot a line\n`,
        stamp: `sha: x\nmanaged-env: .variables:${W1.LEVEL}=${H('90')},.variables:${W1.HISTORY}=${H('9')}\n` });
    const r = prune(at('ws/api'));
    assert.deepStrictEqual([r.dropped, r.own], [[W1.LEVEL], [W1.HISTORY]]);
    assert.strictEqual(varsText(at('ws/api')), `# mine\n${W1.HISTORY}=9\nMY_OWN=1\nALFRED_CODE_HOOKS_OFF=x\n\nnot a line\n`);
    assert.deepStrictEqual(Object.keys(stampLib.readLedger(path.join(at('ws/api'), '.claude', 'alfred-code.stamp')).env['.variables']), [W1.HISTORY]);
    assert.deepStrictEqual(r.lines, [`workspace: 1 values equal to the workspace's removed from .alfred/.variables (${W1.LEVEL}) - 1 kept as this project's own (${W1.HISTORY})`]);
    // a second call changes nothing (Review Focus 3)
    const [text, st] = [varsText(at('ws/api')), stampText(at('ws/api'))];
    const again = prune(at('ws/api'));
    assert.deepStrictEqual([again.dropped, again.own, again.lines], [[], [W1.HISTORY], []]);
    assert.deepStrictEqual([varsText(at('ws/api')), stampText(at('ws/api'))], [text, st]);
});

test('pruneChained: equal is the same string (D1)', () =>
{
    const cases = [[W1.LEVEL, '90', '90', true], [W1.LEVEL, '"90"', '90', true], [W1.LEVEL, '90', '\'90\'', true], [W1.NUDGE, 'inject ', 'inject', true],
        [W1.LEVEL, '90', '9', false], [W1.LEVEL, '1', 'true', false], [W1.NUDGE, 'Inject', 'inject', false], [W1.LEVEL, '90', null, false]];
    for (const [key, mine, theirs, gone] of cases)
    {
        const at = w1Tree({ api: `${key}=${mine}\n`, root: theirs === null ? '' : `${key}=${theirs}\n` });
        assert.deepStrictEqual(prune(at('ws/api')).dropped, gone ? [key] : [], `${key}: ${mine} against ${theirs}`);
    }
});

test('pruneChained: never removed (D3) - DOCS_VERSIONING, WORKSPACE, an ignore env key, one a member between ignores', () =>
{
    const keep = (at, rel) => { const text = varsText(at(rel)); const r = prune(at(rel)); assert.deepStrictEqual([r.dropped, r.lines, varsText(at(rel))], [[], [], text]); };
    keep(w1Tree({ api: `${W1.DOCS}=git\nALFRED_CODE_WORKSPACE=1\n`, root: `${W1.DOCS}=git\nALFRED_CODE_WORKSPACE=1\n` }), 'ws/api');
    const ig = w1Tree({ api: `${W1.LEVEL}=90\n` });
    ws.writeWorkspace(ig('ws/api'), (m) => ws.addIgnore(m, 'env', W1.LEVEL), { env: ON });
    keep(ig, 'ws/api');
    const deep = w1Tree({ api: `${W1.HISTORY}=7\n`, lib: `${W1.LEVEL}=90\n` });
    ws.writeWorkspace(deep('ws/api'), (m) => ws.addIgnore(m, 'env', W1.LEVEL), { env: ON });
    keep(deep, 'ws/api/lib');
});

test('pruneChained: doubt keeps (D5) - the switch off, a garbage or missing record, a member file absent, a folder or empty', () =>
{
    const doubt = [
        ['the switch off in the launch env', () => {}, { ...ON, ALFRED_CODE_WORKSPACE: '0' }],
        ['the child\'s own WORKSPACE=0', (at) => fs.appendFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'ALFRED_CODE_WORKSPACE=0\n')],
        ['the root\'s record garbage', (at) => fs.writeFileSync(jsonOf(at('ws')), '{')],
        ['the root\'s stamp gone', (at) => fs.unlinkSync(path.join(at('ws'), '.claude', 'alfred-code.stamp'))],
        ['the root lists no child', (at) => putWorkspace(at('ws'), { role: 'root' })],
        ['the root\'s file gone', (at) => fs.unlinkSync(path.join(at('ws'), '.alfred', '.variables'))],
        ['the root\'s file a folder', (at) => { const f = path.join(at('ws'), '.alfred', '.variables'); fs.unlinkSync(f); fs.mkdirSync(f); }],
        ['the root\'s file empty', (at) => fs.writeFileSync(path.join(at('ws'), '.alfred', '.variables'), '')],
    ];
    for (const [name, spoil, env = ON] of doubt)
    {
        const at = w1Tree({ api: `${W1.LEVEL}=90\n` });
        spoil(at);
        const text = varsText(at('ws/api'));
        const r = prune(at('ws/api'), { env });
        assert.deepStrictEqual([r.dropped, r.lines, varsText(at('ws/api'))], [[], [], text], name);
    }
});

test('pruneChained: an absent file is not created, an empty one stays empty, a file that empties stays (D6), CRLF kept', () =>
{
    const none = w1Tree({});
    assert.deepStrictEqual(prune(none('ws/api')).lines, []);
    assert.strictEqual(varsText(none('ws/api')), null);
    const empty = w1Tree({ api: '' });
    assert.deepStrictEqual([prune(empty('ws/api')).lines, varsText(empty('ws/api'))], [[], '']);
    const lone = w1Tree({ api: `${W1.LEVEL}=90\n` });
    prune(lone('ws/api'));
    assert.strictEqual(varsText(lone('ws/api')), '');
    const commented = w1Tree({ api: `# only mine\n${W1.LEVEL}=90\n` });
    prune(commented('ws/api'));
    assert.strictEqual(varsText(commented('ws/api')), '# only mine\n');
    const crlf = w1Tree({ api: `# c\r\n${W1.LEVEL}=90\r\n${W1.HISTORY}=9\r\n` });
    prune(crlf('ws/api'));
    assert.strictEqual(varsText(crlf('ws/api')), `# c\r\n${W1.HISTORY}=9\r\n`);
});

// A member's empty line is unset to the loader (valueIn), which reads on to the next member - so the chain does too.
test('pruneChained: depth - against the nearest holder, a member\'s empty line is read past as the loader reads it', () =>
{
    const deep = w1Tree({ root: `${W1.LEVEL}=90\n${W1.HISTORY}=5\n`, api: `${W1.HISTORY}=7\n`, lib: `${W1.LEVEL}=90\n${W1.HISTORY}=7\n` });
    assert.deepStrictEqual(prune(deep('ws/api/lib')).dropped, [W1.LEVEL, W1.HISTORY]);
    const far = w1Tree({ root: `${W1.LEVEL}=90\n${W1.HISTORY}=5\n`, api: `${W1.HISTORY}=7\n`, lib: `${W1.HISTORY}=5\n` });
    assert.deepStrictEqual(prune(far('ws/api/lib')).dropped, []);
    const blank = w1Tree({ root: `${W1.LEVEL}=90\n`, api: `${W1.LEVEL}=\n`, lib: `${W1.LEVEL}=90\n` });
    assert.deepStrictEqual(prune(blank('ws/api/lib')).dropped, [W1.LEVEL]);
    // an own empty line is unset too, never a value equal to the workspace's: it stays, and the read is the same either way
    const both = w1Tree({ root: `${W1.LEVEL}=90\n`, api: `${W1.LEVEL}=\n`, lib: `${W1.LEVEL}=\n` });
    assert.deepStrictEqual(prune(both('ws/api/lib')).dropped, []);
});

test('pruneChained: a write that fails removes nothing and says so', () =>
{
    const H = stampLib.valueHash;
    const at = w1Tree({ api: `${W1.LEVEL}=90\n${W1.HISTORY}=9\n`, stamp: `sha: x\nmanaged-env: .variables:${W1.LEVEL}=${H('90')}\n` });
    const vars = require('./install/variables.js');
    const real = vars.write;
    const [text, st] = [varsText(at('ws/api')), stampText(at('ws/api'))];
    vars.write = () => ({ changed: false, why: 'locked' });
    try
    {
        const r = prune(at('ws/api'));
        assert.deepStrictEqual([r.dropped, r.own, r.lines], [[], [W1.HISTORY], ['!! workspace: .alfred/.variables could not be written (locked) - nothing was removed from it']]);
    }
    finally { vars.write = real; }
    assert.deepStrictEqual([varsText(at('ws/api')), stampText(at('ws/api'))], [text, st]);
});

test('pruneChained: a run never marks join-prune; a join does (Review Focus 3)', () =>
{
    const stamp = `sha: x\nmanaged-env: settings.json:${W1.HISTORY}=${stampLib.valueHash('3')}\n`;
    const run = w1Tree({ api: `${W1.LEVEL}=90\n`, stamp });
    prune(run('ws/api'));
    assert.doesNotMatch(stampText(run('ws/api')), /^join-prune:/m);
    const join = w1Tree({ api: `${W1.LEVEL}=90\n`, stamp });
    prune(join('ws/api'), { seeds: true });
    assert.match(stampText(join('ws/api')), /^join-prune: settings$/m);
});

test('pruneChained: the join\'s two rules in one call, and a run\'s one', () =>
{
    const H = stampLib.valueHash;
    const spec = { api: `${W1.HISTORY}=3\n${W1.LEVEL}=90\n${W1.NUDGE}=log\n`, stamp: `sha: x\nmanaged-env: .variables:${W1.HISTORY}=${H('3')}\n` };
    const join = w1Tree(spec);
    const j = prune(join('ws/api'), { seeds: true });
    assert.deepStrictEqual([j.dropped, j.own], [[W1.HISTORY, W1.LEVEL], [W1.NUDGE]]);
    assert.ok(j.lines[0].startsWith(`workspace: 2 stack seeds and values equal to the workspace's removed from .alfred/.variables (${W1.HISTORY}, ${W1.LEVEL})`), j.lines[0]);
    const run = w1Tree(spec);
    const r = prune(run('ws/api'));
    assert.deepStrictEqual([r.dropped, r.own], [[W1.LEVEL], [W1.HISTORY, W1.NUDGE]]);
});

// Task 2: a layer the loader reads between the own file and the members keeps the line (layout.js ownLayers' order).
const layers = (spec = {}) =>
{
    const at = w1Tree({ api: `${W1.LEVEL}=90\n`, ...(spec.tree || {}) });
    const acct = fs.mkdtempSync(path.join(TMP, 'acct-'));
    const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v)); };
    if (spec.project !== undefined) put(path.join(at('ws/api'), '.claude', 'settings.json'), spec.project);
    if (spec.local !== undefined) put(path.join(at('ws/api'), '.claude', 'settings.local.json'), spec.local);
    if (spec.account !== undefined) put(path.join(acct, 'settings.json'), spec.account);
    return { child: at('ws/api'), env: { ...ON, CLAUDE_CONFIG_DIR: acct, ...(spec.env || {}) } };
};
const stays = (name) => `workspace: 0 values equal to the workspace's removed from .alfred/.variables (none) - 1 kept as this project's own (${W1.LEVEL}); `
    + `${W1.LEVEL} equals the workspace's and stays: ${name} holds another value`;
const lv = (v) => ({ env: { [W1.LEVEL]: v } });

test('pruneChained layers: each layer alone at another value keeps the line and names it (Review Focus 1)', () =>
{
    for (const [spec, name] of [[{ project: lv('70') }, 'settings.json'], [{ account: lv('70') }, 'account settings'], [{ env: { [W1.LEVEL]: '70' } }, 'the run\'s environment']])
    {
        const { child, env } = layers(spec);
        const r = prune(child, { env });
        assert.deepStrictEqual([r.dropped, r.lines], [[], [stays(name)]], name);
    }
});

// The installer loads the hook prelude, whose applyVariables writes the cwd project's winners into process.env - the
// child's own line among them. The run's layer is the launch value it overwrote (the matrix's M5, 2026-11-13).
test('pruneChained layers: the run\'s environment is the launch value, not what applyVariables wrote over it', () =>
{
    const { child, env } = layers({ env: { [W1.LEVEL]: '70' } });
    layoutLib.applyVariables(child, env);
    assert.strictEqual(env[W1.LEVEL], '90', 'the prelude wrote the own line over the launch value');
    assert.deepStrictEqual(prune(child, { env }).lines, [stays('the run\'s environment')]);
    const same = layers({});
    layoutLib.applyVariables(same.child, same.env);
    assert.deepStrictEqual(prune(same.child, { env: same.env }).dropped, [W1.LEVEL], 'no launch value: the line leaves');
});

// The final review's Important finding: the loader reads a 3.10 name (layout.OLD_KEYS, until 4.0.0) wherever the new one
// has no value, in every layer and member - so a layer or member holding only the old name answers once the line leaves.
test('pruneChained layers: a 3.10 key name in any layer, the own file or a member keeps the line (until 4.0.0)', () =>
{
    const OLD = layoutLib.OLD_KEYS[W1.LEVEL];
    const old70 = { env: { [OLD]: '70' } };
    for (const [spec, name] of [[{ project: old70 }, 'settings.json'], [{ account: old70 }, 'account settings'], [{ env: { [OLD]: '70' } }, 'the run\'s environment'],
        [{ tree: { api: `${W1.LEVEL}=90\n${OLD}=70\n` } }, 'this file\'s 3.10 name']])
    {
        const { child, env } = layers(spec);
        const r = prune(child, { env });
        assert.deepStrictEqual([r.dropped, r.lines], [[], [stays(name)]], name);
    }
    // a middle member holding only the old name hands its value, so the grandchild's line is its own
    const at = w1Tree({ api: `${OLD}=70\n`, lib: `${W1.LEVEL}=90\n` });
    const r = prune(at('ws/api/lib'));
    assert.deepStrictEqual([r.dropped, r.own], [[], [W1.LEVEL]]);
});

test('pruneChained layers: each layer alone at the same value drops the line', () =>
{
    for (const spec of [{ project: lv('90') }, { account: lv('90') }, { env: { [W1.LEVEL]: '90' } }, { project: lv(90) }])
    {
        const { child, env } = layers(spec);
        assert.deepStrictEqual(prune(child, { env }).dropped, [W1.LEVEL], JSON.stringify(spec));
    }
});

test('pruneChained layers: the first holder decides', () =>
{
    const a = layers({ project: lv('90'), account: lv('70') });
    assert.deepStrictEqual(prune(a.child, { env: a.env }).dropped, [W1.LEVEL]);
    const b = layers({ project: lv('70'), account: lv('90') });
    assert.deepStrictEqual(prune(b.child, { env: b.env }).lines, [stays('settings.json')]);
    for (const empty of ['', null])
    {
        const c = layers({ account: lv(empty), env: { [W1.LEVEL]: '70' } });
        assert.deepStrictEqual(prune(c.child, { env: c.env }).lines, [stays('the run\'s environment')], String(empty));
    }
});

test('pruneChained layers: settings.local.json is no layer, and a layer that cannot be read holds nothing', () =>
{
    const local = layers({ local: lv('70') });
    assert.strictEqual(layoutLib.variablesOf(local.child, { env: local.env }).values[W1.LEVEL], '70');
    assert.deepStrictEqual(prune(local.child, { env: local.env }).dropped, [W1.LEVEL]);
    assert.strictEqual(layoutLib.variablesOf(local.child, { env: local.env }).values[W1.LEVEL], '70');
    for (const spec of [{ project: '{ garbage' }, { project: 'null' }, {}, { project: { env: [1] } }, { project: { env: 'x' } }])
    {
        const { child, env } = layers(spec);
        assert.deepStrictEqual(prune(child, { env }).dropped, [W1.LEVEL], JSON.stringify(spec));
    }
});

test('pruneChained layers: a kept key is named at every call; a seed at a join leaves whatever a layer holds', () =>
{
    const { child, env } = layers({ project: lv('70') });
    const text = varsText(child);
    assert.deepStrictEqual(prune(child, { env }).lines, [stays('settings.json')]);
    assert.deepStrictEqual(prune(child, { env }).lines, [stays('settings.json')]);
    assert.strictEqual(varsText(child), text);
    const seed = layers({ project: lv('70'), tree: { api: `${W1.LEVEL}=80\n`, root: `${W1.LEVEL}=80\n`,
        stamp: `sha: x\nmanaged-env: .variables:${W1.LEVEL}=${stampLib.valueHash('80')}\n` } });
    const j = prune(seed.child, { env: seed.env, seeds: true });
    assert.deepStrictEqual(j.dropped, [W1.LEVEL]);
    assert.doesNotMatch(j.lines.join('\n'), /stays/);
});

test('releaseChildren writes each value a child read from the parent into the child\'s file before its parent line goes (D5)', () =>
{
    const at = roleTree({
        ws: { stamp: 'sha: x\nmanaged-env: \n', record: { children: ['api'] }, vars: 'ALFRED_CODE_SCORING_LEVEL=90\nALFRED_CODE_HISTORY=5\n' },
        'ws/api': { stamp: 'sha: x\nmanaged-env: \n', git: true, record: { parent: '..' }, vars: 'ALFRED_CODE_CORRECTION_NUDGE=inject\n' },
    });
    const before = layoutLib.variablesOf(at('ws/api'), { env: ON }).values;
    const logs = [];
    assert.deepStrictEqual(ws.releaseChildren({ projectRoot: at('ws'), env: ON, log: (l) => logs.push(l) }), ['api']);
    assert.deepStrictEqual(readWorkspaceValues(at('ws/api')), {});
    assert.strictEqual(fs.readFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'utf8'), 'ALFRED_CODE_CORRECTION_NUDGE=inject\nALFRED_CODE_SCORING_LEVEL=90\nALFRED_CODE_HISTORY=5\n');
    assert.deepStrictEqual(layoutLib.variablesOf(at('ws/api'), { env: ON }).values, before, 'every value reads the same once released');
    assert.match(logs.join('\n'), /^workspace: api: 2 values this project read from the workspace written into \.alfred\/\.variables/m);
});

// ------------------------------------------------------------------ workspace.json: the writer, the conversion, garbage

const { compareVersions } = require('./install/source.js');

test('writer: key order, empty keys left out, an unknown key after the known ones, an invalid value back in its key and never applied', () =>
{
    const root = putJson(project(), '{"zeta": 1, "ignore": {"skill": ["x"], "colour": ["red"]}, "children": ["api", "../x"], "above": "none", "parent": ".."}\n');
    const got = ws.writeWorkspace(root, (r) => ws.addChild(r, 'web'));
    assert.deepStrictEqual([got.ok, got.wrote], [true, true]);
    const written = JSON.parse(fs.readFileSync(jsonOf(root), 'utf8'));
    assert.deepStrictEqual(Object.keys(written), ['parent', 'above', 'children', 'ignore', 'zeta']);
    assert.deepStrictEqual(written.children, ['api', 'web', '../x'], 'the invalid child back after the valid ones');
    assert.deepStrictEqual(written.ignore, { skill: ['x'], colour: ['red'] });
    assert.strictEqual(written.zeta, 1);
    assert.deepStrictEqual(got.view.children, ['api', 'web'], 'the invalid child is never applied');
    const fresh = project();
    assert.ok(ws.writeWorkspace(fresh, (r) => ws.setRole(r, 'root')).wrote);
    assert.strictEqual(fs.readFileSync(jsonOf(fresh), 'utf8'), '{\n  "role": "root"\n}\n', 'the empty keys left out');
    assert.strictEqual(fs.existsSync(legacyOf(fresh)), false, 'no old file is made');
});

test('writer: a 4-space CRLF BOM\'d workspace.json keeps its shape when a value changes', () =>
{
    const root = putJson(project(), '\uFEFF{\r\n    "parent": ".."\r\n}\r\n');
    assert.ok(ws.writeWorkspace(root, (r) => ws.addChild(r, 'api')).wrote);
    assert.strictEqual(fs.readFileSync(jsonOf(root), 'utf8'), '\uFEFF{\r\n    "parent": "..",\r\n    "children": [\r\n        "api"\r\n    ]\r\n}\r\n');
});

test('writer: nothing written when nothing changed - a one-line or reordered hand-saved workspace.json left byte for byte by convertOwn and by a no-op mutate', () =>
{
    for (const text of ['{"parent":"..","children":["api"]}\n', '{ "children": [ "api" ], "parent": ".." }'])
    {
        const root = putJson(project(), text);
        const mtime = aged(jsonOf(root));
        const out = sink();
        const c = ws.convertOwn({ projectRoot: root, env: {}, log: out.log });
        assert.deepStrictEqual([c.ok, c.converted], [true, false], text);
        const w = ws.writeWorkspace(root, (r) => ws.addChild(r, 'api'));
        assert.deepStrictEqual([w.ok, w.wrote], [true, false], text);
        assert.strictEqual(fs.readFileSync(jsonOf(root), 'utf8'), text);
        assert.strictEqual(fs.statSync(jsonOf(root)).mtimeMs, mtime, text);
        assert.deepStrictEqual(out.lines, []);
    }
});

test('writer: the conversion - the old file gone after the rename, one log line ending with the restart clause, its problems on it', () =>
{
    ws.takeConversions();
    const root = project('parent ..\r\n# mine\r\n');
    const out = sink();
    const got = ws.writeWorkspace(root, () => {}, { log: out.log });
    assert.deepStrictEqual([got.ok, got.wrote, got.converted], [true, true, true]);
    assert.strictEqual(fs.existsSync(legacyOf(root)), false, 'the old file is gone');
    assert.strictEqual(fs.readFileSync(jsonOf(root), 'utf8'), '{\n  "parent": ".."\n}\n');
    assert.deepStrictEqual(out.lines, ["workspace: .alfred/workspace converted to workspace.json (comment '# mine' not carried into workspace.json) - restart any session open in this project since before this run"]);
    const plain = project('child api\n');
    const said = sink();
    ws.writeWorkspace(plain, (r) => ws.addChild(r, 'web'), { log: said.log });
    assert.deepStrictEqual(said.lines, ['workspace: .alfred/workspace converted to workspace.json - restart any session open in this project since before this run']);
    const list = ws.takeConversions();
    assert.deepStrictEqual(list.map((c) => [c.own, c.record.parent, c.record.children]), [[true, '..', []], [true, null, ['api', 'web']]]);
    assert.deepStrictEqual(ws.takeConversions(), [], 'taken and cleared');
});

test('writer: an invalid parent is replaced by a join\'s parent and named; an invalid child stays after the valid ones', () =>
{
    const root = putJson(project(), JSON.stringify({ parent: '/abs', children: ['api', '../x'] }));
    const out = sink();
    assert.ok(ws.writeWorkspace(root, (r) => ws.addChild(ws.setParent(r, '..'), 'web'), { log: out.log }).wrote);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonOf(root), 'utf8')), { parent: '..', children: ['api', 'web', '../x'] });
    assert.deepStrictEqual(out.lines, ["workspace: .alfred/workspace.json: invalid parent '/abs' replaced by '..'"]);
    // a mutation that does not set the key: written back as read, nothing named
    const kept = putJson(project(), JSON.stringify({ parent: '/abs' }));
    const quiet = sink();
    assert.ok(ws.writeWorkspace(kept, (r) => ws.addChild(r, 'api'), { log: quiet.log }).wrote);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonOf(kept), 'utf8')), { parent: '/abs', children: ['api'] });
    assert.deepStrictEqual(quiet.lines, []);
});

test('writer: both files fold into workspace.json and the old one goes', () =>
{
    const root = putJson(putOld(project(), 'child web\nignore skill x\n'), '{"children": ["api"]}\n');
    const out = sink();
    const got = ws.writeWorkspace(root, () => {}, { log: out.log });
    assert.deepStrictEqual([got.ok, got.wrote, got.converted], [true, true, true]);
    assert.strictEqual(fs.existsSync(legacyOf(root)), false);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonOf(root), 'utf8')), { children: ['api', 'web'], ignore: { skill: ['x'] } });
    assert.deepStrictEqual(out.lines, ['workspace: .alfred/workspace converted to workspace.json - restart any session open in this project since before this run']);
    ws.takeConversions();
});

test('writer: a garbage workspace.json is left byte for byte, why garbage', () =>
{
    const root = putJson(putOld(project(), 'child api\n'), '{ "parent": ".." ');
    const out = sink();
    const got = ws.writeWorkspace(root, (r) => ws.addChild(r, 'web'), { log: out.log });
    assert.deepStrictEqual([got.ok, got.why, got.wrote], [false, 'garbage', false]);
    assert.strictEqual(fs.readFileSync(jsonOf(root), 'utf8'), '{ "parent": ".." ');
    assert.strictEqual(fs.readFileSync(legacyOf(root), 'utf8'), 'child api\n', 'the old file beside it is left too');
    assert.deepStrictEqual(out.lines, [GARBAGE('.alfred/workspace.json')]);
    assert.strictEqual(fs.existsSync(lockOf(root)), false, 'the lock is released');
});

test('writer: the lock held elsewhere - why locked, neither file touched', () =>
{
    const root = putJson(putOld(project(), 'child web\n'), '{"children": ["api"]}\n');
    fs.writeFileSync(lockOf(root), '');
    const never = clock();
    const got = ws.writeWorkspace(root, (r) => ws.addChild(r, 'x'), { now: never.now, sleep: never.sleep });
    assert.deepStrictEqual([got.ok, got.why, got.wrote], [false, 'locked', false]);
    assert.strictEqual(fs.readFileSync(jsonOf(root), 'utf8'), '{"children": ["api"]}\n');
    assert.strictEqual(fs.readFileSync(legacyOf(root), 'utf8'), 'child web\n');
});

test('convertOwn writes with ALFRED_CODE_WORKSPACE=0 and writes nothing on a converted project', () =>
{
    const root = project('parent ..\nchild api\n');
    const out = sink();
    const off = { ALFRED_CODE_WORKSPACE: '0' };
    const first = ws.convertOwn({ projectRoot: root, env: off, log: out.log });
    assert.deepStrictEqual([first.ok, first.converted], [true, true]);
    assert.strictEqual(fs.existsSync(legacyOf(root)), false);
    assert.strictEqual(readWorkspaceRecord(root).source, 'json');
    assert.deepStrictEqual(readWorkspaceValues(root), { parent: '..', children: ['api'] });
    const text = fs.readFileSync(jsonOf(root), 'utf8');
    const again = ws.convertOwn({ projectRoot: root, env: off, log: out.log });
    assert.deepStrictEqual([again.ok, again.converted], [true, false]);
    assert.strictEqual(fs.readFileSync(jsonOf(root), 'utf8'), text);
    assert.strictEqual(out.lines.length, 1, out.lines.join('\n'));
    ws.takeConversions();
});

test('older-project lines: named for an older child of a converted record, for the older parent a converted record names, and for an older parent or child whose own record this run converted, on either route; silent for a current one and for the run\'s own project', () =>
{
    const stamped = (version, route) => `version: ${version}\nhooks-route: ${route}\n`;
    const spec = () => ({
        ws: { stamp: stamped('3.9.2', 'plugin'), record: { children: ['api', 'web', 'kid'] }, legacy: true },
        'ws/api': { stamp: stamped('3.9.2', 'copy'), record: { parent: '..' }, legacy: true },
        'ws/web': { stamp: stamped('3.10.0', 'plugin'), record: { parent: '..' }, legacy: true },
        'ws/kid': { stamp: stamped('3.9.2', 'plugin'), record: { parent: '..' }, legacy: true },
    });
    const lines = (at, runRel, rels) =>
    {
        ws.takeConversions();
        for (const rel of rels) assert.ok(ws.writeWorkspace(at(rel), (r) => r, { runRoot: at(runRel) }).converted, rel);
        return ws.olderProjectLines({ conversions: ws.takeConversions(), release: '3.10.0', compare: compareVersions, env: env0 });
    };
    const older = (p, child) => `!! workspace: ${p} runs an older release - it reads the old workspace file, which is now workspace.json; update ${p} next${child ? " (or take 'the children too')" : ''}`;
    // the root converts its own record: its older children are named (api on the copy route, kid on the plugin route), the current one and the root itself not
    const a = roleTree(spec());
    assert.deepStrictEqual(lines(a, 'ws', ['ws']), [older('api', true), older('kid', true)]);
    // a current child converts its own record: the older parent it names
    const b = roleTree(spec());
    assert.deepStrictEqual(lines(b, 'ws/web', ['ws/web']), [older('..', false)]);
    // a current child converts its parent's record (register): the older parent, and the older children it lists
    const c = roleTree(spec());
    assert.deepStrictEqual(lines(c, 'ws/web', ['ws']), [older('..', false), older('../api', true), older('../kid', true)]);
    // the root converts its children's records (releaseChildren): each older child, never the root
    const d = roleTree(spec());
    assert.deepStrictEqual(lines(d, 'ws', ['ws/api', 'ws/web']), [older('api', true)]);
    // nothing converted: no line
    assert.deepStrictEqual(lines(d, 'ws', []), []);
    // a later release: a member at the first release that reads workspace.json (web, 3.10.0) is no older one
    const e = roleTree(spec());
    ws.takeConversions();
    assert.ok(ws.writeWorkspace(e('ws'), (r) => r, { runRoot: e('ws') }).converted);
    assert.deepStrictEqual(ws.olderProjectLines({ conversions: ws.takeConversions(), release: '3.11.0', compare: compareVersions, env: env0 }), [older('api', true), older('kid', true)]);
    assert.ok(compareVersions(ws.JSON_SINCE, '3.9.2') > 0, 'v3.9.2 reads only the old file');
    assert.ok(compareVersions(ws.PLURAL_SINCE, '3.10.0') > 0, 'v3.10.0 reads no plural key');
});

test('garbage reads ask nothing: roleOf, roleAsk, rescan, subtree and the status verb over a garbage workspace.json raise no role, join or rejoin ask and print the one line', () =>
{
    const at = roleTree({
        ws: { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, git: true },
        'ws/api/deep': { stamp: true, git: true, record: { parent: '..' } }, 'ws/free': { stamp: true, git: true },
    });
    putJson(at('ws/api'), '{"children": ["deep"]');
    putJson(at('ws/free'), '[1, 2]');
    const out = sink();
    assert.strictEqual(ws.roleOf(at('ws/free'), { env: ON, log: out.log }).kind, 'unknown');
    for (const when of ['init', 'configure', 'update']) assert.strictEqual(ws.roleAsk(at('ws/free'), { env: ON, when, log: out.log }), null, when);
    assert.deepStrictEqual(ws.rescan(at('ws'), { env: ON, log: out.log }), [], 'a garbage record is no unjoined project to offer');
    assert.deepStrictEqual(ws.subtree(at('ws'), { env: ON, log: out.log }).map((r) => r.rel), ['.', 'api'], 'nothing below a garbage record is read');
    assert.deepStrictEqual(out.lines.sort(), [GARBAGE('.alfred/workspace.json'), GARBAGE('api/.alfred/workspace.json')].sort(), 'one line per file, once');
    const cliRun = (...argv) => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'workspace.js'), ...argv], { encoding: 'utf8', env: { ...process.env, ...ON } });
    for (const argv of [['status'], ['role', '--when', 'update']])
    {
        const r = cliRun(...argv, '--root', at('ws/free'));
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.strictEqual(r.stdout.split('\n').filter((l) => l === GARBAGE('.alfred/workspace.json')).length, 1, r.stdout);
        assert.doesNotMatch(r.stdout, /^ask: /m, r.stdout);
    }
});

test('a child whose parent\'s workspace.json is garbage gets no rejoin ask, and register\'s write into it fails with why garbage', () =>
{
    const at = roleTree({ ws: { stamp: true }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    putJson(at('ws'), '{"children": ["api"');
    const out = sink();
    assert.strictEqual(ws.roleAsk(at('ws/api'), { env: ON, when: 'update', log: out.log }), null, 'no rejoin and no parent-gone ask');
    assert.deepStrictEqual(out.lines, [GARBAGE('../.alfred/workspace.json')]);
    const r = ws.register(at('ws/api'), { env: ON });
    assert.deepStrictEqual([r.ok, r.code], [false, 1]);
    const last = r.lines[r.lines.length - 1];
    assert.match(last, /garbage/);
    assert.doesNotMatch(last, /could not be written/);
    assert.strictEqual(fs.readFileSync(jsonOf(at('ws')), 'utf8'), '{"children": ["api"', 'the garbage record is left as it is');
});

test('chain refuses a hop to a garbage parent', () =>
{
    const at = tree({ ws: { stamp: true }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    putJson(at('ws'), '{"children": [');
    const got = ws.chain(at('ws/api'), { env: env0 });
    assert.deepStrictEqual(got.members, []);
    assert.strictEqual(got.notes.length, 1, got.notes.join('\n'));
    assert.match(got.notes[0], /\.\.\/\.alfred\/workspace\.json is not valid JSON/);
    assert.doesNotMatch(got.notes[0], /does not list/);
});

test('garbageOnLeave names each garbage record uninstall would write', () =>
{
    const own = tree({ p: { stamp: true } });
    putJson(own('p'), '{');
    assert.deepStrictEqual(ws.garbageOnLeave({ projectRoot: own('p'), env: env0 }), ['.alfred/workspace.json']);
    const up = tree({ ws: { stamp: true }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    putJson(up('ws'), '{"children": ["api"');
    assert.deepStrictEqual(ws.garbageOnLeave({ projectRoot: up('ws/api'), env: env0 }), ['../.alfred/workspace.json']);
    const down = tree({ ws: { stamp: true, record: { children: ['api', 'web'] } }, 'ws/api': { stamp: true }, 'ws/web': { stamp: true, record: { parent: '..' } } });
    putJson(down('ws/api'), '{');
    assert.deepStrictEqual(ws.garbageOnLeave({ projectRoot: down('ws'), env: env0 }), ['api/.alfred/workspace.json']);
    const fine = tree({ ws: { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    assert.deepStrictEqual(ws.garbageOnLeave({ projectRoot: fine('ws'), env: env0 }), []);
    assert.deepStrictEqual(ws.garbageOnLeave({ projectRoot: fine('ws/api'), env: env0 }), []);
    const empty = tree({ p: { stamp: true } });
    putJson(empty('p'), '');
    assert.deepStrictEqual(ws.garbageOnLeave({ projectRoot: empty('p'), env: env0 }), []);
});

test('review I1: register over an old-format parent that already lists this project keeps that entry when its own write fails, and says kept', () =>
{
    const spec = () => ({ ws: { stamp: true, record: { role: 'root', children: ['api'] }, legacy: true }, 'ws/api': { stamp: true, git: true } });
    const at = roleTree(spec());
    putJson(at('ws/api'), '{"parent": "..",');
    const r = ws.register(at('ws/api'), { env: ON });
    assert.deepStrictEqual([r.ok, r.code], [false, 1], r.lines.join('\n'));
    assert.deepStrictEqual(readWorkspaceValues(at('ws')), { role: 'root', children: ['api'] }, 'the entry the parent held before stays');
    const ok = roleTree(spec());
    const done = ws.register(ok('ws/api'), { env: ON });
    assert.strictEqual(done.ok, true, done.lines.join('\n'));
    assert.ok(done.lines.includes('workspace: child api kept in ..'), done.lines.join('\n'));
    // leaving a parent whose old-format record never listed this project: converted, nothing removed from it
    const lv = roleTree({ ws: { stamp: true, record: { role: 'root' }, legacy: true }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    const said = sink();
    assert.strictEqual(ws.leaveParent({ projectRoot: lv('ws/api'), env: ON, log: said.log }).left, true);
    assert.ok(said.lines.some((l) => /converted to workspace\.json/.test(l)), said.lines.join('\n'));
    assert.ok(!said.lines.some((l) => /child api removed from/.test(l)), said.lines.join('\n'));
});

test('review I2: under a garbage parent record roleOf reads unknown, no role ask is raised, and a role answer changes nothing', () =>
{
    const at = roleTree({ ws: { stamp: true }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    putJson(at('ws'), '{"children": ["api"');
    const before = fs.readFileSync(jsonOf(at('ws/api')), 'utf8');
    const out = sink();
    assert.strictEqual(ws.roleOf(at('ws/api'), { env: ON, log: out.log }).kind, 'unknown');
    for (const when of ['init', 'configure', 'update']) assert.strictEqual(ws.roleAsk(at('ws/api'), { env: ON, when, log: out.log }), null, when);
    assert.deepStrictEqual(out.lines, [GARBAGE('../.alfred/workspace.json')], 'named once');
    for (const answer of ['root', 'standalone', 'stay'])
    {
        const r = ws.applyRole(at('ws/api'), answer, { env: ON });
        assert.strictEqual(r.ok, false, `${answer}: ${r.lines.join('\n')}`);
        assert.match(r.lines[r.lines.length - 1], /not valid JSON - nothing was changed/, answer);
    }
    assert.strictEqual(fs.readFileSync(jsonOf(at('ws/api')), 'utf8'), before, 'the child keeps its parent');
});

// ------------------------------------------------------------------ stage 1: the plural ignore keys (Section 7)

test('Section 7: the writer keeps a file\'s spelling - a new file and a plural file are written plural, any other existing file singular, plural: true rewrites it', () =>
{
    const fileJson = (root) => JSON.parse(fs.readFileSync(jsonOf(root), 'utf8'));
    const fresh = project();
    assert.ok(ws.writeWorkspace(fresh, (r) => ws.addIgnore(r, 'rule', 'a')).wrote);
    assert.deepStrictEqual(fileJson(fresh), { ignore: { rules: ['a'] } }, 'no file yet: plural');
    assert.strictEqual(ws.readWorkspace(fresh).singular, false);

    const plural = putJson(project(), '{ "ignore": { "rules": ["a"] } }\n');
    assert.ok(ws.writeWorkspace(plural, (r) => ws.addIgnore(r, 'hook', 'h')).changed);
    assert.deepStrictEqual(fileJson(plural), { ignore: { rules: ['a'], hooks: ['h'] } }, 'a plural file stays plural');

    const singular = putJson(project(), '{ "ignore": { "rule": ["a"] } }\n');
    assert.strictEqual(ws.readWorkspace(singular).singular, true);
    assert.strictEqual(ws.writeWorkspace(singular, (r) => ws.addIgnore(r, 'hook', 'h')).changed, true);
    assert.deepStrictEqual(fileJson(singular), { ignore: { rule: ['a'], hook: ['h'] } }, 'a singular file stays singular');

    // ruling 10: an existing file with no ignore keys may sit above an older member, which reads no plural key
    const rooted = putJson(project(), '{ "role": "root" }\n');
    assert.ok(ws.writeWorkspace(rooted, (r) => ws.addIgnore(r, 'rule', 'a')).wrote);
    assert.deepStrictEqual(fileJson(rooted), { role: 'root', ignore: { rule: ['a'] } });

    const once = putJson(project(), '{ "ignore": { "rule": ["a"] } }\n');
    const first = ws.writeWorkspace(once, (r) => r, { plural: true });
    assert.deepStrictEqual([first.wrote, first.changed], [true, true]);
    assert.deepStrictEqual(fileJson(once), { ignore: { rules: ['a'] } });
    assert.strictEqual(ws.writeWorkspace(once, (r) => r, { plural: true }).wrote, false, 'a second rewrite changes nothing');

    // review focus 1: both spellings of one kind in one file - each name once, written back under the plural key
    const both = putJson(project(), '{ "ignore": { "rule": ["a"], "rules": ["a", "b"] } }\n');
    assert.ok(ws.writeWorkspace(both, (r) => ws.addIgnore(r, 'hook', 'h')).changed);
    assert.deepStrictEqual(fileJson(both), { ignore: { rules: ['a', 'b'], hooks: ['h'] } });
    // review M1: a JSON null is a value the file holds - written back, never logged as dropped
    const nulled = putJson(project(), '{ "parent": null, "ignore": { "rule": null, "skill": ["a"] } }\n');
    const quiet = sink();
    assert.ok(ws.writeWorkspace(nulled, (r) => ws.addIgnore(r, 'hook', 'h'), { log: quiet.log }).changed);
    assert.deepStrictEqual(quiet.lines.filter((l) => /dropped|replaced/.test(l)), []);
    assert.strictEqual(fileJson(nulled).parent, null);
    // review M2: a key that is also a name on Object.prototype is the user's own key - kept as written, no spelling read from it
    const proto = putJson(project(), '{ "ignore": { "constructor": ["a"], "skill": ["s"] } }\n');
    assert.strictEqual(ws.readWorkspace(proto).singular, true);
    assert.ok(ws.writeWorkspace(proto, (r) => ws.addIgnore(r, 'hook', 'h')).changed);
    assert.deepStrictEqual(Object.keys(fileJson(proto).ignore).sort(), ['constructor', 'hook', 'skill']);
    assert.deepStrictEqual(fileJson(proto).ignore.constructor, ['a']);

    // a stack-kind key that is no list, beside a change: written back under the file's spelling, never logged as dropped
    const bad = putJson(project(), '{ "ignore": { "rules": "x", "hooks": ["h"] } }\n');
    const out = sink();
    assert.ok(ws.writeWorkspace(bad, (r) => ws.addIgnore(r, 'skill', 's'), { log: out.log }).wrote);
    assert.deepStrictEqual(fileJson(bad), { ignore: { hooks: ['h'], skills: ['s'], rules: 'x' } });
    assert.deepStrictEqual(out.lines.filter((l) => /dropped|replaced/.test(l)), []);
});

// Workspace stage 3, Task 3: memberPicks - the skill and seat lines the joined members below a root picked themselves.
test('memberPicks: joined members\' own skill and seat picks, 8 folders deep, a garbage or line-less stamp named, a non-member silent', () =>
{
    const deep = (n) => Array.from({ length: n }, (_, i) => `d${i + 1}`).join('/');
    const at = tree({
        'ws': { stamp: true, record: { children: ['api', 'web', 'bad', 'bare', deep(8), deep(9)] } },
        'ws/api': { stamp: true, record: { parent: '..' } }, 'ws/web': { stamp: true, record: { parent: '..' } },
        'ws/bad': { stamp: true, record: { parent: '..' } }, 'ws/bare': { stamp: true, record: { parent: '..' } },
        'ws/other': { stamp: true },
        [`ws/${deep(8)}`]: { stamp: true, record: { parent: Array(8).fill('..').join('/') } },
        [`ws/${deep(9)}`]: { stamp: true, record: { parent: Array(9).fill('..').join('/') } },
    });
    const put = (rel, text) => fs.writeFileSync(path.join(at(rel), '.claude', 'alfred-code.stamp'), text);
    put('ws/api', 'seats-route: plugin\nown-picks: skill/csharp,agent/evidence-gatherer,rule/r\n');
    put('ws/web', 'seats-route: copy\nown-picks: skill/devops,agent/wpf-verifier\n');
    put('ws/bad', '\u0000\u0001 not a stamp');
    put('ws/bare', 'seats-route: plugin\n');
    put('ws/other', 'own-picks: skill/dotnet\n');
    put(`ws/${deep(8)}`, 'own-picks: skill/dotnet-grpc\n');
    put(`ws/${deep(9)}`, 'own-picks: skill/dotnet-mvc-controllers\n');
    const got = ws.memberPicks(at('ws'), { env: env0, seatsRoute: 'plugin' });
    assert.deepStrictEqual(got.lines, ['agent evidence-gatherer', 'rule r', 'skill csharp', 'skill devops', 'skill dotnet-grpc']);
    assert.deepStrictEqual(got.notes.sort(), ['member bad not counted: its stamp holds no own-picks line', 'member bare not counted: its stamp holds no own-picks line']);
    assert.deepStrictEqual(ws.memberPicks(at('ws'), { env: env0, seatsRoute: 'copy' }).lines, ['rule r', 'skill csharp', 'skill devops', 'skill dotnet-grpc', 'agent wpf-verifier'].sort());
});

// ------------------------------------------------------------------ W3 Task 3: the installer's rule
const wsTree = (extra = {}, rootRecord = { role: 'root', children: ['api'], ignoredChildren: ['legacy'] }) => tree({
    ws: { stamp: true, git: true, record: rootRecord },
    'ws/api': { stamp: true, git: true, record: { parent: '..' } },
    ...extra,
});
const ownTop = (calls) => (cmd, args, opts) => { calls.push(opts.cwd); return `${opts.cwd}\n`; };

test('addIgnoredChild: adds once, takes the covered children out, refuses a path outside', () =>
{
    const r = { ...wfLib.emptyRecord(), children: ['api', 'legacy/app', 'legacy-old'] };
    ws.addIgnoredChild(r, 'legacy');
    ws.addIgnoredChild(r, 'legacy');
    assert.deepStrictEqual([r.ignoredChildren, r.children], [['legacy'], ['api', 'legacy-old']]);
    assert.throws(() => ws.addIgnoredChild(r, '../x'), { message: 'workspace: ignored child ../x is not a relative path inside the project' });
});

test('ignoredBy: null with no list; the path, one folder under it; a sibling sharing the prefix is null', () =>
{
    const none = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/legacy': { stamp: true, git: true } });
    assert.strictEqual(ws.ignoredBy(none('ws/legacy'), { env: env0, exec: ownTop([]) }), null);
    const at = wsTree({ 'ws/legacy': { stamp: true, git: true }, 'ws/legacy-old': { stamp: true, git: true } });
    assert.deepStrictEqual(ws.ignoredBy(at('ws/legacy'), { env: env0, exec: ownTop([]) }), { root: at('ws'), rel: '..', ignored: true });
    assert.strictEqual(ws.ignoredBy(at('ws/legacy-old'), { env: env0, exec: ownTop([]) }), null);
    const under = wsTree({ 'ws/legacy/app': { stamp: true, git: true } });
    assert.deepStrictEqual(ws.ignoredBy(under('ws/legacy/app'), { env: env0, exec: ownTop([]) }), { root: under('ws'), rel: '../..', ignored: true });
});

test('ignoredBy: either holder answers (the between tree)', () =>
{
    const viaRoot = tree({ ws: { stamp: true, git: true, record: { role: 'root', children: ['mid/p'], ignoredChildren: ['mid/p'] } }, 'ws/mid': { stamp: true, git: true },
        'ws/mid/p': { stamp: true, git: true, record: { parent: '../..' } } });
    assert.deepStrictEqual(ws.ignoredBy(viaRoot('ws/mid/p'), { env: env0, exec: ownTop([]) }), { root: viaRoot('ws'), rel: '../..', ignored: true });
    const viaMid = tree({ ws: { stamp: true, git: true, record: { role: 'root', children: ['mid/p'] } }, 'ws/mid': { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['p'] } },
        'ws/mid/p': { stamp: true, git: true, record: { parent: '../..' } } });
    assert.deepStrictEqual(ws.ignoredBy(viaMid('ws/mid/p'), { env: env0, exec: ownTop([]) }), { root: viaMid('ws/mid'), rel: '..', ignored: true });
});

test('ignoredBy: the between tree still reads ignored after its own release - the holder is kept as `above`; a plain tree writes none', () =>
{
    const at = tree({ ws: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['mid/p'] } }, 'ws/mid': { stamp: true, git: true },
        'ws/mid/p': { stamp: true, git: true, record: { parent: '../..' } } });
    assert.deepStrictEqual(ws.releaseChildren({ projectRoot: at('ws'), only: at('ws/mid/p'), keepRules: true, env: env0 }), ['mid/p']);
    const view = wfLib.viewOf(wfLib.readRecord(path.join(at('ws/mid/p'), '.alfred')).record);
    assert.deepStrictEqual([view.parent, view.above], [null, '../..']);
    assert.deepStrictEqual(ws.ignoredBy(at('ws/mid/p'), { env: env0, exec: ownTop([]) }), { root: at('ws'), rel: '../..', ignored: true });
    const anc = ws.stampedAncestors(at('ws/mid/p'), { env: env0, exec: ownTop([]) });
    assert.ok(anc.ignored, 'the project reads ignored');
    assert.ok(ws.chainExcludes(anc, at('ws/mid/p'), []).some((x) => x.endsWith('CLAUDE.md')), 'the wide rows are still written');
    const plain = wsTree({ 'ws/legacy': { stamp: true, git: true, record: { parent: '..' } } });
    ws.releaseChildren({ projectRoot: plain('ws'), only: plain('ws/legacy'), keepRules: true, env: env0 });
    const pv = wfLib.viewOf(wfLib.readRecord(path.join(plain('ws/legacy'), '.alfred')).record);
    assert.deepStrictEqual([pv.parent, pv.above], [null, null], 'the nearest holder needs no above line');
});

test('ignoredBy: a third folder\'s entry and a garbage holder answer null', () =>
{
    const third = tree({ ws: { stamp: true, git: true, record: { role: 'root', children: ['api'], ignoredChildren: ['api/tools'] } },
        'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['tools'] } }, 'ws/api/tools': { stamp: true, git: true, record: { parent: '..' } } });
    assert.strictEqual(ws.ignoredBy(third('ws/api/tools'), { env: env0, exec: ownTop([]) }), null);
    const garbage = tree({ ws: { stamp: true, git: true }, 'ws/api': { stamp: true, git: true } });
    fs.mkdirSync(path.join(garbage('ws'), '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(garbage('ws'), '.alfred', 'workspace.json'), '{ not json');
    assert.strictEqual(ws.ignoredBy(garbage('ws/api'), { env: env0, exec: ownTop([]) }), null);
});

test('ignoredBy: a covered folder of the holder\'s repository answers not ignored, why same-repo; no list covers: git is never asked', () =>
{
    const at = wsTree({ 'ws/legacy': {} });
    const oneTop = (cmd, args, opts) => `${at('ws')}\n`;
    assert.deepStrictEqual(ws.ignoredBy(at('ws/legacy'), { env: env0, exec: oneTop }), { root: at('ws'), rel: '..', ignored: false, why: 'same-repo' });
    const calls = [];
    assert.strictEqual(ws.ignoredBy(at('ws/api'), { env: env0, exec: ownTop(calls) }), null);
    assert.strictEqual(calls.length, 0);
});

test('ignoredBy: a folder that does not exist, and one whose record cannot be read, answer without a throw', () =>
{
    const at = wsTree();
    assert.deepStrictEqual(ws.ignoredBy(path.join(at('ws'), 'legacy'), { env: env0, exec: ownTop([]) }), { root: at('ws'), rel: '..', ignored: true });
    const bad = tree({ ws: { stamp: true, git: true }, 'ws/api': { stamp: true, git: true } });
    fs.mkdirSync(path.join(bad('ws'), '.alfred', 'workspace.json'), { recursive: true });
    assert.strictEqual(ws.ignoredBy(bad('ws/api'), { env: env0, exec: ownTop([]) }), null);
});

test('joinVerdict: same-repo, then ignored, then not-a-checkout', () =>
{
    const at = wsTree({ 'ws/legacy': {} });
    assert.strictEqual(ws.joinVerdict(at('ws/legacy'), { env: env0, exec: () => `${at('ws')}\n` }).why, 'same-repo');
    const v = ws.joinVerdict(at('ws/legacy'), { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual([v.ok, v.why, v.by], [false, 'ignored', '..']);
    const plain = tree({ ws: { stamp: true, git: true, record: { role: 'root' } }, 'ws/sub': {} });
    assert.strictEqual(ws.joinVerdict(plain('ws/sub'), { env: env0, exec: (c, a, o) => (o.cwd === plain('ws') ? `${plain('ws')}\n` : `${plain('ws')}/other\n`) }).why, 'not-a-checkout');
});

test('roleAsk: an ignored project is offered no join', () =>
{
    const at = wsTree({ 'ws/legacy': { git: true } });
    const init = ws.roleAsk(at('ws/legacy'), { env: env0, exec: ownTop([]), when: 'init', log: () => {} });
    assert.deepStrictEqual([init.case, init.options, init.why], ['init-why', ['Standalone (Recommended)', 'Root'], ws.WHY.ignored('..')]);
    const conf = ws.roleAsk(at('ws/legacy'), { env: env0, exec: ownTop([]), when: 'configure', log: () => {} });
    assert.deepStrictEqual(conf.options, ['Keep (Recommended)', 'Become a root']);
    assert.strictEqual(ws.roleAsk(at('ws/legacy'), { env: env0, exec: ownTop([]), when: 'update', log: () => {} }), null, 'never answered');
    putWorkspace(at('ws/legacy'), { parent: '..' });
    assert.strictEqual(ws.roleAsk(at('ws/legacy'), { env: env0, exec: ownTop([]), when: 'update', log: () => {} }), null, 'a parent still recorded');
});

test('rescan: an ignored stamped folder is never listed; its unmarked sibling is', () =>
{
    const at = wsTree({ 'ws/legacy': { stamp: true, git: true }, 'ws/web': { stamp: true, git: true } });
    assert.deepStrictEqual(ws.rescan(at('ws'), { env: env0, log: () => {} }), ['web']);
});

test('stampedAncestors: ignored and cut', () =>
{
    const at = tree({ ws: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['mid'] } }, 'ws/mid': { stamp: true, git: true },
        'ws/mid/p': { stamp: true, git: true }, 'ws/q': { stamp: true, git: true } });
    const p = ws.stampedAncestors(at('ws/mid/p'), { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual([[...p], p.ignored, p.cut], [[at('ws/mid'), at('ws')], at('ws/mid'), [at('ws')]]);
    const mid = ws.stampedAncestors(at('ws/mid'), { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual([[...mid], mid.ignored, mid.cut], [[at('ws')], at('ws/mid'), [at('ws')]]);
    const q = ws.stampedAncestors(at('ws/q'), { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual([[...q], q.ignored, q.cut], [[at('ws')], null, []]);
});

// ------------------------------------------------------------------ W3 Task 4: D16's wide rows
const WIDE_OF = (dir) => [
    path.join(dir, 'CLAUDE.md'), path.join(dir, 'CLAUDE.local.md'), path.join(dir, '.claude', 'CLAUDE.md'),
    path.join(dir, 'AGENTS.md'), path.join(dir, '.claude', 'AGENTS.md'), path.join(dir, '.claude', 'rules') + path.sep,
];
const putMcp = (dir, names) => fs.writeFileSync(path.join(dir, '.mcp.json'),
    `${JSON.stringify({ mcpServers: Object.fromEntries(names.map((n) => [n, { command: 'node', args: [`${n}.js`] }])) }, null, 2)}\n`);
// The root holds a generated rule and its seeded AGENTS.md, so F3 has rows for it.
const f3Root = (at, root = 'ws') =>
{
    const dir = at(root);
    fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'rules', 'alfred-agent-awareness.md'), '# generated\n');
    fs.writeFileSync(path.join(dir, '.claude', 'AGENTS.md'), '# seed\n');
    const seedHash = hashItem(path.join(dir, '.claude', 'AGENTS.md'));
    fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), `sha: x\nmanaged-env: \nmanaged-files: AGENTS.md=${seedHash}\n`);
    assert.ok(ws.ancestorExcludes(dir).length >= 2, 'F3 has rows for the root');
};
const legacyTree = () =>
{
    const at = tree({ ws: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['legacy/app'] } }, 'ws/legacy': {},
        'ws/legacy/app': { stamp: true, git: true } });
    f3Root(at);
    return at;
};

test('chainExcludes: an ignored project gets six names for each folder of the range', () =>
{
    const at = legacyTree();
    const anc = ws.stampedAncestors(at('ws/legacy/app'), { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual(ws.wideRange(anc), [at('ws/legacy'), at('ws')]);
    const got = ws.chainExcludes(anc, at('ws/legacy/app'), []);
    assert.deepStrictEqual([...got].sort(), [...WIDE_OF(at('ws/legacy')), ...WIDE_OF(at('ws'))].sort());
    assert.strictEqual(got.length, 12);
    assert.ok(!got.includes(path.join(at('ws'), '.claude', 'rules', 'alfred-agent-awareness.md')), 'none of the root\'s F3 rows');
    assert.ok(got.every((p) => !p.startsWith(`${at('ws/legacy/app')}${path.sep}`) && path.dirname(p) !== at()), 'none under the project, none under top');
    assert.deepStrictEqual(got.filter((p) => p.endsWith(path.sep)), [`${path.join(at('ws/legacy'), '.claude', 'rules')}${path.sep}`, `${path.join(at('ws'), '.claude', 'rules')}${path.sep}`]);
});

test('chainExcludes: a stamped folder below the ignored one keeps F3\'s rows', () =>
{
    const at = tree({ ws: { stamp: true, git: true, record: { role: 'root', ignoredChildren: ['mid'] } }, 'ws/mid': { stamp: true, git: true },
        'ws/mid/p': { stamp: true, git: true } });
    f3Root(at, 'ws/mid');
    const anc = ws.stampedAncestors(at('ws/mid/p'), { env: env0, exec: ownTop([]) });
    const f3 = ws.ancestorExcludes(at('ws/mid'), { childIgnores: [], nearer: [at('ws/mid/p')] });
    assert.ok(f3.length >= 2);
    assert.deepStrictEqual(ws.chainExcludes(anc, at('ws/mid/p'), []), [...f3, ...WIDE_OF(at('ws'))]);
});

test('chainExcludes: nothing ignored - the rows are today\'s', () =>
{
    const at = tree({ ws: { stamp: true, git: true, record: { role: 'root', children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } },
        'ws/solo': { stamp: true, git: true } });
    f3Root(at);
    const base = (anc, self, ignores) => anc.flatMap((root, i) => ws.ancestorExcludes(root, { childIgnores: ignores, nearer: [self, ...anc.slice(0, i)] }));
    for (const rel of ['ws/api', 'ws/solo'])
        for (const ignores of [[], [{ category: 'instructions', name: 'CLAUDE.md' }]])
        {
            const anc = ws.stampedAncestors(at(rel), { env: env0, exec: ownTop([]) });
            assert.deepStrictEqual(ws.wideRange(anc), []);
            assert.deepStrictEqual(ws.chainExcludes(anc, at(rel), ignores), base(anc, at(rel), ignores), rel);
        }
    assert.deepStrictEqual(ws.wideRange([]), []);
});

test('excludeGlobs: a folder becomes its path plus /**', () =>
{
    assert.deepStrictEqual(ws.excludeGlobs(['/w/.claude/rules/'], 'linux'), ['/w/.claude/rules/**']);
    assert.deepStrictEqual(ws.excludeGlobs(['/w/.claude/rules/'], 'darwin'), ['/[wW]/.[cC][lL][aA][uU][dD][eE]/[rR][uU][lL][eE][sS]/**']);
    assert.deepStrictEqual(ws.excludeGlobs(['C:\\w\\.claude\\rules\\'], 'win32'), ['[cC]:/[wW]/.[cC][lL][aA][uU][dD][eE]/[rR][uU][lL][eE][sS]/**']);
    assert.deepStrictEqual(ws.excludeGlobs(['/w/x(1).md'], 'linux'), ['/w/x[(]1[)].md'], 'a file path is as before');
    assert.deepStrictEqual(ws.excludeGlobs(['/w/a.md'], 'darwin'), ['/[wW]/[aA].[mM][dD]']);
});

test('mcpJsonIgnores: the range\'s servers less the project\'s own names', () =>
{
    const at = legacyTree();
    putMcp(at('ws'), ['rootsrv', 'both']);
    putMcp(at('ws/legacy'), ['mid']);
    putMcp(at('ws/legacy/app'), ['both']);
    const app = at('ws/legacy/app');
    const anc = ws.stampedAncestors(app, { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [], app).sort(), ['mid', 'rootsrv']);
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [{ category: 'mcp', name: 'rootsrv' }], app).sort(), ['mid', 'rootsrv'], 'no duplicate');
    fs.writeFileSync(path.join(at('ws/legacy'), '.mcp.json'), '{ not json');
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [], app), ['rootsrv'], 'a garbage file adds nothing');
    fs.unlinkSync(path.join(at('ws/legacy'), '.mcp.json'));
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [], app), ['rootsrv'], 'an absent file adds nothing');
});

test('mcpJsonIgnores: an unmarked project is as today', () =>
{
    const at = tree({ ws: { stamp: true, git: true, record: { role: 'root', children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    putMcp(at('ws'), ['rootsrv']);
    const anc = ws.stampedAncestors(at('ws/api'), { env: env0, exec: ownTop([]) });
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [], at('ws/api')), []);
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [{ category: 'mcp', name: 'rootsrv' }], at('ws/api')), ['rootsrv']);
    assert.deepStrictEqual(ws.mcpJsonIgnores(anc, [{ category: 'mcp', name: 'nobody-has-it' }], at('ws/api')), []);
});

// ------------------------------------------------------------------ W3 Task 7: the verb's refusals
const noGit = () => { throw new Error('not a git repository'); };
const SAME_REPO_LINE = (rel) => `${rel} is part of this folder's git repository, not a project of its own - it cannot be isolated: this repository's skills, agents and local settings reach it`;

test('markRefusal: each refusal and its sentence', () =>
{
    const at = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/legacy/app': { git: true }, 'ws/api': { stamp: true, git: true }, 'ws/api/tools': { git: true } });
    const root = at('ws');
    const own = { env: env0, exec: ownTop([]) };
    for (const rel of ['../x', '/abs', '.claude', '.claude/x', '.alfred/x', 'a/../b', ''])
        assert.strictEqual(ws.markRefusal(root, rel, own), `${rel} is not a project path below this folder`, rel);
    // another case: refused only where the disk folds case and so finds the folder under it
    const folds = fs.existsSync(path.join(root, 'Legacy', 'App'));
    assert.strictEqual(ws.markRefusal(root, 'Legacy/App', own), folds ? 'Legacy/App is legacy/app on disk - a mark names the real path' : null);
    assert.strictEqual(ws.markRefusal(root, 'legacy/app', { env: env0, exec: () => `${root}\n` }), SAME_REPO_LINE('legacy/app'));
    assert.strictEqual(ws.markRefusal(root, 'api/tools', own), 'api/tools is held by api - mark it in api');
});

test('markRefusal: a link is refused with its real path', (t) =>
{
    const at = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/legacy/app': { git: true } });
    try { fs.symlinkSync(path.join(at('ws'), 'legacy'), path.join(at('ws'), 'ln'), 'junction'); }
    catch { t.skip('no link can be made here'); return; }
    assert.strictEqual(ws.markRefusal(at('ws'), 'ln/app', { env: env0, exec: ownTop([]) }), 'ln/app is legacy/app on disk - a mark names the real path');
});

test('markRefusal: a project that is no checkout, under a root that is none, cannot be isolated', () =>
{
    const at = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/p': { stamp: true }, 'ws/plain': {} });
    assert.strictEqual(ws.markRefusal(at('ws'), 'p', { env: env0, exec: noGit }),
        "p is no git checkout of its own, and neither is this folder - it cannot be isolated: this folder's skills, agents and local settings reach it");
    assert.strictEqual(ws.markRefusal(at('ws'), 'plain', { env: env0, exec: noGit }), null, 'a plain folder that holds no install is marked');
});

test('markRefusal: taken', () =>
{
    const at = tree({ ws: { stamp: true, record: { role: 'root' } }, 'ws/apps/a': { stamp: true, git: true }, 'ws/apps/b': { stamp: true, git: true },
        'ws/mid': { stamp: true, git: true }, 'ws/mid/p': { stamp: true, git: true, record: { parent: '../..' } } });
    const own = { env: env0, exec: ownTop([]) };
    assert.strictEqual(ws.markRefusal(at('ws'), 'new/x', own), null, 'a path with no folder yet');
    assert.strictEqual(ws.markRefusal(at('ws'), 'apps', own), null, 'a plain folder holding two projects');
    assert.strictEqual(ws.markRefusal(at('ws'), 'mid/p', own), null, 'its record names the root while mid is stamped between');
});
