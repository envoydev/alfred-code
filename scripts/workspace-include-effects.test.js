'use strict';
// workspace-include effects: readAside reads each parent's record once over the subtree() rows and returns the set-aside rels.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ws = require('./install/workspace.js');
const { putWorkspace } = require('./workspace-fixture.js');
const { readAside } = require('./workspace-include/effects.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-include-effects-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ALFRED_CODE_WORKSPACE: '1' };

function folder(top, rel, record)
{
    const dir = path.join(top, ...rel.split('/'));
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
    putWorkspace(dir, record);
    return fs.realpathSync.native(dir);
}
const asideOf = (top) => [...readAside(top, ws.subtree(top, { env: ENV }), { env: ENV })];

test('readAside returns a grandchild its middle root set aside, and nothing for a tree that sets none aside', () =>
{
    const base = fs.mkdtempSync(path.join(TMP, 't-'));
    const top = folder(base, 'ws', { children: ['api', 'web'], includedChildren: ['api', 'web'], includeAsked: ['api', 'web'] });
    folder(base, 'ws/api', { parent: '..', children: ['tool'], includedChildren: [], includeAsked: ['tool'] });
    folder(base, 'ws/api/tool', { parent: '..' });
    folder(base, 'ws/web', { parent: '..' });
    assert.deepStrictEqual(asideOf(top), ['api/tool']);
    const plain = fs.mkdtempSync(path.join(TMP, 't-'));
    const plainTop = folder(plain, 'ws', { children: ['api'] });
    folder(plain, 'ws/api', { parent: '..' });
    assert.deepStrictEqual(asideOf(plainTop), [], 'an unasked child is not set aside');
});

test('readAside returns a set-aside child and every row below it, and keeps an included sibling out', () =>
{
    const base = fs.mkdtempSync(path.join(TMP, 't-'));
    const top = folder(base, 'ws', { children: ['api', 'web'], includedChildren: ['web'], includeAsked: ['api', 'web'] });
    folder(base, 'ws/api', { parent: '..', children: ['tool'] });
    folder(base, 'ws/api/tool', { parent: '..', children: ['deep'] });
    folder(base, 'ws/api/tool/deep', { parent: '..' });
    folder(base, 'ws/web', { parent: '..' });
    assert.deepStrictEqual(asideOf(top), ['api', 'api/tool', 'api/tool/deep']);
});
