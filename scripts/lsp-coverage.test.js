'use strict';
// Whether a language server covers the project (spec N2): the enabled plugins' declared servers, each on PATH or not,
// against the file types the project holds. Checked at install time, read at every start, so LSP leaves the tool order
// only where it would answer nothing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lsp = require(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'lsp-coverage.js'));

delete process.env.ALFRED_CODE_DATA_PATH;

const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const writeText = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A config dir with one installed plugin per entry of `plugins` ({ name, decl: 'manifest' | 'market' | 'file', projectPath }),
// each declaring one server, `command` mapping `exts`; a project dir; and a bin dir for stub commands.
function sandbox({ plugins = [] } = {})
{
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-coverage-')));
    const config = path.join(work, 'config');
    const root = path.join(work, 'repo');
    const bin = path.join(work, 'bin');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    const market = path.join(work, 'market');
    const records = {};
    const entries = [];
    for (const p of plugins)
    {
        const installPath = path.join(work, 'cache', p.name);
        fs.mkdirSync(installPath, { recursive: true });
        const servers = { [p.name]: { command: p.command, extensionToLanguage: Object.fromEntries(p.exts.map((e) => [e, 'lang'])) } };
        if (p.decl === 'manifest') writeJson(path.join(installPath, '.claude-plugin', 'plugin.json'), { name: p.name, lspServers: servers });
        if (p.decl === 'file') writeJson(path.join(installPath, '.lsp.json'), servers);
        if (p.decl === 'market') entries.push({ name: p.name, source: `./plugins/${p.name}`, lspServers: servers });
        const record = p.projectPath ? { scope: 'project', projectPath: p.projectPath, installPath } : { scope: 'user', installPath };
        records[`${p.name}@demo`] = [record];
    }
    writeJson(path.join(market, '.claude-plugin', 'marketplace.json'), { name: 'demo', plugins: entries });
    writeJson(path.join(config, 'plugins', 'installed_plugins.json'), { version: 2, plugins: records });
    writeJson(path.join(config, 'plugins', 'known_marketplaces.json'), { demo: { installLocation: market } });
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, PATH: bin };
    const enabled = new Map(plugins.map((p) => [p.name, p.enabled !== false]));
    const stub = (name) => { const f = path.join(bin, name); writeText(f, '#!/bin/sh\n'); fs.chmodSync(f, 0o755); return f; };
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    const commit = (files) =>
    {
        git('init', '-q');
        for (const f of files) writeText(path.join(root, f), 'x\n');
        git('add', '-A');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
    };
    return { work, config, root, bin, env, enabled, stub, commit, done: () => fs.rmSync(work, { recursive: true, force: true }) };
}
const TS = { name: 'ts-lsp', command: 'tsls', exts: ['.ts', '.tsx'] };

test('a server is read from plugin.json lspServers, a marketplace entry and .lsp.json', () =>
{
    for (const decl of ['manifest', 'market', 'file'])
    {
        const s = sandbox({ plugins: [{ ...TS, decl }] });
        try
        {
            const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
            assert.deepStrictEqual(r.servers, [{ plugin: 'ts-lsp', command: 'tsls', onPath: false, exts: ['.ts', '.tsx'] }], decl);
        }
        finally { s.done(); }
    }
});

test('a plugin the settings switch off covers nothing', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest', enabled: false }] });
    try
    {
        s.stub('tsls');
        s.commit(['a.ts']);
        const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual(r.servers, []);
        assert.deepStrictEqual(r.covered, []);
    }
    finally { s.done(); }
});

test('an install record naming another project covers nothing', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest', projectPath: os.tmpdir() }] });
    try
    {
        s.stub('tsls');
        s.commit(['a.ts']);
        assert.deepStrictEqual(lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled }).covered, []);
    }
    finally { s.done(); }
});

test('a server on PATH whose extensions match a tracked file covers them', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest', projectPath: null }] });
    try
    {
        s.stub('tsls');
        s.commit(['src/a.ts', 'README.md']);
        const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual(r.covered, ['.ts']);
        assert.strictEqual(r.servers[0].onPath, true);
        assert.strictEqual(lsp.coverageLine(r), 'lsp: covers .ts (ts-lsp)');
    }
    finally { s.done(); }
});

