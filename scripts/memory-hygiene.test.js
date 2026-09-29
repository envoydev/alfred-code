'use strict';
// `memory.js duplicates` and `memory.js reembed` - the two hygiene verbs over the shared memory
// database. `duplicates` only reports; `reembed` finds the rows a pre-fix registration stored with a
// hash embedding (a vector whose L2 norm is far from 1 - the real sentence model writes unit vectors)
// or with no vector at all, and re-stores them THROUGH the service. Driven against fixture databases
// built from the captured schema plus the vec0 shadow tables - never a real ~/.alfred-memory or ~/.memory-mcp file.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'stack', 'hooks', 'memory.js');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'memory-schema.sql'), 'utf8');
const VEC_SHADOW = fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'memory-vec-shadow.sql'), 'utf8');
const FAKE_SERVER = path.join(ROOT, 'scripts', 'fixtures', 'fake-memory-sqlite-server.js');

let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const skipNoSqlite = DatabaseSync ? false : 'node:sqlite unavailable on this Node - hygiene tests skipped';

const DIM = 384;
const DAY = 86400;
const T0 = Date.UTC(2026, 5, 14) / 1000;   // 2026-06-14
const serviceHash = (content) => crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex');
const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// What a pre-fix registration wrote: values spread over [-1, 1], norm about sqrt(384 / 3) = 11.3.
const hashVector = (seed) => Float32Array.from({ length: DIM }, (_, i) => (((i + 1) * 7919 + seed * 104729) % 2001) / 1000 - 1);
// What the sentence model writes: a unit vector.
const unitVector = (seed) => { const v = hashVector(seed); const n = Math.hypot(...v); return v.map((x) => x / n); };

// memory_graph as migration 008 plus relationship_type creates it (11.13.0).
const GRAPH = 'CREATE TABLE memory_graph (source_hash TEXT NOT NULL, target_hash TEXT NOT NULL, similarity REAL NOT NULL, connection_types TEXT NOT NULL, metadata TEXT, created_at REAL NOT NULL, relationship_type TEXT, PRIMARY KEY (source_hash, target_hash))';

