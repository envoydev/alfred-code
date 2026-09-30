'use strict';
// `memory.js export` / `import` - moving a project's memories between databases (a level change, a
// second machine, a backup). Export reads the database file directly (read-only, the SessionStart
// engine's own reader); import goes THROUGH the memory service, the route the installer's one-time
// notes import uses, so every stored row gets the service's own embedding. Both are driven here on
// the COPIED engine (`.claude/hooks/memory.js` in a temp project, the shape a consuming project
// has), against the fake stdio server and a fixture database - never a real ~/.memory-mcp file.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'stack', 'hooks', 'memory.js');
const FAKE_SERVER = path.join(ROOT, 'scripts', 'fixtures', 'fake-memory-server.js');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'memory-schema.sql'), 'utf8');
const memory = require('../stack/hooks/memory.js');

let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const skipNoSqlite = DatabaseSync ? false : 'node:sqlite unavailable on this Node - export / import tests skipped';

// Measured on a live 11.13.0 database: content_hash is sha256 of the trimmed, lower-cased content
// (50 of 50 rows; the raw and the trimmed-only content matched none).
const serviceHash = (content) => crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex');

function buildDb(file, rows)
{
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    const insert = db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)');
    rows.forEach((r, i) => insert.run(serviceHash(r.content), r.content, r.tags || '', r.memory_type || 'reference', r.created_at ?? 1_000_000 - i, r.deleted_at ?? null));
    db.close();
}

const liveRows = (file) =>
{
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare('SELECT content, tags, memory_type FROM memories WHERE deleted_at IS NULL ORDER BY id').all(); }
    finally { db.close(); }
};

// A consuming project named `proj`: a git repo, the engine COPIED to .claude/hooks/, the plugin
// route's ALFRED_CODE_MEMORY_DB in its settings.json, and an account dir whose
// installed_plugins.json points memory@envoydev at a fake plugin root carrying the fake server.
function sandbox({ plugin = true, dbRows = [] } = {})
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'memxfer-'));
    const root = path.join(work, 'proj');
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    execFileSync('git', ['init', '-q', root]);
    const engine = path.join(root, '.claude', 'hooks', 'memory.js');
    fs.copyFileSync(ENGINE, engine);
    const dbFile = path.join(work, 'target.db');
    buildDb(dbFile, dbRows);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: dbFile } }, null, 2));
    const acct = path.join(work, 'acct');
    fs.mkdirSync(path.join(acct, 'plugins'), { recursive: true });
    const pluginRoot = path.join(work, 'plugin-cache', 'memory', '1.0.0');
    if (plugin)
    {
        fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
        fs.copyFileSync(FAKE_SERVER, path.join(pluginRoot, 'fake-memory-server.js'));
        fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
            name: 'envoydev',
            plugins: [{ name: 'memory', mcpServers: { memory: {
                command: process.execPath,
                args: ['${CLAUDE_PLUGIN_ROOT}/fake-memory-server.js'],
                env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec' },
            } } }],
        }, null, 2));
        fs.writeFileSync(path.join(acct, 'plugins', 'installed_plugins.json'), JSON.stringify({
            version: 2,
            plugins: { 'memory@envoydev': [{ scope: 'project', projectPath: root, installPath: pluginRoot, version: '1.0.0' }] },
        }, null, 2));
    }
    const calls = path.join(work, 'calls.jsonl');
    const env = {
        ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: acct,
        FAKE_MEMORY_DB: path.join(work, 'fake-db.json'), FAKE_MEMORY_CALLS_LOG: calls,
    };
    delete env.CLAUDE_PROJECT_DIR;
    const run = (...args) => spawnSync(process.execPath, [engine, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
    const callCount = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).length : 0);
    return { work, root, dbFile, acct, pluginRoot, env, run, callCount, done: () => fs.rmSync(work, { recursive: true, force: true }) };
}

const SOURCE_ROWS = [
    { content: 'Builds need the offline cache.', tags: 'project:proj,build-cache', memory_type: 'reference' },
    { content: 'Prefer small commits.', tags: 'prefer-small', memory_type: 'preference_signal' },
    { content: 'Other project fact.', tags: 'project:other,fact', memory_type: 'reference' },
    { content: 'A soft-deleted proj row.', tags: 'project:proj,gone', memory_type: 'reference', deleted_at: 5 },
    { content: 'Lesson from the build seat.\nSecond line.', tags: 'project:proj,agent:dotnet-implementer', memory_type: 'learning' },
];

