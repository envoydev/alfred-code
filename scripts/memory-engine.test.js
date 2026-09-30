// scripts/memory-engine.test.js - the memory MCP engine (stack/hooks/memory.js): path <-> level
// derivation, registration lookup, related-project names, and the session selection query over a real
// sqlite fixture database (scripts/fixtures/memory-schema.sql). NEVER touches ~/.memory-mcp - every
// database here is built fresh under os.tmpdir() and removed after its test.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const m = require('../stack/hooks/memory.js');

const ENGINE = path.join(__dirname, '..', 'stack', 'hooks', 'memory.js');

let DatabaseSync = null;
try { process.removeAllListeners('warning'); ({ DatabaseSync } = require('node:sqlite')); } catch {}
const skipNoSqlite = DatabaseSync ? false : 'node:sqlite unavailable on this Node (needs >= 22.13, or 22.12 with --experimental-sqlite) - db-backed engine tests skipped';

const SCHEMA = fs.readFileSync(path.join(__dirname, 'fixtures', 'memory-schema.sql'), 'utf8');

// Builds a fixture db from the shipped schema and inserts one row per entry, newest (array index 0)
// getting the highest created_at so plain array order already reads newest-first unless a case
// overrides created_at itself.
function buildDb(dir, rows) {
  const file = path.join(dir, 'memory.db');
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)');
  rows.forEach((r, i) => {
    insert.run(
      r.hash || `hash-${i}`,
      r.content,
      r.tags || '',
      r.memory_type || 'reference',
      r.created_at != null ? r.created_at : 1_000_000 - i,
      r.deleted_at != null ? r.deleted_at : null,
    );
  });
  db.close();
  return file;
}
// A fixed clock for the selection: fixture rows sit at created_at <= 1_000_000 seconds, so every one of
// them is 0-11 days old against NOW - young enough that the pre-ageing order cases keep their meaning.
const NOW = 1_000_000;
const DAY = 86400;
const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// --- pathForLevel / levelOfPath -------------------------------------------------------------------

test('each level maps to its database under .alfred-memory and back', () => {
  const home = '/home/u';
  const projectRoot = '/work/app';
  const cases = [
    ['global', { home, projectRoot }, '/home/u/.alfred-memory/memory.db'],
    ['scoped', { home, space: 'work', projectRoot }, '/home/u/.alfred-memory/memory_work.db'],
    ['scoped', { home, projectRoot }, '/home/u/.alfred-memory/memory_default.db'],
    ['project', { home, projectRoot }, '/work/app/.alfred/.alfred-memory/memory.db'],
    ['project', { home, projectRoot, root: '.data' }, '/work/app/.data/.alfred-memory/memory.db'],
  ];
  for (const [level, opts, want] of cases) {
    assert.strictEqual(m.pathForLevel(level, opts), path.normalize(want), level);
    assert.strictEqual(m.levelOfPath(want, { home, projectRoot }), level, want);
  }
});

test('a 2.0.0 .memory-mcp database still reads as its level', () => {
  const home = '/home/u';
  const projectRoot = '/work/app';
  assert.strictEqual(m.levelOfPath('/home/u/.memory-mcp/memory.db', { home, projectRoot }), 'global');
  assert.strictEqual(m.levelOfPath('/home/u/.memory-mcp/memory_x.db', { home, projectRoot }), 'scoped');
  assert.strictEqual(m.levelOfPath('/work/app/.memory-mcp/memory.db', { home, projectRoot }), 'project');
});

test('registeredDbPath: a database not moved yet is read at its old place, and a moved one through the link', () => {
  const home = tmpDir('memory-live-');
  try {
    const project = path.join(home, 'app');
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(home, '.alfred-memory', 'memory.db') } }));
    fs.mkdirSync(path.join(home, '.memory-mcp'));
    fs.writeFileSync(path.join(home, '.memory-mcp', 'memory.db'), 'DB');
    const config = path.join(home, 'acct');
    assert.strictEqual(m.registeredDbPath(project, { home, configDir: config }), path.join(home, '.memory-mcp', 'memory.db'), 'the launcher has not moved it yet');
    fs.renameSync(path.join(home, '.memory-mcp'), path.join(home, '.alfred-memory'));
    if (process.platform !== 'win32') fs.symlinkSync('.alfred-memory', path.join(home, '.memory-mcp'), 'dir');
    assert.strictEqual(m.registeredDbPath(project, { home, configDir: config }), path.join(home, '.alfred-memory', 'memory.db'));
    // A project not yet updated still names the old path: it reaches the same file through the link.
    fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(home, '.memory-mcp', 'memory.db') } }));
    if (process.platform !== 'win32') assert.strictEqual(fs.readFileSync(m.registeredDbPath(project, { home, configDir: config }), 'utf8'), 'DB');
  } finally { rmDir(home); }
});

test('I2 registeredDbPath: settings naming a ~/.memory-mcp that moved with no link read the moved file', () => {
  const home = tmpDir('memory-nolink-');
  try {
    const project = path.join(home, 'app');
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(home, '.memory-mcp', 'memory.db') } }));
    fs.mkdirSync(path.join(home, '.alfred-memory'));
    fs.writeFileSync(path.join(home, '.alfred-memory', 'memory.db'), 'DB');
    assert.strictEqual(m.registeredDbPath(project, { home, configDir: path.join(home, 'acct') }), path.join(home, '.alfred-memory', 'memory.db'));
  } finally { rmDir(home); }
});

test('an unknown level throws, a foreign path has no level', () => {
  const home = '/home/u';
  const projectRoot = '/work/app';
  assert.throws(() => m.pathForLevel('team', { home, projectRoot }), /level/);
  assert.strictEqual(m.levelOfPath('/elsewhere/memory.db', { home, projectRoot }), null);
  // A path merely under the scoped directory but not shaped memory_<space>.db is not scoped either.
  assert.strictEqual(m.levelOfPath('/home/u/.memory-mcp/notes.db', { home, projectRoot }), null);
});

test('inside a real git worktree, levelOfPath reads a project-level db under the MAIN checkout root, never "unknown"', () => {
  const outer = tmpDir('memory-level-wt-');
  try {
    const repo = path.join(outer, 'my-repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    spawnSync('git', ['-C', repo, 'config', 'user.email', 't@example.com'], {});
    spawnSync('git', ['-C', repo, 'config', 'user.name', 'test'], {});
    spawnSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init'], {});
    const worktree = path.join(outer, 'unrelated-worktree-name');
    const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feat', worktree], { encoding: 'utf8' });
    assert.strictEqual(add.status, 0, add.stderr);

    // The installer now writes the project db under the MAIN checkout - this must resolve to
    // 'project', not 'unknown', when read from inside the worktree.
    const mainDb = path.join(repo, '.memory-mcp', 'memory.db');
    assert.strictEqual(m.levelOfPath(mainDb, { home: '/home/u', projectRoot: worktree }), 'project');

    // An older, worktree-rooted registration is still honoured (second candidate).
    const worktreeDb = path.join(worktree, '.memory-mcp', 'memory.db');
    assert.strictEqual(m.levelOfPath(worktreeDb, { home: '/home/u', projectRoot: worktree }), 'project');

    // A db under some unrelated project entirely is still foreign.
    assert.strictEqual(m.levelOfPath(path.join(outer, 'other', '.memory-mcp', 'memory.db'), { home: '/home/u', projectRoot: worktree }), null);
  } finally { rmDir(outer); }
});

test('the level CLI, run from inside a real worktree, prints "project <main-checkout>/.memory-mcp/memory.db"', () => {
  const outer = tmpDir('memory-level-cli-wt-');
  try {
    const repo = path.join(outer, 'my-repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    spawnSync('git', ['-C', repo, 'config', 'user.email', 't@example.com'], {});
    spawnSync('git', ['-C', repo, 'config', 'user.name', 'test'], {});
    spawnSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init'], {});
    const worktree = path.join(outer, 'unrelated-worktree-name');
    const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feat', worktree], { encoding: 'utf8' });
    assert.strictEqual(add.status, 0, add.stderr);

    const mainDb = path.join(repo, '.memory-mcp', 'memory.db');
    fs.writeFileSync(path.join(worktree, '.mcp.json'), JSON.stringify({
      mcpServers: { memory: { type: 'stdio', command: 'uvx', args: [], env: { MCP_MEMORY_SQLITE_PATH: mainDb } } },
    }));

    const config = tmpDir('memory-level-cli-config-');
    try {
      const r = spawnSync(process.execPath, [ENGINE, 'level', worktree], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout.trim(), `project ${mainDb}`);
    } finally { rmDir(config); }
  } finally { rmDir(outer); }
});

// Re-verify 2 R4 and R5: the launcher's refusal reached only the CLI's MCP log. The level CLI - what /alfred-code:status and
// validate read - answers through the same settings reader as the launcher: a settings file it cannot read is named, and
// with no other key and no registration it says the memory server is refused.
test('the level CLI names an unreadable settings file, and says "refused" where nothing else names the database', () => {
  const root = tmpDir('memory-level-refused-');
  const config = tmpDir('memory-level-refused-acct-');
  try {
    fs.mkdirSync(path.join(root, '.claude'));
    const local = path.join(root, '.claude', 'settings.local.json');
    fs.writeFileSync(local, '{ "env": { "A": 1, } garbage');
    const run = () => spawnSync(process.execPath, [ENGINE, 'level', root], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: root } });
    assert.strictEqual(run().stdout.trim(), `refused ${local}`);
    const db = path.join(root, '.alfred', '.alfred-memory', 'memory.db');
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: db } }));
    assert.deepStrictEqual(run().stdout.trim().split('\n'), [`project ${db}`, `unreadable ${local}`]);
  } finally { rmDir(root); rmDir(config); }
});

