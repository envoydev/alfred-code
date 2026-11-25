'use strict';
// The root's installer side of the keep: the records read for what a root keeps for set-aside children, the rows it sets aside,
// and the write-back after the run's lock is released. Real folders in a temp tree; no installer run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childKeep = require('./install/child-keep.js');
const { putWorkspace, readWorkspaceValues } = require('./workspace-fixture.js');

const ENV = { CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'child-keep-no-account'), ALFRED_CODE_WORKSPACE: '1' };
const stampAt = (dir, lines = '') => { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), lines); };

// root with api (set aside) and web (included); api holds tool (set aside by api).
function tree()
{
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'child-keep-')));
    for (const rel of ['.', 'api', 'web', 'api/tool']) stampAt(path.join(root, rel), rel === 'api' ? 'own-picks: skill/mine\n' : '');
    putWorkspace(root, { children: ['api', 'web'], includedChildren: ['web'], includeAsked: ['api', 'web'], keptFor: { api: ['skill a', 'skill b', 'skill old'], web: ['skill w'] } });
    putWorkspace(path.join(root, 'api'), { parent: '..', children: ['tool'], includeAsked: ['tool'], ignore: { skill: ['b'] }, keptFor: { tool: ['skill t', 'skill mine'] } });
    putWorkspace(path.join(root, 'web'), { parent: '..' });
    putWorkspace(path.join(root, 'api', 'tool'), { parent: '..' });
    return root;
}
const read = (root, over = {}) => childKeep.readKeep({ projectRoot: root, env: ENV, ownLines: ['skill w'], priorOwn: null, renamed: { skills: { old: 'new' } }, retired: {}, ...over });

test('readKeep reads the top and a middle root: the store lines of both, a rename read, and a line the child ignores or its root holds dropped', () =>
{
    const root = tree();
    try
    {
        const got = read(root);
        assert.deepStrictEqual(got.storeLines, ['skill a', 'skill new', 'skill t']);
        assert.deepStrictEqual(got.notes, ['kept line skill old read as skill new']);
        assert.deepStrictEqual(got.rewrite.map((entry) => [path.relative(root, entry.root), entry.keptFor]),
            [['', { api: ['skill a', 'skill new'] }], ['api', { tool: ['skill t'] }]]);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('readKeep adds the backstop for each set-aside child that does not ignore the drop, and never for an included one', () =>
{
    const root = tree();
    try
    {
        const got = read(root, { priorOwn: ['skill c', 'skill b', 'skill gone', 'skill w'], ownLines: ['skill w'], retired: { skills: ['gone'] } });
        assert.deepStrictEqual(got.rewrite[0].keptFor, { api: ['skill a', 'skill new', 'skill c'] }, 'b is ignored by api, gone is retired, w is still held, web is included');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('readKeep drops an entry whose child left the workspace and writes the record, whatever else it holds', () =>
{
    const root = tree();
    try
    {
        putWorkspace(root, { children: ['api', 'web'], includedChildren: ['web'], includeAsked: ['api', 'web'], keptFor: { api: ['skill a'], gone: ['skill z'] } });
        const got = read(root);
        assert.deepStrictEqual(got.rewrite[0].keptFor, { api: ['skill a'] });
        assert.deepStrictEqual(got.storeLines, ['skill a', 'skill t']);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('readKeep keeps once more a line the last stamp kept that no record holds, and ignores one a record holds or a child ignores', () =>
{
    const root = tree();
    try
    {
        const got = read(root, { priorKept: ['skill orphan', 'skill a', 'skill b'] });
        assert.deepStrictEqual(got.rewrite[0].keptFor, { api: ['skill a', 'skill new', 'skill orphan'] }, 'a is in the record, b is ignored by api');
        const none = read(root, { priorKept: ['skill a'] });
        assert.deepStrictEqual(none.rewrite[0].keptFor, { api: ['skill a', 'skill new'] });
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('asideRows names the rows a record sets aside and the rows below them', () =>
{
    const root = tree();
    try { assert.deepStrictEqual([...childKeep.asideRows(root, { env: ENV, dataRoot: '.alfred' })].sort(), ['api', 'api/tool']); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writeBack writes the new kept lines, and names a record whose lock is refused', () =>
{
    const root = tree();
    try
    {
        const lines = [];
        const rewrite = [{ root, keptFor: { api: ['skill a'] } }, { root: path.join(root, 'api'), keptFor: {} }];
        fs.writeFileSync(path.join(root, 'api', '.alfred', 'workspace.lock'), String(process.pid));
        childKeep.writeBack(rewrite, { top: root, log: (line) => lines.push(line) });
        assert.deepStrictEqual(readWorkspaceValues(root).keptFor, { api: ['skill a'] });
        assert.deepStrictEqual(readWorkspaceValues(path.join(root, 'api')).keptFor, { tool: ['skill t', 'skill mine'] }, 'the refused write left the record');
        assert.strictEqual(lines.filter((line) => /^  !! workspace: the kept lines of api were not written \(locked\)/.test(line)).length, 1, lines.join('\n'));
        assert.strictEqual(lines.filter((line) => line === '  kept lines of . rewritten: api keeps skill a').length, 1, 'the write that went through is named once');
        assert.ok(!lines.some((line) => /kept lines of api rewritten/.test(line)), 'a refused write is not named as a rewrite');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('settleLines reads the keep when the lock state says a record was read, and carries the stamp keep as it was when none was', () =>
{
    const root = tree();
    try
    {
        const readArgs = { projectRoot: root, env: ENV, ownLines: ['skill w'], priorOwn: null, renamed: {}, retired: {} };
        const read = childKeep.settleLines({ locked: true, lines: ['skill m'], priorOnly: [], readArgs });
        assert.deepStrictEqual(read.keptStore, ['skill a', 'skill old', 'skill t']);
        assert.deepStrictEqual([...read.memberOwn], ['skill m']);
        assert.ok(read.rewrite.length);
        const off = childKeep.settleLines({ locked: 'off', lines: ['skill m', 'skill kept'], priorOnly: ['skill kept'], readArgs });
        assert.deepStrictEqual(off, { lines: ['skill m', 'skill kept'], memberOwn: new Set(['skill m']), keptStore: ['skill kept'], rewrite: [], notes: [] });
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('writeBack names a set-aside middle root whose kept lines it rewrote, and an entry emptied', () =>
{
    const root = tree();
    try
    {
        const lines = [];
        childKeep.writeBack([{ root: path.join(root, 'api'), keptFor: { tool: ['skill t', 'skill new'] } }], { top: root, log: (line) => lines.push(line) });
        childKeep.writeBack([{ root: path.join(root, 'api'), keptFor: {} }], { top: root, log: (line) => lines.push(line) });
        assert.deepStrictEqual(lines, ['  kept lines of api rewritten: tool keeps skill t, skill new', '  kept lines of api rewritten: none left']);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
