'use strict';
// layout.js's workspace readers - the hook-side twin of scripts/install/workspace.js chain() (release 2, T2). The hooks
// cannot require the installer, so the twin reads the same files with fs and path alone; these tests hold the two equal.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');
const ws = require('./install/workspace.js');
const { putWorkspace } = require('./workspace-fixture.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-ws-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const STAMP = 'sha: x\n';
const env0 = { CLAUDE_CONFIG_DIR: path.join(TMP, 'no-account') };
// `spec` maps a relative folder to { stamp, git, file, data, settings, local, vars } - `file` is its workspace file's
// text and `vars` its `.variables` text, both under `data` (default .alfred); `settings` / `local` are its
// .claude/settings.json / settings.local.json text.
const tree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        if (o.stamp) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), STAMP); }
        if (o.settings !== undefined) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), o.settings); }
        if (o.local !== undefined) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), o.local); }
        const data = path.join(dir, ...(o.data || '.alfred').split('/'));
        if (o.record !== undefined) putWorkspace(dir, o.record, { dataRoot: o.data || '.alfred' });
        // `file`: the old file's own text, where the text is the subject (an unknown line, a BOM, CRLF)
        if (o.file !== undefined) { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'workspace'), o.file); }
        if (o.vars !== undefined) { fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, '.variables'), o.vars); }
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const shape = (c) => ({ members: c.members.map((m) => [m.root, m.rel, m.dataRoot, m.ignores || m.view.ignores]), notes: c.notes });
const same = (projectRoot, env = env0) => assert.deepStrictEqual(shape(layout.workspaceChain(projectRoot, { env })), shape(ws.chain(projectRoot, { env })));

test('workspaceChain matches chain() on every tree', () =>
{
    const three = tree({
        'ws': { stamp: true, record: { children: ['api'], ignore: { skill: ['tdd'] } } },
        'ws/api': { stamp: true, record: { parent: '..', children: ['tool'], ignore: { secret: ['B'], doc: ['TOOLS-PREFERENCES.md'] } } },
        'ws/api/tool': { stamp: true, record: { parent: '..' } },
    });
    same(three('ws/api/tool'));
    same(three('ws/api'));
    same(three('ws'));
    // a refused hop: the parent does not list the child
    const refused = tree({ 'ws': { stamp: true, record: {} }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    same(refused('ws/api'));
    // a missing parent and an unstamped one
    const missing = tree({ 'ws/api': { stamp: true, record: { parent: '../..' } } });
    same(missing('ws/api'));
    const unstamped = tree({ 'ws': { record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    same(unstamped('ws/api'));
    // a cycle back to a member already in the chain
    const loop = tree({ 'ws': { stamp: true, record: { parent: '..', children: ['ws'] } } });
    const top = path.dirname(loop('ws'));
    fs.mkdirSync(path.join(top, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(top, '.claude', 'alfred-code.stamp'), STAMP);
    // the file's text is the subject: `parent ws` is no valid parent, so no record can hold it
    fs.mkdirSync(path.join(top, '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(top, '.alfred', 'workspace'), 'parent ws\nchild ws\n');
    same(loop('ws'));
    // a parent whose data root is custom (settings.local.json) and one whose settings.json names an invalid root
    const custom = tree({
        'ws': { stamp: true, data: 'var/data', record: { children: ['api'] }, local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) },
        'ws/api': { stamp: true, record: { parent: '..' } },
    });
    // The fixed root (3.11.0): the two walks part here. The hooks read <parent>/.alfred alone; the installer reads the
    // folder an older install's data still sits in, until an update moves it.
    assert.deepStrictEqual(layout.workspaceChain(custom('ws/api'), { env: env0 }).members, []);
    assert.strictEqual(ws.chain(custom('ws/api')).members[0].dataRoot, 'var/data');
    const invalid = tree({
        'ws': { stamp: true, record: { children: ['api'] }, settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '/abs/root' } }) },
        'ws/api': { stamp: true, record: { parent: '..' } },
    });
    same(invalid('ws/api'));
    // the child's own record in an older install's folder: the hooks read .alfred (no record, no chain), the installer reads it
    const own = tree({
        'ws': { stamp: true, record: { children: ['api'] } },
        'ws/api': { stamp: true, data: '.kid', record: { parent: '..' }, local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '.kid' } }) },
    });
    assert.deepStrictEqual(layout.workspaceChain(own('ws/api'), { env: env0 }).members, []);
    assert.deepStrictEqual(layout.workspaceChain(own('ws/api'), { env: { ...env0, ALFRED_CODE_DATA_PATH: '.kid' } }).members, []);
    assert.strictEqual(ws.chain(own('ws/api')).members.length, 1);
});

test('workspaceChain depth 7, 8 and 9 matches chain()', () =>
{
    for (const [depth, want] of [[7, 7], [8, 8], [9, 8]])
    {
        const spec = {};
        const names = Array.from({ length: depth + 1 }, (_, i) => `d${i}`);
        for (let i = 0; i <= depth; i++)
        {
            spec[names.slice(0, i + 1).join('/')] = { stamp: true, record: { parent: i > 0 ? '..' : null, children: i < depth ? [names[i + 1]] : [] } };
        }
        const at = tree(spec);
        same(at(names.join('/')));
        assert.strictEqual(layout.workspaceChain(at(names.join('/')), { env: env0 }).members.length, want, `depth ${depth}`);
    }
});

test('a symlinked spelling of the child reads the real chain, as chain() does', { skip: process.platform === 'win32' }, () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'other': { stamp: true, record: { children: ['api'] } }, 'other/api': { stamp: true, record: { parent: '..' } } });
    fs.symlinkSync(at('other/api'), path.join(at('ws'), 'api'));
    same(path.join(at('ws'), 'api'));
    assert.deepStrictEqual(layout.workspaceChain(path.join(at('ws'), 'api'), { env: env0 }).members.map((m) => m.root), [at('other')]);
});

// On by default from 3.0.0 (D9): off only at 0. A launch 0 freezes; else the project's own value decides - settings.local.json,
// .variables, settings.json, the account - and a 0 there beats a launch 1; a member's value is never read for it.
test('the twins agree: unset on, launch 0 off, file 0 beats launch 1, settings.local.json 0 beats launch 1, .variables 0 off, a member\'s 0 is never read', () =>
{
    const at = tree({
        p: {},
        q: { settings: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) },
        r: { settings: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }), local: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '1' } }) },
        s: { local: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: 0 } }) },
        v: { vars: 'ALFRED_CODE_WORKSPACE=0\n' },
        ws: { stamp: true, record: { children: ['api'] }, vars: 'ALFRED_CODE_WORKSPACE=0\n', settings: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) },
        'ws/api': { stamp: true, record: { parent: '..' } },
    });
    const ONE = { ALFRED_CODE_WORKSPACE: '1' };
    const ZERO = { ALFRED_CODE_WORKSPACE: '0' };
    const on = (rel, e = {}) => layout.workspaceOn({ env: { ...env0, ...e }, projectRoot: at(rel) });
    assert.strictEqual(on('p'), true, 'unset is on');
    assert.strictEqual(on('p', ZERO), false, 'a launch 0 freezes');
    assert.strictEqual(on('p', { ALFRED_CODE_WORKSPACE: 'yes' }), true, 'only 0 is off');
    assert.strictEqual(on('q'), false, 'a settings.json 0');
    assert.strictEqual(on('q', ONE), false, 'a file 0 beats a launch 1');
    assert.strictEqual(on('s', ONE), false, 'a settings.local.json 0 (a number) beats a launch 1');
    assert.strictEqual(on('r'), true, 'settings.local.json 1 over settings.json 0');
    assert.strictEqual(on('v'), false, 'a .variables 0 is off');
    assert.strictEqual(on('v', ONE), false, 'a .variables 0 beats a launch 1');
    assert.strictEqual(on('ws/api'), true, 'a member\'s 0 is never read');
    assert.strictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).members.length, 1, 'the member is there to be read');
    for (const p of ['p', 'q', 'r', 's', 'v', 'ws', 'ws/api']) for (const e of [{}, ZERO, ONE])
        assert.strictEqual(on(p, e), ws.workspaceOn({ env: { ...env0, ...e }, projectRoot: at(p) }), `${p} ${JSON.stringify(e)}`);
});

