// scripts/memory-handoff.test.js - the seat handoff bus on the alfred-memory MCP (the user's 2026-10-13 ruling:
// 'alfred-memory must have highest priority compared to serena memory. Serena is just for navigation, for memory
// it's only alfred memory.'). Measured before the move: 0 alfred-memory calls in 121 seat runs, 247 navigation-server
// memory calls (137 write, 50 read, 60 list) - two memory stores, the seats using the one the rule ranked second.
// Pins: no seat grant or stack instruction names a navigation-server memory tool, the server's context switches all
// six off, every seat's handoff line stores and lists through alfred-memory with the protocol alfred-memory.md states,
// the session-start push never re-sends a handoff row, `memory.js handoff` counts what a purge left, and SubagentStart
// hands every seat its project tag. Every database here is a fixture under os.tmpdir(), removed after its test.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const m = require('../stack/hooks/memory.js');
const ENGINE = path.join(ROOT, 'stack', 'hooks', 'memory.js');
const HOOK = path.join(ROOT, 'stack', 'hooks', 'memory-session.js');
const host = require(HOOK).hostLines(process.platform, '/bin/bash'); // the lines a bash host gets: none, or win32's own

let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const skipNoSqlite = DatabaseSync ? false : 'node:sqlite unavailable on this Node - db-backed handoff tests skipped';
const SCHEMA = fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-schema.sql'), 'utf8');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function buildDb(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)');
  rows.forEach((r, i) => insert.run(r.hash || `hash-${i}`, r.content, r.tags || '', r.memory_type || 'note', r.created_at != null ? r.created_at : Date.now() / 1000 - i, r.deleted_at != null ? r.deleted_at : null));
  db.close();
}

const SERENA_MEMORY_TOOLS = ['write_memory', 'read_memory', 'list_memories', 'edit_memory', 'rename_memory', 'delete_memory'];
const NAV = 'mcp__plugin_alfred-navigation_alfred-navigation__';
const MEM = 'mcp__plugin_alfred-memory_alfred-memory__';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(md|js|json|ya?ml)$/.test(e.name)) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ the server and the grants

