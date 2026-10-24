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
        assert.strictEqual(lsp.coverageLine(r), "lsp: none covers this project's files - navigation starts at the grep; ts-lsp's tsls is not on PATH; /alfred-code:update checks again");
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

// Final review I2: git hands over its whole list at once, so a cap there only cut covered files off - a repo whose first
// 20,000 paths are assets read as covering nothing.
test('in git every file is read, past the walk cap', () =>
{
    const s = sandbox();
    try
    {
        s.commit(['a.a', 'b.b', 'c.c', 'd.d']);
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root, walkCap: 3 })].sort(), ['.a', '.b', '.c', '.d']);
        assert.strictEqual(lsp.scanProject({ projectRoot: s.root, walkCap: 3 }).capped, false);
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
        assert.deepStrictEqual(lsp.readCoverage(s.root), { ...result, checked: '2026-10-24', settled: true });
        fs.writeFileSync(file, '{ not json');
        assert.strictEqual(lsp.readCoverage(s.root), null);
    }
    finally { s.done(); }
});

test('coverageLine: the states', () =>
{
    assert.strictEqual(lsp.coverageLine(null), 'lsp: not checked yet - the next update or /alfred-code:init checks it');
    assert.strictEqual(lsp.coverageLine({ servers: [], covered: [], missing: [] }), "lsp: none covers this project's files - navigation starts at the grep; /alfred-code:update checks again");
    assert.strictEqual(lsp.coverageLine({ servers: [], covered: [], missing: [], settled: false, why: 'empty' }), 'lsp: not settled - the project holds no files yet, so LSP stays in the order; /alfred-code:update checks again');
    assert.strictEqual(lsp.coverageLine({ servers: [], covered: [], missing: [], settled: false, why: 'capped' }), `lsp: not settled - the walk stopped at ${lsp.WALK_CAP} files before a covered one, so LSP stays in the order; /alfred-code:update checks again`);
    assert.strictEqual(lsp.coverageLine({ servers: [{ plugin: 'ts-lsp', command: 'tsls', onPath: true, exts: ['.ts', '.tsx'] }], covered: ['.ts', '.tsx'], missing: [] }), 'lsp: covers .ts, .tsx (ts-lsp)');
});

test('in git, files not committed yet count, and ignored ones do not', () =>
{
    const s = sandbox();
    try
    {
        spawnSync('git', ['init', '-q'], { cwd: s.root });
        writeText(path.join(s.root, 'src', 'a.ts'), 'x\n');
        writeText(path.join(s.root, '.gitignore'), 'build/\n');
        writeText(path.join(s.root, 'build', 'out.js'), 'x\n');
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root })].sort(), ['.ts'], 'a fresh repo with nothing committed still holds its .ts');
    }
    finally { s.done(); }
});

// Final review I3: a 'none' read off an empty project or a cut-short walk is no finding - it would drop LSP from every
// session until the next update - so it is written as not settled, and the order keeps LSP.
test('an empty project and a capped walk that found nothing are not settled', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest' }] });
    try
    {
        s.stub('tsls');
        const empty = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual([empty.settled, empty.why, empty.covered], [false, 'empty', []]);
        for (const f of ['a.a', 'b.b', 'c.c', 'x.ts']) writeText(path.join(s.root, f), 'x');
        const capped = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled, walkCap: 3 });
        assert.deepStrictEqual([capped.settled, capped.why, capped.covered], [false, 'capped', []]);
        const whole = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual([whole.settled, whole.covered], [true, ['.ts']]);
        writeText(path.join(s.root, 'd.d'), 'x');
        const none = lsp.computeCoverage({ projectRoot: s.root, env: { ...s.env, PATH: '' }, enabled: s.enabled });
        assert.deepStrictEqual([none.settled, none.covered], [true, []], 'a whole walk that found nothing is settled');
        assert.strictEqual(lsp.writeCoverage(s.root, capped), true);
        assert.strictEqual(lsp.readCoverage(s.root).settled, false);
    }
    finally { s.done(); }
});

// Final review M1: Claude Code expands ${CLAUDE_PLUGIN_ROOT} in a server's command, so a plugin shipping its own binary
// read as not on PATH; a variable the check cannot resolve is taken as present, never as missing.
test('a command under ${CLAUDE_PLUGIN_ROOT} resolves against the install path, and an unresolvable one is taken as present', () =>
{
    const s = sandbox({ plugins: [{ name: 'own-lsp', command: '${CLAUDE_PLUGIN_ROOT}/bin/srv', exts: ['.ts'], decl: 'file' }, { name: 'data-lsp', command: '${CLAUDE_PLUGIN_DATA}/srv', exts: ['.py'], decl: 'file' }] });
    try
    {
        writeText(path.join(s.work, 'cache', 'own-lsp', 'bin', 'srv'), '#!/bin/sh\n');
        for (const f of ['a.ts', 'b.py']) writeText(path.join(s.root, f), 'x');
        const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual(r.covered, ['.py', '.ts'], JSON.stringify(r));
        assert.deepStrictEqual(r.missing, []);
        const inProject = path.join(s.root, 'tools', 'srv');
        assert.strictEqual(lsp.onPath('${CLAUDE_PROJECT_DIR}/tools/srv', s.env, process.platform, { CLAUDE_PROJECT_DIR: s.root }), false, 'resolved, and absent');
        writeText(inProject, '#!/bin/sh\n');
        assert.strictEqual(lsp.onPath('${CLAUDE_PROJECT_DIR}/tools/srv', s.env, process.platform, { CLAUDE_PROJECT_DIR: s.root }), true);
        assert.strictEqual(lsp.onPath('${HOME}/srv', { ...s.env, HOME: s.work }, process.platform), true, 'a variable Claude Code does not name is not guessed');
        fs.rmSync(path.join(s.work, 'cache', 'own-lsp', 'bin', 'srv'));
        assert.deepStrictEqual(lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled }).missing, [{ plugin: 'own-lsp', command: '${CLAUDE_PLUGIN_ROOT}/bin/srv' }]);
    }
    finally { s.done(); }
});