test('a malformed workspace line is skipped and the chain still reads', () =>
{
    // the file's text is the subject: a BOM, CRLF and lines no record can hold
    const at = tree({
        'ws': { stamp: true, file: '\uFEFFgarbage line here\r\nchild api\r\nignore nope x\r\n' },
        'ws/api': { stamp: true, file: 'this is not a line\nparent ..\nignore secret API_KEY\n' },
    });
    same(at('ws/api'));
    assert.strictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).members.length, 1);
    assert.deepStrictEqual(layout.ownWorkspace(at('ws/api'), { env: env0 }), { parent: '..', ignores: [{ category: 'secret', name: 'API_KEY' }] });
});

test('ownWorkspace reads the project\'s own file under .alfred, and is empty without one', () =>
{
    const at = tree({
        'p': { record: { parentNone: true, ignore: { mcp: ['db'] } } }, 'q': {},
        'r': { data: 'var/d', record: { parentNone: true, ignore: { mcp: ['db'] } }, local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/d' } }) },
    });
    assert.deepStrictEqual(layout.ownWorkspace(at('p'), { env: env0 }), { parent: null, ignores: [{ category: 'mcp', name: 'db' }] });
    assert.deepStrictEqual(layout.ownWorkspace(at('q'), { env: env0 }), { parent: null, ignores: [] });
    assert.deepStrictEqual(layout.ownWorkspace(at('r'), { env: env0 }), { parent: null, ignores: [] }, 'a settings key names no other folder');
});

test('fixed root: dataRootOf is .alfred whatever the env, the settings files and the account say', () =>
{
    const acct = path.join(TMP, 'acct-dr');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'acct/root' } }));
    const at = tree({
        'a': {},
        'b': { settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'shared/root' } }) },
        'c': { settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'shared/root' } }), local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: './mine/' } }) },
        'd': { local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '../out' } }) },
        'e': { local: '{ not json', settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 42 } }) },
    });
    const env = { CLAUDE_CONFIG_DIR: acct };
    for (const p of ['a', 'b', 'c', 'd', 'e'])
        for (const e of [env0, env, { ...env, ALFRED_CODE_DATA_PATH: 'from/env' }]) assert.strictEqual(layout.dataRootOf(at(p), { env: e }), '.alfred', p);
});

test('the kill switch is the caller\'s: workspaceChain reads the chain whatever it says', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' }, local: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) } });
    assert.strictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).members.length, 1);
    assert.strictEqual(layout.workspaceOn({ env: env0, projectRoot: at('ws/api') }), false);
});

// ---- release 3, T2: an ancestor's memory folder (R6) and docs root (R2) ---------------------------------------------
// The folder Claude Code keys a project by, as T1 measured it (docs/workspace-layering-evidence.md, A5): the git top
// with every character outside [A-Za-z0-9] as `-`; `<S>` is the measured temp prefix, here the test's own.
const sanitized = (p) => p.normalize('NFC').replace(/[^A-Za-z0-9]/g, '-');
// Past 200 characters Claude Code (2.1.318, read from its own code for R068) keeps the first 200 and appends
// `-<base36 of |the Java string hash of the git top as it spells it|>`; written out here so the test is no copy of layout.js.
const ccHash = (p) => { let h = 0; for (const c of p.normalize('NFC')) for (let i = 0; i < c.length; i++) h = ((h << 5) - h + c.charCodeAt(i)) | 0; return Math.abs(h).toString(36); };
const ccName = (p) => { const n = sanitized(p); return n.length <= 200 ? n : `${n.slice(0, 200)}-${ccHash(p)}`; };
const memTree = (spec) =>
{
    const at = tree(spec);
    const home = path.join(at('.'), 'home');
    const acct = path.join(home, '.claude');
    fs.mkdirSync(acct, { recursive: true });
    return { at, home, acct, env: { CLAUDE_CONFIG_DIR: acct }, managed: path.join(at('.'), 'managed', 'managed-settings.json') };
};
const memOf = (m, rel, extra = {}) => layout.memoryDirsOf(m.at(rel), { env: m.env, home: m.home, managed: m.managed, ...extra });

test('memoryDirsOf names <account>/projects/<git top with - >/memory, from a sub-folder too', () =>
{
    const m = memTree({ 'Plain': { git: true }, 'Plain/sub': {} });
    const want = [path.join(m.acct, 'projects', sanitized(m.at('Plain')), 'memory')];
    assert.deepStrictEqual(memOf(m, 'Plain'), want);
    assert.deepStrictEqual(memOf(m, 'Plain/sub'), want, 'keyed by the git top, not the folder');
    const plainDir = memTree({ 'nogit': {} });
    assert.deepStrictEqual(memOf(plainDir, 'nogit'), [path.join(plainDir.acct, 'projects', sanitized(plainDir.at('nogit')), 'memory')], 'no git: the root');
});

test('memoryDirsOf equals the folders T1 measured: a space and an e-acute each one -, the mixed case kept', () =>
{
    const m = memTree({ 'my projé': { git: true }, 'MixedCase': { git: true } });
    const S = sanitized(m.at('.'));
    assert.deepStrictEqual(memOf(m, 'my projé'), [path.join(m.acct, 'projects', `${S}-my-proj-`, 'memory')]);
    assert.deepStrictEqual(memOf(m, 'MixedCase'), [path.join(m.acct, 'projects', `${S}-MixedCase`, 'memory')]);
});

test('autoMemoryDirectory in settings.local.json wins over settings.json, ~/ expanded; a bare ~ or a relative value is no setting', () =>
{
    const m = memTree({ 'p': { git: true, settings: JSON.stringify({ autoMemoryDirectory: '/shared/mem' }), local: JSON.stringify({ autoMemoryDirectory: '~/my-mem' }) }, 'q': { git: true, settings: JSON.stringify({ autoMemoryDirectory: '~' }) }, 'r': { git: true, settings: JSON.stringify({ autoMemoryDirectory: '/shared/mem' }), local: JSON.stringify({ autoMemoryDirectory: '.' }) } });
    assert.deepStrictEqual(memOf(m, 'p'), [path.join(m.home, 'my-mem')]);
    assert.deepStrictEqual(memOf(m, 'q'), [path.join(m.acct, 'projects', sanitized(m.at('q')), 'memory')]);
    assert.deepStrictEqual(memOf(m, 'r'), [path.resolve('/shared/mem')], 'the relative value is skipped, the next scope read');
});

