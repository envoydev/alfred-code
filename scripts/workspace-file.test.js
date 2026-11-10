'use strict';
// stack/hooks/workspace-file.js - the one reader of a project's workspace record, `<data root>/workspace.json`, with the
// old line file `<data root>/workspace` read until the support floor (spec: the workspace.json design, 2026-11-10).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wf = require('../stack/hooks/workspace-file.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-file-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
// A data-root folder holding `json` as workspace.json and `legacy` as the old file, each only when given.
const dirWith = ({ json, legacy } = {}) =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'd-'));
    if (json !== undefined) fs.writeFileSync(path.join(dir, 'workspace.json'), typeof json === 'string' ? json : JSON.stringify(json, null, 2));
    if (legacy !== undefined) fs.writeFileSync(path.join(dir, 'workspace'), legacy);
    return dir;
};
const keysOf = (r) => r.invalid.map((i) => i.key);

test('readRecord: absent - neither file', () =>
{
    const r = wf.readRecord(dirWith());
    assert.strictEqual(r.state, 'absent');
    assert.strictEqual(r.source, null);
    assert.ok(r.file.endsWith('workspace.json'));
    assert.deepStrictEqual(r.record, wf.emptyRecord());
    assert.strictEqual(r.text, null);
});

test('readRecord: a JSON record reads each key; an absent key is empty', () =>
{
    const r = wf.readRecord(dirWith({ json: { parent: '..', above: 'none', children: ['api', 'web/admin'], ignore: { skill: ['dotnet-build'], memory: ['root'] } } }));
    assert.strictEqual(r.state, 'ok');
    assert.strictEqual(r.source, 'json');
    assert.strictEqual(r.record.parent, '..');
    assert.strictEqual(r.record.role, null);
    assert.strictEqual(r.record.above, 'none');
    assert.deepStrictEqual(r.record.children, ['api', 'web/admin']);
    assert.deepStrictEqual(r.record.ignore, { skill: ['dotnet-build'], memory: ['root'] });
    assert.strictEqual(r.record.parentNone, false);
    assert.deepStrictEqual(r.problems, []);
    const bare = wf.readRecord(dirWith({ json: { role: 'root' } }));
    assert.strictEqual(bare.record.role, 'root');
    assert.deepStrictEqual(bare.record.children, []);
    assert.deepStrictEqual(bare.record.ignore, {});
    assert.strictEqual(bare.record.above, null);
});

test('readRecord: the old file reads by the line-to-key table, row by row', () =>
{
    const read = (line) => wf.readRecord(dirWith({ legacy: `${line}\n` }));
    assert.strictEqual(read('parent ../..').record.parent, '../..');
    const none = read('parent none');
    assert.strictEqual(none.record.role, 'standalone');
    assert.strictEqual(none.record.parentNone, true);
    assert.strictEqual(none.record.parent, null);
    assert.strictEqual(read('role root').record.role, 'root');
    assert.strictEqual(read('above none').record.above, 'none');
    assert.deepStrictEqual(read('child web/admin').record.children, ['web/admin']);
    assert.deepStrictEqual(read('ignore skill dotnet-build').record.ignore, { skill: ['dotnet-build'] });
    const r = read('child api');
    assert.strictEqual(r.state, 'ok');
    assert.strictEqual(r.source, 'legacy');
    assert.ok(r.file.endsWith(`${path.sep}workspace`));
    assert.strictEqual(r.text, null);
});

test('readRecord: both files - the union, the JSON first, parent over role', () =>
{
    const r = wf.readRecord(dirWith({ json: { children: ['api'] }, legacy: 'parent ..\nchild web\nchild api\n' }));
    assert.strictEqual(r.source, 'both');
    assert.strictEqual(r.state, 'ok');
    assert.ok(r.file.endsWith('workspace.json'));
    assert.strictEqual(r.record.parent, '..');
    assert.deepStrictEqual(r.record.children, ['api', 'web']);
    const role = wf.readRecord(dirWith({ json: { role: 'root' }, legacy: 'parent ..\n' }));
    assert.strictEqual(role.record.parent, '..');
    assert.strictEqual(role.record.role, null);
    assert.ok(role.problems.some((p) => /role 'root' dropped - parent is set/.test(p)), role.problems.join('\n'));
    const own = wf.readRecord(dirWith({ json: { parent: '../..' }, legacy: 'parent ..\n' }));
    assert.strictEqual(own.record.parent, '../..', "the JSON's value wins a scalar both files hold");
});

