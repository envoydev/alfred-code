'use strict';
// layout.js's docs-memory helpers (memory P3, D1): the place, the setting Claude Code reads, the refusal rule (R4 plus
// the plan's 'elsewhere' and 'garbage'), the file list and a workspace child sharing its member's docs memory (OD5). The
// installer, tools.js and the session start all call these, so the three readers never disagree.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');

const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'layout-docs-mem-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

// A fresh repo under TMP, with an empty account, home and managed file of its own (the machine's are never read).
function repo(name = 'r')
{
    const top = fs.mkdtempSync(path.join(TMP, `${name}-`));
    const root = path.join(top, 'repo');
    fs.mkdirSync(root);
    git(root, 'init', '-q');
    const env = { CLAUDE_CONFIG_DIR: path.join(top, 'acct') };
    return { top, root, env, home: path.join(top, 'home'), managed: path.join(top, 'managed', 'managed-settings.json') };
}
const writeLocal = (root, value) =>
{
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), typeof value === 'string' ? value : JSON.stringify(value));
};
const commitOnce = (root) =>
{
    fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
    git(root, 'add', 'README.md');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
};

test('docsMemoryDir: <data root>/docs/memory, the main checkout\'s from a linked worktree', () =>
{
    const r = repo();
    assert.strictEqual(layout.docsMemoryDir(r.root, { env: r.env }), path.join(r.root, '.alfred', 'docs', 'memory'));
    commitOnce(r.root);
    const wt = path.join(r.top, 'wt');
    git(r.root, 'worktree', 'add', '-q', wt);
    assert.strictEqual(layout.docsMemoryDir(wt, { env: r.env }), path.join(r.root, '.alfred', 'docs', 'memory'), 'a worktree names the MAIN checkout\'s folder');
    // a custom data root moves it
    writeLocal(r.root, { env: { ALFRED_CODE_DATA_PATH: '.data' } });
    assert.strictEqual(layout.docsMemoryDir(r.root, { env: r.env }), path.join(r.root, '.data', 'docs', 'memory'));
});

test('memoryDirSetting: the local file\'s value, ~/ expanded, a relative value no setting', () =>
{
    const r = repo();
    const at = (value) => { writeLocal(r.root, { autoMemoryDirectory: value }); return layout.memoryDirSetting(r.root, { env: r.env, home: r.home, managed: r.managed }); };
    assert.strictEqual(at('/abs/m'), path.resolve('/abs/m'));
    assert.strictEqual(at('~/m'), path.join(r.home, 'm'));
    assert.strictEqual(at('rel/m'), null);
    fs.rmSync(path.join(r.root, '.claude'), { recursive: true });
    assert.strictEqual(layout.memoryDirSetting(r.root, { env: r.env, home: r.home, managed: r.managed }), null, 'no file, no setting');
    // memoryDirsOf reads it first, unchanged
    writeLocal(r.root, { autoMemoryDirectory: '/abs/m' });
    assert.deepStrictEqual(layout.memoryDirsOf(r.root, { env: r.env, home: r.home, managed: r.managed }), [path.resolve('/abs/m')]);
});

test('docsMemoryRefusal: null for a plain untracked file, and for an absent one', () =>
{
    const r = repo();
    const wanted = layout.docsMemoryDir(r.root, { env: r.env });
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home }), null, 'no .claude at all');
    writeLocal(r.root, { permissions: { allow: [] } });
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home }), null);
});

test('docsMemoryRefusal: symlink', { skip: process.platform === 'win32' && 'a symlink needs a privilege there' }, () =>
{
    const r = repo();
    const real = path.join(r.top, 'shared-claude');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(r.root, '.claude'));
    const got = layout.docsMemoryRefusal(r.root, { wanted: layout.docsMemoryDir(r.root, { env: r.env }), home: r.home });
    assert.strictEqual(got && got.why, 'symlink');
    assert.strictEqual(got.text, layout.DOCS_MEMORY_REFUSAL.symlink);
});

