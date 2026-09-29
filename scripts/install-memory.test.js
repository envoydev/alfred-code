'use strict';
// THE MEMORY LAYER OF THE NODE SEED - Phase 7, T4.
//
// Switching Claude's own memory off is the only irreversible-feeling thing an install does, so the
// order is the test: import first, switch off second, and never the second without the first.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const memory = require('./install/memory.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-memory-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project({ settings, rules = ['baseline-memory.md'] } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    for (const r of rules) fs.writeFileSync(path.join(root, '.claude', 'rules', r), '# rule\n');
    if (settings !== undefined) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), settings);
    return root;
}
const settingsOf = (root) => path.join(root, '.claude', 'settings.json');
const GATE = (root, over = {}) => ({
    projectRoot: root, settingsFile: settingsOf(root),
    mcps: ['serena|x', 'memory|y'], rules: ['baseline-memory.md::x'], ...over,
});

// --- the level -> path rule ----------------------------------------------

test('level: the three levels resolve to the three shapes under .alfred-memory, and back again', () =>
{
    const at = { home: '/home/u', space: 'work', projectRoot: '/repo' };
    assert.strictEqual(memory.pathForLevel('global', at), path.join('/home/u', '.alfred-memory', 'memory.db'));
    assert.strictEqual(memory.pathForLevel('scoped', at), path.join('/home/u', '.alfred-memory', 'memory_work.db'));
    assert.strictEqual(memory.pathForLevel('project', at), path.join('/repo', '.alfred', '.alfred-memory', 'memory.db'));
    assert.strictEqual(memory.pathForLevel('project', { ...at, root: '.data' }), path.join('/repo', '.data', '.alfred-memory', 'memory.db'), 'the project database follows the data root');
    assert.strictEqual(memory.pathForLevel('scoped', { ...at, space: '' }), path.join('/home/u', '.alfred-memory', 'memory_default.db'));
    for (const level of ['global', 'scoped', 'project'])
        assert.strictEqual(memory.levelOfPath(memory.pathForLevel(level, at), at), level, level);
});

test('level: a 2.0.0 .memory-mcp path still reads as its level, and resolving it names the .alfred-memory path', () =>
{
    const at = { home: '/home/u', space: 'work', projectRoot: '/repo' };
    assert.strictEqual(memory.levelOfPath(path.join('/home/u', '.memory-mcp', 'memory.db'), at), 'global');
    assert.strictEqual(memory.levelOfPath(path.join('/home/u', '.memory-mcp', 'memory_work.db'), at), 'scoped');
    assert.strictEqual(memory.levelOfPath(path.join('/repo', '.memory-mcp', 'memory.db'), at), 'project');
    assert.deepStrictEqual(memory.resolveLevel({ registeredPath: path.join('/home/u', '.memory-mcp', 'memory_work.db'), ...at }),
        { level: 'scoped', dbPath: path.join('/home/u', '.alfred-memory', 'memory_work.db'), from: 'registration' });
    assert.strictEqual(memory.resolveLevel({ registeredPath: path.join('/repo', '.memory-mcp', 'memory.db'), ...at, root: '.data' }).dbPath,
        path.join('/repo', '.data', '.alfred-memory', 'memory.db'));
});

test('level: a foreign path is never mistaken for one of ours', () =>
{
    const at = { home: '/home/u', projectRoot: '/repo' };
    // Matched EXACTLY, never as a prefix or a substring.
    assert.strictEqual(memory.levelOfPath('/home/u/.memory-mcp/other/memory.db', at), '');
    assert.strictEqual(memory.levelOfPath('/home/u/.memory-mcp-backup/memory.db', at), '');
    assert.strictEqual(memory.levelOfPath('/elsewhere/memory.db', at), '');
    assert.strictEqual(memory.levelOfPath('', at), '');
});

// --- reading the switch ---------------------------------------------------

test('state: absent, true, false and malformed are four different answers', () =>
{
    assert.strictEqual(memory.autoMemoryState(settingsOf(project())), 'absent');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{}' }))), 'absent');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{"autoMemoryEnabled":true}' }))), 'true');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{"autoMemoryEnabled":false}' }))), 'false');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '{ broken' }))), 'malformed');
    assert.strictEqual(memory.autoMemoryState(settingsOf(project({ settings: '[]' }))), 'malformed');
});

