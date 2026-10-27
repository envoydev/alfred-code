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
    const at = tree({ 'ws': { stamp: true, file: 'child api\n' }, 'ws/api': { stamp: true, file: 'parent ..\n' } });
    fs.writeFileSync(path.join(at('ws'), '.alfred', '.variables'), 'ALFRED_CODE_SCORER=1\nALFRED_CODE_HISTORY=0\nALFRED_CODE_DOCS_VERSIONING=local\nALFRED_CODE_INSTRUMENT=1\n');
    return at;
};

test('chainValues reads the members\' .variables, never a MEMBER_NEVER key, and stops a key at an ignore env line', () =>
{
    const at = chainTree();
    assert.deepStrictEqual(ws.chainValues(at('ws/api'), { env: env0 }), { ALFRED_CODE_SCORER: '1', ALFRED_CODE_HISTORY: '0', ALFRED_CODE_INSTRUMENT: '1' });
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', 'workspace'), 'parent ..\nignore env ALFRED_CODE_SCORER\n');
    assert.ok(!Object.hasOwn(ws.chainValues(at('ws/api'), { env: env0 }), 'ALFRED_CODE_SCORER'));
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
    const at = tree({ 'home': {}, 'home/ws': { stamp: true, file: joined ? 'child api\n' : '' }, 'home/ws/api': { stamp: true, file: joined ? 'parent ..\n' : '' } });
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

test('releaseChildren leaves a listed child that names another parent as it was - its own lines kept, never named released', () =>
{
    // ws lists g/x, but x's parent line names g: a stale line in ws, and x is g's child.
    const at = tree({ 'home': {}, 'home/ws': { stamp: true, file: 'child g\nchild g/x\n' }, 'home/ws/g': { stamp: true, file: 'parent ..\nchild x\n' }, 'home/ws/g/x': { stamp: true, file: 'parent ..\n' } });
    markStamp(at('home/ws/g/x'), 'own-picks: skill/npm');
    markStamp(at('home/ws/g/x'), 'own-env: ALFRED_CODE_SCORER');
    const logs = [];
    const released = ws.releaseChildren({ projectRoot: at('home/ws'), env: {}, log: (l) => logs.push(l) });
    assert.deepStrictEqual(released, ['g']);
    const xStamp = fs.readFileSync(path.join(at('home/ws/g/x'), '.claude', 'alfred-code.stamp'), 'utf8');
    assert.match(xStamp, /^own-picks: skill\/npm$/m);
    assert.match(xStamp, /^own-env: ALFRED_CODE_SCORER$/m);
    assert.match(fs.readFileSync(path.join(at('home/ws/g/x'), '.alfred', 'workspace'), 'utf8'), /^parent \.\.$/m);
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
// { rel: { stamp, git, file, vars } } under a fresh folder; returns rel -> real path.
const roleTree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 'r-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) run('git', ['init', '-q'], { cwd: dir });
        if (o.stamp) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), typeof o.stamp === 'string' ? o.stamp : 'sha: x\n'); }
        if (o.file !== undefined || o.vars !== undefined) fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        if (o.file !== undefined) fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), o.file);
        if (o.vars !== undefined) fs.writeFileSync(path.join(dir, '.alfred', '.variables'), o.vars);
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const asked = (root, when, env = ON) => { const a = ws.roleAsk(root, { env, when }); return a && { case: a.case, rel: a.rel, options: a.options }; };