test('docsMemoryRefusal: elsewhere below the repository root on darwin and linux, allowed on win32', () =>
{
    const r = repo();
    const part = path.join(r.root, 'part');
    fs.mkdirSync(part);
    const wanted = layout.docsMemoryDir(part, { env: r.env });
    const linux = layout.docsMemoryRefusal(part, { wanted, home: r.home, platform: 'linux' });
    assert.strictEqual(linux && linux.why, 'elsewhere');
    assert.strictEqual(linux.text, layout.DOCS_MEMORY_REFUSAL.elsewhere);
    assert.strictEqual(layout.docsMemoryRefusal(part, { wanted, home: r.home, platform: 'darwin' }).why, 'elsewhere');
    assert.strictEqual(layout.docsMemoryRefusal(part, { wanted, home: r.home, platform: 'win32' }), null);
    // a linked worktree's own root is no 'elsewhere': its row goes in its own file
    commitOnce(r.root);
    const wt = path.join(r.top, 'wt');
    git(r.root, 'worktree', 'add', '-q', wt);
    assert.strictEqual(layout.docsMemoryRefusal(wt, { wanted: layout.docsMemoryDir(wt, { env: r.env }), home: r.home, platform: 'linux' }), null);
    // the repository root itself
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home, platform: 'linux' }), null);
});

test('docsMemoryRefusal: tracked', () =>
{
    const r = repo();
    writeLocal(r.root, {});
    const got = layout.docsMemoryRefusal(r.root, { wanted: layout.docsMemoryDir(r.root, { env: r.env }), tracked: () => true, home: r.home });
    assert.strictEqual(got && got.why, 'tracked');
    assert.match(got.text, /git rm --cached \.claude\/settings\.local\.json/);
    // the tracked check is handed the file Claude Code would read
    let asked = null;
    layout.docsMemoryRefusal(r.root, { wanted: layout.docsMemoryDir(r.root, { env: r.env }), tracked: (f) => { asked = f; return false; }, home: r.home });
    assert.strictEqual(asked, path.join(r.root, '.claude', 'settings.local.json'));
});

test('docsMemoryRefusal: garbage', () =>
{
    const r = repo();
    writeLocal(r.root, '{oops');
    const got = layout.docsMemoryRefusal(r.root, { wanted: layout.docsMemoryDir(r.root, { env: r.env }), home: r.home });
    assert.strictEqual(got && got.why, 'garbage');
    assert.strictEqual(got.text, layout.DOCS_MEMORY_REFUSAL.garbage);
    writeLocal(r.root, '[1, 2]');
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted: '/x', home: r.home }).why, 'garbage', 'an array is no settings object');
    writeLocal(r.root, `\uFEFF${JSON.stringify({ a: 1 })}`);
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted: '/x', home: r.home }), null, 'a BOM is no garbage');
});

test('docsMemoryRefusal: own value - another folder refuses, the wanted folder is accepted (D3), ours is never own', () =>
{
    const r = repo();
    const wanted = layout.docsMemoryDir(r.root, { env: r.env });
    writeLocal(r.root, { autoMemoryDirectory: '/elsewhere' });
    const got = layout.docsMemoryRefusal(r.root, { wanted, home: r.home });
    assert.strictEqual(got && got.why, 'own');
    assert.strictEqual(got.text, layout.DOCS_MEMORY_REFUSAL.own);
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home, ours: () => true }), null, 'the stack\'s own row is never own');
    writeLocal(r.root, { autoMemoryDirectory: wanted });
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home }), null, 'the user\'s value equal to ours');
    writeLocal(r.root, { autoMemoryDirectory: 'rel/m' });
    assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home }).why, 'own', 'a value Claude Code would not read is still the user\'s key');
});

test('memoryFiles: top-level .md only, sorted; [] for a missing folder', () =>
{
    const r = repo();
    const dir = path.join(r.root, 'mem');
    assert.deepStrictEqual(layout.memoryFiles(dir), []);
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    for (const n of ['b.md', 'MEMORY.md', 'a.md', 'notes.txt', 'sub/inner.md']) fs.writeFileSync(path.join(dir, n), 'x\n');
    fs.mkdirSync(path.join(dir, 'folder.md'));
    assert.deepStrictEqual(layout.memoryFiles(dir), ['MEMORY.md', 'a.md', 'b.md']);
});