// rows: { id, content, tags, memory_type, metadata, created_at, updated_at, deleted_at, superseded_by,
// parent_id, vector: 'hash' | 'unit' | null }. Every vector shares ONE chunk at its own offset, the layout
// the live database uses. graph: [[sourceContent, targetContent]] edges; wal: the service's journal mode.
function buildDb(file, rows, { shadow = true, graph = null, wal = false } = {})
{
    const db = new DatabaseSync(file);
    if (wal) db.exec('PRAGMA journal_mode=WAL');
    db.exec(SCHEMA);
    if (shadow) db.exec(VEC_SHADOW);
    if (graph)
    {
        db.exec(GRAPH);
        const edge = db.prepare(`INSERT INTO memory_graph (source_hash, target_hash, similarity, connection_types, created_at) VALUES (?, ?, 0.97, '["semantic"]', ?)`);
        for (const [a, b] of graph) edge.run(serviceHash(a), serviceHash(b), T0);
    }
    const insert = db.prepare('INSERT INTO memories (id, content_hash, content, tags, memory_type, metadata, created_at, updated_at, created_at_iso, updated_at_iso, deleted_at, superseded_by, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const iso = (t) => (t == null ? null : new Date(t * 1000).toISOString());
    const withVector = rows.filter((r) => r.vector);
    const chunk = Buffer.alloc(Math.max(1, withVector.length) * DIM * 4);
    withVector.forEach((r, offset) =>
    {
        const v = r.vector === 'hash' ? hashVector(r.id) : unitVector(r.id);
        Buffer.from(v.buffer).copy(chunk, offset * DIM * 4);
    });
    for (const r of rows) insert.run(r.id, serviceHash(r.content), r.content, r.tags || '', r.memory_type || 'reference', r.metadata || '{}', r.created_at, r.updated_at ?? r.created_at, iso(r.created_at), iso(r.updated_at ?? r.created_at), r.deleted_at ?? null, r.superseded_by ?? null, r.parent_id ?? null);
    if (shadow)
    {
        db.prepare('INSERT INTO memory_embeddings_vector_chunks00 (rowid, vectors) VALUES (1, ?)').run(chunk);
        const rowid = db.prepare('INSERT INTO memory_embeddings_rowids (rowid, id, chunk_id, chunk_offset) VALUES (?, NULL, 1, ?)');
        withVector.forEach((r, offset) => rowid.run(r.id, offset));
    }
    db.close();
}

// A project dir whose .mcp.json registers the fake sqlite-backed server on the fixture db (`service`
// false leaves no server to find), so `reembed` reaches it the way it reaches a real registration.
function sandbox(rows, opts = {})
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'memhyg-'));
    const dbFile = path.join(work, 'memory.db');
    buildDb(dbFile, rows, opts);
    if (opts.service !== false)
    {
        fs.writeFileSync(path.join(work, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { command: process.execPath, args: [FAKE_SERVER], env: { MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec', MCP_MEMORY_SQLITE_PATH: dbFile } } } }));
    }
    const calls = path.join(work, 'calls.jsonl');
    const env = { ...process.env, HOME: work, USERPROFILE: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), FAKE_SQLITE_CALLS_LOG: calls, ...(opts.env || {}) };
    delete env.CLAUDE_PROJECT_DIR;
    const runEnv = (extra, ...args) => spawnSync(process.execPath, [ENGINE, ...args, '--db', dbFile], { cwd: work, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 });
    const run = (...args) => runEnv({}, ...args);
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
    const callNames = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
    const rowsNow = () =>
    {
        const db = new DatabaseSync(dbFile, { readOnly: true });
        try { return db.prepare('SELECT id, content, tags, memory_type, metadata, created_at, updated_at, deleted_at FROM memories ORDER BY id').all(); }
        finally { db.close(); }
    };
    return { work, dbFile, run, runEnv, digest, callNames, rowsNow, done: () => fs.rmSync(work, { recursive: true, force: true }) };
}

const LONG = 'The integration suite needs the docker daemon up and the seeded database restored before it starts, or every test times out. ';

const DUP_ROWS = [
    { id: 1, content: 'Prefer small commits.', created_at: T0, vector: 'unit' },
    { id: 2, content: '  prefer   SMALL\ncommits. ', created_at: T0 + DAY, vector: 'unit' },
    { id: 3, content: `${LONG}Run it with the offline cache.`, created_at: T0 + 2 * DAY, vector: 'unit' },
    { id: 4, content: `${LONG}Run it on the build agent only.`, created_at: T0 + 3 * DAY, vector: 'unit' },
    { id: 5, content: 'Unrelated fact about the release branch.', created_at: T0 + 4 * DAY, vector: 'unit' },
    { id: 6, content: 'Prefer small  commits.', created_at: T0 + 5 * DAY, deleted_at: T0 + 6 * DAY, vector: null },
];

test('duplicates: identical normalized content and the same first 120 characters are reported as pairs, with ids and dates', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(DUP_ROWS);
    try
    {
        const before = s.digest();
        const r = s.run('duplicates');
        assert.strictEqual(r.status, 0, r.stderr);
        const lines = r.stdout.trim().split('\n');
        assert.deepStrictEqual(lines.filter((l) => /^(exact|near) /.test(l)), [
            `exact  #1 ${isoDay(T0)}  #2 ${isoDay(T0 + DAY)}`,
            `near   #3 ${isoDay(T0 + 2 * DAY)}  #4 ${isoDay(T0 + 3 * DAY)}`,
        ]);
        assert.match(lines[lines.length - 1], /^memory duplicates: 1 exact, 1 near, of 5 live rows in .*memory\.db - nothing deleted$/);
        assert.strictEqual(s.digest(), before, 'duplicates never writes the database');
    }
    finally { s.done(); }
});

// The service's own hash is already case- and trim-blind and UNIQUE, so the copies a live database can
// hold differ inside the text: a doubled space, a tab, a line break.
test('duplicates: three copies of one memory are two pairs against the oldest, never three', { skip: skipNoSqlite }, () =>
{
    const s = sandbox([
        { id: 1, content: 'Same thing.', created_at: T0, vector: 'unit' },
        { id: 2, content: 'same  thing.', created_at: T0 + DAY, vector: 'unit' },
        { id: 3, content: 'SAME\tthing.', created_at: T0 + 2 * DAY, vector: 'unit' },
    ]);
    try
    {
        const r = s.run('duplicates');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.deepStrictEqual(r.stdout.trim().split('\n').filter((l) => l.startsWith('exact')), [
            `exact  #1 ${isoDay(T0)}  #2 ${isoDay(T0 + DAY)}`,
            `exact  #1 ${isoDay(T0)}  #3 ${isoDay(T0 + 2 * DAY)}`,
        ]);
    }
    finally { s.done(); }
});

test('duplicates: a database with none says so and exits 0; an unreadable one is a failure on stderr', { skip: skipNoSqlite }, () =>
{
    const s = sandbox([{ id: 1, content: 'Only one.', created_at: T0, vector: 'unit' }]);
    try
    {
        const r = s.run('duplicates');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^memory duplicates: 0 exact, 0 near, of 1 live row in /m);
        fs.writeFileSync(s.dbFile, 'not a database');
        const bad = s.run('duplicates');
        assert.strictEqual(bad.status, 1);
        assert.match(bad.stderr, /memory duplicates: could not read /);
        assert.strictEqual(bad.stdout, '');
    }
    finally { s.done(); }
});