// --- writing it -----------------------------------------------------------

test('switch-off: every other key survives, and the file is written once', () =>
{
    const root = project({ settings: '{\n  "env": { "A": "1" },\n  "hooks": {}\n}\n' });
    const logs = [];
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root), { log: (m) => logs.push(m) }), true);
    const data = JSON.parse(fs.readFileSync(settingsOf(root), 'utf8'));
    assert.deepStrictEqual(data, { env: { A: '1' }, hooks: {}, autoMemoryEnabled: false });
    assert.ok(logs.some((m) => /autoMemoryEnabled set to false/.test(m)), logs.join(' | '));
});

test('switch-off: a malformed settings file REFUSES the write and says so', () =>
{
    const root = project({ settings: '{ not json' });
    const logs = [];
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root), { log: (m) => logs.push(m) }), false);
    assert.strictEqual(fs.readFileSync(settingsOf(root), 'utf8'), '{ not json', 'the user\'s file was overwritten');
    assert.ok(logs.some((m) => /not valid JSON - autoMemoryEnabled left untouched/.test(m)), logs.join(' | '));
});

test('switch-off: an absent settings file is created with just the key', () =>
{
    const root = project();
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root)), true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsOf(root), 'utf8')), { autoMemoryEnabled: false });
});

// --- the gate -------------------------------------------------------------

test('gate: everything present is a go', () =>
{
    assert.strictEqual(memory.importGate(GATE(project())).go, true);
});

test('gate: no project root, no memory server, no rule selected, no rule on disk - four different refusals', () =>
{
    const root = project();
    assert.match(memory.importGate(GATE(root, { projectRoot: '' })).reason, /no identifiable project/);
    assert.match(memory.importGate(GATE(root, { mcps: ['serena|x'] })).reason, /memory MCP is not part of this install/);
    assert.match(memory.importGate(GATE(root, { rules: ['baseline-security.md::x'] })).reason, /baseline-memory\.md is not part of this install/);
    const bare = project({ rules: [] });
    assert.match(memory.importGate(GATE(bare)).reason, /did not land in/);
    // Every one of them ends the same way: Claude's own memory stays on.
    for (const g of [GATE(root, { projectRoot: '' }), GATE(root, { mcps: [] }), GATE(root, { rules: [] })])
        assert.match(memory.importGate(g).reason, /stays on/);
});

test('gate: a missing tool is named, and already-off is never re-run', () =>
{
    const root = project();
    assert.match(memory.importGate(GATE(root, { tools: { node: true, uvx: false } })).reason, /uvx not found/);
    const off = project({ settings: '{"autoMemoryEnabled":false}' });
    const gate = memory.importGate(GATE(off));
    assert.strictEqual(gate.go, false);
    assert.strictEqual(gate.already, true);
    assert.strictEqual(gate.reason, undefined, 'an already-off install logged a refusal');
});

// --- the order ------------------------------------------------------------