test('readRecord: garbage - not JSON, an array, null - and the old file is not consulted', () =>
{
    for (const json of ['{', '[1]', 'null', '"x"', '\uFEFF{"parent": ']) {
        const r = wf.readRecord(dirWith({ json, legacy: 'parent ..\n' }));
        assert.strictEqual(r.state, 'garbage', json);
        assert.deepStrictEqual(r.record, wf.emptyRecord(), json);
        assert.ok(r.file.endsWith('workspace.json'), json);
        assert.strictEqual(r.text, json, json);
    }
});

test('readRecord: an empty workspace.json - 0 bytes, whitespace, a lone BOM - is an empty record, not garbage', () =>
{
    for (const json of ['', '  \n', '\uFEFF', '\uFEFF\r\n']) {
        const r = wf.readRecord(dirWith({ json }));
        assert.strictEqual(r.state, 'ok', JSON.stringify(json));
        assert.strictEqual(r.source, 'json');
        assert.deepStrictEqual(r.record, wf.emptyRecord());
    }
    const both = wf.readRecord(dirWith({ json: '', legacy: '' }));
    assert.strictEqual(both.state, 'ok');
    assert.strictEqual(both.source, 'both');
    assert.deepStrictEqual(both.record, wf.emptyRecord());
});

test('readRecord: a BOM on either file, CRLF in the old file', () =>
{
    const text = '\uFEFF{\r\n    "parent": "..",\r\n    "children": ["api"]\r\n}\r\n';
    const json = wf.readRecord(dirWith({ json: text }));
    assert.strictEqual(json.record.parent, '..');
    assert.deepStrictEqual(json.record.children, ['api']);
    assert.strictEqual(json.text, text, 'text keeps the BOM and the line ends as read');
    const legacy = wf.readRecord(dirWith({ legacy: '\uFEFFparent ../..  \r\nchild api\t\r\nignore skill x \r\n' }));
    assert.strictEqual(legacy.record.parent, '../..');
    assert.deepStrictEqual(legacy.record.children, ['api']);
    assert.deepStrictEqual(legacy.record.ignore, { skill: ['x'] });
    assert.deepStrictEqual(legacy.problems, []);
});

test('readRecord: an invalid value is dropped, named and kept in invalid', () =>
{
    const r = wf.readRecord(dirWith({ json: { parent: 'up', children: ['../x', 'C:/x', 'a\\b', 7, 'ok'], ignore: { skill: ['bad name', 'fine'], colour: ['x'] } } }));
    assert.strictEqual(r.state, 'ok');
    assert.strictEqual(r.record.parent, null);
    assert.deepStrictEqual(r.record.children, ['ok']);
    assert.deepStrictEqual(r.record.ignore, { skill: ['fine'] });
    assert.deepStrictEqual(keysOf(r), ['parent', 'children', 'children', 'children', 'children', 'ignore.skill', 'ignore.colour']);
    assert.deepStrictEqual(r.invalid.map((i) => i.value), ['up', '../x', 'C:/x', 'a\\b', 7, 'bad name', ['x']]);
    assert.strictEqual(r.problems.length, 7, r.problems.join('\n'));
    assert.ok(r.problems.includes("invalid child '../x' kept, not applied"), r.problems.join('\n'));
    const docs = wf.readRecord(dirWith({ json: { ignore: { docs: ['other', 'root'], doc: ['a/../b', 'a/b'] } } }));
    assert.deepStrictEqual(docs.record.ignore, { docs: ['root'], doc: ['a/b'] }, 'only docs root is a docs form, and a doc name has no .. segment');
    assert.deepStrictEqual(keysOf(docs), ['ignore.docs', 'ignore.doc']);
});

test('readRecord: a wrong-typed key is invalid as a whole', () =>
{
    const cases = [
        [{ children: 'api' }, 'children', 'api'],
        [{ ignore: [] }, 'ignore', []],
        [{ ignore: { skill: 'x' } }, 'ignore.skill', 'x'],
        [{ role: 'boss' }, 'role', 'boss'],
        [{ above: 3 }, 'above', 3],
    ];
    for (const [json, key, value] of cases) {
        const r = wf.readRecord(dirWith({ json }));
        assert.strictEqual(r.state, 'ok', key);
        assert.deepStrictEqual(r.record, wf.emptyRecord(), key);
        assert.deepStrictEqual(r.invalid, [{ key, value }], key);
        assert.strictEqual(r.problems.length, 1, key);
    }
});

test('readRecord: an unknown key is kept and named', () =>
{
    const r = wf.readRecord(dirWith({ json: { colour: 'red', parent: '..' } }));
    assert.deepStrictEqual(r.unknown, { colour: 'red' });
    assert.deepStrictEqual(r.problems, ["unknown key 'colour' kept"]);
    assert.strictEqual(r.record.parent, '..');
});