test('a managed-settings value wins over the member\'s, the member\'s over the account\'s; the last drop-in over the file', () =>
{
    const m = memTree({ 'p': { git: true, settings: JSON.stringify({ autoMemoryDirectory: '/member' }) }, 'q': { git: true } });
    fs.writeFileSync(path.join(m.acct, 'settings.json'), JSON.stringify({ autoMemoryDirectory: '/account' }));
    assert.deepStrictEqual(memOf(m, 'p'), [path.resolve('/member')]);
    assert.deepStrictEqual(memOf(m, 'q'), [path.resolve('/account')]);
    fs.mkdirSync(path.join(path.dirname(m.managed), 'managed-settings.d'), { recursive: true });
    fs.writeFileSync(m.managed, JSON.stringify({ autoMemoryDirectory: '/managed' }));
    assert.deepStrictEqual(memOf(m, 'p'), [path.resolve('/managed')]);
    fs.writeFileSync(path.join(path.dirname(m.managed), 'managed-settings.d', '10-a.json'), JSON.stringify({ autoMemoryDirectory: '/drop-a' }));
    fs.writeFileSync(path.join(path.dirname(m.managed), 'managed-settings.d', '20-b.json'), JSON.stringify({ autoMemoryDirectory: '/drop-b' }));
    fs.writeFileSync(path.join(path.dirname(m.managed), 'managed-settings.d', '30-c.json'), JSON.stringify({ model: 'x' }));
    assert.deepStrictEqual(memOf(m, 'p'), [path.resolve('/drop-b')], 'drop-ins merge after the file in alphabetical order');
});

test('CLAUDE_CODE_PROJECT_DIR_NAME gives [], but an autoMemoryDirectory still names its folder', () =>
{
    const m = memTree({ 'p': { git: true }, 'q': { git: true, local: JSON.stringify({ autoMemoryDirectory: '/custom/mem' }) } });
    const renamed = { env: { ...m.env, CLAUDE_CODE_PROJECT_DIR_NAME: 'renamed' } };
    assert.deepStrictEqual(memOf(m, 'p', renamed), []);
    assert.deepStrictEqual(memOf(m, 'q', renamed), [path.resolve('/custom/mem')]);
});

// R069 (burn-down 2026-11-04; code.claude.com/docs/en/sessions, 'Name the project directory yourself', read 2026-11-04):
// Claude Code ignores the name without CLAUDE_CONFIG_DIR, and any value but 1-64 letters, digits, - or _ (a Windows
// device name included) - it then keeps the derived folder, and so must the memory reads.
test('R069: the memory default is computed unless CLAUDE_CONFIG_DIR is set and well-formed', () =>
{
    const m = memTree({ 'p': { git: true } });
    const derived = (acct) => [path.join(acct, 'projects', sanitized(m.at('p')), 'memory')];
    const withName = (name, env = m.env) => memOf(m, 'p', { env: { ...env, CLAUDE_CODE_PROJECT_DIR_NAME: name } });
    assert.deepStrictEqual(withName('renamed', {}), derived(path.join(m.home, '.claude')), 'no CLAUDE_CONFIG_DIR: the name is ignored');
    assert.deepStrictEqual(withName('x'.repeat(65)), derived(m.acct), 'a 65-character name is ignored');
    assert.deepStrictEqual(withName('a.b'), derived(m.acct), 'a dot is outside the name rule');
    assert.deepStrictEqual(withName('con'), derived(m.acct), 'a Windows device name is ignored');
    assert.deepStrictEqual(withName('COM1'), derived(m.acct));
    assert.deepStrictEqual(withName(''), derived(m.acct), 'an empty value is no name');
    assert.deepStrictEqual(withName('x'.repeat(64)), [], 'a 64-character name applies');
    assert.deepStrictEqual(withName('tenant_a-1'), []);
});

test('a garbage settings.json or a non-string autoMemoryDirectory / ALFRED_CODE_DOCS_PATH falls through to the default', () =>
{
    const m = memTree({ 'p': { git: true, settings: '{ not json', local: JSON.stringify({ autoMemoryDirectory: 42, env: { ALFRED_CODE_DOCS_PATH: ['x'] } }) } });
    assert.deepStrictEqual(memOf(m, 'p'), [path.join(m.acct, 'projects', sanitized(m.at('p')), 'memory')]);
    assert.strictEqual(layout.docsRootOf(m.at('p'), { env: m.env }), path.join(m.at('p'), '.alfred', 'docs'));
});

test('a 201-character name is <first 200>-<hash of the git top>, the one folder Claude Code makes, whatever else shares the first 200 (R068); 199 and 200 are exact', () =>
{
    const m = memTree({});
    const base = m.at('.');
    const pad = (n, stem) => stem + 'x'.repeat(n - (sanitized(base).length + 1) - stem.length);
    for (const n of [199, 200])
    {
        const dir = path.join(base, pad(n, `len${n}-`));
        fs.mkdirSync(dir); execFileSync('git', ['init', '-q'], { cwd: dir });
        const got = layout.memoryDirsOf(dir, { env: m.env, home: m.home, managed: m.managed });
        assert.deepStrictEqual(got, [path.join(m.acct, 'projects', sanitized(dir), 'memory')]);
        assert.strictEqual(sanitized(dir).length, n);
    }
    const long = path.join(base, pad(201, 'len201-'));
    fs.mkdirSync(long); execFileSync('git', ['init', '-q'], { cwd: long });
    const head = sanitized(long).slice(0, 200);
    const want = [path.join(m.acct, 'projects', `${head}-${ccHash(long)}`, 'memory')];
    for (const platform of ['darwin', 'linux'])
        assert.deepStrictEqual(layout.memoryDirsOf(long, { env: m.env, home: m.home, managed: m.managed, platform }), want, `${platform}: named before it exists`);
    for (const h of ['b5411q', 'zz09aa']) fs.mkdirSync(path.join(m.acct, 'projects', `${head}-${h}`, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(m.acct, 'projects', `${head}x`), { recursive: true });
    for (const platform of ['darwin', 'linux'])
        assert.deepStrictEqual(layout.memoryDirsOf(long, { env: m.env, home: m.home, managed: m.managed, platform }), want, `${platform}: a sibling sharing the first 200 is not this project's`);
});

test('docsRootOf reads the ancestor\'s leftover ALFRED_CODE_DOCS_PATH, never the env\'s, else <dataRoot>/docs', () =>
{
    const m = memTree({ 'a': { settings: JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'shared/docs' } }), local: JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'mine/docs' } }) }, 'b': { settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'data' } }) }, 'c': {} });
    const env = { ...m.env, ALFRED_CODE_DOCS_PATH: 'child/docs', ALFRED_CODE_DATA_PATH: 'child-data' };
    assert.strictEqual(layout.docsRootOf(m.at('a'), { env }), path.join(m.at('a'), 'mine', 'docs'));
    assert.strictEqual(layout.docsRootOf(m.at('b'), { env }), path.join(m.at('b'), '.alfred', 'docs'), 'no settings key names the data root');
    assert.strictEqual(layout.docsRootOf(m.at('c'), { env, dataRoot: 'given' }), path.join(m.at('c'), 'given', 'docs'));
});

test('topMember is the last linked member, null for a project with no parent', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['mid'] } }, 'ws/mid': { stamp: true, record: { parent: '..', children: ['api'] } }, 'ws/mid/api': { stamp: true, record: { parent: '..' } } });
    assert.strictEqual(layout.topMember(at('ws/mid/api'), { env: env0 }).root, at('ws'));
    assert.strictEqual(layout.topMember(at('ws'), { env: env0 }), null);
});