// Re-verify 3 S6: a torn settings.local.json handed the project to a lower key's database - the account settings'
// global one - though the stamp's ledger says this project's key lives in the torn file. That file's key is the only
// answer: the launcher and the level CLI refuse, as when no file answers; a lower key answers only where the ledger
// records none in the unreadable file.
test('settingsDbState: an unreadable file the ledger records the memory key in refuses - a lower key never answers for it', () => {
  const root = fs.realpathSync(tmpDir('memory-ledger-refuse-'));
  const config = tmpDir('memory-ledger-refuse-acct-');
  try {
    fs.mkdirSync(path.join(root, '.claude'));
    const local = path.join(root, '.claude', 'settings.local.json');
    fs.writeFileSync(local, '{ "env": { "ALFRED_CODE_MEMORY_DB": "/some/wh');
    const globalDb = path.join(config, 'home', '.alfred-memory', 'memory.db');
    fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: globalDb } }));
    const stamp = path.join(root, '.claude', 'alfred-code.stamp');
    const ledger = (file) => fs.writeFileSync(stamp, `commit: x\nmanaged-env: settings.json:ALFRED_CODE_DOCS_PATH=${'a'.repeat(64)},${file}:ALFRED_CODE_MEMORY_DB=${'b'.repeat(64)}\n`);
    ledger('settings.local.json');
    const state = m.settingsDbState(root, { home: config, configDir: config });
    assert.strictEqual(state.db, '', `the lower key answered: ${state.db}`);
    assert.deepStrictEqual(state.unread, [local]);
    const run = () => spawnSync(process.execPath, [ENGINE, 'level', root], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: config } });
    assert.strictEqual(run().stdout.trim(), `refused ${local}`);
    assert.strictEqual(m.registeredDbPath(root, { home: config, configDir: config }), null);
    // The ledger records the key in the shared file (an older install): the torn local file is not its home, and the
    // account key answers, said as before.
    ledger('settings.json');
    assert.strictEqual(m.settingsDbState(root, { home: config, configDir: config }).db, globalDb);
    fs.rmSync(stamp);
    assert.strictEqual(m.settingsDbState(root, { home: config, configDir: config }).db, globalDb, 'no ledger: R5 stands');
  } finally { rmDir(root); rmDir(config); }
});

// Re-verify 3 S5: the copy-route server reads only its .mcp.json registration, while the engine asked the settings key
// first - a pulled clone whose machine-local settings.local.json still named the global database had status, validate
// and the session-start injection name the global database while the server opened the project's. The registration
// answers first, as the installer's recordedPath reads it; a relative path is the project's.
test('registeredDbPath: a .mcp.json memory registration answers before the settings key, a relative path resolved at the project', () => {
  const root = fs.realpathSync(tmpDir('memory-reg-first-'));
  const home = tmpDir('memory-reg-first-home-');
  try {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(home, '.alfred-memory', 'memory.db') } }));
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { type: 'stdio', command: 'node', args: [], env: { MCP_MEMORY_SQLITE_PATH: '.alfred/.alfred-memory/memory.db' } } } }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: home }), path.join(root, '.alfred', '.alfred-memory', 'memory.db'));
  } finally { rmDir(root); rmDir(home); }
});

// Re-verify 3 S2 / S3: every project-anchored server - the memory database, the browser profiles, the navigation
// server's home and context - resolved the project from its launch directory, and the copy route's `${CLAUDE_PROJECT_DIR:-.}`
// expands to '.' in Claude Code's own environment. A session started in a subdirectory got a second database and
// profiles outside every .gitignore; an inherited CLAUDE_PROJECT_DIR opened another folder's. ONE resolver walks up from
// the launch directory to the folder holding the install record (the same records hook-prelude's set-up gate reads),
// never past the checkout's git top level, else that top level; with no git, the launch directory alone (re-verify 4
// T1); a linked worktree works on its own checkout, and its memory is the main checkout's.
test('projectRootOf: the launch directory resolves to the folder holding the install record, else its git top level', () => {
  const outer = fs.realpathSync(tmpDir('memory-root-'));
  const home = path.join(outer, 'home');
  try {
    fs.mkdirSync(home);
    const stamped = (dir) => { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'commit: x\n'); };
    const plain = path.join(outer, 'plain');
    stamped(plain);
    fs.mkdirSync(path.join(plain, '.git'));
    fs.mkdirSync(path.join(plain, 'sub', 'deeper'), { recursive: true });
    for (const at of [plain, path.join(plain, 'sub'), path.join(plain, 'sub', 'deeper')])
      assert.deepStrictEqual(m.projectRootOf(at, { home }), { checkout: plain, project: plain }, at);
    // With no git, the launch directory alone - a record above it is never read (re-verify 4 T1).
    const nogit = path.join(outer, 'nogit');
    stamped(nogit);
    fs.mkdirSync(path.join(nogit, 'sub'));
    assert.deepStrictEqual(m.projectRootOf(nogit, { home }), { checkout: nogit, project: nogit });
    assert.deepStrictEqual(m.projectRootOf(path.join(nogit, 'sub'), { home }), { checkout: path.join(nogit, 'sub'), project: path.join(nogit, 'sub') });
    // A git repo with no record: its top level, never the launch directory.
    const repo = path.join(outer, 'repo');
    fs.mkdirSync(path.join(repo, '.git', 'x'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'pkg', 'src'), { recursive: true });
    assert.deepStrictEqual(m.projectRootOf(path.join(repo, 'pkg', 'src'), { home }), { checkout: repo, project: repo });
    // A record below the top (a package installed on its own) is the nearest one.
    stamped(path.join(repo, 'pkg'));
    assert.deepStrictEqual(m.projectRootOf(path.join(repo, 'pkg', 'src'), { home }), { checkout: path.join(repo, 'pkg'), project: path.join(repo, 'pkg') });
    // Nothing at all: the launch directory. A home directory is never a project: its .claude/ is the account dir.
    const bare = path.join(outer, 'bare', 'x');
    fs.mkdirSync(bare, { recursive: true });
    assert.deepStrictEqual(m.projectRootOf(bare, { home }), { checkout: bare, project: bare });
    stamped(home);
    fs.mkdirSync(path.join(home, '.git'));
    fs.mkdirSync(path.join(home, 'scratch'));
    assert.deepStrictEqual(m.projectRootOf(path.join(home, 'scratch'), { home }), { checkout: path.join(home, 'scratch'), project: path.join(home, 'scratch') });
  } finally { rmDir(outer); }
});

test('projectRootOf: a linked worktree works on its own checkout, and its memory is the main checkout\'s', () => {
  const outer = fs.realpathSync(tmpDir('memory-root-wt-'));
  try {
    const repo = path.join(outer, 'repo');
    fs.mkdirSync(repo);
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    fs.mkdirSync(path.join(repo, '.claude'));
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'commit: x\n');
    for (const worktree of [path.join(outer, 'feature'), path.join(repo, '.claude', 'worktrees', 'nested')]) {
      const add = git('worktree', 'add', '-q', '-b', path.basename(worktree), worktree);
      assert.strictEqual(add.status, 0, add.stderr);
      fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
      assert.deepStrictEqual(m.projectRootOf(path.join(worktree, 'src'), { home: path.join(outer, 'home') }), { checkout: worktree, project: repo }, worktree);
    }
  } finally { rmDir(outer); }
});