test('AC1: the file round-trips role root, role standalone, above .. and above none; parent none reads as role standalone and is rewritten; wsLine and parseLine agree on every kind', () =>
{
    for (const text of ['role root\nabove ..\nchild api\n', 'role standalone\nabove none\nignore skill x\n', 'parent ..\nabove ../..\n'])
        assert.strictEqual(ws.renderWorkspace(ws.parseWorkspace(text)), text);
    const v = ws.viewOf(ws.parseWorkspace('role root\nabove ..\nchild api\n'));
    assert.deepStrictEqual([v.role, v.above, v.children], ['root', '..', ['api']]);
    const s = ws.viewOf(ws.parseWorkspace('role standalone\nabove none\n'));
    assert.deepStrictEqual([s.role, s.above], ['standalone', 'none']);
    assert.deepStrictEqual(ws.viewOf(ws.parseWorkspace('role child\nabove x\nrole\n')).unknown, ['role child', 'above x', 'role'], 'only the two roles and a run of .. or none');
    const root = project('parent none\nignore skill x\n');
    assert.strictEqual(ws.readWorkspace(root, { env: {} }).view.role, 'standalone');
    assert.ok(ws.writeWorkspace(root, (m) => ws.addIgnore(m, 'skill', 'y'), { env: {} }).wrote);
    assert.strictEqual(fs.readFileSync(fileOf(root), 'utf8'), 'role standalone\nignore skill x\nignore skill y\n', 'rewritten at the next write');
    const lines = ['role root', 'role standalone', 'role child', 'role', 'above ..', 'above ../..', 'above none', 'above x', 'above /abs',
        'parent ..', 'parent none', 'parent x', 'child api', 'child ../a', 'ignore skill x', 'ignore colour x', 'ignore docs root', '# c', '', 'colour red'];
    for (const line of lines)
    {
        const a = ws.parseLine(line);
        const b = layoutLib.wsLine(line);
        assert.strictEqual(b.kind, a.kind, line);
        assert.strictEqual(b.value, a.value, line);
    }
});

test('roleOf: child of .., root of 2 children, a root with no child, standalone, and standalone not asked', () =>
{
    const at = roleTree({
        ws: { stamp: true, file: 'child api\nchild web\n' }, 'ws/api': { stamp: true, git: true, file: 'parent ..\n' }, 'ws/web': { stamp: true, git: true, file: 'parent ..\n' },
        solo: { stamp: true, git: true, file: 'role root\nabove none\n' }, alone: { stamp: true, git: true, file: 'role standalone\nabove none\n' }, fresh: { stamp: true, git: true },
    });
    assert.deepStrictEqual(ws.roleOf(at('ws/api'), { env: ON }), { kind: 'child', rel: '..', children: 0, asked: true });
    assert.deepStrictEqual(ws.roleOf(at('ws'), { env: ON }), { kind: 'root', children: 2, asked: false });
    assert.deepStrictEqual(ws.roleOf(at('solo'), { env: ON }), { kind: 'root', children: 0, asked: true });
    assert.deepStrictEqual(ws.roleOf(at('alone'), { env: ON }), { kind: 'standalone', asked: true });
    assert.deepStrictEqual(ws.roleOf(at('fresh'), { env: ON }), { kind: 'standalone', asked: false });
    assert.strictEqual(ws.roleText(ws.roleOf(at('ws'), { env: ON })), 'root of 2 children');
    assert.strictEqual(ws.roleText(ws.roleOf(at('ws/api'), { env: ON })), 'child of ..');
    assert.strictEqual(ws.roleText(ws.roleOf(at('fresh'), { env: ON })), 'standalone (not asked)');
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
        ws: { stamp: true, file: 'child mid/deep\n' }, 'ws/alone': { stamp: true, git: true, file: 'role standalone\nabove none\n' },
        'ws/fresh': { stamp: true, git: true }, 'ws/lost': { stamp: true, git: true, file: 'parent ..\n' },
        'ws/mid': { stamp: true }, 'ws/mid/deep': { stamp: true, git: true, file: 'parent ../..\nabove ../..\n' },
        gone: {}, 'gone/kid': { stamp: true, git: true, file: 'parent ..\n' },
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
        ws: { stamp: true, file: 'child kid\n' }, 'ws/kid': { stamp: true, git: true, file: 'parent ..\n' },
        'ws/alone': { stamp: true, git: true, file: 'role standalone\nabove ..\n' }, 'ws/boss': { stamp: true, git: true, file: 'role root\nabove ..\n' },
    });
    assert.deepStrictEqual(asked(at('ws/alone'), 'configure').options, ['Keep (Recommended)', 'Join ..', 'Become a root']);
    assert.deepStrictEqual(asked(at('ws/boss'), 'configure').options, ['Keep (Recommended)', 'Join ..', 'Become standalone']);
    assert.deepStrictEqual(asked(at('ws/kid'), 'configure').options, ['Keep (Recommended)', 'Leave and become standalone', 'Leave and become a root']);
    assert.deepStrictEqual(asked(at('ws'), 'configure').options, ['Keep (Recommended)', 'Become standalone'], 'nothing above to join');
});