// ---- release 3, T4: the ancestors' preferences folders (R0, R3) ------------------------------------------------------
const prefsOf = (list) => list.map((e) => [e.dir, [...e.skip].sort()]);
test('ancestorPrefsDirs lists each linked member\'s preferences nearest first; a grandchild keeps its parent\'s own copy of a file the parent ignores in the root, and loses one the parent ignores', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['mid'] } }, 'ws/mid': { stamp: true, record: { parent: '..', children: ['api'], ignore: { doc: ['GIT-PREFERENCES.md'] } } }, 'ws/mid/api': { stamp: true, record: { parent: '..' } } });
    const env = { ...env0 };
    assert.deepStrictEqual(prefsOf(layout.ancestorPrefsDirs(at('ws/mid/api'), { env })), [
        [path.join(at('ws/mid'), '.alfred', 'docs', 'preferences'), []],
        [path.join(at('ws'), '.alfred', 'docs', 'preferences'), ['GIT-PREFERENCES.md']],
    ]);
    assert.deepStrictEqual(layout.ancestorPrefsDirs(at('ws'), { env }), [], 'the root has no ancestor');
});

test('ancestorPrefsDirs: the child\'s own ignore doc skips every member, ignore docs root drops them, the kill switch reads none', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['api', 'web'] } }, 'ws/api': { stamp: true, record: { parent: '..', ignore: { doc: ['PERSONAL-CODE-PREFERENCES.md'] } } }, 'ws/web': { stamp: true, record: { parent: '..', ignore: { docs: ['root'] } } } });
    assert.deepStrictEqual(prefsOf(layout.ancestorPrefsDirs(at('ws/api'), { env: env0 })), [[path.join(at('ws'), '.alfred', 'docs', 'preferences'), ['PERSONAL-CODE-PREFERENCES.md']]]);
    assert.deepStrictEqual(layout.ancestorPrefsDirs(at('ws/web'), { env: env0 }), []);
    assert.deepStrictEqual(layout.ancestorPrefsDirs(at('ws/api'), { env: { ...env0, ALFRED_CODE_WORKSPACE: '0' } }), []);
});

// ---- release 3, T6: the workspace root's memory folder (R0, R6) ------------------------------------------------------
const wsMem = (m, rel, extra = {}) => layout.workspaceMemoryOf(m.at(rel), { env: m.env, home: m.home, managed: m.managed, ...extra });
test('workspaceMemoryOf names the TOP member\'s memory folder from any child; null at the root and with the switch at 0', () =>
{
    const m = memTree({ 'ws': { stamp: true, git: true, record: { children: ['mid'] } }, 'ws/mid': { stamp: true, git: true, record: { parent: '..', children: ['api'] } }, 'ws/mid/api': { stamp: true, git: true, record: { parent: '..' } } });
    const want = path.join(m.acct, 'projects', sanitized(m.at('ws')), 'memory');
    assert.strictEqual(wsMem(m, 'ws/mid/api'), want);
    assert.strictEqual(wsMem(m, 'ws/mid'), want);
    assert.strictEqual(wsMem(m, 'ws'), null, 'the root has no ancestor');
    assert.strictEqual(wsMem(m, 'ws/mid/api', { env: { ...m.env, ALFRED_CODE_WORKSPACE: '0' } }), null);
    assert.strictEqual(wsMem(m, 'ws/mid/api', { env: { ...m.env, CLAUDE_CODE_PROJECT_DIR_NAME: 'x' } }), null);
});

test('workspaceMemoryOf: ignore memory root in the child or a nearer member drops it (R0); a folder equal to the child\'s own is null', () =>
{
    const m = memTree({ 'ws': { stamp: true, git: true, record: { children: ['mid', 'web'] } }, 'ws/mid': { stamp: true, git: true, record: { parent: '..', children: ['api'], ignore: { memory: ['root'] } } }, 'ws/mid/api': { stamp: true, git: true, record: { parent: '..' } }, 'ws/web': { stamp: true, git: true, record: { parent: '..' } } });
    assert.strictEqual(wsMem(m, 'ws/mid'), null, 'its own ignore');
    assert.strictEqual(wsMem(m, 'ws/mid/api'), null, 'a nearer member\'s ignore');
    assert.strictEqual(wsMem(m, 'ws/web'), path.join(m.acct, 'projects', sanitized(m.at('ws')), 'memory'));
    fs.writeFileSync(path.join(m.acct, 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/shared-mem' }));
    assert.strictEqual(wsMem(m, 'ws/web'), null, 'one account-level folder is the child\'s own memory');
});

test('workspaceMemoryOf past 200 characters: a child sharing the root\'s first 200 still names the root\'s own folder (R068)', () =>
{
    const m = memTree({});
    const base = m.at('.');
    const ws = path.join(base, 'w'.repeat(Math.max(1, 205 - (sanitized(base).length + 1))));
    for (const [dir, record] of [[ws, { children: ['api'] }], [path.join(ws, 'api'), { parent: '..' }]])
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), STAMP); putWorkspace(dir, record);
        execFileSync('git', ['init', '-q'], { cwd: dir });
    }
    const head = sanitized(ws).slice(0, 200);
    const api = path.join(ws, 'api');
    const of = (platform) => layout.workspaceMemoryOf(api, { env: m.env, home: m.home, managed: m.managed, platform });
    const root = path.join(m.acct, 'projects', ccName(ws), 'memory');
    assert.notStrictEqual(ccName(ws), ccName(api), 'two git tops, two folders');
    assert.strictEqual(sanitized(api).slice(0, 200), head, 'the child shares the root\'s first 200');
    for (const platform of ['darwin', 'linux']) assert.strictEqual(of(platform), root, `${platform}: no folder yet`);
    fs.mkdirSync(path.join(m.acct, 'projects', `${head}-zz09aa`, 'memory'), { recursive: true });
    for (const platform of ['darwin', 'linux']) assert.strictEqual(of(platform), root, `${platform}: a third folder sharing the first 200 changes nothing`);
});

// A5 on Windows (2026-10-27): Claude Code keys the folder by the cwd's case as TYPED, and NTFS opens it under any case, so
// the past-200 listing matches case-insensitively there - and only there.
test('memoryDirsOf past 200 on win32 lists a folder named in another case; on a case-sensitive platform it does not', () =>
{
    const m = memTree({});
    const base = m.at('.');
    const long = path.join(base, 'L'.repeat(Math.max(1, 205 - (sanitized(base).length + 1))));
    fs.mkdirSync(long); execFileSync('git', ['init', '-q'], { cwd: long });
    const typed = `${sanitized(long).slice(0, 200).toLowerCase()}-jungf8`;
    fs.mkdirSync(path.join(m.acct, 'projects', typed, 'memory'), { recursive: true });
    const of = (platform) => layout.memoryDirsOf(long, { env: m.env, home: m.home, managed: m.managed, platform });
    assert.ok(of('win32').includes(path.join(m.acct, 'projects', typed, 'memory')), 'win32 lists the typed case');
    assert.deepStrictEqual(of('darwin'), [path.join(m.acct, 'projects', ccName(long), 'memory')], 'darwin: the computed folder alone');
});