// Re-verify 4 T2: the stamp and the engine are often committed, so a linked worktree holds a record of its own - and it
// opened a second, empty database (and on the plugin route read no settings key at all: main's settings.local.json is
// untracked). A worktree's project is its main checkout whenever that one holds a record, whatever the worktree carries.
test('projectRootOf: a linked worktree that carries its own record still shares the main checkout\'s project (re-verify 4 T2)', () => {
  const outer = fs.realpathSync(tmpDir('memory-root-wt-own-'));
  try {
    const repo = path.join(outer, 'repo');
    fs.mkdirSync(repo);
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
    fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'commit: x\n');
    fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'docs.js'), '// engine\n');
    git('add', '-A'); git('commit', '-q', '-m', 'init');
    for (const worktree of [path.join(outer, 'feature'), path.join(repo, '.claude', 'worktrees', 'nested')]) {
      const add = git('worktree', 'add', '-q', '-b', path.basename(worktree), worktree);
      assert.strictEqual(add.status, 0, add.stderr);
      assert.ok(fs.existsSync(path.join(worktree, '.claude', 'alfred-code.stamp')), 'the worktree carries the committed record');
      fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
      for (const at of [worktree, path.join(worktree, 'src')])
        assert.deepStrictEqual(m.projectRootOf(at, { home: path.join(outer, 'home') }), { checkout: worktree, project: repo }, at);
    }
  } finally { rmDir(outer); }
});

// Re-verify 4 T1: the walk went past the git top level (ROOT_BOOT) and, with no git, to '/' (projectRootOf), so a record
// planted in a shared ancestor - /private/tmp, /Users/Shared, an extracted archive - redirected the database, serena's
// project, the browser profile and the memory tag. The walk stops at the checkout's git top level; with no git it is the
// launch directory alone; a home is never passed; and a `.git` another user owns is no repository (git's own rule).
test('projectRootOf: a record above the git top level, or above a folder with no git, never names the project (re-verify 4 T1)', () => {
  const outer = fs.realpathSync(tmpDir('memory-root-planted-'));
  try {
    const plant = (dir) => {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'commit: planted\n');
      fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(dir, 'planted.db') } }));
    };
    const home = path.join(outer, 'home');
    fs.mkdirSync(home);
    // Above a repo: the repo's own top level.
    const shared = path.join(outer, 'shared');
    plant(shared);
    const clone = path.join(shared, 'clone');
    fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
    fs.mkdirSync(path.join(clone, 'sub'), { recursive: true });
    for (const at of [clone, path.join(clone, 'sub')])
      assert.deepStrictEqual(m.projectRootOf(at, { home }), { checkout: clone, project: clone }, at);
    // Above a folder with no git: the launch directory alone, never an ancestor.
    const shared2 = path.join(outer, 'shared2');
    plant(shared2);
    const plain = path.join(shared2, 'plain');
    fs.mkdirSync(path.join(plain, 'sub'), { recursive: true });
    for (const at of [plain, path.join(plain, 'sub')])
      assert.deepStrictEqual(m.projectRootOf(at, { home }), { checkout: at, project: at }, at);
    assert.strictEqual(m.registeredDbPath(m.projectRootOf(path.join(plain, 'sub'), { home }).project, { home, configDir: home }), null, 'the planted settings name no database here');
  } finally { rmDir(outer); }
});

const OTHER_OWNER = process.platform === 'win32' || !process.getuid || process.getuid() === 0 ? 'needs a posix non-root user' : false;
test('projectRootOf: a .git another user owns is no repository - the launch directory alone (re-verify 4 T1)', { skip: OTHER_OWNER }, () => {
  const outer = fs.realpathSync(tmpDir('memory-root-foreign-'));
  try {
    // A `.git` owned by root, standing in for one another account planted in a shared folder.
    const foreign = path.join(outer, 'foreign');
    fs.mkdirSync(path.join(foreign, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(foreign, '.claude', 'alfred-code.stamp'), 'commit: planted\n');
    fs.symlinkSync('/', path.join(foreign, '.git'));
    assert.notStrictEqual(fs.statSync(path.join(foreign, '.git')).uid, process.getuid());
    const sub = path.join(foreign, 'work');
    fs.mkdirSync(sub);
    assert.deepStrictEqual(m.projectRootOf(sub, { home: path.join(outer, 'home') }), { checkout: sub, project: sub });
  } finally { rmDir(outer); }
});

// The copy route registers no launcher of its own, so its three project-anchored rows start through ROOT_BOOT: a
// constant `node -e` that finds the project's copied engine walking up from the launch directory (or through the main
// checkout of a linked worktree) and runs the server at the project it resolves. The seed asserts what the reviewer
// asked of the fix: from a subdirectory, and under an exported CLAUDE_PROJECT_DIR naming another folder, the server's
// MCP_MEMORY_SQLITE_PATH resolves to the engine's own database.
test('ROOT_BOOT: a copy-route server started in a subdirectory, or under another folder\'s CLAUDE_PROJECT_DIR, runs at its project', { skip: process.platform === 'win32' && 'posix stub' }, () => {
  const outer = fs.realpathSync(tmpDir('memory-boot-'));
  try {
    const proj = path.join(outer, 'proj');
    fs.mkdirSync(path.join(proj, '.claude', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.git'));
    fs.writeFileSync(path.join(proj, '.claude', 'alfred-code.stamp'), 'commit: x\n');
    fs.copyFileSync(ENGINE, path.join(proj, '.claude', 'hooks', 'memory.js'));
    const rel = '.alfred/.alfred-memory/memory.db';
    fs.writeFileSync(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { memory: { type: 'stdio', command: 'node', args: [], env: { MCP_MEMORY_SQLITE_PATH: rel } } } }));
    const elsewhere = path.join(outer, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const deeper = path.join(proj, 'sub', 'deeper');
    fs.mkdirSync(deeper, { recursive: true });
    const record = path.join(outer, 'started.json');
    const stub = path.join(outer, 'stub.js');
    fs.writeFileSync(stub, `require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), db: require('path').resolve(process.env.MCP_MEMORY_SQLITE_PATH), argv: process.argv.slice(2) }));`);
    const boot = (cwd, env) => spawnSync(process.execPath, ['-e', m.ROOT_BOOT, '--', 'project', process.execPath, stub, '--flag', 'value'],
      { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: outer, MCP_MEMORY_SQLITE_PATH: rel, ...env } });
    const engineDb = m.registeredDbPath(proj, { home: outer, configDir: outer });
    for (const [cwd, env] of [[path.join(proj, 'sub'), {}], [deeper, {}], [deeper, { CLAUDE_PROJECT_DIR: elsewhere }], [proj, { CLAUDE_PROJECT_DIR: elsewhere }]]) {
      fs.rmSync(record, { force: true });
      const r = boot(cwd, env);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout, '', 'stdout is the MCP stream - the anchor writes nothing to it');
      const got = JSON.parse(fs.readFileSync(record, 'utf8'));
      assert.deepStrictEqual(got, { cwd: proj, db: engineDb, argv: ['--flag', 'value'] }, `${cwd} ${JSON.stringify(env)}`);
    }
    // No engine above the launch directory: nothing starts, one line says why.
    fs.rmSync(record, { force: true });
    const lost = boot(elsewhere, {});
    assert.notStrictEqual(lost.status, 0);
    assert.strictEqual(fs.existsSync(record), false);
    assert.match(lost.stderr, /alfred-code: .*\.claude\/hooks\/memory\.js/);
    assert.strictEqual(lost.stderr.trim().split('\n').length, 1, lost.stderr);
  } finally { rmDir(outer); }
});

