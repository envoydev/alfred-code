'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { instructionsAbove, assertIsolated, INSTRUCTION_NAMES } = require('./isolation.js');

function tree(t)
{
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-iso-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const deep = path.join(dir, 'host', 'work', 'r1', 'arm', 'task', 'r1', 'repo');
    fs.mkdirSync(deep, { recursive: true });
    return { dir, deep };
}

test('the names Claude Code loads from every directory above the working one', () =>
{
    assert.deepStrictEqual(INSTRUCTION_NAMES, ['CLAUDE.md', 'CLAUDE.local.md', '.claude']);
});

test('a directory with nothing above it passes', (t) =>
{
    const { deep } = tree(t);
    assert.strictEqual(instructionsAbove(deep), null);
    assert.doesNotThrow(() => assertIsolated(deep, 'a cell'));
});

for (const name of ['CLAUDE.md', 'CLAUDE.local.md', '.claude'])
{
    test(`a ${name} in any ancestor is named, and refused`, (t) =>
    {
        const { dir, deep } = tree(t);
        const hit = path.join(dir, 'host', name);
        if (name === '.claude') fs.mkdirSync(hit);
        else fs.writeFileSync(hit, '# host rules\n');
        assert.strictEqual(instructionsAbove(deep), hit);
        assert.throws(() => assertIsolated(deep, 'a cell'), (err) => err.message.includes(hit) && /a cell sits under .* every session there would load it/.test(err.message));
    });
}

test('the directory itself counts only when asked: a cell repo holding its own CLAUDE.md is the arm\'s', (t) =>
{
    const { deep } = tree(t);
    fs.writeFileSync(path.join(deep, 'CLAUDE.md'), '# the arm wrote this\n');
    assert.strictEqual(instructionsAbove(deep), null);
    assert.strictEqual(instructionsAbove(deep, { inclusive: true }), path.join(deep, 'CLAUDE.md'));
});

test('a directory not made yet is judged by what is above it', (t) =>
{
    const { dir } = tree(t);
    fs.writeFileSync(path.join(dir, 'host', 'CLAUDE.md'), 'x\n');
    assert.strictEqual(instructionsAbove(path.join(dir, 'host', 'not', 'yet')), path.join(dir, 'host', 'CLAUDE.md'));
});