// R068's review (2026-11-04): Claude Code keys a worktree by its main checkout only through a back-link it can check -
// `<gitdir>/gitdir` naming this worktree's `.git` - and a bare repository's worktree by the bare folder itself.
test('memoryDirsOf keys a bare repository\'s worktree by the bare folder, and a worktree moved without repair by itself', () =>
{
    const m = memTree({});
    const base = fs.realpathSync.native(m.at('.'));
    const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
    const src = path.join(base, 'src');
    fs.mkdirSync(src); g(src, 'init', '-q'); fs.writeFileSync(path.join(src, 'f'), 'x'); g(src, 'add', 'f'); g(src, 'commit', '-qm', 'i');
    g(base, 'clone', '-q', '--bare', src, path.join(base, 'bare.git'));
    g(path.join(base, 'bare.git'), 'worktree', 'add', '-q', path.join(base, 'wt'), '-b', 'w');
    const named = (dir) => [path.join(m.acct, 'projects', sanitized(dir), 'memory')];
    assert.deepStrictEqual(memOf(m, 'wt'), named(path.join(base, 'bare.git')), 'a bare repository\'s worktree: the bare folder');
    g(src, 'worktree', 'add', '-q', path.join(base, 'wt1'), '-b', 'w1');
    assert.deepStrictEqual(memOf(m, 'wt1'), named(src), 'a linked worktree: its main checkout');
    fs.renameSync(path.join(base, 'wt1'), path.join(base, 'wt2'));
    assert.deepStrictEqual(memOf(m, 'wt2'), named(path.join(base, 'wt2')), 'moved without git worktree repair: the back-link fails, so itself');
});

// G2 (2026-11-05): Claude Code 2.1.318 keys a worktree by the top itself when the `.git` value, the `commondir` text or
// the back-link is a path it refuses (`ra`) or walks into one (`p_`); read from its own code, written out as cases here.
test('unsafeLinkPath: Claude Code 2.1.318 refused path classes', () =>
{
    const refused = [['//host/share/x', '/Users/u'], ['\\\\?\\C:\\x', '/Users/u'], ['\\\\.\\pipe\\x', '/Users/u'], ['/GLOBAL??/C:/x', '/Users/u'],
        ['/net', '/Users/u'], ['/net/h/x', '/home/u'], ['/Network/Servers/h/x', '/Users/u'], ['/Network/Servers/h/x', '/Network/Servers/h/repo'],
        ['/network/x', '/Users/u'], ['/.vol/1/2', '/Users/u'], ['/.NoFollow/Users/x', '/Users/u'], ['/a/../.vol/x', '/Users/u']];
    for (const [p, base] of refused) assert.strictEqual(layout.unsafeLinkPath(p, base), true, `${p} (base ${base}) is refused`);
    const kept = [['/net/h/x', '/net/h/repo'], ['//srv/s/x', '//srv/s/repo'], ['/Users/u/repo/.git/worktrees/w', '/Users/u'],
        ['../..', '/Users/u/repo/.git/worktrees/w'], ['/a/net/x', '/Users/u']];
    for (const [p, base] of kept) assert.strictEqual(layout.unsafeLinkPath(p, base), false, `${p} (base ${base}) is kept`);
});

test('unsafeLinkWalk: a link to a refused root is refused; a plain or missing path is not', { skip: process.platform === 'win32' && 'POSIX links' }, () =>
{
    const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'walk-')));
    fs.mkdirSync(path.join(d, 'ok'));
    fs.symlinkSync('/.vol', path.join(d, 'via'));
    assert.strictEqual(layout.unsafeLinkWalk('via/x', d), true, 'a link whose text is a refused class');
    assert.strictEqual(layout.unsafeLinkWalk('ok/x', d), false, 'a plain folder');
    assert.strictEqual(layout.unsafeLinkWalk('gone/x', d), false, 'a missing path');
    const chain = (n) =>
    {
        const c = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, `chain${n}-`)));
        fs.mkdirSync(path.join(c, 'ok'));
        for (let i = 1; i <= n; i++) fs.symlinkSync(i === n ? 'ok' : `l${i + 1}`, path.join(c, `l${i}`));
        return layout.unsafeLinkWalk('l1/x', c);
    };
    assert.strictEqual(chain(39), false, '39 links are followed');
    assert.strictEqual(chain(40), false, '40 links are followed');
    assert.strictEqual(chain(41), true, 'past 40 links the walk refuses');
});

test('memoryKeyOf keys a worktree by itself when its .git names the admin folder through a // path', { skip: process.platform === 'win32' && 'POSIX reads // as /' }, () =>
{
    const m = memTree({});
    const base = fs.realpathSync.native(m.at('.'));
    const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
    const src = path.join(base, 'src');
    fs.mkdirSync(src); g(src, 'init', '-q'); fs.writeFileSync(path.join(src, 'f'), 'x'); g(src, 'add', 'f'); g(src, 'commit', '-qm', 'i');
    g(src, 'worktree', 'add', '-q', path.join(base, 'wt1'), '-b', 'w1');
    g(src, 'worktree', 'add', '-q', path.join(base, 'wt3'), '-b', 'w3');
    const named = (dir) => [path.join(m.acct, 'projects', sanitized(dir), 'memory')];
    const admin = fs.realpathSync.native(path.join(src, '.git', 'worktrees', 'wt1'));
    fs.writeFileSync(path.join(base, 'wt1', '.git'), `gitdir: /${admin}\n`);
    assert.deepStrictEqual(memOf(m, 'wt1'), named(path.join(base, 'wt1')), 'a // gitdir: the worktree itself');
    assert.deepStrictEqual(memOf(m, 'wt3'), named(src), 'an untouched worktree: its main checkout');
});

// R068's review: on Windows every `<first 200>-*` folder is listed, and a child shares its root's first 200, so once the
// root's folder existed the child read it as its own - the deny came and went with the folder. An ancestor's computed
// folder is never this project's.
test('memoryDirsOf past 200 on win32 never lists an ancestor\'s computed folder as its own, so the child\'s root line holds once the folder exists', () =>
{
    const m = memTree({});
    const base = m.at('.');
    const ws = path.join(base, 'w'.repeat(Math.max(1, 205 - (sanitized(base).length + 1))));
    for (const [dir, record] of [[ws, { children: ['api'] }], [path.join(ws, 'api'), { parent: '..' }]])
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), STAMP); putWorkspace(dir, record);
        execFileSync('git', ['init', '-q'], { cwd: dir });
    }
    const api = path.join(ws, 'api');
    const root = path.join(m.acct, 'projects', ccName(ws), 'memory');
    const own = path.join(m.acct, 'projects', ccName(api), 'memory');
    const line = () => layout.workspaceMemoryOf(api, { env: m.env, home: m.home, managed: m.managed, platform: 'win32' });
    assert.strictEqual(line(), root, 'before the folders exist');
    for (const d of [root, own]) fs.mkdirSync(d, { recursive: true });
    assert.ok(!layout.memoryDirsOf(api, { env: m.env, home: m.home, managed: m.managed, platform: 'win32' }).includes(root), 'the root\'s folder is not the child\'s');
    assert.strictEqual(line(), root, 'after the folders exist');
});