test('the navigation server context switches all six memory tools off and its prompt routes notes to alfred-memory', () => {
  const yml = read('stack/mcp/navigation-context.yml');
  const excluded = (/^excluded_tools:\n((?:[ \t]+(?:-[^\n]*|#[^\n]*)\n)+)/m.exec(yml) || [, ''])[1]
    .split('\n').map((l) => /^\s+-\s+(\S+)/.exec(l)).filter(Boolean).map((x) => x[1]);
  for (const t of SERENA_MEMORY_TOOLS) assert.ok(excluded.includes(t), `excluded_tools lists ${t}`);
  assert.ok(!/write_memory, read_memory and list_memories carry/.test(yml), 'the seat-handoff prompt bullet is gone');
  assert.match(yml, /a note one agent\s+leaves for the next goes through the alfred-memory MCP/);
});

// The seats' handoff left this server on 2026-10-24 (the file bus, scripts/handoff-engine.test.js; seat-grants.test.js
// holds every seat to it).

test('no shipped text tells the model to use a navigation-server memory tool', () => {
  const files = [...walk(path.join(ROOT, 'stack')), ...walk(path.join(ROOT, 'setup-plugin'))]
    // the record of how the stack shipped its servers keeps the navigation context verbatim - read by nothing
    .filter((f) => !f.endsWith(path.join('mcp', 'navigation-context.yml')) && !f.endsWith(path.join('mcp', 'shipped-mcps.json')));
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const t of SERENA_MEMORY_TOOLS) if (new RegExp(`\\b${t}\\b`).test(text)) hits.push(`${path.relative(ROOT, f)}: ${t}`);
    // 'an older release's navigation-server notes' is the legacy files a purge count still finds - a fact, not a route.
    if (/(?<!older release's )navigation[- ]server(?:'s)? (?:memory|note|handoff)/i.test(text)) hits.push(`${path.relative(ROOT, f)}: navigation-server memory prose`);
  }
  assert.deepStrictEqual(hits, []);
});

test('the rules: alfred-memory.md routes the handoff notes, the trio protocol holds their calls, alfred-navigation.md and the locked row keep no memory on the server', () => {
  const mem = read('stack/rules/alfred-memory.md');
  assert.ok(!mem.includes("handoff notes go to the navigation server's memory"), 'the old routing is gone');
  assert.match(mem, /A seat's handoff note - what one agent leaves the next within a run - lives here too, never in the navigation server \(its memory tools are off\); its dispatch brief names it, and the session-start block never carries a `handoff` row\./);
  // audit 2026-10-14 RU01: the call shapes left the always-on rule - every seat body carries its own, the orchestrator's protocol the rest
  assert.ok(!mem.includes('conversation_id'), 'no call shape in the always-on rule');
  const trio = read('stack/skills/task-solve-cross/references/domain-trio-protocol.md');
  for (const piece of ["`conversation_id: '<feature>/<contract_version>'`", "`metadata.type: 'note'`", '`handoff`, `handoff:<feature>`, `handoff:<feature>/<contract_version>`, `note:<note name>` and the project tag', "`tag_match: 'all'`", 'memory_delete', 'the newest note per name wins'])
    assert.ok(trio.includes(piece), `domain-trio-protocol.md: ${piece}`);
  const nav = read('stack/rules/alfred-navigation.md');
  assert.ok(!/write_memory|seat memory handoff/.test(nav), 'alfred-navigation.md keeps no memory on the server');
  assert.ok(!/memory tools are off/.test(nav), 'stack audit 2026-10-20 rules row 6: alfred-memory.md is the one home of the line');
});

test('the manifest wires memory-session.js on SubagentStart beside SessionStart', () => {
  const hooks = JSON.parse(read('meta/stack-manifest.json')).hooks.filter((h) => h.file === 'memory-session.js').map((h) => h.matcher);
  assert.deepStrictEqual(hooks.sort(), ['@SessionStart', '@SubagentStart']);
});

// ------------------------------------------------------------------ the engine

test('selectForSession never re-sends a handoff row, the bare tag or a handoff:<run> one', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('handoff-select-');
  try {
    const db = path.join(dir, 'memory.db');
    buildDb(db, [
      { content: 'run note', tags: 'handoff,handoff:feat,handoff:feat/v1,note:feat/v1/designer,project:app' },
      { content: 'tag only by run', tags: 'handoff:feat/v1,project:app' },
      { content: 'a project fact', tags: 'project:app', memory_type: 'reference' },
    ]);
    const { text, counts } = m.selectForSession(db, { project: 'app' });
    assert.ok(text.includes('a project fact'), text);
    assert.ok(!text.includes('run note') && !text.includes('tag only by run'), text);
    assert.strictEqual(counts.own, 1);
  } finally { rmDir(dir); }
});

const handoffCli = (args, extra = {}) => spawnSync(process.execPath, [ENGINE, 'handoff', ...args], { encoding: 'utf8', env: { ...process.env, ...extra } });

test('memory.js handoff counts this project\'s rows for the feature by exact tag, plus legacy notes on disk', { skip: skipNoSqlite }, () => {
  const root = tmpDir('handoff-count-');
  try {
    const name = path.basename(root);
    const db = path.join(root, 'memory.db');
    buildDb(db, [
      { content: 'a', tags: `handoff,handoff:feat,handoff:feat/v1,note:feat/v1/aspnet-implementer/t1,project:${name}` },
      { content: 'b', tags: `handoff,handoff:feat,handoff:feat/v2,note:feat/v2/aspnet-verifier,project:${name}` },
      { content: 'c - another feature whose name starts the same', tags: `handoff,handoff:feat-2,handoff:feat-2/v1,note:feat-2/v1/x,project:${name}` },
      { content: 'd - another project', tags: 'handoff,handoff:feat,handoff:feat/v1,note:feat/v1/y,project:other' },
      { content: 'e - purged', tags: `handoff,handoff:feat,note:feat/v1/z,project:${name}`, deleted_at: 1 },
    ]);
    const legacyDir = path.join(root, '.alfred', 'serena', 'memories', 'feat', 'v0');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'aspnet-designer.md'), 'old');
    fs.writeFileSync(path.join(root, '.alfred', 'serena', 'memories', 'feat__flat.md'), 'older');
    fs.writeFileSync(path.join(root, '.alfred', 'serena', 'memories', 'feat-2__other.md'), 'not this feature');
    const r = handoffCli(['feat', '--db', db, '--root', root]);
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split(/\r?\n/);
    assert.strictEqual(lines[0], '4', r.stdout);
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('row ')).sort(), ['row feat/v1/aspnet-implementer/t1', 'row feat/v2/aspnet-verifier']);
    assert.strictEqual(lines.filter((l) => l.startsWith('legacy ')).length, 2);
    const all = handoffCli(['--db', db, '--root', root]);
    assert.strictEqual(all.stdout.split(/\r?\n/)[0], '6', 'no feature: every handoff row of this project and every legacy note');
    buildDb(path.join(root, 'empty.db'), []);
    rmDir(path.join(root, '.alfred'));
    assert.strictEqual(handoffCli(['feat', '--db', path.join(root, 'empty.db'), '--root', root]).stdout.trim(), '0', 'nothing left reads 0');
  } finally { rmDir(root); }
});

