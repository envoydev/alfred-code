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
function project({ settings, rules = ['alfred-memory.md'] } = {})
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
    mcps: ['serena|x', 'memory|y'], rules: ['alfred-memory.md::x'], ...over,
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

// Re-verify 3 S9: a read error is named by its code, a parse error as bad JSON.
test('switch-off: a settings file that cannot be read REFUSES the write and names the read error', () =>
{
    const root = project();
    fs.mkdirSync(settingsOf(root), { recursive: true });
    const logs = [];
    assert.strictEqual(memory.writeSwitchOff(settingsOf(root), { log: (m) => logs.push(m) }), false);
    assert.ok(fs.statSync(settingsOf(root)).isDirectory());
    assert.ok(logs.some((m) => /could not be read \(EISDIR\) - autoMemoryEnabled left untouched/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /not valid JSON/.test(m)), logs.join(' | '));
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
    assert.match(memory.importGate(GATE(root, { rules: ['alfred-security.md::x'] })).reason, /alfred-memory\.md is not part of this install/);
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

// Matrix 2.1.5 F2 (case 7c): a settings.local.json that did not parse read as {}, so the level the file records fell to
// the global default and the full copy route re-registered the memory server there, at local scope, before the run said
// the file was invalid. An unreadable file is no answer: the account's local-scope registration (the copy route's) is
// read in its place, and with nothing readable left the level is unknown - kept, never the default.
test('recordedPath: a registration, then the settings key; an unreadable settings file hands over to the local registration, never to the default', () =>
{
    const root = path.join(TMP, `rec-${seq++}`);
    const claudeDir = path.join(root, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const accountFile = path.join(root, 'acct', '.claude.json');
    fs.mkdirSync(path.dirname(accountFile));
    const at = { mcpFile: path.join(root, '.mcp.json'), claudeDir, accountFile, projectRoot: root };
    const write = (file, body) => fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
    const local = path.join(claudeDir, 'settings.local.json');
    const projectDb = path.join(root, '.alfred', '.alfred-memory', 'memory.db');

    assert.deepStrictEqual(memory.recordedPath(at), { path: '', from: '', unread: [] }, 'nothing recorded');
    write(local, { env: { ALFRED_CODE_MEMORY_DB: projectDb } });
    // Where it was read comes back too, so the ledger can say whether the stack wrote it (a moved or copied folder).
    assert.deepStrictEqual(memory.recordedPath(at), { path: projectDb, from: 'settings', file: 'settings.local.json', key: 'ALFRED_CODE_MEMORY_DB', value: projectDb, unread: [] });

    // The copy route's local registration, in the shape the claude CLI writes it (2.1.284).
    write(accountFile, { projects: { [root]: { mcpServers: { memory: { type: 'stdio', command: 'uvx', args: [], env: { MCP_MEMORY_SQLITE_PATH: projectDb } } } } } });
    write(local, '{ "env": { "A": 1, } garbage');
    assert.deepStrictEqual(memory.recordedPath(at), { path: projectDb, from: 'local registration', unread: ['settings.local.json'] });
    // Re-verify 2 R5: one rule with the memory launcher (the shared reader, stack/hooks/memory.js settingsDbState) - an unread
    // settings.local.json is no answer, and the next readable file's key answers: settings.json, then the account settings.
    write(path.join(claudeDir, 'settings.json'), { env: { ALFRED_CODE_MEMORY_DB: '/elsewhere/memory.db' } });
    assert.deepStrictEqual(memory.recordedPath(at), { path: path.normalize('/elsewhere/memory.db'), from: 'settings', file: 'settings.json', key: 'ALFRED_CODE_MEMORY_DB', value: '/elsewhere/memory.db', unread: ['settings.local.json'] });
    write(path.join(claudeDir, 'settings.json'), { env: {} });
    write(path.join(path.dirname(accountFile), 'settings.json'), { env: { ALFRED_CODE_MEMORY_DB: '/account/memory.db' } });
    assert.strictEqual(memory.recordedPath(at).path, path.normalize('/account/memory.db'));
    fs.rmSync(path.join(path.dirname(accountFile), 'settings.json'));
    assert.strictEqual(memory.recordedPath(at).path, projectDb, 'with no key anywhere the local registration still answers');
    // No registration either: nothing answers, and the unread file is named.
    write(accountFile, { projects: {} });
    assert.deepStrictEqual(memory.recordedPath(at), { path: '', from: '', unread: ['settings.local.json'] });
    // An account file that cannot be read is named too (F1: read before any claude call replaces it).
    write(accountFile, '{"projects": { "x": [1,2, garbage');
    assert.deepStrictEqual(memory.recordedPath(at).unread, ['settings.local.json', '.claude.json']);
    // A .mcp.json registration answers before either (the project scope's, and C10's) - and the unread local file, the
    // key's home at every scope, is still named, so the run can say so before its first registration.
    const entry = { command: 'uvx', env: { MCP_MEMORY_SQLITE_PATH: '/r/memory.db' } };
    write(at.mcpFile, { mcpServers: { memory: entry } });
    assert.deepStrictEqual(memory.recordedPath(at), { path: '/r/memory.db', from: 'registration', entry, unread: ['settings.local.json'] });
    write(local, { env: {} });
    assert.deepStrictEqual(memory.recordedPath(at), { path: '/r/memory.db', from: 'registration', entry, unread: [] });
});

test('level: an unreadable record with no answer is KEPT - never the global default; the flag still wins', () =>
{
    const at = { home: '/home/u', projectRoot: '/repo', stamped: true };
    assert.deepStrictEqual(memory.resolveLevel({ unread: ['settings.local.json'], ...at }), { level: 'kept', dbPath: '', from: 'unreadable' });
    assert.strictEqual(memory.resolveLevel({ flag: 'project', unread: ['settings.local.json'], ...at }).level, 'project');
    assert.strictEqual(memory.resolveLevel({ registeredPath: path.join('/repo', '.alfred', '.alfred-memory', 'memory.db'), unread: ['settings.local.json'], ...at }).level, 'project');
});

test('movedProjectRoot: another folder\'s project database - the data-root shape or a 2.0.0 .memory-mcp - never this project\'s own, a home database or any other path', () =>
{
    const root = path.join(TMP, 'moved-here');
    fs.mkdirSync(root, { recursive: true });
    assert.strictEqual(memory.movedProjectRoot('/old/place/.alfred/.alfred-memory/memory.db', { projectRoot: root, root: '.alfred' }), path.normalize('/old/place'));
    assert.strictEqual(memory.movedProjectRoot('/old/place/data/x/.alfred-memory/memory.db', { projectRoot: root, root: 'data/x' }), path.normalize('/old/place'));
    // The 2.0.0 shape is also a 2.0.0 GLOBAL database under another home (a folder copied between machines): it counts
    // only where this folder holds a project-level memory folder of its own, which a moved project brings along.
    assert.strictEqual(memory.movedProjectRoot('/old/place/.memory-mcp/memory.db', { projectRoot: root, root: '.alfred' }), '', 'no memory folder came with this one');
    fs.mkdirSync(path.join(root, '.memory-mcp'), { recursive: true });
    assert.strictEqual(memory.movedProjectRoot('/old/place/.memory-mcp/memory.db', { projectRoot: root, root: '.alfred' }), path.normalize('/old/place'));
    assert.strictEqual(memory.movedProjectRoot(path.join(root, '.alfred', '.alfred-memory', 'memory.db'), { projectRoot: root, root: '.alfred' }), '', 'this project\'s own');
    assert.strictEqual(memory.movedProjectRoot('/elsewhere/team/shared.db', { projectRoot: root, root: '.alfred' }), '');
    assert.strictEqual(memory.movedProjectRoot('/home/u/.alfred-memory/memory_default.db', { projectRoot: root, root: '.alfred' }), '');
});

// Review 2.1.6 M1: setup passes no --memory-level, so a FRESH install over a settings file it could not read took `kept`
// and, on the full copy route, registered no memory server at all. `kept` needs an install to keep - no stamp, no level
// to leave as it is: the default, as before F2.
test('level: KEPT only where a stamp records an install - a fresh one takes the default', () =>
{
    const at = { home: '/home/u', projectRoot: '/repo' };
    assert.deepStrictEqual(memory.resolveLevel({ unread: ['settings.json'], stamped: false, ...at }),
        { level: 'global', dbPath: path.join('/home/u', '.alfred-memory', 'memory.db'), from: 'default' });
    assert.strictEqual(memory.resolveLevel({ unread: ['settings.json'], ...at }).level, 'global', 'a caller that names no stamp has none');
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
    fs.writeFileSync(path.join(root, '.claude', 'rules', 'alfred-memory.md'), '# rule\n');
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
    const SEL = 'skill markdown-style\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n';
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
    const SEL = 'skill markdown-style\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n';
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
    const SEL = 'skill markdown-style\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n';
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
    const SEL = 'skill markdown-style\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n';
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
    const SEL = 'skill markdown-style\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n';
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
    const SEL = 'skill markdown-style\nrule alfred-memory\nmcp serena\nmcp context7\nmcp memory\n';
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
        // The level stays project; with no database at either place its path is the current one (Task 7a), absolute in the
        // machine-local file (re-verify 3 S1).
        assert.strictEqual(result.l.env.ALFRED_CODE_MEMORY_DB, path.join(result.repo, '.alfred', '.alfred-memory', 'memory.db'), `${home}: the update re-pointed the level init set`);
        assert.ok(!('ALFRED_CODE_MEMORY_DB' in result.s.env), `${home}: the machine path is in the committed settings.json (C8)`);
        assert.match(out, /memory=project/);
    }
});

// Matrix 2.1.5 F2 (case 7c), end to end on the full copy route at local scope: a garbage settings.local.json re-pointed
// the memory server's local registration at the GLOBAL database and said the file was invalid only afterwards. Now the
// local registration answers the level (re-registered where it was), or with none the memory server is left alone -
// and the run says so before its first registration.
test('seed update (full copy route): an unreadable settings.local.json re-points no memory registration, and says so first', POSIX_ONLY, () =>
{
    const SEL = 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n';
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    // Local scope with the local registration, local scope with none, and project scope, whose .mcp.json answers.
    for (const [scope, registered] of [['local', true], ['local', false], ['project', true]])
    {
        const { calls, outs, steps } = seedRun(['install', 'update'], SEL, {
            env: COPY,
            // The stand-in CLI keeps the account file, so the local registration is the one the install wrote - the stack's own
            // by the ledger (re-verify 3 S1/S4: a registration in another shape is the user's and never re-pointed).
            account: true,
            args: [['--scope', scope, '--memory-level', 'project'], ['--installed-only', '--scope', scope]],
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                const work = path.dirname(repo);
                const local = path.join(repo, '.claude', 'settings.local.json');
                // The machine-local key is the absolute path (re-verify 3 S1), the one the local registration names.
                const projectDb = JSON.parse(fs.readFileSync(local, 'utf8')).env.ALFRED_CODE_MEMORY_DB;
                const account = path.join(work, 'acct', '.claude.json');
                if (scope === 'local')
                {
                    const data = JSON.parse(fs.readFileSync(account, 'utf8'));
                    const held = data.projects[fs.realpathSync(repo)].mcpServers;
                    assert.strictEqual(held.memory.env.MCP_MEMORY_SQLITE_PATH, projectDb, 'the install registered memory elsewhere');
                    if (!registered) { delete held.memory; fs.writeFileSync(account, JSON.stringify(data)); }
                }
                fs.writeFileSync(local, '{ "env": { "A": 1, } garbage');
                return { projectDb, work, before: fs.readFileSync(path.join(work, 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length };
            },
        });
        const { projectDb, work, before } = steps[0];
        const adds = calls.slice(before).filter((c) => c.startsWith(`mcp add --scope ${scope} memory `));
        const out = outs[1];
        assert.ok(!adds.some((c) => c.includes(path.join(work, '.alfred-memory'))), `re-pointed at the global database:\n${adds.join('\n')}`);
        if (registered)
        {
            assert.strictEqual(adds.length, 1, `${scope}: ${adds.join('\n')}\n${out}`);
            // .mcp.json (project scope) names the project level by its project-relative path, started at the project through
            // ROOT_BOOT (re-verify 3 S2); the account (local scope) by its absolute path.
            assert.ok(adds[0].includes(scope === 'project' ? 'MCP_MEMORY_SQLITE_PATH=.alfred/.alfred-memory/memory.db' : `MCP_MEMORY_SQLITE_PATH=${projectDb}`), adds[0]);
            assert.match(out, /memory=project/);
        }
        else
        {
            assert.deepStrictEqual(adds, [], 'with no readable record the memory server is left as it is');
            assert.match(out, /memory=kept/);
        }
        const said = out.indexOf('settings.local.json could not be read');
        assert.ok(said > -1 && said < out.indexOf(`mcp [${scope}]:`), `the unreadable file is said before the first registration:\n${out}`);
    }
});

// Review 2.1.6 M1, end to end: a fresh install over a settings file it cannot read registers memory at the default level
// (base did the same) and says the unread file first - never a project left with no memory server.
test('seed install (full copy route): a fresh install over an unreadable settings file registers memory at the default level, said first', POSIX_ONLY, () =>
{
    const SEL = 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n';
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    for (const [scope, file] of [['local', 'settings.json'], ['local', 'settings.local.json'], ['project', 'settings.json']])
    {
        let home = '';
        // An install asks `claude mcp get` first at local scope; this stub finds nothing, as the CLI does on a fresh account.
        const claude = ['printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"', 'if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then exit 1; fi', 'exit 0'].join('\n');
        const { calls, out } = seedRun('install', SEL, {
            env: COPY, args: ['--scope', scope], failOk: true, tools: { claude },
            prepare: (repo, work) =>
            {
                home = work;
                fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
                fs.writeFileSync(path.join(repo, '.claude', file), '{ "env": { "A": 1, } garbage');
            },
        });
        const adds = calls.filter((c) => c.startsWith(`mcp add --scope ${scope} memory `));
        assert.strictEqual(adds.length, 1, `${scope}/${file}: memory is registered\n${out}`);
        // The committed .mcp.json names the account level from the home (re-verify 3 S2); the account registration by its path.
        const want = scope === 'project' ? '~/.alfred-memory/memory.db' : path.join(home, '.alfred-memory', 'memory.db');
        assert.ok(adds[0].includes(`MCP_MEMORY_SQLITE_PATH=${want}`), `${scope}/${file}: at the default level\n${adds[0]}`);
        assert.match(out, /memory=global/, `${scope}/${file}`);
        const said = out.indexOf(`${file} could not be read`);
        assert.ok(said > -1 && said < out.indexOf(`mcp [${scope}]:`), `${scope}/${file}: the unreadable file is said before the first registration:\n${out}`);
    }
});

// M1's other half: the no-notes switch-off turns Claude's own memory off only where the memory server is there to take its
// place - on the copy route a kept level registers none, so it stays on.
test('seed update (full copy route, local scope): a kept memory level registers no server, so Claude\'s own memory is not switched off', POSIX_ONLY, () =>
{
    const SEL = 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n';
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const { calls, outs, steps } = seedRun(['install', 'update'], SEL, {
        env: COPY, args: [['--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            const local = path.join(repo, '.claude', 'settings.local.json');
            if (i === 0)
            {
                // No record left to answer the level (the key gone, settings.json unreadable, no local registration - the
                // recording stub writes no account file), and Claude's own memory back on.
                const data = JSON.parse(fs.readFileSync(local, 'utf8'));
                delete data.env.ALFRED_CODE_MEMORY_DB;
                delete data.autoMemoryEnabled;
                fs.writeFileSync(local, JSON.stringify(data, null, 2));
                fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{ "env": { "A": 1, } garbage');
                return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
            }
            return JSON.parse(fs.readFileSync(local, 'utf8'));
        },
    });
    assert.match(outs[1], /memory=kept/, outs[1]);
    assert.ok(!calls.slice(steps[0]).some((c) => c.startsWith('mcp add --scope local memory ')), 'the kept level registers no memory server');
    assert.notStrictEqual(steps[1].autoMemoryEnabled, false, `Claude's own memory was switched off with no memory server in its place:\n${outs[1]}`);
});

// Review 2.1.6 re-verify N5: a 1.x account-dir stamp is a prior install too, read as this project's on its migrating
// update - so its memory level is kept over an unreadable settings file, never the default a fresh install takes.
test('seed update: an unmigrated 1.x account-dir stamp is a prior install - an unreadable settings.local.json keeps the level', POSIX_ONLY, () =>
{
    const { LEGACY } = require('./install/brand.js');
    const { out } = seedRun('update', 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
        prepare: (repo, work) =>
        {
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', LEGACY.stamp), 'sha: abc\nversion: 1.3.0\nscope: global\n');
            fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'docs.js'), '');
            fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage');
        },
    });
    assert.doesNotMatch(out, /no install is recorded here/, out);
    assert.match(out, /memory=kept/, out);
});

// Review 2.1.6, the every-issue ruling: an unstamped legacy install (measured: v0.2.84 from a plain directory - no stamp, and
// no docs.js install record) registers memory in .mcp.json with its database, which answers the level first. With that
// registration removed by hand there is no level to keep, so it takes the default like a fresh install - 'kept' left the
// full copy route registering no memory server at all.
test('seed update (full copy route): an unstamped legacy install with no memory registration takes the default level over an unreadable settings file', POSIX_ONLY, () =>
{
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const claude = ['printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"', 'if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then exit 1; fi', 'exit 0'].join('\n');
    const { calls, outs, steps } = seedRun(['install', 'update'], 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
        env: COPY, tools: { claude }, args: [['--scope', 'project', '--memory-level', 'project'], ['--scope', 'project']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.rmSync(path.join(repo, '.claude', 'alfred-code.stamp'));
            fs.rmSync(path.join(repo, '.claude', 'hooks', 'docs.js'));
            const mcpFile = path.join(repo, '.mcp.json');
            const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
            delete data.mcpServers.memory;
            fs.writeFileSync(mcpFile, JSON.stringify(data, null, 2));
            fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage');
            return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
        },
    });
    assert.match(outs[1], /no stamp: an unstamped legacy install/, outs[1]);
    assert.match(outs[1], /memory=global/, outs[1]);
    assert.ok(calls.slice(steps[0]).some((c) => c.startsWith('mcp add --scope project memory ')), 'the memory server is registered');
});

// The user's ruling (review 2.1.6, concern 4): on the plugin route a kept level leaves the memory plugin's launcher to
// find the database. Claude's own memory is switched off only where that launcher starts the server - a settings key it
// can read (memory-launch.js resolveDbState) - never where it refuses to start (N2), which would leave neither memory.
// Re-verify 3 S6: settings.json's key serves only where the stamp's ledger records no key in the unreadable settings.local.json
// (an older install's shape); where it records one there, that file is the key's only home and the launcher refuses.
test('seed update (plugin route): a kept memory level switches Claude\'s own memory off only where the launcher serves the server', POSIX_ONLY, () =>
{
    for (const [served, ledgered] of [[false, true], [true, false], [true, true]])
    {
        const { steps, outs } = seedRun(['install', 'update'], 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
            args: [['--scope', 'project'], ['--installed-only', '--scope', 'project']],
            each: (repo, i) =>
            {
                const shared = path.join(repo, '.claude', 'settings.json');
                if (i === 0)
                {
                    const data = JSON.parse(fs.readFileSync(shared, 'utf8'));
                    delete data.autoMemoryEnabled;
                    if (served) data.env = { ...(data.env || {}), ALFRED_CODE_MEMORY_DB: path.join(path.dirname(repo), 'served', 'memory.db') };
                    fs.writeFileSync(shared, JSON.stringify(data, null, 2));
                    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage');
                    const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
                    if (!ledgered) fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/,?settings\.local\.json:ALFRED_CODE_MEMORY_DB=[0-9a-f]{64}/, ''));
                    return null;
                }
                return JSON.parse(fs.readFileSync(shared, 'utf8')).autoMemoryEnabled;
            },
        });
        // With settings.json naming the database it is the level too - the launcher and the installer read one rule (R5) -
        // unless the ledger says the key lives in the file that cannot be read (S6).
        const serves = served && !ledgered;
        const said = `served=${served} ledgered=${ledgered}`;
        assert.match(outs[1], serves ? /settings\.json's ALFRED_CODE_MEMORY_DB records/ : /memory=kept/, `${said}\n${outs[1]}`);
        assert.strictEqual(steps[1], serves ? false : undefined, `${said}: autoMemoryEnabled is ${steps[1]}\n${outs[1]}`);
    }
});