// Re-verify 3, the Windows half of the anchor: a copy-route row is `node -e <ROOT_BOOT> -- ...`, which Claude Code starts from
// its command and args, and which a local-scope install passes through `claude mcp add` - on Windows a .cmd shim, so
// cmd.exe. ROOT_BOOT therefore holds no character cmd.exe reads (the double quote, %, ^, &, |, <, >, !, a line break),
// and no space or tab, which would split it into several arguments on a line cmd.exe joins unquoted.
const CMD_SPECIAL = /["%^&|<>!\r\n \t]/;
test('ROOT_BOOT: holds no character cmd.exe reads, and no space', () => {
  const found = [...new Set(m.ROOT_BOOT.match(new RegExp(CMD_SPECIAL.source, 'g')) || [])];
  assert.deepStrictEqual(found, [], `ROOT_BOOT holds ${JSON.stringify(found)}`);
});

// Starts ROOT_BOOT as a copy-route row does - `node -e <ROOT_BOOT> -- <anchor> <node> <recorder>` - with a recorder that
// writes where it ran and the database path it was handed.
const POSIX_BOOT = { skip: process.platform === 'win32' && 'posix stub' };
function bootIn(outer) {
  const record = path.join(outer, 'started.json');
  const recorder = path.join(outer, 'recorder.js');
  fs.writeFileSync(recorder, `require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), db: process.env.MCP_MEMORY_SQLITE_PATH || null }));`);
  return (cwd, anchor, env = {}) => {
    fs.rmSync(record, { force: true });
    const r = spawnSync(process.execPath, ['-e', m.ROOT_BOOT, '--', anchor, process.execPath, recorder], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(outer, 'home'), ...env } });
    return { ...r, started: fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : null };
  };
}
// An engine another account planted: requiring it runs its code.
const plantEngine = (dir, mark) => {
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'hooks', 'memory.js'), `require('fs').writeFileSync(${JSON.stringify(mark)}, __filename); module.exports = { runAtRoot() {} };\n`);
};

// Re-verify 4 T1: ROOT_BOOT required the first .claude/hooks/memory.js in ANY ancestor of the launch directory - past the git
// top level and the home, up to '/' - and a user-scope row runs in every project on the account: a file planted above
// another repo was executed from it. The engine is looked for only between the launch directory and the checkout's git top
// level (the launch directory alone with no git, never a home, never under a .git another user owns); a checkout row loads
// no engine at all.
test('ROOT_BOOT: an engine above the git top level, above a folder with no git, or under a .git another user owns is never loaded (re-verify 4 T1)', POSIX_BOOT, () => {
  const outer = fs.realpathSync(tmpDir('memory-boot-planted-'));
  try {
    fs.mkdirSync(path.join(outer, 'home'));
    const mark = path.join(outer, 'planted-ran');
    const boot = bootIn(outer);
    const shared = path.join(outer, 'shared');
    plantEngine(shared, mark);
    const clone = path.join(shared, 'clone');
    fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
    fs.mkdirSync(path.join(clone, 'sub'), { recursive: true });
    const shared2 = path.join(outer, 'shared2');
    plantEngine(shared2, mark);
    const plain = path.join(shared2, 'plain', 'sub');
    fs.mkdirSync(plain, { recursive: true });
    const cases = [[path.join(clone, 'sub'), clone], [plain, plain]];
    if (!OTHER_OWNER) {
      const foreign = path.join(outer, 'foreign');
      plantEngine(foreign, mark);
      fs.symlinkSync('/', path.join(foreign, '.git'));
      fs.mkdirSync(path.join(foreign, 'work'));
      cases.push([path.join(foreign, 'work'), path.join(foreign, 'work')]);
    }
    for (const [at, root] of cases) {
      const project = boot(at, 'project');
      assert.notStrictEqual(project.status, 0, `${at}: a project row started with no engine of its own`);
      assert.strictEqual(project.started, null, at);
      assert.match(project.stderr, /alfred-code: .*\.claude\/hooks\/memory\.js/, at);
      assert.strictEqual(project.stderr.trim().split('\n').length, 1, project.stderr);
      const checkout = boot(at, 'checkout');
      assert.strictEqual(checkout.status, 0, checkout.stderr);
      assert.strictEqual(checkout.started && checkout.started.cwd, root, at);
      assert.strictEqual(fs.existsSync(mark), false, `${at}: the planted engine ran (${fs.existsSync(mark) && fs.readFileSync(mark, 'utf8')})`);
    }
  } finally { rmDir(outer); }
});

// Re-verify 4 T1: the MCP copy route with the core on registers each browser engine at user scope, so its row starts in
// every project on the account - a repo the stack never set up refused with the anchor message, where base started it at
// its own folder. A checkout row starts its command itself: at the nearest install between the launch directory and the
// git top level, else that top level - and it requires none of the project's code, so a user-scope row runs nothing a
// repo ships.
test('ROOT_BOOT: a checkout row starts its command at the checkout and runs no project code - a repo never set up starts at its top level (re-verify 4 T1)', POSIX_BOOT, () => {
  const outer = fs.realpathSync(tmpDir('memory-boot-checkout-'));
  try {
    fs.mkdirSync(path.join(outer, 'home'));
    const mark = path.join(outer, 'engine-ran');
    const boot = bootIn(outer);
    const repo = path.join(outer, 'repo');
    const src = path.join(repo, 'pkg', 'src');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(src, { recursive: true });
    const never = boot(src, 'checkout');
    assert.strictEqual(never.status, 0, never.stderr);
    assert.strictEqual(never.started.cwd, repo, 'a repo never set up starts at its top level');
    plantEngine(repo, mark);
    assert.strictEqual(boot(src, 'checkout').started.cwd, repo);
    plantEngine(path.join(repo, 'pkg'), mark);
    assert.strictEqual(boot(src, 'checkout').started.cwd, path.join(repo, 'pkg'), 'a package installed on its own is its own checkout');
    assert.strictEqual(fs.existsSync(mark), false, 'a checkout row loaded the project\'s engine');
    // The project row does run the engine inside the checkout - the nearest one.
    boot(src, 'project');
    assert.strictEqual(fs.readFileSync(mark, 'utf8'), path.join(repo, 'pkg', '.claude', 'hooks', 'memory.js'));
  } finally { rmDir(outer); }
});