test('parseLegacy: a repeated entry keeps its first spelling; a second different parent line is named', () =>
{
    const { record, problems } = wf.parseLegacy('parent ..\nchild api\nchild api\nignore skill x\nignore skill x\nparent ..\n');
    assert.strictEqual(record.parent, '..');
    assert.deepStrictEqual(record.children, ['api']);
    assert.deepStrictEqual(record.ignore, { skill: ['x'] });
    assert.deepStrictEqual(problems, []);
    const second = wf.parseLegacy('parent none\nparent ..\n');
    assert.strictEqual(second.record.parentNone, true);
    assert.strictEqual(second.record.parent, null);
    assert.strictEqual(second.problems.length, 1);
    assert.ok(/'parent \.\.'/.test(second.problems[0]), second.problems[0]);
});

test('parseLegacy: R062 - a child holding a double space or a tab; the separator run after the keyword is not part of the name', () =>
{
    const { record } = wf.parseLegacy('child a  b\nchild a\tb\nchild x/a  b\nchild   api\n');
    assert.deepStrictEqual(record.children, ['a  b', 'a\tb', 'x/a  b', 'api']);
});

test('parseLegacy: parent none beside a role line reads the role', () =>
{
    for (const text of ['parent none\nrole root\n', 'role root\nparent none\n']) {
        const { record } = wf.parseLegacy(text);
        assert.strictEqual(record.role, 'root', text);
        assert.strictEqual(record.parentNone, true, text);
    }
});

test('parseLegacy: a comment and an unknown line are named as not carried', () =>
{
    const { record, problems } = wf.parseLegacy('# note\nparent ..\ncolour red\nchild ../a\n\n');
    assert.strictEqual(record.parent, '..');
    assert.deepStrictEqual(record.children, []);
    assert.deepStrictEqual(problems, [
        "comment '# note' not carried into workspace.json",
        "line 'colour red' not carried into workspace.json",
        "line 'child ../a' not carried into workspace.json",
    ]);
});

test('renderRecord: key order, empty keys out, invalid back in its key, unknown keys last, parentNone never written', () =>
{
    const record = { ...wf.emptyRecord(), parent: '..', above: 'none', children: ['api'], ignore: { skill: ['x'], hook: [] }, parentNone: true };
    const out = wf.renderRecord(record, { colour: 'red' }, [{ key: 'children', value: '../x', entry: true }, { key: 'ignore.skill', value: 'bad name', entry: true }, { key: 'ignore.colour', value: ['y'], entry: true }]);
    assert.deepStrictEqual(Object.keys(out), ['parent', 'above', 'children', 'ignore', 'colour']);
    assert.deepStrictEqual(out.children, ['api', '../x']);
    assert.deepStrictEqual(out.ignore, { skill: ['x', 'bad name'], colour: ['y'] });
    assert.strictEqual(out.colour, 'red');
    assert.ok(!('parentNone' in out));
    assert.deepStrictEqual(Object.keys(wf.renderRecord({ ...wf.emptyRecord(), role: 'standalone', parentNone: true })), ['role']);
    assert.deepStrictEqual(wf.renderRecord(wf.emptyRecord()), {});
    // the reader's own invalid list round-trips: what it read comes back out in the same place
    const read = wf.readRecord(dirWith({ json: { parent: '..', children: ['api', '../x'], ignore: { skill: ['bad name'] } } }));
    assert.deepStrictEqual(wf.renderRecord(read.record, read.unknown, read.invalid), { parent: '..', children: ['api', '../x'], ignore: { skill: ['bad name'] } });
});

test('renderRecord: a scalar or wrong-typed invalid value is written back as read while the record holds no value for its key, and left out once it does', () =>
{
    const empty = wf.emptyRecord();
    assert.deepStrictEqual(wf.renderRecord(empty, {}, [{ key: 'parent', value: '/abs' }]), { parent: '/abs' });
    assert.deepStrictEqual(wf.renderRecord({ ...empty, parent: '..' }, {}, [{ key: 'parent', value: '/abs' }]), { parent: '..' });
    assert.deepStrictEqual(wf.renderRecord(empty, {}, [{ key: 'children', value: 'api' }]), { children: 'api' });
    assert.deepStrictEqual(wf.renderRecord({ ...empty, children: ['web'] }, {}, [{ key: 'children', value: 'api' }]), { children: ['web'] });
    assert.deepStrictEqual(wf.renderRecord(empty, {}, [{ key: 'ignore', value: [] }]), { ignore: [] });
    assert.deepStrictEqual(wf.renderRecord({ ...empty, ignore: { skill: ['x'] } }, {}, [{ key: 'ignore', value: [] }]), { ignore: { skill: ['x'] } });
    assert.deepStrictEqual(wf.renderRecord(empty, {}, [{ key: 'ignore.skill', value: 'x' }]), { ignore: { skill: 'x' } });
    assert.deepStrictEqual(wf.renderRecord({ ...empty, ignore: { skill: ['y'] } }, {}, [{ key: 'ignore.skill', value: 'x' }]), { ignore: { skill: ['y'] } });
    assert.deepStrictEqual(wf.renderRecord(empty, {}, [{ key: 'role', value: 'boss' }]), { role: 'boss' });
    assert.deepStrictEqual(wf.renderRecord({ ...empty, parent: '..' }, {}, [{ key: 'role', value: 'boss' }]), { parent: '..' }, 'a parent excludes any role');
});