test('docsMemoryShare: a same-repo child inheriting docs shares its member\'s row; null when the effective row is not the member\'s, or the mode is its own', () =>
{
    const r = repo('ws');
    const parent = r.root;
    const child = path.join(parent, 'api');
    for (const [dir, file] of [[parent, 'child api\n'], [child, 'parent ..\n']])
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), file);
    }
    fs.writeFileSync(path.join(parent, '.alfred', '.variables'), 'ALFRED_CODE_MEMORY=docs\n');
    const dir = layout.docsMemoryDir(parent, { env: r.env });
    writeLocal(parent, { autoMemoryDirectory: dir });
    // The POSIX rule (the repository root's file is read); win32 reads the start folder's, so a child shares nothing there.
    const opts = { env: r.env, home: r.home, managed: r.managed, platform: 'linux' };
    assert.deepStrictEqual(layout.docsMemoryShare(child, opts), { member: '..', dir });
    assert.strictEqual(layout.docsMemoryShare(child, { ...opts, platform: 'win32' }), null, 'win32 reads the start folder file');
    assert.strictEqual(layout.docsMemoryShare(parent, opts), null, 'the member itself holds its own mode');
    writeLocal(parent, {});
    assert.strictEqual(layout.docsMemoryShare(child, opts), null, 'the parent wrote no row');
    writeLocal(parent, { autoMemoryDirectory: dir });
    // A hook's or a script's loader applies the member's docs to its process env first (applyVariables): still shared.
    const applied = { ...r.env };
    layout.applyVariables(child, applied);
    assert.strictEqual(applied.ALFRED_CODE_MEMORY, 'docs', 'the loader carried the member\'s value');
    assert.deepStrictEqual(layout.docsMemoryShare(child, { ...opts, env: applied }), { member: '..', dir }, 'the applied env is no value of the child\'s own');
    fs.writeFileSync(path.join(child, '.alfred', '.variables'), 'ALFRED_CODE_MEMORY=docs\n');
    assert.strictEqual(layout.docsMemoryShare(child, opts), null, 'the child\'s own docs is no share');
});

// P3 review finding 1: the stamp travels with a committed `.claude/`, so its row names the docs memory by its place under
// the project, never by this machine's absolute path - a teammate's run records the hash this machine's value matches.
test('memoryRowHash / memoryRowMatches: the row is the place under the project, the same on every machine', () =>
{
    const here = layout.memoryRowHash('/Users/a/code/shop/.alfred/docs/memory', '/Users/a/code/shop');
    assert.match(here, /^[0-9a-f]{64}$/);
    assert.strictEqual(layout.memoryRowHash('/home/b/work/shop2/.alfred/docs/memory', '/home/b/work/shop2'), here, 'another machine, another folder name');
    assert.ok(layout.memoryRowMatches('/home/b/work/shop2/.alfred/docs/memory', here));
    assert.ok(layout.memoryRowMatches('C:\\Users\\c\\shop\\.alfred\\docs\\memory', here), 'a Windows value');
    assert.ok(!layout.memoryRowMatches('/home/b/work/shop2/.data/docs/memory', here), 'another place under the project');
    assert.ok(!layout.memoryRowMatches('/home/b/notes/memory', here));
    // An absolute row (a docs root outside the project) is matched by the value itself.
    const outside = layout.memoryRowHash('/srv/shared/docs/memory', '/Users/a/code/shop');
    assert.ok(layout.memoryRowMatches('/srv/shared/docs/memory', outside));
    assert.ok(!layout.memoryRowMatches('/srv/other/docs/memory', outside));
    for (const bad of [null, 42, '', {}]) assert.ok(!layout.memoryRowMatches(bad, here), String(bad));
    assert.ok(!layout.memoryRowMatches('/x/.alfred/docs/memory', null));
});

// P3 review finding 3: an empty settings.local.json reads as {} (settings.js readSettings, the 2026-10-20 ruling), and a
// file that cannot be read gets its own reason, never 'not valid JSON'.
test('docsMemoryRefusal: an empty or whitespace settings.local.json is no refusal; an unreadable one says so', { skip: process.platform === 'win32' && 'chmod' }, () =>
{
    const r = repo('empty');
    const wanted = layout.docsMemoryDir(r.root, { env: r.env });
    for (const text of ['', '  \n', '\uFEFF'])
    {
        writeLocal(r.root, text);
        assert.strictEqual(layout.docsMemoryRefusal(r.root, { wanted, home: r.home }), null, JSON.stringify(text));
    }
    writeLocal(r.root, '{}');
    const file = path.join(r.root, '.claude', 'settings.local.json');
    fs.chmodSync(file, 0o000);
    try
    {
        let readable = true;
        try { fs.readFileSync(file); } catch { readable = false; }
        if (readable) return; // running as root: nothing is unreadable
        const out = layout.docsMemoryRefusal(r.root, { wanted, home: r.home });
        assert.strictEqual(out && out.why, 'unreadable');
        assert.match(out.text, /cannot be read/);
    }
    finally { fs.chmodSync(file, 0o644); }
});
