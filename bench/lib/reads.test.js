'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hostRoots, pluginSourcesOf, cellReads } = require('./reads.js');
const { cellPaths } = require('./cells.js');

function scratch(t)
{
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-reads-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe' }).toString().trim();

test('the host roots are the checkout the harness runs from and, for a worktree, the main checkout that holds it', (t) =>
{
    const dir = scratch(t);
    const main = path.join(dir, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '-q');
    git(main, '-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'one');
    assert.deepStrictEqual(hostRoots(main), [main]);
    const wt = path.join(dir, 'elsewhere', 'wt');
    git(main, 'worktree', 'add', '-q', '--detach', wt);
    assert.deepStrictEqual(hostRoots(wt), [wt, main], 'a worktree outside the main checkout names both');
    const plain = path.join(dir, 'plain');
    fs.mkdirSync(plain);
    assert.deepStrictEqual(hostRoots(plain), [plain], 'no repository: the directory alone');
});

test('the plugin code a cell runs from outside its own work dir is what its config names, and nothing inside it', (t) =>
{
    const dir = scratch(t);
    const cell = cellPaths({ benchDir: dir, workRoot: path.join(dir, 'work'), run: 'r1', arm: 'ours', task: 't1', rep: 1 });
    const src = path.join(dir, 'work', 'templates', 'ours-abcdef01', 'src');
    const inside = path.join(cell.config, 'plugins', 'marketplaces', 'official');
    for (const d of [src, inside, path.join(cell.config, 'plugins', 'cache', 'x', '1.0.0')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(cell.config, 'plugins', 'known_marketplaces.json'), JSON.stringify({ envoydev: { installLocation: src }, official: { installLocation: inside }, gone: { installLocation: path.join(dir, 'gone') } }));
    fs.writeFileSync(path.join(cell.config, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'x@official': [{ installPath: path.join(cell.config, 'plugins', 'cache', 'x', '1.0.0') }] } }));
    assert.deepStrictEqual(pluginSourcesOf(cell), [src], 'outside the cell and on disk only');
    const bare = cellPaths({ benchDir: dir, workRoot: path.join(dir, 'work'), run: 'r1', arm: 'bare', task: 't1', rep: 1 });
    assert.deepStrictEqual(pluginSourcesOf(bare), [], 'an arm with no plugins runs from nothing outside its cell');
});

test('a cell may read itself, the plugin code it runs from and the shared uv store - never the host repo, another cell or a template', () =>
{
    const cell = { work: '/w/r1/ours/t1/r1' };
    const reads = cellReads({ cell, workRoot: '/w', hostRoots: ['/host/wt', '/host'], pluginSources: ['/w/templates/ours-abcdef01/src'] });
    assert.deepStrictEqual(reads.denyRead, ['/host/wt', '/host', '/w', '/w/templates/ours-abcdef01/src/.git'], 'the work root holds every cell of every run and every template');
    assert.deepStrictEqual(reads.allowRead, ['/w/r1/ours/t1/r1', '/w/templates/ours-abcdef01/src', '/w/uv'], 'a narrower rule wins, so these read inside the denied work root');
    for (const p of [...reads.denyRead, ...reads.allowRead]) assert.ok(path.isAbsolute(p), `${p} is absolute`);
});