test('viewOf: the installer view of a record', () =>
{
    const view = wf.viewOf({ ...wf.emptyRecord(), parent: '..', children: ['api'], ignore: { docs: ['root'], skill: ['a', 'b'] } });
    assert.deepStrictEqual(view, {
        parent: '..', parentNone: false, role: null, above: null, children: ['api'],
        ignores: [{ category: 'docs', name: 'root' }, { category: 'skill', name: 'a' }, { category: 'skill', name: 'b' }],
    });
});

test('validators: isChildPath and isIgnoreEntry', () =>
{
    assert.ok(wf.isChildPath('web/admin'));
    for (const bad of ['', '/abs', '../x', 'a/./b', 'C:/x', 'a\\b', 7, 'a//b']) assert.ok(!wf.isChildPath(bad), String(bad));
    assert.ok(wf.isIgnoreEntry('docs', 'root'));
    assert.ok(wf.isIgnoreEntry('memory', 'root'));
    assert.ok(!wf.isIgnoreEntry('docs', 'other'));
    assert.ok(wf.isIgnoreEntry('instructions', '.claude/AGENTS.md'));
    assert.ok(!wf.isIgnoreEntry('skill', 'a/b'));
    assert.ok(!wf.isIgnoreEntry('colour', 'x'));
    assert.ok(Object.isFrozen(wf.CATEGORIES));
    assert.strictEqual(wf.JSON_NAME, 'workspace.json');
    assert.strictEqual(wf.LEGACY_NAME, 'workspace');
    assert.strictEqual(wf.LOCK_NAME, 'workspace.lock');
});

test("workspace-file.js requires only Node's own modules", () =>
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'workspace-file.js'), 'utf8');
    const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    assert.ok(reqs.length > 0);
    for (const r of reqs) assert.ok(/^(?:node:)?(?:fs|path|os)$/.test(r), r);
});

test('workspace-fixture: putWorkspace then readWorkspaceRecord round-trips a record in each format', () =>
{
    const fx = require('./workspace-fixture.js');
    const record = { parent: '../..', above: 'none', children: ['api', 'web/admin'], ignore: { skill: ['x'], docs: ['root'] } };
    for (const legacy of [true, false])
    {
        const root = fs.mkdtempSync(path.join(TMP, 'fx-'));
        const written = fx.putWorkspace(root, record, { legacy });
        assert.ok(written.endsWith(legacy ? `${path.sep}workspace` : 'workspace.json'), written);
        const back = fx.readWorkspaceRecord(root);
        assert.strictEqual(back.source, legacy ? 'legacy' : 'json');
        assert.strictEqual(back.record.parent, '../..');
        assert.strictEqual(back.record.above, 'none');
        assert.deepStrictEqual(back.record.children, ['api', 'web/admin']);
        assert.deepStrictEqual(back.record.ignore, { skill: ['x'], docs: ['root'] });
        assert.strictEqual(typeof back.text, 'string');
    }
    const roles = fs.mkdtempSync(path.join(TMP, 'fx-'));
    fx.putWorkspace(roles, { role: 'standalone' }, { legacy: true, dataRoot: '.data' });
    assert.strictEqual(fs.readFileSync(path.join(roles, '.data', 'workspace'), 'utf8'), 'role standalone\n');
    assert.strictEqual(fx.readWorkspaceRecord(roles, { dataRoot: '.data' }).record.role, 'standalone');
    const none = fs.mkdtempSync(path.join(TMP, 'fx-'));
    fx.putWorkspace(none, { parentNone: true }, { legacy: true });
    assert.strictEqual(fs.readFileSync(path.join(none, '.alfred', 'workspace'), 'utf8'), 'parent none\n', 'the 2.11 spelling stays writable for the tests that read it');
    assert.strictEqual(fx.LEGACY_DEFAULT, true);
});