// D5's join and leave: a joiner's stack seeds leave its own file (they would beat the members); what it typed stays.
test('pruneOnJoin drops each key still at its ledger hash, keeps a typed or changed one, never DOCS_VERSIONING, and names the count kept', () =>
{
    const H = stampLib.valueHash;
    const stampText = `sha: x\nmanaged-env: .variables:ALFRED_CODE_SCORER_LEVEL=${H('80')},.variables:ALFRED_CODE_HISTORY=${H('5')},.variables:ALFRED_CODE_DOCS_VERSIONING=${H('git')},settings.json:ALFRED_CODE_DATA_PATH=${H('.alfred')}\n`;
    const at = roleTree({ p: { stamp: stampText, git: true, vars: '# mine\nALFRED_CODE_SCORER_LEVEL=80\nALFRED_CODE_HISTORY=9\nALFRED_CODE_DOCS_VERSIONING=git\nALFRED_CODE_CORRECTION_NUDGE=inject\n' } });
    const lines = [];
    const got = ws.pruneOnJoin(at('p'), { env: ON, log: (l) => lines.push(l) });
    assert.deepStrictEqual(got, { dropped: ['ALFRED_CODE_SCORER_LEVEL'], own: ['ALFRED_CODE_HISTORY', 'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_CORRECTION_NUDGE'] });
    assert.strictEqual(fs.readFileSync(path.join(at('p'), '.alfred', '.variables'), 'utf8'), '# mine\nALFRED_CODE_HISTORY=9\nALFRED_CODE_DOCS_VERSIONING=git\nALFRED_CODE_CORRECTION_NUDGE=inject\n');
    const ledger = stampLib.readLedger(path.join(at('p'), '.claude', 'alfred-code.stamp'));
    assert.deepStrictEqual(Object.keys(ledger.env['.variables']).sort(), ['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_HISTORY'], 'the dropped key\'s row goes with it');
    assert.deepStrictEqual(lines, ['workspace: 3 of this project\'s values kept as its own (ALFRED_CODE_HISTORY, ALFRED_CODE_DOCS_VERSIONING, ALFRED_CODE_CORRECTION_NUDGE) - 1 stack seed dropped, so the workspace\'s value reaches it']);
});

test('pruneOnJoin keeps an installer answer off the catalog default (--auto-compact on) as the project\'s own, though it sits at its ledger hash (D5)', () =>
{
    const H = stampLib.valueHash;
    const stampText = `sha: x\nmanaged-env: .variables:ALFRED_CODE_AUTO_COMPACT=${H('1')},.variables:ALFRED_CODE_HISTORY=${H('3')}\n`;
    const at = roleTree({ p: { stamp: stampText, git: true, vars: 'ALFRED_CODE_AUTO_COMPACT=1\nALFRED_CODE_HISTORY=3\n' } });
    const got = ws.pruneOnJoin(at('p'), { env: ON, log: () => {} });
    assert.deepStrictEqual(got, { dropped: ['ALFRED_CODE_HISTORY'], own: ['ALFRED_CODE_AUTO_COMPACT'] });
    assert.strictEqual(fs.readFileSync(path.join(at('p'), '.alfred', '.variables'), 'utf8'), 'ALFRED_CODE_AUTO_COMPACT=1\n');
});