// ---- release 3 review: a child's linked worktree reads the chain its main checkout holds ----------------------------
test('a child\'s linked worktree, with no workspace file of its own, reads its main checkout\'s preferences folders and root memory', () =>
{
    const m = memTree({ 'ws': { stamp: true, git: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });
    const api = m.at('ws/api');
    fs.writeFileSync(path.join(api, '.gitignore'), '.alfred/\n');
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: api, stdio: 'ignore' });
    git('add', '.gitignore', '.claude');
    git('commit', '-qm', 'i');
    git('worktree', 'add', '-q', path.join(m.at('.'), 'api-wt'), '-b', 'feat');
    const wt = m.at('api-wt');
    assert.ok(!fs.existsSync(path.join(wt, '.alfred')), 'the worktree holds no workspace file');
    const main = prefsOf(layout.ancestorPrefsDirs(api, { env: m.env }));
    assert.strictEqual(main.length, 1);
    assert.deepStrictEqual(prefsOf(layout.ancestorPrefsDirs(wt, { env: m.env })), main);
    assert.strictEqual(wsMem(m, 'api-wt'), path.join(m.acct, 'projects', sanitized(m.at('ws')), 'memory'));
});

test('trustedMemoryDir reads the managed and account settings only, never a project file a clone can carry', () =>
{
    const m = memTree({ 'p': { git: true, settings: JSON.stringify({ autoMemoryDirectory: '~/.ssh' }), local: JSON.stringify({ autoMemoryDirectory: '/local/mem' }) } });
    const of = () => layout.trustedMemoryDir(m.at('p'), { env: m.env, home: m.home, managed: m.managed });
    assert.strictEqual(of(), null);
    fs.writeFileSync(path.join(m.acct, 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/mem' }));
    assert.strictEqual(of(), path.join(m.home, 'mem'));
    fs.mkdirSync(path.dirname(m.managed), { recursive: true });
    fs.writeFileSync(m.managed, JSON.stringify({ autoMemoryDirectory: '/policy/mem' }));
    assert.strictEqual(of(), path.resolve('/policy/mem'));
});

test('trustedMemoryDir reads settings.local.json in its own place only when the untracked check passes it', () =>
{
    const m = memTree({ 'p': { git: true, local: JSON.stringify({ autoMemoryDirectory: '/local/mem' }) } });
    const local = path.join(m.at('p'), '.claude', 'settings.local.json');
    const seen = [];
    const of = (untracked) => layout.trustedMemoryDir(m.at('p'), { env: m.env, home: m.home, managed: m.managed, untracked });
    assert.strictEqual(of(), null, 'no check: the file stays untrusted');
    assert.strictEqual(of((f) => { seen.push(f); return true; }), path.resolve('/local/mem'));
    assert.deepStrictEqual(seen, [local], 'the check is asked about settings.local.json');
    assert.strictEqual(of(() => false), null, 'a tracked file');
    fs.writeFileSync(path.join(m.acct, 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/mem' }));
    assert.strictEqual(of(() => true), path.resolve('/local/mem'), 'the local file outranks the account');
    assert.strictEqual(of(() => false), path.join(m.home, 'mem'), 'a tracked one falls through to the account');
    fs.writeFileSync(local, JSON.stringify({ autoMemoryDirectory: 'rel/mem' }));
    seen.length = 0;
    assert.strictEqual(of((f) => { seen.push(f); return true; }), path.join(m.home, 'mem'), 'a relative value is no setting');
    assert.deepStrictEqual(seen, [], 'and asks no check');
    fs.writeFileSync(local, JSON.stringify({ autoMemoryDirectory: '/local/mem' }));
    fs.mkdirSync(path.dirname(m.managed), { recursive: true });
    fs.writeFileSync(m.managed, JSON.stringify({ autoMemoryDirectory: '/policy/mem' }));
    assert.strictEqual(of((f) => { seen.push(f); return true; }), path.resolve('/policy/mem'), 'the managed file outranks it');
    assert.deepStrictEqual(seen, [], 'unasked');
});

test('localSettingsFile names the settings.local.json Claude Code reads in a repository: the root\'s, the main checkout\'s; on Windows the start folder\'s at its top; null below it there and with no repository', () =>
{
    const m = memTree({ 'r': { git: true }, 'r/pkg': {}, 'plain': {} });
    const of = (rel, platform = 'darwin') => layout.localSettingsFile(m.at(rel), { home: m.home, platform });
    const file = (rel) => path.join(m.at(rel), '.claude', 'settings.local.json');
    assert.strictEqual(of('r'), file('r'));
    assert.strictEqual(of('r/pkg'), file('r'), 'a sub-folder reads the root\'s');
    assert.strictEqual(of('r', 'win32'), file('r'));
    assert.strictEqual(of('r/pkg', 'win32'), null, 'Windows keeps it in the start folder, which nothing vouches for below the top');
    assert.strictEqual(of('plain'), null);
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: m.at('r'), stdio: 'ignore' });
    fs.writeFileSync(path.join(m.at('r'), 'a.txt'), 'a');
    git('add', 'a.txt');
    git('commit', '-qm', 'i');
    git('worktree', 'add', '-q', path.join(m.at('.'), 'r-wt'), '-b', 'feat');
    assert.strictEqual(of('r-wt'), file('r'), 'a linked worktree reads the main checkout\'s');
    assert.strictEqual(of('r-wt', 'win32'), file('r-wt'));
});

// E-batch 300-memdirs (3.0.0 deferred minor): the untrusted read took the START folder's settings.local.json, while Claude
// Code reads the one at the repo root (the main checkout for a worktree; the start folder on Windows - localSettingsFile).
test('300-memdirs: an untrusted read takes the root settings.local.json', () =>
{
    const m = memTree({
        'p': { git: true, settings: JSON.stringify({ autoMemoryDirectory: '/p-settings' }), local: JSON.stringify({ autoMemoryDirectory: '/p-root-local' }) },
        'p/sub': { local: JSON.stringify({ autoMemoryDirectory: '/p-sub-leftover' }) },
        'q': { git: true },
        'q/sub': { settings: JSON.stringify({ autoMemoryDirectory: '/q-sub-settings' }), local: JSON.stringify({ autoMemoryDirectory: '/q-sub-leftover' }) },
        'r': { git: true },
        'r/sub': { settings: JSON.stringify({ autoMemoryDirectory: '/r-sub-settings' }) },
    });
    // The root-first reading is the macOS / Linux one, named explicitly: on a Windows runner the default platform is win32,
    // where the start folder's own file is the one read (the win32 line below) - CI 547ede2c, windows 2/2.
    const posix = { platform: 'linux' };
    assert.deepStrictEqual(memOf(m, 'p/sub', posix), [path.resolve('/p-root-local')], 'the repo root\'s settings.local.json first');
    assert.deepStrictEqual(memOf(m, 'q/sub', posix), [path.resolve('/q-sub-leftover')], 'then the start folder\'s leftover');
    assert.deepStrictEqual(memOf(m, 'r/sub', posix), [path.resolve('/r-sub-settings')], 'then settings.json');
    assert.deepStrictEqual(memOf(m, 'p/sub', { platform: 'win32' }), [path.resolve('/p-sub-leftover')], 'win32: the start folder\'s own file (localSettingsFile)');
    assert.deepStrictEqual(memOf(m, 'p'), [path.resolve('/p-root-local')], 'started at the root: one file, read once');
    // a worktree reads its main checkout's
    const p = m.at('p');
    fs.writeFileSync(path.join(p, '.gitignore'), '.claude/settings.local.json\n');
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: p, stdio: 'ignore' });
    git('add', '.gitignore', '.claude/settings.json'); git('commit', '-qm', 'i');
    git('worktree', 'add', '-q', path.join(m.at('.'), 'p-wt'), '-b', 'feat');
    assert.deepStrictEqual(memOf(m, 'p-wt', posix), [path.resolve('/p-root-local')], 'a worktree reads the main checkout\'s settings.local.json');
});