// Re-verify 2 R2 (fSwitchProj / fSwitchUser): a FRESH plugin-route install over a garbage settings.local.json took the default
// level, so the no-notes switch-off ran - while the launcher, which cannot write or read the key there, refuses to start:
// neither memory. On the plugin route the switch-off waits for a launcher that serves, at every level.
test('seed install (plugin route): a fresh install over an unreadable settings.local.json leaves Claude\'s own memory on - project and user scope', POSIX_ONLY, () =>
{
    for (const scope of ['project', 'user'])
    {
        const { result, out } = seedRun('install', 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
            args: ['--scope', scope],
            prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage'); },
            inspect: (repo) => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).autoMemoryEnabled; } catch { return 'unreadable'; } },
        });
        assert.notStrictEqual(result, false, `${scope}: Claude's own memory was switched off with no memory server to serve:\n${out}`);
    }
});

// Re-verify 2 R3 (mClones): the copy route registered the project-level database by its ABSOLUTE path in the committed .mcp.json,
// so every checkout of one repo rewrote it (and the stamp's hash of it) to its own path on every update - a teammate's too.
// Re-verify 3 S2: R3's `${CLAUDE_PROJECT_DIR:-.}` expands to '.' in Claude Code's own environment, so a session started in a
// subdirectory opened a second, un-ignored database there, and an inherited CLAUDE_PROJECT_DIR opened another folder's. The
// three project-anchored rows now start through the engine's ROOT_BOOT - a constant `node -e` that runs the server at the
// project it resolves (memory.js projectRootOf) - with plain relative paths: no parse-time variable, no machine's path.
test('seed install and update (full copy route, project scope): the anchored registrations name no path of this machine, a second checkout rewrites nothing, and a server started in a subdirectory or under another folder\'s CLAUDE_PROJECT_DIR runs at the project', POSIX_ONLY, () =>
{
    const { scrubLegacyEnv } = require('./seed-sandbox.js');
    const engine = require('../stack/hooks/memory.js');
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    // The machine-local key is this checkout's absolute path (re-verify 3 S1), so its ledger hash is the one stamp change a
    // second checkout makes; the tracked .mcp.json is what must stay put.
    const untimed = (stamp) => stamp.replace(/^(installed|installed-ms|action): .*\n/mg, '').replace(/(settings\.local\.json:ALFRED_CODE_MEMORY_DB=)[0-9a-f]{64}/, '$1<hash>');
    const { steps } = seedRun(['install', 'update'], 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\nmcp browser\n', {
        env: COPY, args: [['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], ['--installed-only', '--scope', 'project']],
        each: (repo, i) =>
        {
            if (i === 0) return null;
            const work = path.dirname(repo);
            const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
            const servers = JSON.parse(read(repo, '.mcp.json')).mcpServers;
            // Start each anchored registration as Claude Code would - its command, args and env - from a subdirectory and
            // under a CLAUDE_PROJECT_DIR exported to another folder, with a stub on PATH recording where it ran.
            const bin = path.join(work, 'anchor-bin');
            const record = path.join(work, 'anchor.json');
            fs.mkdirSync(bin, { recursive: true });
            for (const tool of ['uvx', 'npx'])
                fs.writeFileSync(path.join(bin, tool), `#!/usr/bin/env node\nconst p=require('path');const a=process.argv.slice(2);const at=(f)=>a[a.indexOf(f)+1];require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), db: process.env.MCP_MEMORY_SQLITE_PATH ? p.resolve(process.env.MCP_MEMORY_SQLITE_PATH) : null, context: a.includes('--context') ? p.resolve(at('--context')) : null, profile: a.includes('--user-data-dir') ? p.resolve(at('--user-data-dir')) : null, home: process.env.SERENA_HOME ? p.resolve(process.env.SERENA_HOME) : null }));\n`, { mode: 0o755 });
            const sub = path.join(repo, 'packages', 'app');
            fs.mkdirSync(sub, { recursive: true });
            const elsewhere = path.join(work, 'elsewhere');
            fs.mkdirSync(elsewhere, { recursive: true });
            const started = {};
            for (const name of ['memory', 'navigation', 'browser-chrome'])
            {
                const e = servers[name];
                started[name] = [{}, { CLAUDE_PROJECT_DIR: elsewhere }].map((inherited) =>
                {
                    fs.rmSync(record, { force: true });
                    execFileSync(e.command, e.args, { cwd: sub, env: { PATH: bin + path.delimiter + process.env.PATH, HOME: work, ...e.env, ...inherited }, stdio: 'pipe' });
                    return JSON.parse(fs.readFileSync(record, 'utf8'));
                });
            }
            const second = path.join(work, 'second-checkout');
            fs.cpSync(repo, second, { recursive: true });
            const before = { mcp: read(second, '.mcp.json'), stamp: untimed(read(second, '.claude/alfred-code.stamp')) };
            const env = { ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), PATH: path.join(work, 'bin') + path.delimiter + process.env.PATH,
                CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json'), ALFRED_CODE_MEMORY_WARM: '0' };
            for (const k of ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY', 'UV_EXCLUDE_NEWER']) delete env[k];
            scrubLegacyEnv(env);
            Object.assign(env, COPY);
            const out = execFileSync(process.execPath, [path.join(__dirname, 'install', 'alfred-code.js'), 'update', '--installed-only', '--source', path.join(__dirname, '..'), '--scope', 'project'],
                { cwd: second, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            return { before, after: { mcp: read(second, '.mcp.json'), stamp: untimed(read(second, '.claude/alfred-code.stamp')),
                key: JSON.parse(read(second, '.claude/settings.local.json')).env.ALFRED_CODE_MEMORY_DB, secondDb: path.join(fs.realpathSync(second), '.alfred', '.alfred-memory', 'memory.db') }, out, servers, started,
                real: fs.realpathSync(repo), engineDb: engine.registeredDbPath(fs.realpathSync(repo), { home: work, configDir: path.join(work, 'acct') }), work: [work, fs.realpathSync(work)] };
        },
    });
    const { before, after, out, servers, started, real, engineDb, work } = steps[1];
    // The documentation row's key header is the account env's by design; the three project-anchored rows carry no variable.
    const text = JSON.stringify([servers.memory, servers.navigation, servers['browser-chrome']]);
    assert.doesNotMatch(text, /\$\{/, 'no parse-time variable in a project-anchored registration');
    assert.ok(work.every((w) => !text.includes(w)), `a registration names this machine's path: ${text}`);
    for (const [name, anchor] of [['memory', 'project'], ['navigation', 'checkout'], ['browser-chrome', 'checkout']])
        assert.deepStrictEqual([servers[name].command, ...servers[name].args.slice(0, 4)], ['node', '-e', engine.ROOT_BOOT, '--', anchor], name);
    // The emitted rows, whole, hold no character cmd.exe reads: a row may reach cmd.exe on Windows (re-verify 3).
    for (const name of ['memory', 'navigation', 'browser-chrome'])
    {
        const words = [servers[name].command, ...servers[name].args, ...Object.values(servers[name].env || {})];
        const bad = words.filter((w) => /["%^&|<>!\r\n]/.test(w));
        assert.deepStrictEqual(bad, [], `${name} carries a character cmd.exe reads`);
    }
    assert.strictEqual(servers.memory.env.MCP_MEMORY_SQLITE_PATH, '.alfred/.alfred-memory/memory.db');
    for (const run of started.memory) assert.deepStrictEqual([run.cwd, run.db], [real, engineDb], 'the server opens the database the engine names');
    assert.strictEqual(engineDb, path.join(real, '.alfred', '.alfred-memory', 'memory.db'));
    for (const run of started.navigation) assert.deepStrictEqual([run.cwd, run.context, run.home], [real, path.join(real, '.claude', 'navigation-context.yml'), path.join(real, '.alfred', 'serena', 'home')]);
    for (const run of started['browser-chrome']) assert.deepStrictEqual([run.cwd, run.profile], [real, path.join(real, '.alfred', 'browser', 'chrome')]);
    assert.strictEqual(after.mcp, before.mcp, `the second checkout rewrote .mcp.json:\n${out}`);
    assert.strictEqual(after.stamp, before.stamp, 'the second checkout changed the stamp beyond its time lines');
    assert.strictEqual(after.key, after.secondDb, 'the second checkout\'s machine-local key names its own database');
    assert.doesNotMatch(out, /is in another folder/, out);
    assert.match(out, /memory=project/, out);
});

// Re-verify 3 S2, the account levels: the committed .mcp.json named the global (or scoped) database by this machine's home,
// so a teammate's server opened a folder that is not theirs until their update rewrote the tracked file to their own. It is
// named from the home (`~/`), and ROOT_BOOT's runAtRoot expands that against the home of the machine that starts it.
test('seed install (full copy route, project scope): the global and scoped levels are named from the home in .mcp.json, and a start expands it on the machine that runs it', POSIX_ONLY, () =>
{
    const engine = require('../stack/hooks/memory.js');
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    for (const [level, file] of [['global', 'memory.db'], ['scoped', 'memory_default.db']])
    {
        const { result, out } = seedRun('install', 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
            env: COPY, args: ['--scope', 'project', '--memory-level', level],
            inspect: (repo) =>
            {
                const work = path.dirname(repo);
                const e = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers.memory;
                const bin = path.join(work, 'anchor-bin');
                const record = path.join(work, 'anchor.txt');
                fs.mkdirSync(bin, { recursive: true });
                fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, require('path').resolve(process.env.MCP_MEMORY_SQLITE_PATH));\n`, { mode: 0o755 });
                // Another machine's home: the start expands the registration against it, never against the installer's.
                const teammate = path.join(work, 'teammate');
                fs.mkdirSync(teammate, { recursive: true });
                execFileSync(e.command, e.args, { cwd: repo, env: { PATH: bin + path.delimiter + process.env.PATH, HOME: teammate, ...e.env }, stdio: 'pipe' });
                return { value: e.env.MCP_MEMORY_SQLITE_PATH, started: fs.readFileSync(record, 'utf8'), teammate,
                    engineDb: engine.registeredDbPath(fs.realpathSync(repo), { home: work, configDir: path.join(work, 'acct') }), home: work };
            },
        });
        assert.strictEqual(result.value, `~/.alfred-memory/${file}`, `${level}: .mcp.json names a machine's path`);
        assert.strictEqual(result.started, path.join(result.teammate, '.alfred-memory', file), `${level}: the start did not expand the home`);
        assert.strictEqual(result.engineDb, path.join(result.home, '.alfred-memory', file), `${level}: the engine reads another database`);
        assert.match(out, new RegExp(`memory=${level}`), out);
    }
});

// Re-verify 4 T2 (wtFull*, wtPlug*): a linked worktree of an installed checkout must share the main checkout's project
// database. On the full copy route the committed stamp and engine made the worktree its own project - a second, empty
// database relative to it (base opened main's); on the plugin route the key lives in main's untracked settings.local.json,
// so the worktree's server opened the GLOBAL database and the level CLI said `none` (base did the same). Each cell installs
// at the project level, commits, adds a worktree, then starts the memory server as Claude Code would from the worktree and
// from a folder in it, and reads the level CLI there.
test('seed install (full copy and plugin routes, project and user scope): a linked worktree\'s memory server and level CLI open the main checkout\'s project database', POSIX_ONLY, () =>
{
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const LAUNCH = path.join(__dirname, '..', 'stack', 'mcp', 'memory-launch.js');
    for (const [route, env] of [['copy', COPY], ['plugin', {}]])
        for (const scope of ['project', 'user'])
        {
            const { result } = seedRun('install', 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
                env, args: ['--scope', scope, '--memory-level', 'project'],
                inspect: (repo) =>
                {
                    const work = path.dirname(repo);
                    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
                    git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
                    // Claude Code keeps settings.local.json out of git; the worktree never has main's copy.
                    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.claude/settings.local.json\n');
                    git('add', '-A'); git('commit', '-q', '-m', 'install');
                    const wt = path.join(work, 'wt');
                    git('worktree', 'add', '-q', '-b', 'wt', wt);
                    fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
                    const bin = path.join(work, 'anchor-bin');
                    const record = path.join(work, 'anchor.json');
                    fs.mkdirSync(bin, { recursive: true });
                    fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), db: require('path').resolve(process.env.MCP_MEMORY_SQLITE_PATH || '') }));\n`, { mode: 0o755 });
                    const runEnv = { PATH: bin + path.delimiter + process.env.PATH, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
                    const row = route === 'copy' ? JSON.parse(fs.readFileSync(path.join(wt, '.mcp.json'), 'utf8')).mcpServers.memory : null;
                    const started = [wt, path.join(wt, 'src')].map((cwd) =>
                    {
                        fs.rmSync(record, { force: true });
                        if (row) execFileSync(row.command, row.args, { cwd, env: { ...runEnv, ...row.env }, stdio: 'pipe' });
                        else execFileSync(process.execPath, [LAUNCH, '--package', 'mcp-memory-service[sqlite]==11.13.0'], { cwd, env: runEnv, stdio: 'pipe' });
                        return JSON.parse(fs.readFileSync(record, 'utf8')).db;
                    });
                    const engine = [wt, repo].map((r) => path.join(r, '.claude', 'hooks', 'memory.js')).find((f) => fs.existsSync(f));
                    const level = execFileSync(process.execPath, [engine, 'level'], { cwd: wt, env: runEnv, encoding: 'utf8' }).trim();
                    return { started, level, mainDb: path.join(fs.realpathSync(repo), '.alfred', '.alfred-memory', 'memory.db') };
                },
            });
            const cell = `${route} route, ${scope} scope`;
            assert.deepStrictEqual(result.started, [result.mainDb, result.mainDb], `${cell}: the worktree's server opened another database`);
            assert.strictEqual(result.level, `project ${result.mainDb}`, `${cell}: the level CLI in the worktree`);
        }
});

// Re-verify 4 T6 (the mate cells): the committed value followed the author machine's unmoved 2.0.0 ~/.memory-mcp, so a
// teammate holding only ~/.alfred-memory got a second, empty database (and an author with no 2.0.0 folder handed a
// teammate with an unmoved one an empty one). The value is always ~/.alfred-memory/<file>; each machine that starts the
// server opens its own live file - the new place, else its unmoved 2.0.0 one. A second run rewrites nothing.
test('seed install and update (full copy route, project scope): an account-level database is committed as ~/.alfred-memory/<file> whatever the author\'s folder, and each machine opens its own live file', POSIX_ONLY, () =>
{
    const COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const { steps, outs } = seedRun(['install', 'update'], 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
        env: COPY, args: [['--scope', 'project', '--memory-level', 'global'], ['--installed-only', '--scope', 'project']],
        // The author's machine still holds its 2.0.0 database, unmoved: the copy route never moves it.
        prepare: (repo, work) => { fs.mkdirSync(path.join(work, '.memory-mcp'), { recursive: true }); fs.writeFileSync(path.join(work, '.memory-mcp', 'memory.db'), 'AUTHOR'); },
        each: (repo) =>
        {
            const work = path.dirname(repo);
            const e = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers.memory;
            const bin = path.join(work, 'anchor-bin');
            const record = path.join(work, 'anchor.txt');
            fs.mkdirSync(bin, { recursive: true });
            fs.writeFileSync(path.join(bin, 'uvx'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, require('path').resolve(process.env.MCP_MEMORY_SQLITE_PATH));\n`, { mode: 0o755 });
            const mates = { fresh: path.join(work, 'mate-new'), old: path.join(work, 'mate-old') };
            fs.mkdirSync(path.join(mates.fresh, '.alfred-memory'), { recursive: true });
            fs.writeFileSync(path.join(mates.fresh, '.alfred-memory', 'memory.db'), 'MATE');
            fs.mkdirSync(path.join(mates.old, '.memory-mcp'), { recursive: true });
            fs.writeFileSync(path.join(mates.old, '.memory-mcp', 'memory.db'), 'MATE-OLD');
            const start = (home) => { execFileSync(e.command, e.args, { cwd: repo, env: { PATH: bin + path.delimiter + process.env.PATH, HOME: home, ...e.env }, stdio: 'pipe' }); return fs.readFileSync(record, 'utf8'); };
            return { value: e.env.MCP_MEMORY_SQLITE_PATH, author: start(work), fresh: start(mates.fresh), old: start(mates.old), work, mates, mcp: fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8') };
        },
    });
    const [first, second] = steps;
    assert.strictEqual(first.value, '~/.alfred-memory/memory.db', 'the committed value names the author\'s unmoved folder');
    assert.strictEqual(first.author, path.join(first.work, '.memory-mcp', 'memory.db'), 'the author\'s server left its own database');
    assert.strictEqual(first.fresh, path.join(first.mates.fresh, '.alfred-memory', 'memory.db'), 'a teammate with only the new place got another file');
    assert.strictEqual(first.old, path.join(first.mates.old, '.memory-mcp', 'memory.db'), 'a teammate with an unmoved 2.0.0 database got another file');
    assert.strictEqual(second.mcp, first.mcp, 'the update rewrote .mcp.json');
    assert.match(outs[1], /memory=global/, outs[1]);
});

// The flag is the user's own word, so it still re-points the server - but the key it would write lives in the file that
// cannot be read, and that is said before the first registration too.
test('seed update (full copy route, local scope): --memory-level over an unreadable settings.local.json re-points the server and says first that the key is not written', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        args: [['--scope', 'local', '--memory-level', 'project'], ['--installed-only', '--scope', 'local', '--memory-level', 'global']],
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage'); return null; },
    });
    const out = outs[1];
    assert.match(out, /memory=global/);
    const said = out.search(/settings\.local\.json could not be read - --memory-level global .*ALFRED_CODE_MEMORY_DB is not written/);
    assert.ok(said > -1 && said < out.indexOf('mcp [local]:'), `the unwritten key is said before the first registration:\n${out}`);
});