const EMBED_ROWS = [
    { id: 1, content: 'Hash-embedded preference.', tags: 'prefer-x', memory_type: 'preference_signal', created_at: T0, vector: 'hash' },
    { id: 2, content: 'A real sentence embedding.', tags: 'project:proj', created_at: T0 + DAY, vector: 'unit' },
    { id: 3, content: 'Hash-embedded project fact.', tags: 'project:proj,build', created_at: T0 + 2 * DAY, vector: 'hash' },
    { id: 4, content: 'A row that never got a vector.', tags: 'project:proj', created_at: T0 + 3 * DAY, vector: null },
    { id: 5, content: 'Soft-deleted and hash-embedded.', tags: 'project:proj', created_at: T0 + 4 * DAY, deleted_at: T0 + 5 * DAY, vector: 'hash' },
];

test('reembed --dry-run: selects the live rows whose vector norm is not 1, and those with no vector, and changes nothing', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS);
    try
    {
        const before = s.digest();
        const r = s.run('reembed', '--dry-run');
        assert.strictEqual(r.status, 0, r.stderr);
        const lines = r.stdout.trim().split('\n');
        assert.deepStrictEqual(lines.slice(0, -1).map((l) => l.replace(/\(norm [\d.]+\)/, '(norm N)')), [
            `#1 ${isoDay(T0)} hash-embedded (norm N)`,
            `#3 ${isoDay(T0 + 2 * DAY)} hash-embedded (norm N)`,
            `#4 ${isoDay(T0 + 3 * DAY)} no vector`,
        ]);
        const norm = Number(/norm ([\d.]+)/.exec(lines[0])[1]);
        assert.ok(norm > 5 && norm < 20, `a hash vector's norm is far from 1, got ${norm}`);
        assert.match(lines[lines.length - 1], /^memory reembed --dry-run: 3 of 4 live rows need a real embedding in .*memory\.db - nothing changed$/);
        assert.strictEqual(s.digest(), before);
    }
    finally { s.done(); }
});

test('reembed --dry-run: a database where every vector is a unit vector selects nothing', { skip: skipNoSqlite }, () =>
{
    const s = sandbox([{ id: 1, content: 'Fine.', created_at: T0, vector: 'unit' }, { id: 2, content: 'Also fine.', created_at: T0, vector: 'unit' }]);
    try
    {
        const r = s.run('reembed', '--dry-run');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^memory reembed --dry-run: 0 of 2 live rows need a real embedding in /);
    }
    finally { s.done(); }
});

test('reembed: a database without the vector tables is a named failure, never an empty success', { skip: skipNoSqlite }, () =>
{
    const s = sandbox([{ id: 1, content: 'No vec tables.', created_at: T0 }], { shadow: false });
    try
    {
        const r = s.run('reembed', '--dry-run');
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /memory reembed: .*memory\.db has no sqlite_vec vector tables/);
        assert.strictEqual(r.stdout, '');
    }
    finally { s.done(); }
});