// E-batch mcp-A7d: `key` read another tool's variable by its exact name (UV_EXCLUDE_NEWER) for a server launcher that left in
// 2.10.1 - no caller passes it. Both copies drop it together (meta/shared-rules.json data-path-setting holds them equal).
test('A7d: settingFrom takes no key', () =>
{
    const params = (rel) => (/function settingFrom\(\{([^}]*)\}\)/.exec(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')) || [])[1];
    const hooks = params('stack/hooks/layout.js');
    const mcpCopy = params('stack/mcp/data-root.js');
    assert.ok(hooks, 'layout.js settingFrom not found');
    assert.strictEqual(hooks, mcpCopy, 'the two copies take different parameters');
    assert.doesNotMatch(hooks, /\bkey\b/, hooks);
});


// ------------------------------------------------------------------ workspace.json (the workspace.json design, Task 3)

test('the chain reads a workspace.json tree, an old-file tree and a mixed tree alike', () =>
{
    const records = {
        'ws': { children: ['api'], ignore: { skill: ['tdd'] } },
        'ws/api': { parent: '..', children: ['tool'], ignore: { secret: ['B'] } },
        'ws/api/tool': { parent: '..', ignore: { env: ['ALFRED_CODE_SCORER'] } },
    };
    const read = (legacyOf) =>
    {
        const at = tree(Object.fromEntries(Object.keys(records).map((rel) => [rel, { stamp: true }])));
        for (const [rel, record] of Object.entries(records)) putWorkspace(at(rel), record, { legacy: legacyOf(rel) });
        const got = layout.workspaceChain(at('ws/api/tool'), { env: env0 });
        return { members: got.members.map((m) => [path.relative(at(), m.root), m.rel, m.dataRoot, m.ignores]), notes: got.notes, ignores: got.ignores };
    };
    const json = read(() => false);
    assert.strictEqual(json.members.length, 2, JSON.stringify(json));
    assert.deepStrictEqual(read(() => true), json, 'the old files read as workspace.json does');
    assert.deepStrictEqual(read((rel) => rel === 'ws'), json, 'a workspace.json child below an old-file parent');
    assert.deepStrictEqual(read((rel) => rel !== 'ws'), json, 'an old-file child below a workspace.json parent');
    // a refused hop's note names the file the record was read from
    const at = tree({ 'ws': { stamp: true }, 'ws/api': { stamp: true } });
    putWorkspace(at('ws'), {}, { legacy: false });
    putWorkspace(at('ws/api'), { parent: '..' }, { legacy: false });
    assert.deepStrictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).notes, ['!! workspace: parent .. in .alfred/workspace.json ignored - .. does not list this folder as a child']);
});

test('a garbage workspace.json reads as no record, and the old file beside it is not read', () =>
{
    const at = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true } });
    putWorkspace(at('ws/api'), { parent: '..' }, { legacy: true });
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', 'workspace.json'), '{ "parent": ".." ');
    assert.strictEqual(layout.ownWorkspace(at('ws/api'), { env: env0 }).parent, null);
    assert.deepStrictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).members, []);
});

test('layout.js requires only Node\'s own modules and ./workspace-file.js', () =>
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'layout.js'), 'utf8');
    const required = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    const builtin = require('node:module').builtinModules;
    assert.deepStrictEqual(required.filter((r) => !builtin.includes(r.replace(/^node:/, '')) && r !== './workspace-file.js'), []);
    assert.ok(required.includes('./workspace-file.js'), required.join(', '));
});

// workspace.json design, Section 1 (the session-start line): the walk names each garbage record it read, the start's own first.
test('the chain names each garbage record it reads', () =>
{
    const put = (dir, text) => { fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true }); fs.writeFileSync(path.join(dir, '.alfred', 'workspace.json'), text); };
    const valid = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    const v = layout.workspaceChain(valid('ws/api'), { env: env0 });
    assert.deepStrictEqual(v.garbage, []);
    assert.strictEqual(v.members.length, 1);
    const empty = tree({ 'p': { stamp: true } });
    put(empty('p'), '');
    assert.deepStrictEqual(layout.workspaceChain(empty('p'), { env: env0 }).garbage, [], 'an empty workspace.json is an empty record');
    const own = tree({ 'ws': { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true } });
    put(own('ws/api'), '{');
    const o = layout.workspaceChain(own('ws/api'), { env: env0 });
    assert.deepStrictEqual(o.garbage, ['.alfred/workspace.json']);
    assert.deepStrictEqual(o.members, []);
    const root = tree({ 'ws': { stamp: true }, 'ws/api': { stamp: true } });
    put(root('ws'), '{"children": [');
    put(root('ws/api'), '{"parent": ".."}');
    const r = layout.workspaceChain(root('ws/api'), { env: env0 });
    assert.deepStrictEqual(r.garbage, ['../.alfred/workspace.json']);
    assert.deepStrictEqual(r.members, []);
    assert.strictEqual(r.notes.length, 1, r.notes.join('\n'));
    assert.match(r.notes[0], /\.\.\/\.alfred\/workspace\.json is not valid JSON/);
    assert.doesNotMatch(r.notes[0], /does not list/);
});

// The fixed root (2026-11-11): a member's record is always <member>/.alfred's - no settings key names another folder.
test('fixed root: the parent hop reads <parent>/.alfred whatever a settings key says', () =>
{
    const at = tree({
        'ws': { stamp: true, record: { children: ['api'] }, settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) },
        'ws/api': { stamp: true, record: { parent: '..' } },
    });
    const chain = layout.workspaceChain(at('ws/api'), { env: env0 });
    assert.deepStrictEqual(chain.members.map((m) => [m.rel, m.dataRoot]), [['..', '.alfred']]);
    assert.deepStrictEqual(chain.notes, []);
});