test('order: a FAILED import leaves Claude\'s own memory ON', () =>
{
    // Never retried into a false success, and the old MEMORY.md is never deleted either way.
    const root = project({ settings: '{}' });
    const importer = path.join(TMP, 'importer.js');
    fs.writeFileSync(importer, '');
    const logs = [];
    const out = memory.importNotes({
        gate: { go: true }, importer, runImport: () => ({ ok: false }),
        settingsFile: settingsOf(root), log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(out, { switchedOff: false, imported: false });
    assert.strictEqual(memory.autoMemoryState(settingsOf(root)), 'absent');
    assert.ok(logs.some((m) => /import failed - Claude's own memory stays ON/.test(m)), logs.join(' | '));
});

test('order: the switch-off happens only AFTER the import succeeds', () =>
{
    const root = project({ settings: '{}' });
    const importer = path.join(TMP, 'importer2.js');
    fs.writeFileSync(importer, '');
    const seen = [];
    const out = memory.importNotes({
        gate: { go: true }, importer,
        runImport: () => { seen.push(`state-at-import:${memory.autoMemoryState(settingsOf(root))}`); return { ok: true }; },
        settingsFile: settingsOf(root),
    });
    assert.deepStrictEqual(seen, ['state-at-import:absent'], 'the switch-off ran before the import');
    assert.strictEqual(out.switchedOff, true);
    assert.strictEqual(memory.autoMemoryState(settingsOf(root)), 'false');
});

test('order: the importer\'s own lines are logged - its count on success, the REASON on failure', () =>
{
    // The twins print the importer's output as-is; the seed swallowed it, so 1.0.0's plugin-route
    // failure read 'import failed' with no reason at all.
    const root = project({ settings: '{}' });
    const importer = path.join(TMP, 'importer3.js');
    fs.writeFileSync(importer, '');
    const logs = [];
    memory.importNotes({
        gate: { go: true }, importer, settingsFile: settingsOf(root), log: (m) => logs.push(m),
        runImport: () => ({ ok: false, output: "\nmemory import: no 'memory' MCP server registered - nothing to import into\n" }),
    });
    assert.ok(logs.includes("  memory import: no 'memory' MCP server registered - nothing to import into"), logs.join(' | '));
    assert.ok(logs.indexOf("  memory import: no 'memory' MCP server registered - nothing to import into") < logs.findIndex((m) => /import failed/.test(m)), 'the reason comes before the verdict');
    const ok = [];
    memory.importNotes({
        gate: { go: true }, importer, settingsFile: settingsOf(root), log: (m) => ok.push(m),
        runImport: () => ({ ok: true, output: 'memory import: 2 imported, 0 already present, from x\n' }),
    });
    assert.ok(ok.includes('  memory import: 2 imported, 0 already present, from x'), ok.join(' | '));
});

test('order: a refused gate never runs the importer', () =>
{
    const root = project();
    const out = memory.importNotes({
        gate: { go: false, reason: 'memory: skipped' }, importer: 'x',
        runImport: () => assert.fail('the importer ran behind a closed gate'),
        settingsFile: settingsOf(root),
    });
    assert.strictEqual(out.imported, false);
});

test('order: an importer missing from the snapshot is reported, and nothing is switched off', () =>
{
    const root = project({ settings: '{}' });
    const logs = [];
    const out = memory.importNotes({
        gate: { go: true }, importer: path.join(TMP, 'no-such-importer.js'),
        runImport: () => assert.fail('an absent importer was run'),
        settingsFile: settingsOf(root), log: (m) => logs.push(m),
    });
    assert.strictEqual(out.switchedOff, false);
    assert.ok(logs.some((m) => /not found in the source snapshot/.test(m)), logs.join(' | '));
});

// --- the level resolution -------------------------------------------------

test('level: the flag wins, an existing registration is kept BYTE-FOR-BYTE, else global', () =>
{
    const at = { home: '/home/u', space: 'work', projectRoot: '/repo' };
    assert.deepStrictEqual(memory.resolveLevel({ flag: 'scoped', ...at }),
        { level: 'scoped', dbPath: path.join('/home/u', '.alfred-memory', 'memory_work.db'), from: 'flag' });
    // A level change never copies or deletes a database, so an absent flag must not re-point one.
    const kept = memory.resolveLevel({ registeredPath: '/somewhere/else/memory.db', ...at });
    assert.strictEqual(kept.dbPath, '/somewhere/else/memory.db');
    assert.strictEqual(kept.level, 'custom', 'a foreign path was labelled as one of our three levels');
    assert.deepStrictEqual(memory.resolveLevel(at),
        { level: 'global', dbPath: path.join('/home/u', '.alfred-memory', 'memory.db'), from: 'default' });
});

test('level: a registration already at one of the three shapes keeps that NAME, not custom', () =>
{
    const at = { home: '/home/u', projectRoot: '/repo' };
    const got = memory.resolveLevel({ registeredPath: path.join('/repo', '.memory-mcp', 'memory.db'), ...at });
    assert.strictEqual(got.level, 'project');
    assert.strictEqual(got.from, 'registration');
});

// --- /alfred-code:init's memory step: `memory.js init` -------------------------
//
// setup installs with no level; init asks it in a LATER session and sets it through this entry point
// alone - the settings key the plugin's launcher reads, the notes import, the switch-off - with no
// reinstall. Driven against the fake stdio server behind a fake memory@envoydev plugin row, the
// route every plugin install has (no .mcp.json registration).
const { spawnSync, execFileSync } = require('node:child_process');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const CLI = path.join(__dirname, 'install', 'memory.js');
const FAKE_SERVER = path.join(__dirname, 'fixtures', 'fake-memory-server.js');
let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const NO_SQLITE = DatabaseSync ? false : 'node:sqlite unavailable on this Node';

function initSandbox({ settings = { env: { ALFRED_CODE_MEMORY_DB: '/elsewhere/memory.db' }, keep: 'me' }, uvx = true } = {})
{
    const work = fs.mkdtempSync(path.join(TMP, 'init-'));
    const root = path.join(work, 'proj');
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    execFileSync('git', ['init', '-q', root]);
    fs.writeFileSync(path.join(root, '.claude', 'rules', 'baseline-memory.md'), '# rule\n');
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\ninitialised: pending\n');   // setup's install
    if (settings !== null) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
    const acct = path.join(work, 'acct');
    const pluginRoot = path.join(work, 'plugin-cache', 'memory', '1.0.0');
    fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(acct, 'plugins'), { recursive: true });
    fs.copyFileSync(FAKE_SERVER, path.join(pluginRoot, 'fake-memory-server.js'));
    fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'envoydev',
        plugins: [{ name: 'memory', mcpServers: { memory: { command: process.execPath, args: ['${CLAUDE_PLUGIN_ROOT}/fake-memory-server.js'], env: {} } } }] }));
    fs.writeFileSync(path.join(acct, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2,
        plugins: { 'memory@envoydev': [{ scope: 'user', installPath: pluginRoot, version: '1.0.0' }] } }));
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    if (uvx) { fs.writeFileSync(path.join(bin, 'uvx'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(bin, 'uvx'), 0o755); }
    const notes = path.join(work, 'notes');
    fs.mkdirSync(notes);
    fs.writeFileSync(path.join(notes, 'a.md'), '---\nname: a\ndescription: A note\nmetadata:\n  type: project\n---\nBuilds need the offline cache.\n');
    const calls = path.join(work, 'calls.jsonl');
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct, PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`,
        FAKE_MEMORY_DB: path.join(work, 'fake-db.json'), FAKE_MEMORY_CALLS_LOG: calls };
    for (const k of Object.keys(env)) if (/^(ALFRED_CODE_|CLAUDE_STACK_|MCP_MEMORY_|CLAUDE_PROJECT_DIR$)/.test(k)) delete env[k]; // legacy-name
    const run = (...args) => spawnSync(process.execPath, [CLI, 'init', '--project-root', root, '--config-dir', acct, '--memory-dir', notes, ...args],
        { cwd: root, env, encoding: 'utf8', timeout: 60000 });
    const callCount = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length : 0);
    const settingsNow = () => JSON.parse(fs.readFileSync(settingsOf(root), 'utf8'));
    const localNow = () => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
    return { work, root, acct, run, callCount, settingsNow, localNow };
}

test('init: the level lands in the key the launcher reads, the notes are imported into THAT database, Claude\'s own memory goes off - no reinstall', { skip: NO_SQLITE || POSIX_ONLY.skip }, () =>
{
    const sb = initSandbox();
    const db = path.join(sb.root, '.memory-mcp', 'memory.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    new DatabaseSync(db).exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-schema.sql'), 'utf8'));
    const before = [...fs.readdirSync(path.join(sb.root, '.claude')), 'settings.local.json'].sort();
    const r = sb.run('--level', 'project');
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const s = sb.settingsNow();
    // C8: the database path is this machine's - settings.local.json holds it, the shared copy leaves.
    assert.strictEqual(sb.localNow().env.ALFRED_CODE_MEMORY_DB, db);
    assert.ok(!('ALFRED_CODE_MEMORY_DB' in s.env), `a machine path stayed in the committed settings.json: ${s.env.ALFRED_CODE_MEMORY_DB}`);
    assert.match(r.stdout, /settings\.json env: ALFRED_CODE_MEMORY_DB removed - this machine's database path, kept in settings\.local\.json from here on/);
    assert.strictEqual(s.keep, 'me', 'every other key survives');
    assert.strictEqual(s.autoMemoryEnabled, false);
    assert.strictEqual(fs.readFileSync(path.join(sb.root, '.memory-mcp', '.gitignore'), 'utf8'), '*\n', 'a project database is never committed');
    const rows = new DatabaseSync(db, { readOnly: true }).prepare('SELECT content FROM memories WHERE deleted_at IS NULL').all();
    assert.strictEqual(rows.length, 1, 'imported into the level just chosen');
    assert.match(rows[0].content, /Builds need the offline cache\./);
    assert.match(r.stdout, /memory: level project -> .*\.memory-mcp[/\\]memory\.db \(settings\.local\.json env ALFRED_CODE_MEMORY_DB\)/);
    assert.deepStrictEqual(fs.readdirSync(path.join(sb.root, '.claude')).sort(), before, 'nothing else under .claude/ - no install ran');
    // I1: the one signal only init writes - the router reads it, every later run carries it.
    assert.match(fs.readFileSync(path.join(sb.root, '.claude', 'alfred-code.stamp'), 'utf8'), /^initialised: \d{4}-\d{2}-\d{2}T[\d:]+Z$/m);
    assert.strictEqual(require('./install/stamp.js').installState(sb.root), 'initialised');
    // Idempotent: a second run stores nothing and exits clean.
    const calls = sb.callCount();
    const again = sb.run('--level', 'project');
    assert.strictEqual(again.status, 0, again.stdout + again.stderr);
    assert.strictEqual(sb.callCount(), calls, 'a re-run stored the notes again');
});

test('init: scoped names the space\'s file, global the machine\'s; the key goes where settings.local.json already keeps it', { skip: POSIX_ONLY.skip }, () =>
{
    const sb = initSandbox({ uvx: false });
    fs.writeFileSync(path.join(sb.root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: '/old.db', X: '1' } }));
    const r = sb.run('--level', 'scoped', '--space', 'work');
    const local = JSON.parse(fs.readFileSync(path.join(sb.root, '.claude', 'settings.local.json'), 'utf8'));
    assert.strictEqual(local.env.ALFRED_CODE_MEMORY_DB, path.join(sb.work, '.alfred-memory', 'memory_work.db'));
    assert.strictEqual(local.env.X, '1');
    assert.strictEqual(sb.settingsNow().env.ALFRED_CODE_MEMORY_DB, '/elsewhere/memory.db', 'the shared file is not written when the local one holds the key');
    // No uvx: the level is set, the import is not run, and Claude's own memory stays on - a failure exit.
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /uvx not found/);
    assert.ok(!('autoMemoryEnabled' in sb.settingsNow()));
    assert.strictEqual(sb.callCount(), 0);
    assert.match(fs.readFileSync(path.join(sb.root, '.claude', 'alfred-code.stamp'), 'utf8'), /^initialised: pending$/m, 'a failed import leaves init owed');
    // A local-scope stamp sends the key to the local file even when neither file holds it yet.
    const l = initSandbox({ uvx: false });
    fs.writeFileSync(path.join(l.root, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\nscope: local\n');
    l.run('--level', 'global');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(l.root, '.claude', 'settings.local.json'), 'utf8')).env.ALFRED_CODE_MEMORY_DB, path.join(l.work, '.alfred-memory', 'memory.db'));
    assert.strictEqual(l.settingsNow().env.ALFRED_CODE_MEMORY_DB, '/elsewhere/memory.db', 'the shared file every teammate reads is left alone');
    const g = initSandbox({ settings: null, uvx: false });
    g.run('--level', 'global');
    assert.strictEqual(g.localNow().env.ALFRED_CODE_MEMORY_DB, path.join(g.work, '.alfred-memory', 'memory.db'), 'an absent settings.local.json is created with the key (C8)');
    assert.ok(!fs.existsSync(settingsOf(g.root)), 'no settings.json is created for a machine path');
    assert.ok(!fs.existsSync(path.join(g.root, '.memory-mcp')) && !fs.existsSync(path.join(g.root, '.alfred')), 'no project folder for a machine-level database');
    // A 2.0.0 database the launcher has not moved yet is the one the level names - never a second, empty one.
    const old = initSandbox({ settings: null, uvx: false });
    fs.mkdirSync(path.join(old.work, '.memory-mcp'), { recursive: true });
    fs.writeFileSync(path.join(old.work, '.memory-mcp', 'memory.db'), '');
    old.run('--level', 'global');
    assert.strictEqual(old.localNow().env.ALFRED_CODE_MEMORY_DB, path.join(old.work, '.memory-mcp', 'memory.db'));
});

test('init: refuses a registration it cannot re-point, a malformed settings file and an unknown level - nothing written', { skip: POSIX_ONLY.skip }, () =>
{
    const sb = initSandbox();
    fs.writeFileSync(path.join(sb.root, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'uvx', env: { MCP_MEMORY_SQLITE_PATH: '/reg/memory.db' } } } }));
    const before = fs.readFileSync(settingsOf(sb.root), 'utf8');
    const r = sb.run('--level', 'project');
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout + r.stderr, /\.mcp\.json registers memory at \/reg\/memory\.db - .*update --memory-level project/);
    assert.strictEqual(fs.readFileSync(settingsOf(sb.root), 'utf8'), before);
    assert.strictEqual(sb.callCount(), 0);

    // M4: the importer falls back to the ACCOUNT registration, so init checks that file too - a user-
    // scope copy-route registration, then the account file's entry for this project.
    for (const account of [
        (root) => ({ mcpServers: { memory: { command: 'uvx', env: { MCP_MEMORY_SQLITE_PATH: '/acct/memory.db' } } } }),
        (root) => ({ projects: { [root]: { mcpServers: { memory: { command: 'uvx', env: { MCP_MEMORY_SQLITE_PATH: '/acct/memory.db' } } } } } }),
    ])
    {
        const a = initSandbox();
        fs.mkdirSync(a.acct, { recursive: true });
        fs.writeFileSync(path.join(a.acct, '.claude.json'), JSON.stringify(account(a.root)));
        const settingsBefore = fs.readFileSync(settingsOf(a.root), 'utf8');
        const ra = a.run('--level', 'project');
        assert.strictEqual(ra.status, 1, ra.stdout + ra.stderr);
        assert.match(ra.stdout, /\.claude\.json registers memory at \/acct\/memory\.db - .*update --memory-level project/);
        assert.strictEqual(fs.readFileSync(settingsOf(a.root), 'utf8'), settingsBefore, 'nothing written');
        assert.strictEqual(a.callCount(), 0);
    }
    // The same path registered is no mismatch - under its 2.0.0 spelling too, which the installer re-spells.
    for (const folder of ['.alfred-memory', '.memory-mcp'])
    {
        const same = initSandbox({ uvx: false });
        fs.mkdirSync(same.acct, { recursive: true });
        fs.writeFileSync(path.join(same.acct, '.claude.json'), JSON.stringify({ mcpServers: { memory: { command: 'uvx', env: { MCP_MEMORY_SQLITE_PATH: path.join(same.work, folder, 'memory.db') } } } }));
        assert.doesNotMatch(same.run('--level', 'global').stdout, /registers memory at/, folder);
    }

    const bad = initSandbox({ settings: '{ not json' });
    const b = bad.run('--level', 'global');
    assert.strictEqual(b.status, 1);
    assert.match(b.stdout + b.stderr, /not valid JSON/);
    assert.strictEqual(fs.readFileSync(settingsOf(bad.root), 'utf8'), '{ not json');
    assert.ok(!fs.existsSync(path.join(bad.root, '.claude', 'settings.local.json')), 'nothing written before the refusal');

    const u = sb.run('--level', 'account');
    assert.strictEqual(u.status, 2);
    assert.match(u.stderr, /--level must be global, scoped or project/);
});

// I1 (Task 18a review): 'initialised' is the stamp line only init writes. Before it, no run IMPORTS
// the notes - not setup's install, not a /alfred-code:update, not configure's or validate's apply with a
// level named - so the router keeps offering init. Pilot 2 (2026-09-27): init's own switch-off hit EPERM
// inside the sandbox and auto-memory stayed ON in every cell. With NO notes there is nothing to import and
// nothing a level choice could change, so the INSTALLER (run outside the session) switches Claude's own
// memory off at install time; init only reports it. With notes, the switch-off still waits for init.
const stampText = (repo) => fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
test('seed: with no notes, install switches Claude\'s own memory off, imports nothing and leaves the router on init', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const { installState } = require('./install/stamp.js');
    const { outs, steps } = seedRun(['install', 'update', 'update'], SEL, {
        tools: { uvx: 'exit 0' },   // the import would run: uvx answers, and no notes is a clean 'nothing to import'
        args: [[], [], ['--memory-level', 'project']],
        each: (repo) => ({ s: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')), l: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')), stamp: stampText(repo), state: installState(repo) }),
    });
    for (const [i, step] of steps.entries())
    {
        assert.strictEqual(step.s.autoMemoryEnabled, false, `run ${i}: no notes - Claude's own memory is off from the install on`);
        assert.match(step.stamp, /^initialised: pending$/m, `run ${i}`);
        assert.strictEqual(step.state, 'installed', `run ${i}: the router still routes to init`);
        assert.doesNotMatch(outs[i], /importing Claude's existing notes/, `run ${i}: nothing is imported before init`);
    }
    assert.match(outs[0], /memory: no Claude memory notes for this project - nothing to import, so Claude's own memory is off from this install/);
    assert.match(outs[0], /autoMemoryEnabled set to false/);
    for (const i of [1, 2]) assert.match(outs[i], /memory: Claude's own memory is already off/, `run ${i}: reported, never rewritten`);
    assert.match(steps[2].l.env.ALFRED_CODE_MEMORY_DB, /\.alfred[/\\]\.alfred-memory[/\\]memory\.db$/, 'the named level still applies - only the import waits');
});

// Review A, I1: the memory server launches through uvx, which INIT installs after setup - so the install-time
// switch-off checks it like the other two switch-off paths do. No uvx on PATH: Claude's own memory stays on.
test('seed: with no notes but no uvx on PATH, install leaves Claude\'s own memory on and says why', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const { out, result } = seedRun('install', SEL, {
        tools: { uvx: null },
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
    });
    assert.ok(!('autoMemoryEnabled' in result), 'no uvx - the replacement cannot start, so Claude\'s own memory stays on');
    assert.match(out, /uvx not found - the memory notes import was skipped; Claude's own memory stays on/);
    assert.doesNotMatch(out, /autoMemoryEnabled set to false/);
});

// With notes, nothing changes before init: the notes must land in the database the user picks, so the
// switch-off waits for init's import.
test('seed: with notes, install and update leave Claude\'s own memory on until init imports them', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const { defaultMemoryDir } = require('./memory-import.js');
    const { outs, steps } = seedRun(['install', 'update'], SEL, {
        tools: { uvx: 'exit 0' },
        prepare: (repo, work) =>
        {
            const dir = defaultMemoryDir(repo, path.join(work, 'acct'), work);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'build.md'), '---\nname: build\ndescription: A note\n---\nBuilds need the offline cache.\n');
        },
        each: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
    });
    for (const [i, s] of steps.entries())
    {
        assert.ok(!('autoMemoryEnabled' in s), `run ${i}: a note is waiting - Claude's own memory stays on until init`);
        assert.match(outs[i], /memory: the notes import waits for \/alfred-code:init/, `run ${i}`);
    }
});

