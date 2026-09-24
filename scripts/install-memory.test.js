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

test('level: the three levels resolve to the three shapes, and back again', () =>
{
    const at = { home: '/home/u', space: 'work', projectRoot: '/repo' };
    assert.strictEqual(memory.pathForLevel('global', at), path.join('/home/u', '.memory-mcp', 'memory.db'));
    assert.strictEqual(memory.pathForLevel('scoped', at), path.join('/home/u', '.memory-mcp', 'memory_work.db'));
    assert.strictEqual(memory.pathForLevel('project', at), path.join('/repo', '.memory-mcp', 'memory.db'));
    assert.strictEqual(memory.pathForLevel('scoped', { ...at, space: '' }), path.join('/home/u', '.memory-mcp', 'memory_default.db'));
    for (const level of ['global', 'scoped', 'project'])
        assert.strictEqual(memory.levelOfPath(memory.pathForLevel(level, at), at), level, level);
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
        { level: 'scoped', dbPath: path.join('/home/u', '.memory-mcp', 'memory_work.db'), from: 'flag' });
    // A level change never copies or deletes a database, so an absent flag must not re-point one.
    const kept = memory.resolveLevel({ registeredPath: '/somewhere/else/memory.db', ...at });
    assert.strictEqual(kept.dbPath, '/somewhere/else/memory.db');
    assert.strictEqual(kept.level, 'custom', 'a foreign path was labelled as one of our three levels');
    assert.deepStrictEqual(memory.resolveLevel(at),
        { level: 'global', dbPath: path.join('/home/u', '.memory-mcp', 'memory.db'), from: 'default' });
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
    return { work, root, acct, run, callCount, settingsNow };
}

test('init: the level lands in the key the launcher reads, the notes are imported into THAT database, Claude\'s own memory goes off - no reinstall', { skip: NO_SQLITE || POSIX_ONLY.skip }, () =>
{
    const sb = initSandbox();
    const db = path.join(sb.root, '.memory-mcp', 'memory.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    new DatabaseSync(db).exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-schema.sql'), 'utf8'));
    const before = fs.readdirSync(path.join(sb.root, '.claude')).sort();
    const r = sb.run('--level', 'project');
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const s = sb.settingsNow();
    assert.strictEqual(s.env.ALFRED_CODE_MEMORY_DB, db);
    assert.strictEqual(s.keep, 'me', 'every other key survives');
    assert.strictEqual(s.autoMemoryEnabled, false);
    assert.strictEqual(fs.readFileSync(path.join(sb.root, '.memory-mcp', '.gitignore'), 'utf8'), '*\n', 'a project database is never committed');
    const rows = new DatabaseSync(db, { readOnly: true }).prepare('SELECT content FROM memories WHERE deleted_at IS NULL').all();
    assert.strictEqual(rows.length, 1, 'imported into the level just chosen');
    assert.match(rows[0].content, /Builds need the offline cache\./);
    assert.match(r.stdout, /memory: level project -> .*\.memory-mcp[/\\]memory\.db/);
    assert.deepStrictEqual(fs.readdirSync(path.join(sb.root, '.claude')).sort(), before, 'nothing else under .claude/ - no install ran');
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
    assert.strictEqual(local.env.ALFRED_CODE_MEMORY_DB, path.join(sb.work, '.memory-mcp', 'memory_work.db'));
    assert.strictEqual(local.env.X, '1');
    assert.strictEqual(sb.settingsNow().env.ALFRED_CODE_MEMORY_DB, '/elsewhere/memory.db', 'the shared file is not written when the local one holds the key');
    // No uvx: the level is set, the import is not run, and Claude's own memory stays on - a failure exit.
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /uvx not found/);
    assert.ok(!('autoMemoryEnabled' in sb.settingsNow()));
    assert.strictEqual(sb.callCount(), 0);
    // A local-scope stamp sends the key to the local file even when neither file holds it yet.
    const l = initSandbox({ uvx: false });
    fs.writeFileSync(path.join(l.root, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\nscope: local\n');
    l.run('--level', 'global');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(l.root, '.claude', 'settings.local.json'), 'utf8')).env.ALFRED_CODE_MEMORY_DB, path.join(l.work, '.memory-mcp', 'memory.db'));
    assert.strictEqual(l.settingsNow().env.ALFRED_CODE_MEMORY_DB, '/elsewhere/memory.db', 'the shared file every teammate reads is left alone');
    const g = initSandbox({ settings: null, uvx: false });
    g.run('--level', 'global');
    assert.strictEqual(g.settingsNow().env.ALFRED_CODE_MEMORY_DB, path.join(g.work, '.memory-mcp', 'memory.db'), 'an absent settings.json is created with the key');
    assert.ok(!fs.existsSync(path.join(g.root, '.memory-mcp')), 'no project folder for a machine-level database');
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

    const bad = initSandbox({ settings: '{ not json' });
    const b = bad.run('--level', 'global');
    assert.strictEqual(b.status, 1);
    assert.match(b.stdout + b.stderr, /not valid JSON/);
    assert.strictEqual(fs.readFileSync(settingsOf(bad.root), 'utf8'), '{ not json');

    const u = sb.run('--level', 'account');
    assert.strictEqual(u.status, 2);
    assert.match(u.stderr, /--level must be global, scoped or project/);
});

// setup installs with no --memory-level: the level is init's question, so the import waits for it -
// importing now would file every note under a database the user has not chosen yet.
test('seed: an install with no --memory-level leaves the notes import to init, and says so', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const { out, result } = seedRun('install', SEL, { inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')) });
    assert.match(out, /memory: the notes import waits for \/alfred-code:init/);
    assert.doesNotMatch(out, /importing Claude's existing notes|memory notes import was skipped/);
    assert.ok(!('autoMemoryEnabled' in result), 'Claude\'s own memory stays on until init');
    const withLevel = seedRun('install', SEL, { args: ['--memory-level', 'global'] });
    assert.doesNotMatch(withLevel.out, /waits for \/alfred-code:init/, 'a named level (configure, update) imports as before');
});

// The plugin route has no registration to read back: its record of the level is the settings key.
// An update that ignored it reset a project level init had set to the global default.
test('seed: an update with no --memory-level keeps the level the settings key records', POSIX_ONLY, () =>
{
    const SEL = 'skill markdown-style\nrule baseline-memory\nmcp serena\nmcp context7\nmcp memory\n';
    const { out, result } = seedRun(['install', 'update'], SEL, {
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const file = path.join(repo, '.claude', 'settings.json');
            const s = JSON.parse(fs.readFileSync(file, 'utf8'));
            s.env.ALFRED_CODE_MEMORY_DB = path.join(fs.realpathSync(repo), '.memory-mcp', 'memory.db');
            fs.writeFileSync(file, JSON.stringify(s, null, 2));
            return null;
        },
        inspect: (repo) => ({ repo: fs.realpathSync(repo), s: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')) }),
    });
    assert.strictEqual(result.s.env.ALFRED_CODE_MEMORY_DB, path.join(result.repo, '.memory-mcp', 'memory.db'), 'the update re-pointed the level init set');
    assert.match(out, /memory=project/);
});