// The Windows half of a checkout row, on any POSIX runner: with process.platform read as win32 the command goes through
// %ComSpec% as `/d /s /c "<command> <args>"` - the one quoted line runAtRoot builds - at the checkout.
test('ROOT_BOOT: on Windows a checkout row starts its command through cmd.exe as one quoted line, at the checkout', POSIX_BOOT, () => {
  const outer = fs.realpathSync(tmpDir('memory-boot-win-'));
  try {
    fs.mkdirSync(path.join(outer, 'home'));
    const record = path.join(outer, 'comspec.json');
    const comspec = path.join(outer, 'comspec');
    fs.writeFileSync(comspec, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));\n`, { mode: 0o755 });
    const preload = path.join(outer, 'as-win32.js');
    fs.writeFileSync(preload, "Object.defineProperty(process, 'platform', { value: 'win32' });\n");
    const repo = path.join(outer, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'sub'));
    const r = spawnSync(process.execPath, ['--require', preload, '-e', m.ROOT_BOOT, '--', 'checkout', 'npx', '-y', '@playwright/mcp@0.0.82', '--user-data-dir', '.alfred/browser/chrome'],
      { cwd: path.join(repo, 'sub'), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(outer, 'home'), ComSpec: comspec } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(record, 'utf8')), { cwd: repo, argv: ['/d', '/s', '/c', '"npx -y @playwright/mcp@0.0.82 --user-data-dir .alfred/browser/chrome"'] });
  } finally { rmDir(outer); }
});

// Re-verify 4 T2: the copy route's committed .mcp.json and engine reach every linked worktree, and the project row opened a
// second, empty database relative to the worktree - base opened the main checkout's. The engine runs the row at the main
// checkout whenever that one holds a record; the checkout rows stay on the worktree.
test('ROOT_BOOT: a project row started in a linked worktree runs at the main checkout, whose database it shares (re-verify 4 T2)', POSIX_BOOT, () => {
  const outer = fs.realpathSync(tmpDir('memory-boot-wt-'));
  try {
    fs.mkdirSync(path.join(outer, 'home'));
    const boot = bootIn(outer);
    const repo = path.join(outer, 'repo');
    fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'commit: x\n');
    fs.copyFileSync(ENGINE, path.join(repo, '.claude', 'hooks', 'memory.js'));
    git('add', '-A'); git('commit', '-q', '-m', 'init');
    const rel = '.alfred/.alfred-memory/memory.db';
    for (const worktree of [path.join(outer, 'feature'), path.join(repo, '.claude', 'worktrees', 'nested')]) {
      const add = git('worktree', 'add', '-q', '-b', path.basename(worktree), worktree);
      assert.strictEqual(add.status, 0, add.stderr);
      fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
      for (const at of [worktree, path.join(worktree, 'src')]) {
        const r = boot(at, 'project', { MCP_MEMORY_SQLITE_PATH: rel });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.deepStrictEqual([r.started.cwd, path.resolve(r.started.cwd, r.started.db)], [repo, path.join(repo, rel)], at);
        assert.strictEqual(boot(at, 'checkout').started.cwd, worktree, at);
      }
    }
  } finally { rmDir(outer); }
});

// Re-verify 4 T6: the committed value followed the author machine's unmoved ~/.memory-mcp, so a teammate holding only
// ~/.alfred-memory got a second, empty database (and the mirror case the other way). The value is always
// ~/.alfred-memory/<file>, and the machine that starts the server opens the live file there: the new place, else an
// unmoved 2.0.0 one.
test('ROOT_BOOT: a database named from the home opens the live file of the machine that starts it - the new place, else an unmoved 2.0.0 one (re-verify 4 T6)', POSIX_BOOT, () => {
  const outer = fs.realpathSync(tmpDir('memory-boot-home-'));
  try {
    const home = path.join(outer, 'home');
    const boot = bootIn(outer);
    const proj = path.join(outer, 'proj');
    fs.mkdirSync(path.join(proj, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', 'alfred-code.stamp'), 'commit: x\n');
    fs.copyFileSync(ENGINE, path.join(proj, '.claude', 'hooks', 'memory.js'));
    for (const file of ['memory.db', 'memory_default.db']) {
      const fresh = path.join(home, '.alfred-memory', file);
      const old = path.join(home, '.memory-mcp', file);
      const start = () => boot(proj, 'project', { MCP_MEMORY_SQLITE_PATH: `~/.alfred-memory/${file}` }).started.db;
      rmDir(home);
      assert.strictEqual(start(), fresh, `${file}: neither place holds it`);
      fs.mkdirSync(path.dirname(old), { recursive: true });
      fs.writeFileSync(old, '');
      assert.strictEqual(start(), old, `${file}: only the unmoved 2.0.0 file`);
      fs.mkdirSync(path.dirname(fresh), { recursive: true });
      fs.writeFileSync(fresh, '');
      assert.strictEqual(start(), fresh, `${file}: both places`);
    }
  } finally { rmDir(outer); }
});

// Re-verify 4 T3: `level` resolved its folder with path.resolve, so from a subdirectory it said `none` while the servers
// started there used the project database; `export` and `import` took the same folder. Every verb resolves its project the
// way the servers do - a subdirectory's install, and a linked worktree's main checkout.
test('the level and export verbs resolve their project the way the servers do - from a subdirectory and from a linked worktree (re-verify 4 T3)', () => {
  const outer = fs.realpathSync(tmpDir('memory-cli-anchor-'));
  try {
    const home = path.join(outer, 'home');
    fs.mkdirSync(home);
    const root = path.join(outer, 'proj');
    const deeper = path.join(root, 'sub', 'deeper');
    fs.mkdirSync(deeper, { recursive: true });
    const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'commit: x\n');
    fs.writeFileSync(path.join(root, '.gitignore'), '.claude/settings.local.json\n.alfred/\n');
    git('add', '-A'); git('commit', '-q', '-m', 'init');
    const db = path.join(root, '.alfred', '.alfred-memory', 'memory.db');
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: db } }));
    const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: home };
    const cli = (cwd, ...args) => spawnSync(process.execPath, [ENGINE, ...args], { cwd, encoding: 'utf8', env });
    assert.strictEqual(cli(deeper, 'level').stdout.trim(), `project ${db}`, 'from a subdirectory');
    assert.strictEqual(cli(outer, 'level', deeper).stdout.trim(), `project ${db}`, 'naming a subdirectory');
    const worktree = path.join(outer, 'feature');
    assert.strictEqual(git('worktree', 'add', '-q', '-b', 'feature', worktree).status, 0);
    assert.strictEqual(cli(worktree, 'level').stdout.trim(), `project ${db}`, 'from a linked worktree - its main checkout\'s key');
    if (DatabaseSync) {
      fs.mkdirSync(path.dirname(db), { recursive: true });
      buildDb(path.dirname(db), [{ content: 'a project fact', tags: 'project:proj' }]);
      for (const at of [deeper, worktree]) {
        const r = cli(at, 'export');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout.trim().split('\n').length, 1, `${at}: ${r.stderr}`);
      }
    }
  } finally { rmDir(outer); }
});

// --- Windows path spellings, on any platform ---------------------------------------------------------
// The engine loaded with path.win32 and a Windows-shaped fs / git, so the spelling rules a Windows run
// depends on are pinned on every CI platform, not only on the one that can see them. `dirs` maps every
// spelling of an existing directory (lower-cased, the way Windows matches names) to its canonical form;
// the native realpath answers canonical, the JS one keeps the spelling it was handed - the two behaviours
// a Windows runner showed (C:\Users\RUNNER~1\... from os.tmpdir(), C:/Users/runneradmin/... from git).
function loadAsWin32({ dirs = {}, commonDir = {}, files = {} } = {}, file = ENGINE) {
  const w = path.win32;
  const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const canonical = (p) => dirs[w.resolve(p).toLowerCase()];
  const realpathSync = (p) => { if (!canonical(p)) throw enoent(p); return w.resolve(p); };
  realpathSync.native = (p) => { const c = canonical(p); if (!c) throw enoent(p); return c; };
  const fakeFs = {
    realpathSync,
    existsSync: (p) => Boolean(canonical(p)) || w.resolve(p) in files,
    readFileSync: (p) => { const k = w.resolve(p); if (k in files) return files[k]; throw enoent(p); },
  };
  const fakeGit = {
    execFileSync: (cmd, args) => {
      const at = args.indexOf('-C');
      const answer = at >= 0 && args.includes('--git-common-dir') ? commonDir[w.resolve(args[at + 1]).toLowerCase()] : null;
      if (!answer) throw new Error('fatal: not a git repository');
      return `${answer}\n`;
    },
  };
  const swap = { fs: fakeFs, path: w, child_process: fakeGit };
  const req = (name) => swap[name.replace(/^node:/, '')] || require(name);
  const mod = { exports: {} };
  const src = fs.readFileSync(file, 'utf8').replace(/^#!.*\n/, '');
  new Function('require', 'module', 'exports', '__filename', '__dirname', src)(req, mod, mod.exports, file, path.dirname(file));
  return mod.exports;
}

test('win32: a registration spelled with forward slashes, a drive letter in another case or a POSIX-shaped home still maps to its level', () => {
  const home = 'C:\\Users\\dev';
  const root = 'C:\\work\\app';
  const w = loadAsWin32({ dirs: { 'c:\\users\\dev': home, 'c:\\work\\app': root } });
  assert.strictEqual(w.levelOfPath('C:/Users/dev/.memory-mcp/memory.db', { home, projectRoot: root }), 'global');
  assert.strictEqual(w.levelOfPath('c:\\users\\DEV\\.memory-mcp\\memory_work.db', { home, projectRoot: root }), 'scoped');
  assert.strictEqual(w.levelOfPath('C:/work/app/.memory-mcp/memory.db', { home, projectRoot: 'c:\\work\\app' }), 'project');
  // Neither directory exists: the spellings are still resolved before they are compared (the Windows
  // run of 'each level maps to its database and back' read '\home\u' against '/home/u' and answered null).
  const bare = loadAsWin32();
  assert.strictEqual(bare.levelOfPath('/home/u/.memory-mcp/memory.db', { home: '/home/u', projectRoot: '/work/app' }), 'global');
  assert.strictEqual(bare.levelOfPath('/home/u/.memory-mcp/memory_default.db', { home: '/home/u', projectRoot: '/work/app' }), 'scoped');
  assert.strictEqual(bare.levelOfPath('/work/app/.memory-mcp/memory.db', { home: '/home/u', projectRoot: '/work/app' }), 'project');
  assert.strictEqual(bare.levelOfPath('/elsewhere/.memory-mcp/memory.db', { home: '/home/u', projectRoot: '/work/app' }), null);
});

test('win32: an 8.3 short-name project path inside a worktree reads the main checkout git names in long form as "project"', () => {
  const shortTmp = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\wt';
  const longTmp = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\wt';
  const dirs = {};
  for (const leaf of ['my-repo', 'feat-tree']) {
    dirs[`${shortTmp}\\${leaf}`.toLowerCase()] = `${longTmp}\\${leaf}`;
    dirs[`${longTmp}\\${leaf}`.toLowerCase()] = `${longTmp}\\${leaf}`;
  }
  const worktree = `${shortTmp}\\feat-tree`;
  const commonDir = { [worktree.toLowerCase()]: 'C:/Users/runneradmin/AppData/Local/Temp/wt/my-repo/.git' };
  const w = loadAsWin32({ dirs, commonDir });
  const opts = { home: 'C:\\Users\\runneradmin', projectRoot: worktree };
  assert.strictEqual(w.levelOfPath(`${shortTmp}\\my-repo\\.memory-mcp\\memory.db`, opts), 'project', 'the main checkout, in the short spelling the temp dir hands out');
  assert.strictEqual(w.levelOfPath(`${worktree}\\.memory-mcp\\memory.db`, opts), 'project', 'an older worktree-rooted registration');
  assert.strictEqual(w.levelOfPath(`${shortTmp}\\other\\.memory-mcp\\memory.db`, opts), null, 'a sibling that is not this repo');
});

test('win32: a project-scope registration the CLI keyed with forward slashes is found from a backslashed project root', () => {
  const home = 'C:\\Users\\dev';
  const account = JSON.stringify({ projects: { 'C:/work/app': { mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: 'C:/work/app/.memory-mcp/memory.db' } } } } } });
  const w = loadAsWin32({ files: { [`${home}\\.claude.json`]: account } });
  assert.strictEqual(w.registeredDbPath('C:\\work\\app', { home, configDir: home }), 'C:\\work\\app\\.memory-mcp\\memory.db');
});

// --- registeredDbPath ------------------------------------------------------------------------------

test('registeredDbPath reads the project .mcp.json memory entry first, expanding ~ and $HOME', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  try {
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: { memory: { type: 'stdio', command: 'uvx', args: [], env: { MCP_MEMORY_SQLITE_PATH: '~/.memory-mcp/memory.db' } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home }), path.join(home, '.memory-mcp', 'memory.db'));

    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: '$HOME/.memory-mcp/memory_work.db' } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home }), path.join(home, '.memory-mcp', 'memory_work.db'));
  } finally { rmDir(root); rmDir(home); }
});

test('registeredDbPath falls back to the account .claude.json, user scope then project scope', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  const config = tmpDir('memory-config-');
  try {
    // No project .mcp.json at all - falls straight to the account file, user-scope entry.
    fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({
      mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: path.join(home, '.memory-mcp', 'memory.db') } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), path.join(home, '.memory-mcp', 'memory.db'));

    // No user-scope entry - falls to projects[<projectRoot>].mcpServers.memory.
    fs.writeFileSync(path.join(config, '.claude.json'), JSON.stringify({
      projects: { [root]: { mcpServers: { memory: { env: { MCP_MEMORY_SQLITE_PATH: path.join(root, '.memory-mcp', 'memory.db') } } } } },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), path.join(root, '.memory-mcp', 'memory.db'));
  } finally { rmDir(root); rmDir(home); rmDir(config); }
});

test('registeredDbPath: settings.local.json ALFRED_CODE_MEMORY_DB wins over settings.json (Claude Code\'s own precedence)', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
      env: { ALFRED_CODE_MEMORY_DB: path.join(root, '.memory-mcp', 'shared.db') },
    }));
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({
      env: { ALFRED_CODE_MEMORY_DB: path.join(root, '.memory-mcp', 'local.db') },
    }));
    assert.strictEqual(m.registeredDbPath(root, { home }), path.join(root, '.memory-mcp', 'local.db'), 'settings.local.json must win when both files hold the key');
  } finally { rmDir(root); rmDir(home); }
});

test('registeredDbPath never throws: absent files, garbage JSON, no memory entry all read as not registered', () => {
  const root = tmpDir('memory-reg-');
  const home = tmpDir('memory-home-');
  const config = tmpDir('memory-config-');
  try {
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), null); // nothing exists yet
    fs.writeFileSync(path.join(root, '.mcp.json'), '{ not json');
    fs.writeFileSync(path.join(config, '.claude.json'), 'also not json');
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), null);
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    assert.strictEqual(m.registeredDbPath(root, { home, configDir: config }), null);
  } finally { rmDir(root); rmDir(home); rmDir(config); }
});

// --- projectName -------------------------------------------------------------------------------

test('projectName is the git top-level basename inside a repo, else the projectRoot basename', () => {
  const outer = tmpDir('memory-name-');
  try {
    const repo = path.join(outer, 'my-repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    const sub = path.join(repo, 'nested', 'dir');
    fs.mkdirSync(sub, { recursive: true });
    assert.strictEqual(m.projectName(sub), 'my-repo');

    const plain = path.join(outer, 'not-a-repo');
    fs.mkdirSync(plain);
    assert.strictEqual(m.projectName(plain), 'not-a-repo');
  } finally { rmDir(outer); }
});

test('projectName inside a real git worktree reads the MAIN repo name, never the worktree folder', () => {
  const outer = tmpDir('memory-name-wt-');
  try {
    const repo = path.join(outer, 'my-repo');
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    spawnSync('git', ['-C', repo, 'config', 'user.email', 't@example.com'], {});
    spawnSync('git', ['-C', repo, 'config', 'user.name', 'test'], {});
    spawnSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init'], {});
    // The worktree folder's own name is deliberately unrelated to the repo's, so a bug reading
    // --show-toplevel (the worktree's own top) instead of --git-common-dir's parent (the main repo)
    // cannot pass by accident.
    const worktree = path.join(outer, 'unrelated-worktree-name');
    const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feat', worktree], { encoding: 'utf8' });
    assert.strictEqual(add.status, 0, add.stderr);
    assert.strictEqual(m.projectName(worktree), 'my-repo');
    const nested = path.join(worktree, 'nested', 'dir');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(m.projectName(nested), 'my-repo');
  } finally { rmDir(outer); }
});

// --- relatedProjects -----------------------------------------------------------------------------

test('relatedProjects reads RELATED-PROJECTS.md headings, else the generated rule, else []', () => {
  const root = tmpDir('memory-related-');
  const docsRoot = path.join(root, '.claude', 'docs');
  try {
    // Neither present.
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), []);

    // The doc, present: one '## <name>' heading per sibling.
    const docDir = path.join(docsRoot, 'related-projects');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'RELATED-PROJECTS.md'), [
      '# Related projects', '',
      '## acme-billing-api', '<!-- id: acme-billing-api -->', '', '```yaml', 'location: ../acme-billing-api', '```', '',
      '## acme-frontend', '<!-- id: acme-frontend -->', '', '```yaml', 'location: ../acme-frontend', '```', '',
    ].join('\n'));
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), ['acme-billing-api', 'acme-frontend']);

    // The doc wins even when the rule also exists.
    const rulesDir = path.join(root, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'baseline-project-related-context.md'), '---\ndescription: x\n---\n- name: rule-only-sibling\n  location: ../x\n');
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), ['acme-billing-api', 'acme-frontend']);

    // The doc gone, the rule present - falls back to its 'name:' fields.
    fs.rmSync(docDir, { recursive: true, force: true });
    assert.deepStrictEqual(m.relatedProjects(root, docsRoot), ['rule-only-sibling']);
  } finally { rmDir(root); }
});

// --- selectForSession ------------------------------------------------------------------------------

test('preferences and corrections (own or global) come first, newest first, then this project\'s other memories, then related-project rows', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'own newest', tags: 'project:myapp', memory_type: 'reference', created_at: 500 },
      { content: 'own oldest', tags: 'myapp', memory_type: 'learning', created_at: 100 }, // bare tag form
      { content: 'a global preference', tags: '', memory_type: 'preference_signal', created_at: 400 },
      { content: 'a global correction', tags: '', memory_type: 'user_correction', created_at: 300 },
      { content: 'sibling note', tags: 'project:sibling-a', memory_type: 'reference', created_at: 450 },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', related: ['sibling-a'], now: NOW, capBytes: 100000 });
    const order = text.split('\n').map((l) => l.replace(/^- \[[^\]]+\] /, ''));
    // Group 1 (preference/correction, own-or-untagged) beats group 2 (this project's other memories)
    // even though the group-2 rows are newer - a correction is never crowded out by recency (I4).
    assert.deepStrictEqual(order, ['a global preference', 'a global correction', 'own newest', 'own oldest', 'sibling note']);
    assert.deepStrictEqual(counts, { own: 2, preference: 2, related: 1 });
  } finally { rmDir(dir); }
});

test('a credential-shaped literal in a memory is redacted before the session start injects it', { skip: skipNoSqlite }, () => {
  // The database is shared across accounts and projects, and a stored note can quote a token; the
  // start block re-sends every stored line into every session, a new copy of the exposure each time.
  const dir = tmpDir('memory-select-');
  const fake = 'ghp_' + 'Z9'.repeat(18);
  try {
    const file = buildDb(dir, [
      { content: `the CI token is ${fake} - rotate it`, tags: 'project:myapp', memory_type: 'reference', created_at: 500 },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 });
    assert.ok(!text.includes(fake), 'the value never reaches the injection');
    assert.match(text, /the CI token is <redacted> - rotate it/, 'the note keeps its meaning');
    assert.strictEqual(counts.own, 1);
  } finally { rmDir(dir); }
});

test('a project-tagged preference or correction joins group 1 too, ahead of the project\'s other memories', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'own reference, newer', tags: 'project:myapp', memory_type: 'reference', created_at: 500 },
      { content: 'own correction, older', tags: 'project:myapp', memory_type: 'user_correction', created_at: 100 },
    ]);
    const { text } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 });
    const order = text.split('\n').map((l) => l.replace(/^- \[[^\]]+\] /, ''));
    assert.deepStrictEqual(order, ['own correction, older', 'own reference, newer']);
  } finally { rmDir(dir); }
});

test('tag matching is exact on the comma-split list, never a substring - "app" does not match "app-web"', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'real own note', tags: 'project:app', memory_type: 'reference' },
      { content: 'a different project entirely', tags: 'project:app-web', memory_type: 'reference' },
      { content: 'bare form of a different project', tags: 'app-web', memory_type: 'reference' },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'app', now: NOW, capBytes: 100000 });
    assert.match(text, /real own note/);
    assert.doesNotMatch(text, /a different project entirely/);
    assert.doesNotMatch(text, /bare form of a different project/);
    assert.strictEqual(counts.own, 1);
  } finally { rmDir(dir); }
});

test('a preference tagged with another project is excluded everywhere - it is that project\'s local preference, not global', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'scoped preference', tags: 'project:otherproject', memory_type: 'preference_signal' },
      { content: 'truly global preference', tags: '', memory_type: 'preference_signal' },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', related: [], now: NOW, capBytes: 100000 });
    assert.doesNotMatch(text, /scoped preference/);
    assert.match(text, /truly global preference/);
    assert.strictEqual(counts.preference, 1);
  } finally { rmDir(dir); }
});

test('agent: tagged rows are never selected, whatever else they carry', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'an own-project row an agent saved', tags: 'project:myapp,agent:some-seat', memory_type: 'reference' },
      { content: 'an agent-saved global preference', tags: 'agent:some-seat', memory_type: 'preference_signal' },
      { content: 'a real own row', tags: 'project:myapp', memory_type: 'reference', created_at: 1 },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 });
    assert.doesNotMatch(text, /an agent-saved/);
    assert.doesNotMatch(text, /an own-project row an agent saved/);
    assert.match(text, /a real own row/);
    assert.strictEqual(counts.own, 1);
    assert.strictEqual(counts.preference, 0);
  } finally { rmDir(dir); }
});

test('each printed line carries the friendly label, never the service\'s raw subtype spelling', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    // The service validates memory_type against its OWN built-in vocabulary and silently stores
    // anything else as 'observation' (proven live, Task 3) - so a row can carry that fallback value
    // too, and it must print as itself, never blank or throw.
    const file = buildDb(dir, [
      { content: 'a preference row', tags: 'project:myapp', memory_type: 'preference_signal', created_at: 400 },
      { content: 'a correction row', tags: 'project:myapp', memory_type: 'user_correction', created_at: 300 },
      { content: 'a reference row', tags: 'project:myapp', memory_type: 'reference', created_at: 200 },
      { content: 'a learning row', tags: 'project:myapp', memory_type: 'learning', created_at: 100 },
      { content: 'an unvalidated-kind row', tags: 'project:myapp', memory_type: 'observation', created_at: 50 },
    ]);
    const { text } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 });
    const lines = text.split('\n');
    assert.deepStrictEqual(lines, [
      '- [preference, 11 days old] a preference row',
      '- [correction, 11 days old] a correction row',
      '- [project fact, 11 days old] a reference row',
      '- [lesson, 11 days old] a learning row',
      '- [observation, 11 days old] an unvalidated-kind row',
    ]);
  } finally { rmDir(dir); }
});

test('a soft-deleted row (deleted_at set) is never selected', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'deleted own row', tags: 'project:myapp', memory_type: 'reference', deleted_at: 12345 },
      { content: 'live own row', tags: 'project:myapp', memory_type: 'reference' },
    ]);
    const { text } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 });
    assert.doesNotMatch(text, /deleted own row/);
    assert.match(text, /live own row/);
  } finally { rmDir(dir); }
});

test('the cap stops between memories, never inside one', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    // 6 identical-shaped lines, 52 bytes then 53 bytes each (leading \n) once joined - measured directly
    // from the same line format selectForSession emits (the age label ', 11 days old' included), so this
    // cap is not a guess: 52 + 53 + 53 = 158 (items 0-2) is the last total at or under 160; item 3 would
    // push it to 211.
    const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ content: `${'a'.repeat(20)}-${i}`, tags: 'project:myapp', memory_type: 'reference', created_at: 100 - i }));
    const file = buildDb(dir, rows);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 160 });
    const lines = text.split('\n');
    assert.strictEqual(lines.length, 3, text);
    assert.deepStrictEqual(lines.map((l) => l.match(/-(\d)$/)[1]), ['0', '1', '2']);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 160);
    assert.strictEqual(counts.own, 3);
    // Never a truncated line: every kept line is one of the exact lines that would have been emitted whole.
    for (const l of lines) assert.match(l, /^- \[project fact, 11 days old\] a{20}-\d$/);
  } finally { rmDir(dir); }
});

test('a cap smaller than the only memory yields nothing, never a partial line', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [{ content: 'a'.repeat(200), tags: 'project:myapp', memory_type: 'reference' }]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 10 });
    assert.strictEqual(text, '');
    assert.deepStrictEqual(counts, { own: 0, preference: 0, related: 0 });
  } finally { rmDir(dir); }
});

// I4 / M7: the old code `break`d at the first row that did not fit, so one oversized newest row blanked
// the whole block - every smaller row behind it, however well it would have fit, was silently dropped
// too. The engine now `continue`s past a row that does not fit, so selection keeps going. (This flips
// the assertion that used to live at this line, which pinned the harmful `break`.)
test('one oversized newest row no longer blanks the block - a smaller row behind it still gets in', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const file = buildDb(dir, [
      { content: 'x'.repeat(1000), tags: 'project:myapp', memory_type: 'reference', created_at: 200 },
      { content: 'a small note that fits', tags: 'project:myapp', memory_type: 'reference', created_at: 100 },
    ]);
    // 100 bytes: even truncated to 400 chars + '...', the oversized row's line alone is far over the
    // cap and must be skipped, not treated as the end of selection.
    const { text, counts } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100 });
    assert.doesNotMatch(text, /x{50}/, text);
    assert.match(text, /a small note that fits/, text);
    assert.strictEqual(counts.own, 1);
  } finally { rmDir(dir); }
});

test('a memory line is cut to 400 chars with \'...\', never dropped whole just for being long', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const long = 'y'.repeat(1000);
    const file = buildDb(dir, [{ content: long, tags: 'project:myapp', memory_type: 'reference' }]);
    const { text } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 });
    assert.strictEqual(text, `- [project fact, today] ${'y'.repeat(400)}...`);
  } finally { rmDir(dir); }
});

test('with 20 recent project facts and 3 older corrections, the corrections are in the block', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push({ content: `recent fact ${i}`, tags: 'project:myapp', memory_type: 'reference', created_at: 1000 - i });
    for (let i = 0; i < 3; i++) rows.push({ content: `older correction ${i}`, tags: 'project:myapp', memory_type: 'user_correction', created_at: 100 - i });
    const file = buildDb(dir, rows);
    // A cap that cannot possibly hold all 23 rows - proves the corrections are not merely present
    // because everything fit, but because group 1 (preference/correction) is selected ahead of the
    // 20 newer facts rather than being crowded out by their recency.
    const { text } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 300 });
    for (let i = 0; i < 3; i++) assert.match(text, new RegExp(`older correction ${i}`), text);
    const lines = text.split('\n');
    assert.ok(lines.length < 23, `expected the cap to leave some facts out, got ${lines.length} lines`);
  } finally { rmDir(dir); }
});

// --- ageing (improvement plan 2.3) ---------------------------------------------------------------

test('each line carries its age in whole days - today, 1 day old, N days old - and a future timestamp reads as today', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-age-');
  try {
    const file = buildDb(dir, [
      { content: 'written this morning', tags: 'project:myapp', memory_type: 'reference', created_at: NOW - 0.2 * DAY },
      { content: 'written yesterday', tags: 'project:myapp', memory_type: 'reference', created_at: NOW - 1.5 * DAY },
      { content: 'written last month', tags: 'project:myapp', memory_type: 'reference', created_at: NOW - 40 * DAY },
      { content: 'a clock ahead of ours', tags: 'project:myapp', memory_type: 'reference', created_at: NOW + 3600 },
    ]);
    const lines = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 100000 }).text.split('\n');
    assert.ok(lines.includes('- [project fact, today] written this morning'), lines.join('\n'));
    assert.ok(lines.includes('- [project fact, 1 day old] written yesterday'), lines.join('\n'));
    assert.ok(lines.includes('- [project fact, 40 days old] written last month'), lines.join('\n'));
    assert.ok(lines.includes('- [project fact, today] a clock ahead of ours'), lines.join('\n'));
  } finally { rmDir(dir); }
});

test('ageing orders young preferences and corrections, then this project\'s other memories, then the older preferences and corrections, then related projects', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-age-');
  try {
    const file = buildDb(dir, [
      { content: 'own fact, new', tags: 'project:myapp', memory_type: 'reference', created_at: NOW - 1 * DAY },
      { content: 'sibling note', tags: 'project:sibling-a', memory_type: 'reference', created_at: NOW - 2 * DAY },
      { content: 'young global preference', tags: '', memory_type: 'preference_signal', created_at: NOW - 5 * DAY },
      { content: 'young own correction', tags: 'project:myapp', memory_type: 'user_correction', created_at: NOW - 89 * DAY },
      { content: 'old global preference', tags: '', memory_type: 'preference_signal', created_at: NOW - 90 * DAY },
      { content: 'old own correction', tags: 'project:myapp', memory_type: 'user_correction', created_at: NOW - 200 * DAY },
      { content: 'own fact, old', tags: 'myapp', memory_type: 'learning', created_at: NOW - 300 * DAY },
    ]);
    const { text, counts } = m.selectForSession(file, { project: 'myapp', related: ['sibling-a'], now: NOW, capBytes: 100000 });
    const order = text.split('\n').map((l) => l.replace(/^- \[[^\]]+\] /, ''));
    // 89 days is still young, 90 is the first old day.
    assert.deepStrictEqual(order, ['young global preference', 'young own correction', 'own fact, new', 'own fact, old', 'old global preference', 'old own correction', 'sibling note']);
    assert.deepStrictEqual(counts, { own: 2, preference: 4, related: 1 });
  } finally { rmDir(dir); }
});

test('a 4KB overflow drops the OLDEST correction, not a fact - and nothing is deleted from the database', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-age-');
  try {
    const rows = [{ content: 'young correction', tags: '', memory_type: 'user_correction', created_at: NOW - 10 * DAY }];
    for (let i = 0; i < 9; i++) rows.push({ content: `fact ${i} ${'f'.repeat(395)}`, tags: 'project:myapp', memory_type: 'reference', created_at: NOW - (i + 1) * DAY });
    rows.push({ content: `old correction ${'c'.repeat(300)}`, tags: '', memory_type: 'user_correction', created_at: NOW - 100 * DAY });
    const file = buildDb(dir, rows);
    // Uncapped, every row is selected - so what the 4KB cap leaves out below is an overflow, not a filter.
    const all = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 1000000 });
    assert.deepStrictEqual(all.counts, { own: 9, preference: 2, related: 0 });
    assert.ok(Buffer.byteLength(all.text, 'utf8') > 4096, 'the fixture does not overflow 4KB');
    const { text, counts } = m.selectForSession(file, { project: 'myapp', now: NOW, capBytes: 4096 });
    assert.doesNotMatch(text, /old correction/, 'the oldest correction should be the row the cap drops');
    assert.match(text, /young correction/);
    for (let i = 0; i < 9; i++) assert.match(text, new RegExp(`fact ${i} f`), `fact ${i} was dropped instead`);
    assert.deepStrictEqual(counts, { own: 9, preference: 1, related: 0 });
    const db = new DatabaseSync(file, { readOnly: true });
    try { assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM memories WHERE deleted_at IS NULL').get().n, 11); } finally { db.close(); }
  } finally { rmDir(dir); }
});

test('missing file, locked file and wrong-schema file all return { text: "" } without throwing', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    // Missing file.
    assert.deepStrictEqual(m.selectForSession(path.join(dir, 'nope.db'), { project: 'x' }), { text: '', counts: { own: 0, preference: 0, related: 0 } });

    // Wrong schema: a valid sqlite db with no memories table at all.
    const wrongFile = path.join(dir, 'wrong.db');
    const wdb = new DatabaseSync(wrongFile);
    wdb.exec('CREATE TABLE other (id INTEGER)');
    wdb.close();
    assert.deepStrictEqual(m.selectForSession(wrongFile, { project: 'x' }), { text: '', counts: { own: 0, preference: 0, related: 0 } });

    // Locked: a second connection holds an uncommitted EXCLUSIVE transaction, so the read-only open's
    // first query gets SQLITE_BUSY - a real OS/SQLite-level lock, not a simulated error.
    const lockedFile = buildDb(dir, [{ content: 'unreadable while locked', tags: 'project:x', memory_type: 'reference' }]);
    const writer = new DatabaseSync(lockedFile);
    writer.exec('BEGIN EXCLUSIVE');
    writer.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at) VALUES (?, ?, ?, ?, ?)').run('extra', 'x', 'project:x', 'reference', 1);
    try {
      assert.deepStrictEqual(m.selectForSession(lockedFile, { project: 'x' }), { text: '', counts: { own: 0, preference: 0, related: 0 } });
    } finally { writer.exec('ROLLBACK'); writer.close(); }
  } finally { rmDir(dir); }
});

test(
  'a WAL database in a read-only directory recovers through the immutable URI retry',
  { skip: skipNoSqlite || (process.platform === 'win32' ? 'chmod-based read-only directories are not reliable on Windows' : false) },
  () => {
    // Measured live against this exact fixture before writing the implementation: a plain
    // `new DatabaseSync(path, { readOnly: true })` open SUCCEEDS on a WAL database sitting in a
    // directory this process cannot write to, but the first query then throws
    // "attempt to write a readonly database" (SQLITE_READONLY_DIRECTORY, base code 8) - WAL reads need
    // to create a -shm/-wal index even for a reader. `file:<path>?mode=ro&immutable=1` skips that need
    // and the same query succeeds. This is the retry cross-task-facts.md calls out (its own live note:
    // "a read-only open of a WAL db failed where immutable worked") - the failure surfaces at query
    // time here, not at open time, which is why the engine retries around BOTH steps, not just the
    // constructor.
    const outer = tmpDir('memory-wal-');
    const dbDir = path.join(outer, 'db');
    fs.mkdirSync(dbDir);
    const file = path.join(dbDir, 'memory.db');
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    db.exec('PRAGMA journal_mode=WAL');
    db.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)').run('h1', 'wal note', 'project:demo', 'reference', 1000, null);
    db.close();
    fs.chmodSync(dbDir, 0o500);
    try {
      const { text, counts } = m.selectForSession(file, { project: 'demo', now: NOW, capBytes: 100000 });
      assert.match(text, /wal note/, 'the immutable-URI retry should have recovered the row');
      assert.strictEqual(counts.own, 1);
    } finally {
      fs.chmodSync(dbDir, 0o700);
      rmDir(outer);
    }
  },
);

test('a 500-row database selects in well under 1s', { skip: skipNoSqlite }, () => {
  const dir = tmpDir('memory-select-');
  try {
    const rows = [];
    for (let i = 0; i < 500; i++) {
      const kind = i % 3 === 0 ? 'preference_signal' : i % 3 === 1 ? 'learning' : 'reference';
      const tags = i % 5 === 0 ? 'project:myapp' : i % 5 === 1 ? 'project:sibling-a' : i % 5 === 2 ? 'agent:someone' : '';
      rows.push({ content: `row ${i} ${'x'.repeat(80)}`, tags, memory_type: kind, created_at: i });
    }
    const file = buildDb(dir, rows);
    const started = Date.now();
    const { counts } = m.selectForSession(file, { project: 'myapp', related: ['sibling-a'], now: NOW, capBytes: 100000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `took ${elapsed}ms`);
    assert.ok(counts.own > 0 && counts.related > 0 && counts.preference > 0);
  } finally { rmDir(dir); }
});