const parseLines = (stdout) => stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('contentHash is the service\'s own: sha256 of the trimmed, lower-cased content', () =>
{
    assert.strictEqual(memory.contentHash('  Mixed Case\n'), serviceHash('mixed case'));
});

test('export: this project\'s live rows as JSONL, nothing else', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox({ dbRows: SOURCE_ROWS });
    const res = sb.run('export');
    assert.strictEqual(res.status, 0, res.stderr);
    const rows = parseLines(res.stdout);
    assert.deepStrictEqual(rows.map((r) => r.content).sort(), ['Builds need the offline cache.', 'Lesson from the build seat.\nSecond line.']);
    const lesson = rows.find((r) => r.memory_type === 'learning');
    assert.deepStrictEqual(lesson.tags, ['project:proj', 'agent:dotnet-implementer']);
    assert.strictEqual(lesson.content_hash, serviceHash(lesson.content));
    assert.strictEqual(typeof lesson.created_at, 'number');
    assert.deepStrictEqual(Object.keys(lesson).sort(), ['content', 'content_hash', 'created_at', 'memory_type', 'tags']);
    assert.match(res.stderr, /memory export: 2 memories \(project proj\) from /);
    sb.done();
});

test('export <project> names another project; --all takes every live row', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox({ dbRows: SOURCE_ROWS });
    const other = sb.run('export', 'other');
    assert.strictEqual(other.status, 0, other.stderr);
    assert.deepStrictEqual(parseLines(other.stdout).map((r) => r.content), ['Other project fact.']);
    const all = sb.run('export', '--all');
    assert.strictEqual(all.status, 0, all.stderr);
    assert.strictEqual(parseLines(all.stdout).length, 4);
    assert.match(all.stderr, /memory export: 4 memories \(all\) from /);
    sb.done();
});

test('export --db reads a database no longer registered (the file an old level left behind)', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const old = path.join(sb.work, 'old-level.db');
    buildDb(old, SOURCE_ROWS);
    const res = sb.run('export', '--db', old);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(parseLines(res.stdout).length, 2);
    sb.done();
});

test('export: an unreadable database is a failure on stderr, never an empty success', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const res = sb.run('export', '--db', path.join(sb.work, 'absent.db'));
    assert.strictEqual(res.status, 1);
    assert.strictEqual(res.stdout, '');
    assert.match(res.stderr, /memory export: could not read /);
    fs.writeFileSync(path.join(sb.work, 'garbage.db'), 'not a database');
    const garbage = sb.run('export', '--db', path.join(sb.work, 'garbage.db'));
    assert.strictEqual(garbage.status, 1);
    assert.strictEqual(garbage.stdout, '');
    sb.done();
});

test('import: stores each line through the plugin\'s own server, then a re-run stores nothing', { skip: skipNoSqlite }, () =>
{
    const src = sandbox({ dbRows: SOURCE_ROWS });
    const file = path.join(src.work, 'proj.jsonl');
    fs.writeFileSync(file, src.run('export').stdout);
    const sb = sandbox();
    const res = sb.run('import', file);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /memory import: 2 imported, 0 already present, from /);
    assert.strictEqual(sb.callCount(), 2);
    const rows = liveRows(sb.dbFile);
    assert.deepStrictEqual(rows.map((r) => r.content).sort(), ['Builds need the offline cache.', 'Lesson from the build seat.\nSecond line.']);
    assert.strictEqual(rows.find((r) => r.memory_type === 'learning').tags, 'project:proj,agent:dotnet-implementer');

    const again = sb.run('import', file);
    assert.strictEqual(again.status, 0, again.stderr);
    assert.match(again.stdout, /memory import: 0 imported, 2 already present, from /);
    assert.strictEqual(sb.callCount(), 2, 'a re-run makes no store call');
    src.done(); sb.done();
});

test('import: a row already present under the service\'s hash (case, whitespace) is not stored again', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox({ dbRows: [{ content: 'prefer small commits.', tags: 'x', memory_type: 'preference_signal' }] });
    const file = path.join(sb.work, 'in.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ content: '  Prefer small commits.\n', tags: ['x'], memory_type: 'preference_signal' })}\n`);
    const res = sb.run('import', file);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /0 imported, 1 already present/);
    assert.strictEqual(sb.callCount(), 0);
    sb.done();
});