test('countNotes: none, some, and an unreadable folder are three answers', () =>
{
    const home = fs.mkdtempSync(path.join(TMP, 'notes-'));
    const root = path.join(home, 'proj');
    fs.mkdirSync(root);
    const configDir = path.join(home, 'acct');
    // The importer's scan also reads CLAUDE_CONFIG_DIR - pinned, so this case never reads the real account.
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try
    {
        assert.strictEqual(memory.countNotes({ projectRoot: root, configDir, home }), 0, 'no folder at all');
        const { defaultMemoryDir } = require('./memory-import.js');
        const dir = defaultMemoryDir(root, configDir, home);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- index\n');
        assert.strictEqual(memory.countNotes({ projectRoot: root, configDir, home }), 0, 'the index alone is no note');
        fs.writeFileSync(path.join(dir, 'a.md'), 'note\n');
        assert.strictEqual(memory.countNotes({ projectRoot: root, configDir, home }), 1);
        fs.rmSync(dir, { recursive: true });
        fs.writeFileSync(dir, 'a file where the folder should be');
        assert.strictEqual(memory.countNotes({ projectRoot: root, configDir, home }), null, 'unreadable is unknown - the caller waits for init');
    }
    finally { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; }
});

// After init the line is carried, and a later run imports as it always did (a no-op once memory is off).
test('seed: once init marked the stamp, an update carries the line and the import gate opens again (I1)', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const { markInitialised, installState } = require('./install/stamp.js');
    const { out, result } = seedRun(['install', 'update'], SEL, {
        tools: { uvx: 'exit 0' },
        each: (repo, i) => { if (i === 0) markInitialised(path.join(repo, '.claude'), new Date('2026-09-25T10:00:00Z')); return null; },
        inspect: (repo) => ({ stamp: stampText(repo), s: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')), state: installState(repo) }),
    });
    assert.match(result.stamp, /^initialised: 2026-09-25T10:00:00Z$/m, 'carried across the rewrite');
    assert.strictEqual(result.state, 'initialised');
    assert.doesNotMatch(out, /waits for \/alfred-code:init/);
    assert.strictEqual(result.s.autoMemoryEnabled, false, 'the gate opened: nothing to import, so the switch-off landed');
});

// M5 (Task 18a review): every run that lands the project level writes the database's own .gitignore -
// update and configure with --memory-level project too, not only init - so post-install's 'the
// installer already wrote it' holds whichever command set the level.
test('seed: a project-level run writes the database folder\'s .gitignore, and a machine level writes no memory folder in the project (M5)', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const ignore = (repo) => path.join(repo, '.alfred', '.alfred-memory', '.gitignore');
    const { steps } = seedRun(['install', 'update'], SEL, {
        args: [['--memory-level', 'global'], ['--memory-level', 'project']],
        each: (repo) => (fs.existsSync(ignore(repo)) ? fs.readFileSync(ignore(repo), 'utf8') : null),
    });
    assert.strictEqual(steps[0], null, 'global: no project folder at all');
    assert.strictEqual(steps[1], '*\n', 'the update that moved the level to project ignores the database');
    const { result } = seedRun('install', SEL, {
        args: ['--memory-level', 'project'],
        prepare: (repo) => { fs.mkdirSync(path.dirname(ignore(repo)), { recursive: true }); fs.writeFileSync(ignore(repo), '# mine\n*\n'); },
        inspect: (repo) => fs.readFileSync(ignore(repo), 'utf8'),
    });
    assert.strictEqual(result, '# mine\n*\n', 'an existing .gitignore is left as the user wrote it');
});