// The installer side reads an older install's unmoved folder through the hooks' loader by naming it; a hook never does.
test('fixed root: variablesOf takes a dataRoot option', () =>
{
    const at = tree({ 'p': { stamp: true, data: 'var/data', vars: 'ALFRED_CODE_HISTORY=5\n' } });
    fs.mkdirSync(path.join(at('p'), '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(at('p'), '.alfred', '.variables'), 'ALFRED_CODE_HISTORY=9\n');
    assert.strictEqual(layout.variablesOf(at('p'), { env: env0, dataRoot: 'var/data' }).values.ALFRED_CODE_HISTORY, '5');
    assert.strictEqual(layout.variablesOf(at('p'), { env: env0 }).values.ALFRED_CODE_HISTORY, '9');
});

// ---- memberOf (workspace stage 5): the joined member a touched file belongs to, outside the start's own chain ----------
const keyOf = (rel) => require('node:crypto').createHash('sha256').update(rel).digest('hex').slice(0, 12);
const MEMBERS = {
    'ws': { stamp: true, git: true, record: { children: ['api', 'web'] } },
    'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['lib'] } },
    'ws/web': { stamp: true, git: true, record: { parent: '..' } },
    'ws/api/lib': { stamp: true, git: true, record: { parent: '..' } },
    'ws/loose': { stamp: true, git: true },
    'ws/api/loose': { stamp: true, git: true },
    'out': {},
};
const fileIn = (at, rel) => path.join(at('.'), ...rel.split('/'));
const brief = (m) => m && { root: m.root, rel: m.rel, key: m.key, chain: m.chain.map((c) => c.rel) };

test('memberOf: a child, a sibling, a grandchild and a grandchild from its parent', () =>
{
    const at = tree(MEMBERS);
    assert.deepStrictEqual(brief(layout.memberOf(fileIn(at, 'ws/api/src/a.ts'), at('ws'), { env: env0 })),
        { root: at('ws/api'), rel: 'api', key: keyOf('api'), chain: ['api'] });
    assert.deepStrictEqual(brief(layout.memberOf(fileIn(at, 'ws/web/a.ts'), at('ws/api'), { env: env0 })),
        { root: at('ws/web'), rel: 'web', key: keyOf('web'), chain: ['web'] });
    const grand = layout.memberOf(fileIn(at, 'ws/api/lib/a.ts'), at('ws'), { env: env0 });
    assert.deepStrictEqual(brief(grand), { root: at('ws/api/lib'), rel: 'api/lib', key: keyOf('api/lib'), chain: ['api', 'api/lib'] });
    assert.deepStrictEqual(grand.chain.map((c) => [c.root, c.key]), [[at('ws/api'), keyOf('api')], [at('ws/api/lib'), keyOf('api/lib')]]);
    assert.deepStrictEqual(brief(layout.memberOf(fileIn(at, 'ws/api/lib/a.ts'), at('ws/api'), { env: env0 })).chain, ['api/lib']);
});

test('memberOf: null for the start, a chain ancestor, an unjoined project, outside the workspace and the switch off', () =>
{
    const at = tree(MEMBERS);
    const none = (file, start, env = env0) => assert.strictEqual(layout.memberOf(fileIn(at, file), at(start), { env }), null, file);
    none('ws/api/a.ts', 'ws/api');
    none('ws/a.ts', 'ws/api');
    none('ws/loose/a.ts', 'ws');
    none('ws/api/loose/a.ts', 'ws');
    none('out/a.ts', 'ws');
    assert.strictEqual(layout.memberOf(path.join(os.tmpdir(), 'a.ts'), at('ws'), { env: env0 }), null);
    none('ws/api/a.ts', 'ws', { ...env0, ALFRED_CODE_WORKSPACE: '0' });
    const solo = tree({ 'solo': { stamp: true, git: true }, 'solo/sub': { stamp: true, git: true } });
    assert.strictEqual(layout.memberOf(path.join(solo('solo/sub'), 'a.ts'), solo('solo'), { env: env0 }), null);
});

test('memberOf: a garbage child record sends nothing; a new path, a .. segment and a link find the member', () =>
{
    const at = tree(MEMBERS);
    fs.writeFileSync(path.join(at('ws/web'), '.alfred', 'workspace.json'), '{');
    assert.strictEqual(layout.memberOf(fileIn(at, 'ws/web/a.ts'), at('ws'), { env: env0 }), null);
    const root = (file) => (layout.memberOf(file, at('ws'), { env: env0 }) || {}).root;
    assert.strictEqual(root(fileIn(at, 'ws/api/new/dir/a.ts')), at('ws/api'));
    assert.strictEqual(root(path.join(at('ws/web'), '..', 'api', 'a.ts')), at('ws/api'));
    if (process.platform === 'win32') return;   // a symlink needs rights a Windows runner may lack
    fs.symlinkSync(at('ws/api'), path.join(at('.'), 'ln'));
    assert.strictEqual(root(path.join(at('.'), 'ln', 'a.ts')), at('ws/api'));
});

test('memberOf: a linked worktree of a member, and a sub-folder member in a worktree of the root', () =>
{
    const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
    const at = tree(MEMBERS);
    g(at('ws/api'), 'commit', '-q', '--allow-empty', '-m', 'x');
    g(at('ws/api'), 'worktree', 'add', '-q', path.join(at('.'), 'wt-api'));
    assert.strictEqual((layout.memberOf(path.join(at('.'), 'wt-api', 'src', 'a.ts'), at('ws'), { env: env0 }) || {}).root, at('ws/api'));
    const one = tree({ 'ws': { stamp: true, git: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    g(one('ws'), 'commit', '-q', '--allow-empty', '-m', 'x');
    g(one('ws'), 'worktree', 'add', '-q', path.join(one('.'), 'wt'));
    assert.strictEqual((layout.memberOf(path.join(one('.'), 'wt', 'api', 'a.ts'), one('ws'), { env: env0 }) || {}).root, one('ws/api'));
});

// ---- workspace stage 6: a member's holds - enterMember, and hasMembers, the test made before the owner lookup ----------
test('enterMember: the docs path and the off-list follow the member, and undo restores both', () =>
{
    const at = tree({ 'm': { stamp: true, settings: JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'notes/docs', ALFRED_CODE_HOOKS_OFF: 'docs-session:gate' } }) } });
    const env = { ...env0, ALFRED_CODE_HOOKS_OFF: 'x' };
    const copy = { ...env };
    const undo = layout.enterMember(at('m'), env);
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, path.join(at('m'), 'notes', 'docs'));
    assert.strictEqual(env.ALFRED_CODE_HOOKS_OFF, 'x,docs-session:gate');
    undo();
    assert.deepStrictEqual(env, copy);
    const bare = { ...env0 };
    const undo2 = layout.enterMember(at('m'), bare);
    assert.strictEqual(bare.ALFRED_CODE_HOOKS_OFF, 'docs-session:gate');
    undo2();
    assert.deepStrictEqual(bare, { ...env0 });
});

test('hasMembers: true only where the start\'s chain lists another member', () =>
{
    const at = tree({ ...MEMBERS, 'solo': { stamp: true, git: true }, 'one': { stamp: true, git: true, record: { children: ['a'] } }, 'one/a': { stamp: true, git: true, record: { parent: '..' } } });
    const has = (rel, env = env0) => layout.hasMembers(at(rel), { env });
    const seen = [];
    const read = fs.readFileSync;
    fs.readFileSync = (p, ...rest) => { seen.push(String(p)); return read(p, ...rest); };
    let solo;
    try { solo = has('solo'); } finally { fs.readFileSync = read; }
    assert.strictEqual(solo, false);
    assert.deepStrictEqual(seen.filter((p) => !/[\\/]\.alfred[\\/](?:workspace\.json|workspace)$/.test(p)), []);
    assert.strictEqual(has('ws'), true);
    assert.strictEqual(has('ws/web'), true);
    assert.strictEqual(has('one/a'), false);
    assert.strictEqual(has('ws', { ...env0, ALFRED_CODE_WORKSPACE: '0' }), false);
    const lone = tree({ 'ws': { stamp: true, git: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['lib'] } }, 'ws/api/lib': { stamp: true, git: true, record: { parent: '..' } } });
    assert.strictEqual(layout.hasMembers(lone('ws/api'), { env: env0 }), true);
    fs.writeFileSync(path.join(at('ws'), '.alfred', 'workspace.json'), '{');
    assert.strictEqual(has('ws'), false);
    const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
    const wt = tree({ 'ws': { stamp: true, git: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, record: { parent: '..' } } });
    g(wt('ws'), 'commit', '-q', '--allow-empty', '-m', 'x');
    g(wt('ws'), 'worktree', 'add', '-q', path.join(wt('.'), 'wt'));
    assert.strictEqual(layout.hasMembers(path.join(wt('.'), 'wt'), { env: env0 }), true);
});