test('keepOnLeave writes each value read through the chain into the child\'s file, a seed with its ledger row; with the parent gone it names the keys that read their defaults', () =>
{
    const H = stampLib.valueHash;
    const at = roleTree({
        ws: { stamp: `sha: x\nmanaged-env: .variables:ALFRED_CODE_HISTORY=${H('5')}\n`, file: 'child api\n', vars: 'ALFRED_CODE_SCORER_LEVEL=90\nALFRED_CODE_HISTORY=5\n' },
        'ws/api': { stamp: 'sha: x\nmanaged-env: \n', git: true, file: 'parent ..\n', vars: 'ALFRED_CODE_CORRECTION_NUDGE=inject\n' },
    });
    const before = layoutLib.variablesOf(at('ws/api'), { env: { ...ON } }).values;
    const got = ws.keepOnLeave(at('ws/api'), { env: ON, log: () => {} });
    assert.deepStrictEqual(got.written.sort(), ['ALFRED_CODE_HISTORY', 'ALFRED_CODE_SCORER_LEVEL']);
    assert.deepStrictEqual(got.defaults, []);
    assert.strictEqual(fs.readFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'utf8'), 'ALFRED_CODE_CORRECTION_NUDGE=inject\nALFRED_CODE_SCORER_LEVEL=90\nALFRED_CODE_HISTORY=5\n');
    const ledger = stampLib.readLedger(path.join(at('ws/api'), '.claude', 'alfred-code.stamp'));
    assert.deepStrictEqual(ledger.env['.variables'], { ALFRED_CODE_HISTORY: H('5') }, 'the root\'s seed stays a seed; its typed 90 is the child\'s own now');
    const own = { ...ON, ALFRED_CODE_WORKSPACE: '0' };
    assert.deepStrictEqual(layoutLib.variablesOf(at('ws/api'), { env: own }).values.ALFRED_CODE_SCORER_LEVEL, before.ALFRED_CODE_SCORER_LEVEL, 'the value reads the same with the chain cut');

    const gone = roleTree({ kid: { stamp: 'sha: x\n', git: true, file: 'parent ..\n', vars: 'ALFRED_CODE_DOCS_VERSIONING=git\n' } });
    const lines = [];
    const g = ws.keepOnLeave(gone('kid'), { env: ON, log: (l) => lines.push(l) });
    assert.deepStrictEqual(g.written, []);
    assert.ok(g.defaults.includes('ALFRED_CODE_SCORER_LEVEL') && !g.defaults.includes('ALFRED_CODE_DOCS_VERSIONING') && !g.defaults.includes('ALFRED_CODE_WORKSPACE'), g.defaults.join(','));
    assert.match(lines.join('\n'), /^workspace: \.\. is gone - \d+ values read the stack's defaults here now \(ALFRED_CODE_/m);
});

test('releaseChildren writes each value a child read from the parent into the child\'s file before its parent line goes (D5)', () =>
{
    const at = roleTree({
        ws: { stamp: 'sha: x\nmanaged-env: \n', file: 'child api\n', vars: 'ALFRED_CODE_SCORER_LEVEL=90\nALFRED_CODE_HISTORY=5\n' },
        'ws/api': { stamp: 'sha: x\nmanaged-env: \n', git: true, file: 'parent ..\n', vars: 'ALFRED_CODE_CORRECTION_NUDGE=inject\n' },
    });
    const before = layoutLib.variablesOf(at('ws/api'), { env: ON }).values;
    const logs = [];
    assert.deepStrictEqual(ws.releaseChildren({ projectRoot: at('ws'), env: ON, log: (l) => logs.push(l) }), ['api']);
    assert.strictEqual(fs.readFileSync(path.join(at('ws/api'), '.alfred', 'workspace'), 'utf8'), '');
    assert.strictEqual(fs.readFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'utf8'), 'ALFRED_CODE_CORRECTION_NUDGE=inject\nALFRED_CODE_SCORER_LEVEL=90\nALFRED_CODE_HISTORY=5\n');
    assert.deepStrictEqual(layoutLib.variablesOf(at('ws/api'), { env: ON }).values, before, 'every value reads the same once released');
    assert.match(logs.join('\n'), /^workspace: api: 2 values this project read from the workspace written into \.alfred\/\.variables/m);
});