// Final review M2: two servers of one plugin may share a command (one binary, two languages) - both keep their file types.
test('two servers sharing a command keep both servers\' extensions', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'file' }] });
    try
    {
        writeJson(path.join(s.work, 'cache', TS.name, '.lsp.json'), { ts: { command: 'tsls', extensionToLanguage: { '.ts': 'typescript' } }, js: { command: 'tsls', extensionToLanguage: { '.js': 'javascript' } } });
        assert.deepStrictEqual(lsp.declaredServers(path.join(s.work, 'cache', TS.name), TS.name, null), [{ command: 'tsls', exts: ['.js', '.ts'] }]);
    }
    finally { s.done(); }
});

// Matrix case 17: git lists the stack's own files too (.claude/hooks/*.js, the data root), so a project holding nothing else
// read as settled - and as covered wherever a server maps .js or .md. Git's list skips what the walk skips.
test('in git the walk\'s skipped folders are skipped too: .claude, node_modules and the data root at any depth they apply', () =>
{
    const s = sandbox();
    try
    {
        spawnSync('git', ['init', '-q'], { cwd: s.root });
        for (const f of ['.claude/hooks/docs.js', '.claude/rules/r.md', '.alfred/docs/a.md', 'node_modules/p/i.js', 'pkg/.claude/x.js']) writeText(path.join(s.root, f), 'x\n');
        const empty = lsp.scanProject({ projectRoot: s.root });
        assert.deepStrictEqual([empty.files, [...empty.exts]], [0, []], 'only the stack\'s and the packages\' files: nothing of the project\'s');
        writeText(path.join(s.root, 'src', 'a.ts'), 'x\n');
        writeText(path.join(s.root, 'docs', '.alfred', 'b.py'), 'x\n');
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root })].sort(), ['.py', '.ts'], 'the data root is skipped at the top only, as the walk does');
    }
    finally { s.done(); }
});

test('a nested data root is skipped by its whole path, its parent folder still read', () =>
{
    const s = sandbox();
    try
    {
        writeJson(path.join(s.root, '.claude', 'settings.json'), { env: { ALFRED_CODE_DATA_PATH: 'docs/alfred' } });
        for (const f of ['docs/alfred/state/x.js', 'docs/guide.md']) writeText(path.join(s.root, f), 'x\n');
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root })], ['.md'], 'outside git');
        spawnSync('git', ['init', '-q'], { cwd: s.root });
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root })], ['.md'], 'in git');
    }
    finally { s.done(); }
});

// Final review M3: a plugin no settings file names is on by its own default - `defaultEnabled`, the marketplace entry's over
// the manifest's, true when none sets it; a settings entry still decides when there is one.
test('a plugin the settings do not name follows its defaultEnabled, the marketplace entry over the manifest', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest' }] });
    try
    {
        s.stub('tsls');
        writeText(path.join(s.root, 'a.ts'), 'x');
        const covered = (enabled) => lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled }).covered;
        assert.deepStrictEqual(covered(new Map()), ['.ts'], 'no entry and no defaultEnabled: on');
        const manifest = path.join(s.work, 'cache', TS.name, '.claude-plugin', 'plugin.json');
        writeJson(manifest, { ...JSON.parse(fs.readFileSync(manifest, 'utf8')), defaultEnabled: false });
        assert.deepStrictEqual(covered(new Map()), [], 'the manifest says off');
        writeJson(path.join(s.work, 'market', '.claude-plugin', 'marketplace.json'), { name: 'demo', plugins: [{ name: TS.name, source: './x', defaultEnabled: true }] });
        assert.deepStrictEqual(covered(new Map()), ['.ts'], 'the marketplace entry wins over the manifest');
        assert.deepStrictEqual(covered(new Map([[TS.name, false]])), [], 'a settings entry decides');
    }
    finally { s.done(); }
});

