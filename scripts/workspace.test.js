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