test('memory.js handoff never prints a number it could not read', { skip: skipNoSqlite }, () => {
  const root = tmpDir('handoff-unread-');
  try {
    const garbage = path.join(root, 'garbage.db');
    fs.writeFileSync(garbage, 'not a database');
    const bad = handoffCli(['feat', '--db', garbage, '--root', root]);
    assert.strictEqual(bad.status, 1);
    assert.strictEqual(bad.stdout, '', 'no number on stdout');
    assert.match(bad.stderr, /could not read .* - no count/);
    const none = handoffCli(['feat', '--root', root], { CLAUDE_CONFIG_DIR: root, HOME: root, USERPROFILE: root });
    assert.strictEqual(none.status, 1);
    assert.strictEqual(none.stdout, '');
    assert.match(none.stderr, /no memory database registered/);
  } finally { rmDir(root); }
});

test('legacyHandoffNotes reads a Windows-shaped data root and a 2.0.0 .serena folder', () => {
  const root = tmpDir('handoff-legacy-');
  try {
    fs.mkdirSync(path.join(root, 'data', 'serena', 'memories', 'feat'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'serena', 'memories', 'feat', 'n.md'), 'x');
    fs.mkdirSync(path.join(root, '.serena', 'memories'), { recursive: true });
    fs.writeFileSync(path.join(root, '.serena', 'memories', 'feat__old.md'), 'y');
    fs.writeFileSync(path.join(root, '.serena', 'memories', 'feat__old.txt'), 'not a note');
    const found = m.legacyHandoffNotes(root, 'feat', { ALFRED_CODE_DATA_PATH: 'data' });
    assert.strictEqual(found.length, 2, found.join('\n'));
    assert.deepStrictEqual(m.legacyHandoffNotes(path.join(root, 'absent'), 'feat', {}), [], 'a missing folder is none left');
  } finally { rmDir(root); }
});

// ------------------------------------------------------------------ the hook

function hookProject(registered = true) {
  const root = tmpDir('handoff-hook-');
  const config = tmpDir('handoff-hook-config-');
  const dbPath = path.join(root, '.memory-mcp', 'memory.db');
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: registered ? { memory: { type: 'stdio', command: 'uvx', args: [], env: { MCP_MEMORY_SQLITE_PATH: dbPath } } } : {} }));
  // a bash $SHELL: no zsh trap line rides the push (memory-session.js hostLines, audit 2026-10-14 RU13); win32 adds its own
  const run = (payload) => spawnSync(process.execPath, [HOOK], { cwd: root, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, SHELL: '/bin/bash', CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: config } });
  return { root, dbPath, run, rm: () => { rmDir(root); rmDir(config); } };
}

test('SubagentStart hands the seat its project tag line, never the rows', { skip: skipNoSqlite }, () => {
  const p = hookProject();
  try {
    buildDb(p.dbPath, [{ content: 'a project fact', tags: `project:${path.basename(p.root)}`, memory_type: 'reference' }]);
    const r = p.run({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'aspnet-implementer', cwd: p.root });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.strictEqual(out.hookEventName, 'SubagentStart');
    assert.strictEqual(out.additionalContext.split('\n')[0], `This project's memory tag: project:${path.basename(p.root)}`);
    assert.strictEqual(out.additionalContext.split('\n').length, 1 + (host.length ? host.length + 1 : 0), 'the tag line, then the host\'s shell lines (RU13) - the tool line (RU10) is the tool order\'s now');
    assert.ok(!out.additionalContext.includes('a project fact'), 'no row reaches a seat');
    const start = JSON.parse(p.run({ hook_event_name: 'SessionStart', cwd: p.root }).stdout).hookSpecificOutput;
    assert.ok(start.additionalContext.includes('a project fact'), 'SessionStart still pushes the rows');
  } finally { p.rm(); }
});

test('SubagentStart with no memory registration, or another event, stays silent', () => {
  const p = hookProject(false);
  try {
    assert.strictEqual(p.run({ hook_event_name: 'SubagentStart', cwd: p.root }).stdout, '');
  } finally { p.rm(); }
  const q = hookProject();
  try {
    assert.strictEqual(q.run({ hook_event_name: 'SubagentStop', cwd: q.root }).stdout, '');
  } finally { q.rm(); }
});