const live = (rows, content) => rows.filter((r) => r.content === content && r.deleted_at == null);
const backupOf = (stdout) => /; backup (.+?\.jsonl) /m.exec(stdout)[1];
const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('reembed: each selected row is re-stored through the service - real vector, same tags, type, metadata and dates - and a second run is a no-op', { skip: skipNoSqlite }, () =>
{
    const rows = EMBED_ROWS.map((r) => (r.id === 1 ? { ...r, metadata: '{"conversation_id":"conv-1","access_count":3}', updated_at: T0 + 10 * DAY } : r));
    const s = sandbox(rows);
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 0, r.stderr);
        const out = r.stdout.trim().split('\n');
        assert.deepStrictEqual(out.slice(3, -1), ['#1 re-embedded', '#3 re-embedded', '#4 re-embedded']);
        assert.match(out[out.length - 1], /^memory reembed: 3 re-embedded, 0 failed, of 3 selected in .*memory\.db; backup .*\.jsonl \(it holds the rows' text\)$/);
        assert.deepStrictEqual(s.callNames(), ['memory_delete', 'memory_store', 'memory_update', 'memory_delete', 'memory_store', 'memory_update', 'memory_delete', 'memory_store', 'memory_update']);

        const after = s.rowsNow();
        for (const src of rows.filter((x) => x.id !== 5 && x.id !== 2))
        {
            const now = live(after, src.content);
            assert.strictEqual(now.length, 1, `one live row for #${src.id}`);
            assert.strictEqual(now[0].tags, src.tags || '');
            assert.strictEqual(now[0].memory_type, src.memory_type || 'reference');
            assert.strictEqual(now[0].created_at, src.created_at, `#${src.id} keeps its original date`);
            assert.strictEqual(now[0].updated_at, src.updated_at ?? src.created_at);
        }
        const meta = JSON.parse(live(after, rows[0].content)[0].metadata);
        assert.strictEqual(meta.conversation_id, 'conv-1');
        assert.strictEqual(meta.access_count, 3);
        const kept = after.find((x) => x.id === 2);
        assert.deepStrictEqual([kept.content, kept.deleted_at, kept.created_at], [rows[1].content, null, rows[1].created_at], 'a unit-vector row is never touched');
        assert.strictEqual(after.find((x) => x.id === 5).deleted_at, rows[4].deleted_at, 'a soft-deleted row stays as it was');

        // Never beside the database - a project-level one sits inside a repo no ignore rule covers.
        const backupFile = backupOf(r.stdout);
        assert.strictEqual(path.dirname(backupFile), path.join(s.work, '.alfred-memory', 'backups'));
        if (process.platform !== 'win32') assert.strictEqual(fs.statSync(backupFile).mode & 0o777, 0o600, 'the backup is readable by its owner only');
        const backup = fs.readFileSync(backupFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepStrictEqual(backup.map((b) => b.content), [rows[0].content, rows[2].content, rows[3].content]);
        assert.deepStrictEqual(backup[0].tags, ['prefer-x']);
        assert.strictEqual(backup[0].created_at, T0);
        assert.strictEqual(backup[0].id, 1, 'the whole row is kept, id included');
        assert.ok('superseded_by' in backup[0] && 'version' in backup[0], 'every column is kept');

        assert.match(s.run('reembed', '--dry-run').stdout, /^memory reembed --dry-run: 0 of 4 live rows need a real embedding/m);
        const before = s.digest();
        const again = s.run('reembed');
        assert.strictEqual(again.status, 0, again.stderr);
        assert.match(again.stdout, /^memory reembed: nothing to re-embed in .*memory\.db$/m);
        assert.strictEqual(s.callNames().length, 9, 'a second run starts no server');
        assert.strictEqual(s.digest(), before);
    }
    finally { s.done(); }
});

test('reembed: a store that fails once is restored on a second pass, date and all', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { env: { FAKE_SQLITE_FAIL_STORE: 'Hash-embedded project fact.', FAKE_SQLITE_FAIL_STORE_ONCE: '1' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^#3 re-embedded \(restored on the second pass\)$/m);
        assert.match(r.stdout, /^memory reembed: 3 re-embedded, 0 failed, of 3 selected/m);
        const now = live(s.rowsNow(), 'Hash-embedded project fact.');
        assert.strictEqual(now.length, 1);
        assert.strictEqual(now[0].created_at, T0 + 2 * DAY);
        assert.strictEqual(now[0].tags, 'project:proj,build');
    }
    finally { s.done(); }
});

test('reembed: a store that keeps failing is reported with the backup that restores it, and exits 1', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { env: { FAKE_SQLITE_FAIL_STORE: 'Hash-embedded project fact.' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 1);
        assert.match(r.stdout, /^#3 FAILED - store: Error storing memory: simulated failure for test$/m);
        assert.match(r.stdout, /^memory reembed: 2 re-embedded, 1 failed, of 3 selected/m);
        const backup = backupOf(r.stdout);
        assert.match(r.stderr, new RegExp(`restore it with: node ".*memory\\.js" reembed --restore "${quoted(backup)}" --db "${quoted(s.dbFile)}" --root "${quoted(fs.realpathSync(s.work))}"`));
        assert.ok(fs.readFileSync(backup, 'utf8').includes('Hash-embedded project fact.'), 'the failed row is in the backup');

        // The hint, run once the store works again, brings the row back with its dates.
        const restored = s.runEnv({ FAKE_SQLITE_FAIL_STORE: '' }, 'reembed', '--restore', backup);
        assert.strictEqual(restored.status, 0, restored.stderr);
        assert.match(restored.stdout, /^#3 restored$/m);
        assert.match(restored.stdout, /^memory reembed --restore: 1 restored, 2 already fine, 0 failed, of 3 in /m);
        const now = live(s.rowsNow(), 'Hash-embedded project fact.');
        assert.strictEqual(now.length, 1);
        assert.strictEqual(now[0].created_at, T0 + 2 * DAY);
        assert.strictEqual(now[0].tags, 'project:proj,build');
        const again = s.runEnv({ FAKE_SQLITE_FAIL_STORE: '' }, 'reembed', '--restore', backup);
        assert.match(again.stdout, /^memory reembed --restore: 0 restored, 3 already fine, 0 failed, of 3 in /m);
    }
    finally { s.done(); }
});

test('reembed: a locked database is a clean failure before anything is deleted, and no server starts', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS);
    const lock = new DatabaseSync(s.dbFile);
    try
    {
        lock.exec('BEGIN EXCLUSIVE');
        const r = s.run('reembed');
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /memory reembed: could not read .*memory\.db/);
        assert.deepStrictEqual(s.callNames(), []);
        lock.exec('COMMIT');
        assert.strictEqual(s.rowsNow().filter((x) => x.deleted_at == null).length, 4);
    }
    finally { try { lock.close(); } catch {} s.done(); }
});