test('import: a malformed file is refused whole, before any server starts', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const file = path.join(sb.work, 'bad.jsonl');
    fs.writeFileSync(file, [
        JSON.stringify({ content: 'fine', tags: [], memory_type: 'reference' }),
        '{not json',
        JSON.stringify({ tags: ['no-content'] }),
        '',
        JSON.stringify({ content: 'bad tags', tags: 'a,b' }),
    ].join('\n'));
    const res = sb.run('import', file);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /memory import: bad\.jsonl lines 2, 3, 5 are not memories - nothing imported/);
    assert.strictEqual(sb.callCount(), 0);
    assert.deepStrictEqual(liveRows(sb.dbFile), []);
    const missing = sb.run('import', path.join(sb.work, 'absent.jsonl'));
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /memory import: could not read /);
    const none = sb.run('import');
    assert.strictEqual(none.status, 1);
    assert.match(none.stderr, /memory import: usage: memory\.js import <file\.jsonl>/);
    sb.done();
});

test('import: an empty file imports nothing and starts no server', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const file = path.join(sb.work, 'empty.jsonl');
    fs.writeFileSync(file, '\n');
    const res = sb.run('import', file);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /memory import: nothing to import, from /);
    assert.strictEqual(sb.callCount(), 0);
    sb.done();
});

test('import: no registration and no installed memory plugin is a named failure', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox({ plugin: false });
    const file = path.join(sb.work, 'in.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ content: 'x', tags: [], memory_type: 'reference' })}\n`);
    const res = sb.run('import', file);
    assert.strictEqual(res.status, 1);
    assert.match(res.stderr, /memory import: no memory server found for this project/);
    sb.done();
});

test('serviceEntry: a registration wins; else the installed plugin, its root substituted and the db path pinned', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const viaPlugin = memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct });
    assert.strictEqual(viaPlugin.command, process.execPath);
    // Substituted the way Claude Code substitutes it - a plain string swap, so the separator after the
    // root stays the template's '/' on Windows too, which node resolves the same.
    assert.deepStrictEqual(viaPlugin.args, [`${sb.pluginRoot}/fake-memory-server.js`]);
    assert.strictEqual(viaPlugin.env.MCP_MEMORY_SQLITE_PATH, sb.dbFile);
    assert.strictEqual(viaPlugin.env.MCP_MEMORY_STORAGE_BACKEND, 'sqlite_vec');

    fs.writeFileSync(path.join(sb.root, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'uvx', args: ['a'], env: { MCP_MEMORY_SQLITE_PATH: '/elsewhere.db' } } } }));
    const viaRegistration = memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct });
    assert.strictEqual(viaRegistration.command, 'uvx');
    assert.strictEqual(viaRegistration.env.MCP_MEMORY_SQLITE_PATH, '/elsewhere.db');
    // Re-verify 3 S2: the committed .mcp.json names a project level relative to the project and an account level from the
    // home; the service this engine starts gets the absolute path each names.
    for (const [value, want] of [['.alfred/.alfred-memory/memory.db', path.join(sb.root, '.alfred', '.alfred-memory', 'memory.db')], ['~/.alfred-memory/memory.db', path.join(sb.work, '.alfred-memory', 'memory.db')]])
    {
        fs.writeFileSync(path.join(sb.root, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: 'uvx', args: ['a'], env: { MCP_MEMORY_SQLITE_PATH: value } } } }));
        assert.strictEqual(memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct }).env.MCP_MEMORY_SQLITE_PATH, want, value);
    }
    sb.done();
});

test('serviceEntry: another project\'s plugin row, a foreign marketplace and a garbage file are never used', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const file = path.join(sb.acct, 'plugins', 'installed_plugins.json');
    const row = { scope: 'project', projectPath: path.join(sb.work, 'elsewhere'), installPath: sb.pluginRoot, version: '1.0.0' };
    fs.writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'memory@envoydev': [row], 'memory@claude-plugins-official': [{ ...row, projectPath: undefined, scope: 'user' }] } }));
    assert.strictEqual(memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct }), null);
    fs.writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'memory@envoydev': [{ ...row, projectPath: undefined, scope: 'user' }] } }));
    assert.ok(memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct }), 'a user-scope row serves every project');
    fs.writeFileSync(file, '{garbage');
    assert.strictEqual(memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct }), null);
    sb.done();
});

