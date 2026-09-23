'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { removeTree } = require('./remove-tree.js');

// macOS Finder drops .DS_Store files into folders while they are being deleted; one rmdir then fails
// ENOTEMPTY. A writer doing the same for a moment must not make the removal throw.
test('a tree is removed while another process keeps writing into its folders', async () =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rmtree-'));
    const dirs = [];
    for (let i = 0; i < 40; i++)
    {
        const d = path.join(root, `a${i}`, 'b', 'c');
        fs.mkdirSync(d, { recursive: true });
        for (let j = 0; j < 20; j++) fs.writeFileSync(path.join(d, `f${j}.txt`), 'x'.repeat(1000));
        dirs.push(d, path.dirname(d), path.dirname(path.dirname(d)));
    }
    const script = `const fs=require('fs');const dirs=${JSON.stringify(dirs)};const end=Date.now()+400;`
        + `(function tick(){for(const d of dirs){try{fs.writeFileSync(d+'/.DS_Store','x')}catch{}}if(Date.now()<end)setImmediate(tick)})()`;
    const writer = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
    const exited = new Promise((resolve) => writer.on('exit', resolve));
    // The removal starts only once the writer is writing - a fixed sleep lost that race on a loaded runner.
    for (let i = 0; i < 200 && !fs.existsSync(path.join(dirs[0], '.DS_Store')); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(fs.existsSync(path.join(dirs[0], '.DS_Store')), 'the writer never started');
    try { assert.doesNotThrow(() => removeTree(root)); }
    finally { await exited; fs.rmSync(root, { recursive: true, force: true }); }
});

test('a missing tree is not an error', () =>
{
    assert.doesNotThrow(() => removeTree(path.join(os.tmpdir(), 'bench-rmtree-never-made')));
});