test('a declared server whose command is not on PATH covers nothing, and the line names it', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest' }] });
    try
    {
        s.commit(['a.ts']);
        const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.strictEqual(r.servers[0].onPath, false);
        assert.deepStrictEqual(r.covered, []);
        assert.deepStrictEqual(r.missing, [{ plugin: 'ts-lsp', command: 'tsls' }]);
        assert.strictEqual(lsp.coverageLine(r), "lsp: none covers this project's files - navigation starts at the grep; ts-lsp's tsls is not on PATH");
    }
    finally { s.done(); }
});

test('on win32 a .cmd shim on PATH is found through PATHEXT', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest' }] });
    try
    {
        fs.writeFileSync(path.join(s.bin, 'tsls.cmd'), '@echo off\r\n');
        s.commit(['a.ts']);
        const env = { ...s.env, PATH: s.bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
        assert.deepStrictEqual(lsp.computeCoverage({ projectRoot: s.root, env, enabled: s.enabled, platform: 'win32' }).covered, ['.ts']);
        assert.deepStrictEqual(lsp.computeCoverage({ projectRoot: s.root, env, enabled: s.enabled, platform: 'linux' }).covered, [], 'no PATHEXT off win32');
    }
    finally { s.done(); }
});

test('outside git the walk skips .git, node_modules, .claude and the data root, and stops at the cap', () =>
{
    const s = sandbox();
    try
    {
        for (const f of ['node_modules/x.n', '.claude/x.c', '.alfred/docs/x.d', '.git/x.g']) writeText(path.join(s.root, f), 'x');
        const exts = (cap) => [...lsp.projectExtensions({ projectRoot: s.root, walkCap: cap })].sort();
        writeText(path.join(s.root, 'a.a'), 'x');
        writeText(path.join(s.root, 'b.b'), 'x');
        assert.deepStrictEqual(exts(3), ['.a', '.b'], 'one under the cap');
        writeText(path.join(s.root, 'c.c'), 'x');
        assert.deepStrictEqual(exts(3), ['.a', '.b', '.c'], 'at the cap');
        writeText(path.join(s.root, 'd.d'), 'x');
        assert.deepStrictEqual(exts(3), ['.a', '.b', '.c'], 'one over: the walk stops at the cap');
    }
    finally { s.done(); }
});

test('in git the tracked files are read, up to the cap', () =>
{
    const s = sandbox();
    try
    {
        s.commit(['a.a', 'b.b', 'c.c', 'd.d']);
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root, walkCap: 3 })].sort(), ['.a', '.b', '.c']);
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root })].sort(), ['.a', '.b', '.c', '.d']);
    }
    finally { s.done(); }
});

test('writeCoverage writes the file, then nothing when only the date changed', () =>
{
    const s = sandbox();
    try
    {
        const result = { version: 1, servers: [], covered: [], missing: [] };
        assert.strictEqual(lsp.writeCoverage(s.root, result, { today: '2026-10-24' }), true);
        const file = lsp.coveragePath(s.root);
        assert.strictEqual(file, path.join(s.root, '.alfred', 'state', 'lsp-coverage.json'));
        const before = fs.readFileSync(file, 'utf8');
        assert.strictEqual(lsp.writeCoverage(s.root, result, { today: '2026-10-25' }), false);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
        assert.deepStrictEqual(lsp.readCoverage(s.root), { ...result, checked: '2026-10-24' });
        fs.writeFileSync(file, '{ not json');
        assert.strictEqual(lsp.readCoverage(s.root), null);
    }
    finally { s.done(); }
});

test('coverageLine: the three states', () =>
{
    assert.strictEqual(lsp.coverageLine(null), 'lsp: not checked yet - the next update or /alfred-code:init checks it');
    assert.strictEqual(lsp.coverageLine({ servers: [], covered: [], missing: [] }), "lsp: none covers this project's files - navigation starts at the grep");
    assert.strictEqual(lsp.coverageLine({ servers: [{ plugin: 'ts-lsp', command: 'tsls', onPath: true, exts: ['.ts', '.tsx'] }], covered: ['.ts', '.tsx'], missing: [] }), 'lsp: covers .ts, .tsx (ts-lsp)');
});
