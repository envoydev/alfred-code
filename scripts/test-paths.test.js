'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { realLong, samePath } = require('./test-paths.js');

function tmpDir(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-paths-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('samePath reads a forward-slash and a native spelling of one path as equal', (t) =>
{
    const p = path.join(tmpDir(t), 'a', 'b');
    fs.mkdirSync(p, { recursive: true });
    assert.strictEqual(samePath(p.split(path.sep).join('/'), p), true);
    assert.strictEqual(samePath(path.join(p, '..', 'b'), p), true, 'a dot-dot spelling is the same path');
    assert.strictEqual(samePath(path.join(p, 'c'), p), false, 'a child is another path');
});

test('samePath resolves a link to its target', (t) =>
{
    const root = tmpDir(t);
    const target = path.join(root, 'target');
    const link = path.join(root, 'link');
    fs.mkdirSync(target);
    try { fs.symlinkSync(target, link, 'dir'); }
    catch (err)
    {
        if (process.platform === 'win32') { t.skip(`no symlink here: ${err.code}`); return; }
        throw err;
    }
    assert.strictEqual(samePath(link, target), true);
    assert.strictEqual(samePath(path.join(link, 'later'), path.join(target, 'later')), true, 'a child not yet made resolves through the link');
});

test('realLong keeps a path that does not exist yet under its real parent', (t) =>
{
    const tmpReal = tmpDir(t);
    assert.strictEqual(realLong(path.join(tmpReal, 'nope', 'x')), path.join(fs.realpathSync.native(tmpReal), 'nope', 'x'));
    assert.strictEqual(realLong(tmpReal), fs.realpathSync.native(tmpReal));
});

test('samePath folds case on win32 only', (t) =>
{
    const root = tmpDir(t);
    const lower = path.join(root, 'not-made-yet');
    const upper = path.join(root, 'NOT-MADE-YET');
    assert.strictEqual(samePath(lower, upper), process.platform === 'win32');
    assert.strictEqual(realLong(upper).endsWith('NOT-MADE-YET'), true, 'the spelling keeps its case');
});