// The plugin route has no registration to read back: its record of the level is the settings key.
// An update that ignored it reset a project level init had set to the global default.
test('seed: an update with no --memory-level keeps the level the settings key records', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    // `home`: where the key sits - settings.local.json, where init writes it now (C8), or settings.json
    // alone, an older install's shape, which the update moves into settings.local.json.
    for (const home of ['settings.local.json', 'settings.json'])
    {
        const { out, result } = seedRun(['install', 'update'], SEL, {
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                const edit = (name, fn) => { const file = path.join(repo, '.claude', name); const s = JSON.parse(fs.readFileSync(file, 'utf8')); fn(s.env); fs.writeFileSync(file, JSON.stringify(s, null, 2)); };
                edit('settings.local.json', (env) => { delete env.ALFRED_CODE_MEMORY_DB; });
                edit(home, (env) => { env.ALFRED_CODE_MEMORY_DB = path.join(fs.realpathSync(repo), '.memory-mcp', 'memory.db'); });
                return null;
            },
            inspect: (repo) => ({ repo: fs.realpathSync(repo), s: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')), l: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')) }),
        });
        // The level stays project; with no database at either place its path is the current one (Task 7a).
        assert.strictEqual(result.l.env.ALFRED_CODE_MEMORY_DB, path.join(result.repo, '.alfred', '.alfred-memory', 'memory.db'), `${home}: the update re-pointed the level init set`);
        assert.ok(!('ALFRED_CODE_MEMORY_DB' in result.s.env), `${home}: the machine path is in the committed settings.json (C8)`);
        assert.match(out, /memory=project/);
    }
});
