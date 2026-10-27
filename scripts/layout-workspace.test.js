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
        'ws': { stamp: true, file: 'child api\nignore skill tdd\n' },
        'ws/api': { stamp: true, file: 'parent ..\nchild tool\nignore secret B\nignore doc TOOLS-PREFERENCES.md\n' },
        'ws/api/tool': { stamp: true, file: 'parent ..\n' },
    });
    same(three('ws/api/tool'));
    same(three('ws/api'));
    same(three('ws'));
    // a refused hop: the parent does not list the child
    const refused = tree({ 'ws': { stamp: true, file: '# none\n' }, 'ws/api': { stamp: true, file: 'parent ..\n' } });
    same(refused('ws/api'));
    // a missing parent and an unstamped one
    const missing = tree({ 'ws/api': { stamp: true, file: 'parent ../..\n' } });
    same(missing('ws/api'));
    const unstamped = tree({ 'ws': { file: 'child api\n' }, 'ws/api': { stamp: true, file: 'parent ..\n' } });
    same(unstamped('ws/api'));
    // a cycle back to a member already in the chain
    const loop = tree({ 'ws': { stamp: true, file: 'parent ..\nchild ws\n' } });
    const top = path.dirname(loop('ws'));
    fs.mkdirSync(path.join(top, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(top, '.claude', 'alfred-code.stamp'), STAMP);
    fs.mkdirSync(path.join(top, '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(top, '.alfred', 'workspace'), 'parent ws\nchild ws\n');
    same(loop('ws'));
    // a parent whose data root is custom (settings.local.json) and one whose settings.json names an invalid root
    const custom = tree({
        'ws': { stamp: true, data: 'var/data', file: 'child api\n', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) },
        'ws/api': { stamp: true, file: 'parent ..\n' },
    });
    same(custom('ws/api'));
    assert.strictEqual(layout.workspaceChain(custom('ws/api'), { env: env0 }).members[0].dataRoot, 'var/data');
    const invalid = tree({
        'ws': { stamp: true, file: 'child api\n', settings: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '/abs/root' } }) },
        'ws/api': { stamp: true, file: 'parent ..\n' },
    });
    same(invalid('ws/api'));
    // the child's own data root from its settings, and the run's env never naming an ancestor's root
    const own = tree({
        'ws': { stamp: true, file: 'child api\n' },
        'ws/api': { stamp: true, data: '.kid', file: 'parent ..\n', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: '.kid' } }) },
    });
    same(own('ws/api'));
    same(own('ws/api'), { ...env0, ALFRED_CODE_DATA_PATH: '.kid' });
    assert.strictEqual(layout.workspaceChain(own('ws/api'), { env: env0 }).members.length, 1);
});

test('workspaceChain depth 7, 8 and 9 matches chain()', () =>
{
    for (const [depth, want] of [[7, 7], [8, 8], [9, 8]])
    {
        const spec = {};
        const names = Array.from({ length: depth + 1 }, (_, i) => `d${i}`);
        for (let i = 0; i <= depth; i++)
        {
            const lines = [];
            if (i > 0) lines.push('parent ..');
            if (i < depth) lines.push(`child ${names[i + 1]}`);
            spec[names.slice(0, i + 1).join('/')] = { stamp: true, file: `${lines.join('\n')}\n` };
        }
        const at = tree(spec);
        same(at(names.join('/')));
        assert.strictEqual(layout.workspaceChain(at(names.join('/')), { env: env0 }).members.length, want, `depth ${depth}`);
    }
});

test('a symlinked spelling of the child reads the real chain, as chain() does', { skip: process.platform === 'win32' }, () =>
{
    const at = tree({ 'ws': { stamp: true, file: 'child api\n' }, 'other': { stamp: true, file: 'child api\n' }, 'other/api': { stamp: true, file: 'parent ..\n' } });
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
        ws: { stamp: true, file: 'child api\n', vars: 'ALFRED_CODE_WORKSPACE=0\n', settings: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) },
        'ws/api': { stamp: true, file: 'parent ..\n' },
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
    const at = tree({
        'ws': { stamp: true, file: '\uFEFFgarbage line here\r\nchild api\r\nignore nope x\r\n' },
        'ws/api': { stamp: true, file: 'this is not a line\nparent ..\nignore secret API_KEY\n' },
    });
    same(at('ws/api'));
    assert.strictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).members.length, 1);
    assert.deepStrictEqual(layout.ownWorkspace(at('ws/api'), { env: env0 }), { parent: '..', ignores: [{ category: 'secret', name: 'API_KEY' }] });
});

test('ownWorkspace reads the project\'s own file at its data root, and is empty without one', () =>
{
    const at = tree({ 'p': { data: 'var/d', file: 'parent none\nignore mcp db\n', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/d' } }) }, 'q': {} });
    assert.deepStrictEqual(layout.ownWorkspace(at('p'), { env: env0 }), { parent: null, ignores: [{ category: 'mcp', name: 'db' }] });
    assert.deepStrictEqual(layout.ownWorkspace(at('q'), { env: env0 }), { parent: null, ignores: [] });
});

test('dataRootOf reads env, then settings.local.json, settings.json, the account; an invalid value is .alfred', () =>
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
    assert.strictEqual(layout.dataRootOf(at('a'), { env: env0 }), '.alfred');
    assert.strictEqual(layout.dataRootOf(at('a'), { env }), 'acct/root');
    assert.strictEqual(layout.dataRootOf(at('b'), { env }), 'shared/root');
    assert.strictEqual(layout.dataRootOf(at('c'), { env }), 'mine');
    assert.strictEqual(layout.dataRootOf(at('c'), { env: { ...env, ALFRED_CODE_DATA_PATH: 'from/env' } }), 'from/env');
    assert.strictEqual(layout.dataRootOf(at('d'), { env }), '.alfred', 'a root outside the project is refused');
    for (const p of ['a', 'b', 'c', 'd', 'e']) assert.strictEqual(layout.dataRootOf(at(p), { env }), require('../stack/mcp/data-root.js').dataRootOf({ env, projectDir: at(p) }).root, p);
});

test('the kill switch is the caller\'s: workspaceChain reads the chain whatever it says', () =>
{
    const at = tree({ 'ws': { stamp: true, file: 'child api\n' }, 'ws/api': { stamp: true, file: 'parent ..\n', local: JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } }) } });
    assert.strictEqual(layout.workspaceChain(at('ws/api'), { env: env0 }).members.length, 1);
    assert.strictEqual(layout.workspaceOn({ env: env0, projectRoot: at('ws/api') }), false);
});