// Fix-pass review m6: a plugin an enabled plugin depends on starts enabled whatever its defaultEnabled - in every form a
// dependency is written, a bare name resolving against the dependent's own marketplace (plugins-reference, `dependencies`).
test('a plugin an enabled plugin depends on is on, whatever its defaultEnabled', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest' }, { name: 'host', command: 'hostls', exts: ['.go'], decl: 'manifest' }] });
    try
    {
        s.stub('tsls');
        writeText(path.join(s.root, 'a.ts'), 'x');
        const edit = (name, change) => { const file = path.join(s.work, 'cache', name, '.claude-plugin', 'plugin.json'); writeJson(file, { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...change }); };
        const covered = (enabled) => lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled }).covered;
        edit(TS.name, { defaultEnabled: false });
        assert.deepStrictEqual(covered(new Map([['host', true]])), [], 'no dependency yet: off by its default');
        for (const dep of [TS.name, `${TS.name}@demo`, { name: TS.name }, { name: TS.name, marketplace: 'demo', version: '^1.0.0' }])
        {
            edit('host', { dependencies: [dep] });
            assert.deepStrictEqual(covered(new Map([['host', true]])), ['.ts'], JSON.stringify(dep));
        }
        assert.deepStrictEqual(covered(new Map([['host', false]])), [], 'the dependent switched off takes nothing on');
        assert.deepStrictEqual(covered(new Map([['host', true], [TS.name, false]])), [], 'a settings entry for the dependency still decides');
        edit('host', { dependencies: [`${TS.name}@elsewhere`] });
        assert.deepStrictEqual(covered(new Map([['host', true]])), [], 'another marketplace\'s plugin of the name is not this one');
    }
    finally { s.done(); }
});

// Fix-pass review m7: two install records of one plugin in different folders each resolve ${CLAUDE_PLUGIN_ROOT} against
// their own - the record listed first lacking the binary no longer hides the one that has it.
test('each install folder resolves its own ${CLAUDE_PLUGIN_ROOT}', () =>
{
    const s = sandbox({ plugins: [{ name: 'own-lsp', command: '${CLAUDE_PLUGIN_ROOT}/bin/srv', exts: ['.ts'], decl: 'file' }] });
    try
    {
        const second = path.join(s.work, 'cache', 'own-lsp-project');
        fs.cpSync(path.join(s.work, 'cache', 'own-lsp'), second, { recursive: true });
        writeText(path.join(second, 'bin', 'srv'), '#!/bin/sh\n');
        const registry = path.join(s.config, 'plugins', 'installed_plugins.json');
        const data = JSON.parse(fs.readFileSync(registry, 'utf8'));
        data.plugins['own-lsp@demo'].push({ scope: 'project', projectPath: s.root, installPath: second });
        writeJson(registry, data);
        writeText(path.join(s.root, 'a.ts'), 'x');
        const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual(r.covered, ['.ts'], JSON.stringify(r));
        assert.deepStrictEqual(r.missing, []);
        assert.deepStrictEqual(r.servers, [{ plugin: 'own-lsp', command: '${CLAUDE_PLUGIN_ROOT}/bin/srv', onPath: true, exts: ['.ts'] }], 'one row per plugin and command');
    }
    finally { s.done(); }
});

// Final review M7: a server missing beside one that covers is named - the mixed repo's other language has no LSP. One whose
// file types another server already covers is not.
test('a missing server is named beside one that covers, unless another covers its file types', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest' }, { name: 'cs-lsp', command: 'csls', exts: ['.cs'], decl: 'manifest' }, { name: 'ts2-lsp', command: 'tsls2', exts: ['.ts'], decl: 'manifest' }] });
    try
    {
        s.stub('tsls');
        for (const f of ['a.ts', 'b.cs']) writeText(path.join(s.root, f), 'x');
        const r = lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled });
        assert.deepStrictEqual(r.missing, [{ plugin: 'cs-lsp', command: 'csls' }]);
        assert.strictEqual(lsp.coverageLine(r), "lsp: covers .ts (ts-lsp); cs-lsp's csls is not on PATH");
    }
    finally { s.done(); }
});

// Final review M9: the positive half of a project-scope record, and git's untracked files read with the tracked ones.
test('a project-scope install record naming this project covers it', () =>
{
    const s = sandbox({ plugins: [{ ...TS, decl: 'manifest', projectPath: null }] });
    try
    {
        const registry = path.join(s.config, 'plugins', 'installed_plugins.json');
        const data = JSON.parse(fs.readFileSync(registry, 'utf8'));
        data.plugins[`${TS.name}@demo`][0] = { ...data.plugins[`${TS.name}@demo`][0], scope: 'project', projectPath: s.root };
        writeJson(registry, data);
        s.stub('tsls');
        writeText(path.join(s.root, 'a.ts'), 'x');
        assert.deepStrictEqual(lsp.computeCoverage({ projectRoot: s.root, env: s.env, enabled: s.enabled }).covered, ['.ts']);
    }
    finally { s.done(); }
});

test('in git the untracked files are read beside the tracked ones, whatever the walk cap', () =>
{
    const s = sandbox();
    try
    {
        s.commit(['z.z']);
        for (const f of ['a.a', 'b.b']) writeText(path.join(s.root, f), 'x\n');
        assert.deepStrictEqual([...lsp.projectExtensions({ projectRoot: s.root, walkCap: 1 })].sort(), ['.a', '.b', '.z']);
    }
    finally { s.done(); }
});