test('reembed: no memory server for the project is a named failure, nothing written', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { service: false });
    try
    {
        const before = s.digest();
        const r = s.run('reembed');
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /memory reembed: no memory server found for this project/);
        assert.strictEqual(s.digest(), before);
        assert.ok(!fs.existsSync(path.join(s.work, '.memory-mcp')) && !fs.existsSync(path.join(s.work, '.alfred-memory')), 'no backup is written');
    }
    finally { s.done(); }
});

test('reembed: a row the service ties to another memory - superseded, a child, or in the graph - is listed and left alone', { skip: skipNoSqlite }, () =>
{
    const rows = [
        ...EMBED_ROWS.slice(0, 4),
        { id: 6, content: 'Superseded hash-embedded row.', created_at: T0 + 5 * DAY, superseded_by: 'abc123', vector: 'hash' },
        { id: 7, content: 'Child hash-embedded row.', created_at: T0 + 6 * DAY, parent_id: 'def456', vector: 'hash' },
        { id: 8, content: 'Linked hash-embedded row.', created_at: T0 + 7 * DAY, vector: 'hash' },
    ];
    const s = sandbox(rows, { graph: [['Linked hash-embedded row.', 'A real sentence embedding.']] });
    try
    {
        const dry = s.run('reembed', '--dry-run');
        assert.strictEqual(dry.status, 0, dry.stderr);
        assert.match(dry.stdout, /^#6 .* - left alone: superseded by another memory$/m);
        assert.match(dry.stdout, /^#7 .* - left alone: has a parent memory$/m);
        assert.match(dry.stdout, /^#8 .* - left alone: linked in the memory graph$/m);
        assert.match(dry.stdout, /^memory reembed --dry-run: 6 of 7 live rows need a real embedding in .*memory\.db, 3 of them left alone - tied to another memory - nothing changed$/m);

        const r = s.run('reembed');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^memory reembed: 3 re-embedded, 0 failed, 3 left alone, of 6 selected in /m);
        const after = s.rowsNow();
        for (const id of [6, 7, 8]) assert.strictEqual(after.find((x) => x.id === id).deleted_at, null, `#${id} is never deleted`);
        const backup = fs.readFileSync(backupOf(r.stdout), 'utf8');
        assert.ok(!backup.includes('Superseded hash-embedded row.'), 'a row left alone is not in the backup');
    }
    finally { s.done(); }
});

test('reembed: the conflict tag the service adds on a store is not a changed field, and is reported', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { env: { FAKE_SQLITE_CONFLICT: 'Hash-embedded project fact.' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /^#3 re-embedded - the service flagged it as conflicting with a similar memory \(tag conflict:unresolved\)$/m);
        assert.match(r.stdout, /^memory reembed: 3 re-embedded, 0 failed, of 3 selected in .*; 1 flagged conflict:unresolved by the service$/m);
    }
    finally { s.done(); }
});

test('reembed: dates that did not come back are restored by a memory_update on the second pass', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { env: { FAKE_SQLITE_FAIL_UPDATE_ONCE: '1' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /^#1 re-embedded \(restored on the second pass\)$/m);
        assert.deepStrictEqual(s.callNames().slice(-1), ['memory_update'], 'the retry is an update, not a second store');
        assert.strictEqual(s.callNames().filter((n) => n === 'memory_store').length, 3);
        assert.strictEqual(live(s.rowsNow(), EMBED_ROWS[0].content)[0].created_at, T0);
    }
    finally { s.done(); }
});

test('reembed: a delete the service refuses leaves the row live and unchanged, and is reported with the second attempt', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { env: { FAKE_SQLITE_FAIL_DELETE: 'Hash-embedded project fact.' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 1);
        assert.match(r.stdout, /^#3 FAILED - delete: Error deleting memory: simulated failure for test$/m);
        assert.match(r.stdout, /^memory reembed: 2 re-embedded, 1 failed, of 3 selected/m);
        const row = s.rowsNow().find((x) => x.id === 3);
        assert.deepStrictEqual([row.deleted_at, row.created_at, row.tags], [null, T0 + 2 * DAY, 'project:proj,build']);
        assert.strictEqual(s.callNames().filter((n) => n === 'memory_store').length, 2, 'a row that was never deleted is never stored twice');
    }
    finally { s.done(); }
});

test('reembed: a server killed mid-pass on a WAL database - the deleted row is stored again and the unreached one re-embedded', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { wal: true, env: { FAKE_SQLITE_CRASH_ON_DELETE: 'Hash-embedded project fact.' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /^#3 re-embedded \(restored on the second pass\)$/m);
        assert.match(r.stdout, /^#4 re-embedded \(restored on the second pass\)$/m);
        assert.match(r.stdout, /^memory reembed: 3 re-embedded, 0 failed, of 3 selected/m);
        const after = s.rowsNow();
        for (const src of [EMBED_ROWS[2], EMBED_ROWS[3]])
        {
            const now = live(after, src.content);
            assert.strictEqual(now.length, 1, `one live row for #${src.id}`);
            assert.strictEqual(now[0].created_at, src.created_at);
        }
        assert.match(s.run('reembed', '--dry-run').stdout, /^memory reembed --dry-run: 0 of 4 live rows/m);
    }
    finally { s.done(); }
});

test('reembed: a server that stores a vector far from unit length stops after the first row', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS, { env: { FAKE_SQLITE_BAD_VECTOR: '1' } });
    try
    {
        const r = s.run('reembed');
        assert.strictEqual(r.status, 1);
        assert.match(r.stdout, /^#1 FAILED - verify: the stored vector is still not a unit vector$/m);
        assert.match(r.stdout, /^#3 not attempted$/m);
        assert.match(r.stdout, /^#4 not attempted$/m);
        assert.match(r.stdout, /^memory reembed: 0 re-embedded, 1 failed, 2 not attempted, of 3 selected/m);
        assert.match(r.stderr, /memory reembed: the memory server stored a vector that is not a unit vector - it is not running the sentence model; stopped after the first row/);
        assert.deepStrictEqual(s.callNames(), ['memory_delete', 'memory_store', 'memory_update']);
        const after = s.rowsNow();
        for (const src of [EMBED_ROWS[0], EMBED_ROWS[2], EMBED_ROWS[3]]) assert.strictEqual(live(after, src.content).length, 1, `#${src.id} is still live`);
    }
    finally { s.done(); }
});

test('reembed: a backup that cannot be written stops the run before any server starts', { skip: skipNoSqlite }, () =>
{
    const s = sandbox(EMBED_ROWS);
    try
    {
        fs.writeFileSync(path.join(s.work, '.memory-mcp'), 'a file where the backups folder would go');
        const before = s.digest();
        const r = s.run('reembed');
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /memory reembed: could not write the backup .* - nothing changed/);
        assert.deepStrictEqual(s.callNames(), []);
        assert.strictEqual(s.digest(), before);
    }
    finally { s.done(); }
});