// Requirement 5 (task-5c): a 1.x install's marketplace KEY never migrates on rename
// (docs/rebrand-evidence.md S4/S9), so its installed_plugins.json row still keys the server
// `memory@claude-stack` for the whole 2.x line. The lookup reads the current key first, then falls // legacy-name
// back to the legacy one, and the current key's row wins when both exist.
test('serviceEntry: a 1.x install\'s memory@claude-stack row resolves too, and memory@envoydev wins when both exist', { skip: skipNoSqlite }, () => // legacy-name
{
    const sb = sandbox();
    const file = path.join(sb.acct, 'plugins', 'installed_plugins.json');
    const row = { scope: 'project', projectPath: sb.root, installPath: sb.pluginRoot, version: '1.0.0' };
    // legacy-name - a 1.x install's plugin id still ends @claude-stack; the marketplace key never moves.
    fs.writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'memory@claude-stack': [row] } })); // legacy-name
    const viaLegacy = memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct });
    assert.ok(viaLegacy, 'the memory@claude-stack row alone still resolves an installPath'); // legacy-name
    assert.strictEqual(viaLegacy.command, process.execPath);

    const newRoot = path.join(sb.work, 'plugin-cache', 'memory-new', '2.0.0');
    fs.mkdirSync(path.join(newRoot, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(FAKE_SERVER, path.join(newRoot, 'fake-memory-server.js'));
    fs.writeFileSync(path.join(newRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
        name: 'envoydev',
        plugins: [{ name: 'memory', mcpServers: { memory: {
            command: process.execPath,
            args: ['${CLAUDE_PLUGIN_ROOT}/fake-memory-server.js', '--new-key'],
            env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec' },
        } } }],
    }, null, 2));
    fs.writeFileSync(file, JSON.stringify({ version: 2, plugins: {
        'memory@claude-stack': [row], // legacy-name
        'memory@envoydev': [{ ...row, installPath: newRoot }],
    } }));
    const viaBoth = memory.serviceEntry(sb.root, { home: sb.work, configDir: sb.acct });
    assert.ok(viaBoth.args.includes('--new-key'), 'memory@envoydev wins when both rows exist');
    sb.done();
});

test('the installer\'s notes import finds the plugin route\'s server too (1.0.0 found none and left Claude\'s own memory on)', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const notes = path.join(sb.work, 'notes');
    fs.mkdirSync(notes);
    fs.writeFileSync(path.join(notes, 'a.md'), '---\nname: a\ndescription: A note\nmetadata:\n  type: project\n---\nBody.\n');
    const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'memory-import.js'), '--project-root', sb.root, '--config-dir', sb.acct, '--memory-dir', notes],
        { cwd: sb.root, env: sb.env, encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(res.status, 0, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /memory import: 1 imported, 0 already present, from /);
    assert.deepStrictEqual(liveRows(sb.dbFile).map((r) => r.tags), ['project:proj,a']);
    sb.done();
});

test('import: the refusal names at most ten bad line numbers - ten in full, eleven cut with an ellipsis', { skip: skipNoSqlite }, () =>
{
    const sb = sandbox();
    const ten = path.join(sb.work, 'ten.jsonl');
    fs.writeFileSync(ten, Array.from({ length: 10 }, () => '{bad').join('\n'));
    assert.match(sb.run('import', ten).stderr, /lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 are not memories/);
    const eleven = path.join(sb.work, 'eleven.jsonl');
    fs.writeFileSync(eleven, Array.from({ length: 11 }, () => '{bad').join('\n'));
    assert.match(sb.run('import', eleven).stderr, /lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, \.\.\. are not memories/);
    const one = path.join(sb.work, 'one.jsonl');
    fs.writeFileSync(one, '{bad\n');
    assert.match(sb.run('import', one).stderr, /one\.jsonl line 1 is not a memory - nothing imported/);
    assert.strictEqual(sb.callCount(), 0);
    sb.done();
});
