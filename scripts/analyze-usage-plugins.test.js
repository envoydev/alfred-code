'use strict';

// The PLUGIN layer of analyze-usage.js's inventory block, and the live-session exclusion of its
// directory rollup. Every fixture here is synthetic: a config dir with its own registry, marketplace
// list and settings, plugin roots that declare their servers, hooks and language servers the three
// ways Claude Code reads them, and transcripts whose rows copy the real attachment shapes.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'analyze-usage.js');
const line = (o) => JSON.stringify(o) + '\n';
const usage = { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 10, output_tokens: 1 };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };
const row = (rows, name) => rows.find((r) => r.name === name);

// One run, the environment pinned: the live-session id comes from the caller, never from the shell
// this suite happens to run in.
function run(args, env = {}) {
  const base = { ...process.env };
  delete base.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...base, ...env } });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}
const runJson = (args, env) => JSON.parse(run([...args, '--json'], env));

const SID = { a1: 'aaaaaaaa-0000-4000-8000-000000000001', a2: 'aaaaaaaa-0000-4000-8000-000000000002', b1: 'bbbbbbbb-0000-4000-8000-000000000001' };

// The machine: a config dir holding the registry, the marketplace list and the user settings, and
// two projects. Every plugin root is synthetic.
function writeMachine(dir) {
  const cfg = path.join(dir, 'cfg');
  const projA = path.join(dir, 'proj-a');
  const projB = path.join(dir, 'proj-b');
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });

  // A marketplace whose own manifest declares an LSP server INLINE - the shape the official
  // `*-lsp` entries use, with nothing but a README in the plugin root.
  const market = path.join(dir, 'market');
  writeJson(path.join(market, '.claude-plugin', 'marketplace.json'), {
    name: 'demo-market',
    plugins: [
      { name: 'ts-lsp', source: './plugins/ts-lsp', lspServers: { typescript: { command: 'tsls', extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' } } } },
      { name: 'cs-lsp', source: './plugins/cs-lsp', lspServers: { csharp: { command: 'csls', extensionToLanguage: { '.cs': 'csharp' } } } },
    ],
  });
  const tsLsp = path.join(dir, 'cache', 'ts-lsp');
  const csLsp = path.join(dir, 'cache', 'cs-lsp');
  fs.mkdirSync(tsLsp, { recursive: true });
  fs.mkdirSync(csLsp, { recursive: true });

  // An MCP server declared INLINE in the plugin's own plugin.json.
  const inlineMcp = path.join(dir, 'cache', 'inline-mcp');
  writeJson(path.join(inlineMcp, '.claude-plugin', 'plugin.json'), { name: 'inline-mcp', mcpServers: { 'inline-srv': { command: 'node', args: ['srv.js'] } } });

  // A SHARED repo root: the entry, with its server inline, lives in the marketplace manifest the
  // root ships - the stack's own serena / context7 / memory shape.
  const shared = path.join(dir, 'cache', 'shared-root');
  writeJson(path.join(shared, '.claude-plugin', 'marketplace.json'), {
    name: 'demo-market',
    plugins: [{ name: 'shared-mcp', source: './', strict: false, mcpServers: { 'shared-mcp': { command: 'uvx', args: ['srv'] } } }],
  });

  // A hooks-only plugin: the default hooks/hooks.json, plus a second file named from plugin.json.
  const hooksOnly = path.join(dir, 'cache', 'hooks-only');
  writeJson(path.join(hooksOnly, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.js"' }] }],
      SubagentStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/sub.js"', statusMessage: 'Loading demo mode...' }] }],
    },
  });
  writeJson(path.join(hooksOnly, '.claude-plugin', 'plugin.json'), { name: 'hooks-only', hooks: './hooks/extra.json' });
  writeJson(path.join(hooksOnly, 'hooks', 'extra.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"' }] }] } });

  const at = '2026-07-01T00:00:00.000Z';
  writeJson(path.join(cfg, 'plugins', 'known_marketplaces.json'), { 'demo-market': { source: { source: 'directory', path: market }, installLocation: market } });
  writeJson(path.join(cfg, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      // user scope: every project, every session after the install
      'user-plug@demo-market': [{ scope: 'user', installPath: path.join(dir, 'cache', 'none'), installedAt: at }],
      // project scope, proj-a only
      'proj-plug@demo-market': [{ scope: 'project', projectPath: projA, installPath: path.join(dir, 'cache', 'none'), installedAt: at }],
      // project scope in a project with no session here - yet proj-b's session calls its skill
      'stray-plug@demo-market': [{ scope: 'project', projectPath: path.join(dir, 'proj-c'), installPath: path.join(dir, 'cache', 'none'), installedAt: at }],
      // user scope, installed AFTER the first proj-a session ended
      'late-plug@demo-market': [{ scope: 'user', installPath: path.join(dir, 'cache', 'none'), installedAt: '2026-07-16T00:00:00.000Z' }],
      // user scope, switched off in the user settings and back on in proj-b's project settings
      'off-plug@demo-market': [{ scope: 'user', installPath: path.join(dir, 'cache', 'none'), installedAt: at }],
      'inline-mcp@demo-market': [{ scope: 'user', installPath: inlineMcp, installedAt: at }],
      'shared-mcp@demo-market': [{ scope: 'user', installPath: shared, installedAt: at }],
      'hooks-only@demo-market': [{ scope: 'project', projectPath: projA, installPath: hooksOnly, installedAt: at }],
      'ts-lsp@demo-market': [{ scope: 'user', installPath: tsLsp, installedAt: at }],
      'cs-lsp@demo-market': [{ scope: 'user', installPath: csLsp, installedAt: at }],
    },
  });
  writeJson(path.join(cfg, 'settings.json'), { enabledPlugins: { 'off-plug@demo-market': false } });
  writeJson(path.join(projB, '.claude', 'settings.json'), { enabledPlugins: { 'off-plug@demo-market': true } });
  return { cfg, projA, projB, registry: path.join(cfg, 'plugins', 'installed_plugins.json') };
}

const asst = (id, ts, content) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5', usage, content } });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input: input || {} });
const result = (id, ts) => ({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const human = (cwd, ts) => ({ type: 'user', timestamp: ts, cwd, parentUuid: 'p0', origin: { kind: 'human' }, message: { content: 'go' } });
const attach = (ts, attachment) => ({ type: 'attachment', timestamp: ts, attachment });

function writeSession(corpus, sid, rows) {
  const d = path.join(corpus, 'proj');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${sid}.jsonl`), rows.map(line).join(''));
}

// proj-a session 1 (ends before late-plug's install): the inline servers, the hooks, a .ts diagnostic
// proj-a session 2: nothing plugin-shaped at all
// proj-b session 1: stray-plug's skill used where the registry never installed it
function writeCorpus(dir, m) {
  const corpus = path.join(dir, 'corpus');
  writeSession(corpus, SID.a1, [
    human(m.projA, '2026-07-15T07:00:00.000Z'),
    asst('m1', '2026-07-15T07:00:10.000Z', [toolUse('t1', 'mcp__plugin_inline-mcp_inline-srv__lookup')]), // mcp-fixture
    result('t1', '2026-07-15T07:00:11.000Z'),
    asst('m2', '2026-07-15T07:00:20.000Z', [toolUse('t2', 'mcp__plugin_shared-mcp_shared-mcp__find')]), // mcp-fixture
    result('t2', '2026-07-15T07:00:21.000Z'),
    // a BARE registration of a server with the plugin's server name - not the plugin
    asst('m3', '2026-07-15T07:00:30.000Z', [toolUse('t3', 'mcp__inline-srv__lookup')]),
    result('t3', '2026-07-15T07:00:31.000Z'),
    // the three hook rows a plugin hook leaves: the command, the statusMessage in its place, and a
    // blocking error carrying the command inside it
    attach('2026-07-15T07:00:40.000Z', { type: 'hook_success', hookName: 'SessionStart:startup', hookEvent: 'SessionStart', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/start.js"', exitCode: 0 }),
    attach('2026-07-15T07:00:41.000Z', { type: 'hook_success', hookName: 'SubagentStart', hookEvent: 'SubagentStart', command: 'Loading demo mode...', exitCode: 0 }),
    attach('2026-07-15T07:00:42.000Z', { type: 'hook_blocking_error', hookName: 'Stop', hookEvent: 'Stop', blockingError: { blockingError: 'held', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"' } }),
    // a project's own hook matches no plugin
    attach('2026-07-15T07:00:43.000Z', { type: 'hook_success', hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/own.js"', exitCode: 0 }),
    // an additional-context row names no command, so it proves nothing about which plugin ran
    attach('2026-07-15T07:00:44.000Z', { type: 'hook_additional_context', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', content: ['text'] }),
    // the language server's diagnostics for a .ts file
    attach('2026-07-15T07:00:50.000Z', { type: 'diagnostics', isNew: true, files: [{ uri: `file://${m.projA}/src/app.ts`, diagnostics: [{ message: 'x', severity: 'Error', source: 'typescript' }] }] }),
  ]);
  writeSession(corpus, SID.a2, [
    human(m.projA, '2026-07-17T07:00:00.000Z'),
    asst('n1', '2026-07-17T07:00:10.000Z', [toolUse('u1', 'Read', { file_path: `${m.projA}/README.md` })]),
    result('u1', '2026-07-17T07:00:11.000Z'),
  ]);
  writeSession(corpus, SID.b1, [
    human(m.projB, '2026-07-18T07:00:00.000Z'),
    asst('k1', '2026-07-18T07:00:10.000Z', [toolUse('v1', 'Skill', { skill: 'stray-plug:helper' })]),
    result('v1', '2026-07-18T07:00:11.000Z'),
  ]);
  return corpus;
}

test('plugins (a): a plugin counts only in the sessions its install and enable reach', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const m = writeMachine(dir);
  const corpus = writeCorpus(dir, m);
  const inv = runJson([corpus, '--plugins', m.registry]).inventory;
  assert.strictEqual(inv.source.sessions, 3);
  assert.strictEqual(row(inv.plugins, 'user-plug').installedIn, 3, 'user scope reaches every session');
  assert.strictEqual(row(inv.plugins, 'proj-plug').installedIn, 2, "project scope reaches proj-a's two sessions and nothing else");
  assert.strictEqual(row(inv.plugins, 'stray-plug').installedIn, 1,
    'no install reaches proj-b, but a session that USED the plugin had it loaded - use proves the load');
  assert.strictEqual(row(inv.plugins, 'stray-plug').sessionsUsed, 1);
  assert.strictEqual(row(inv.plugins, 'late-plug').installedIn, 2, 'a session that ended before the install never had it');
  assert.strictEqual(row(inv.plugins, 'off-plug').installedIn, 1, 'off in the user settings, on in the project settings of proj-b only');
  assert.strictEqual(row(inv.plugins, 'hooks-only').installedIn, 2, 'project scope: proj-a only');
  for (const r of inv.plugins) assert.ok(r.sessionsUsed <= r.installedIn || r.source === 'observed', `${r.name}: used ${r.sessionsUsed} > installed ${r.installedIn}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins (b): a server declared inline in plugin.json or a marketplace entry is that plugin\'s use', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const m = writeMachine(dir);
  const corpus = writeCorpus(dir, m);
  const inv = runJson([corpus, '--plugins', m.registry]).inventory;
  assert.deepStrictEqual(row(inv.plugins, 'inline-mcp').how, ['mcp inline-srv x1'],
    'inline in plugin.json - and the bare registration of the same server name is not the plugin');
  assert.deepStrictEqual(row(inv.plugins, 'shared-mcp').how, ['mcp shared-mcp x1'], 'inline in the shared root\'s marketplace entry');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins (c): a diagnostics attachment is the language server\'s use, by the file\'s extension', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const m = writeMachine(dir);
  const corpus = writeCorpus(dir, m);
  const inv = runJson([corpus, '--plugins', m.registry]).inventory;
  assert.deepStrictEqual(row(inv.plugins, 'ts-lsp').how, ['diagnostics .ts x1'], 'the .ts server, from the marketplace entry\'s extension map');
  assert.strictEqual(row(inv.plugins, 'cs-lsp').used, 'no', 'the .cs server saw no .cs file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins (d): a hook row naming the plugin\'s hook is a hooks-only plugin\'s use', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const m = writeMachine(dir);
  const corpus = writeCorpus(dir, m);
  const inv = runJson([corpus, '--plugins', m.registry]).inventory;
  const h = row(inv.plugins, 'hooks-only');
  assert.strictEqual(h.used, 'yes');
  assert.deepStrictEqual(h.how, ['hook x3'], 'the command, the statusMessage in its place, and the blocking error\'s command');
  assert.strictEqual(h.sessionsUsed, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rollup (e): the session running the analyzer is left out, and the run says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const m = writeMachine(dir);
  const corpus = writeCorpus(dir, m);

  const live = runJson([corpus, '--plugins', m.registry], { CLAUDE_CODE_SESSION_ID: SID.a1 });
  assert.deepStrictEqual(live.sessions.map((s) => s.session).sort(), [SID.a2, SID.b1]);
  assert.strictEqual(live.inventory.source.sessions, 2);
  assert.deepStrictEqual(live.excludedSessions, [{ session: SID.a1, why: 'CLAUDE_CODE_SESSION_ID' }]);

  const flag = runJson([corpus, '--plugins', m.registry, '--exclude-session', SID.b1]);
  assert.deepStrictEqual(flag.sessions.map((s) => s.session).sort(), [SID.a1, SID.a2]);
  assert.deepStrictEqual(flag.excludedSessions, [{ session: SID.b1, why: '--exclude-session' }]);

  const none = runJson([corpus, '--plugins', m.registry], { CLAUDE_CODE_SESSION_ID: 'cccccccc-0000-4000-8000-000000000009' });
  assert.strictEqual(none.sessions.length, 3, 'an id that names no session in the corpus excludes nothing');
  assert.deepStrictEqual(none.excludedSessions, []);

  const txt = run([corpus, '--plugins', m.registry], { CLAUDE_CODE_SESSION_ID: SID.a1 });
  assert.match(txt, new RegExp(`excluded 1 session: ${SID.a1} \\(CLAUDE_CODE_SESSION_ID - the session running this analyzer\\)`));
  assert.doesNotMatch(txt, new RegExp(`^  ${SID.a1}`, 'm'), 'no table row for it');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins: a hook command two plugins declare goes to the one the session had, else to both', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const projA = path.join(dir, 'proj-a');
  fs.mkdirSync(projA, { recursive: true });
  const hooked = (name) => {
    const root = path.join(dir, 'cache', name);
    writeJson(path.join(root, 'hooks', 'hooks.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/guard.js"' }] }] } });
    return root;
  };
  const registry = path.join(dir, 'cfg', 'plugins', 'installed_plugins.json');
  writeJson(registry, {
    version: 2,
    plugins: {
      'new-core@m': [{ scope: 'project', projectPath: projA, installPath: hooked('new-core') }],
      'old-hooks@m': [{ scope: 'project', projectPath: path.join(dir, 'elsewhere'), installPath: hooked('old-hooks') }],
    },
  });
  const corpus = path.join(dir, 'corpus');
  // an OLDER release recorded the command without its interpreter and quotes
  const hookRow = attach('2026-07-15T07:00:01.000Z', { type: 'hook_success', hookName: 'SessionStart:startup', hookEvent: 'SessionStart', command: '${CLAUDE_PLUGIN_ROOT}/stack/hooks/guard.js', exitCode: 0 });
  writeSession(corpus, SID.a1, [human(projA, '2026-07-15T07:00:00.000Z'), hookRow]);
  let inv = runJson([corpus, '--plugins', registry]).inventory;
  assert.deepStrictEqual(row(inv.plugins, 'new-core').how, ['hook x1'], 'the plugin installed here owns the row');
  assert.strictEqual(row(inv.plugins, 'old-hooks'), undefined, 'the other claimant was never installed here and is not credited');

  fs.rmSync(corpus, { recursive: true, force: true });
  writeSession(corpus, SID.b1, [human(path.join(dir, 'proj-z'), '2026-07-15T07:00:00.000Z'), hookRow]);
  inv = runJson([corpus, '--plugins', registry]).inventory;
  assert.strictEqual(row(inv.plugins, 'new-core').used, 'yes', 'neither claimant reaches proj-z: both are credited');
  assert.strictEqual(row(inv.plugins, 'old-hooks').used, 'yes');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins: a language server with no readable extension map claims only what no known map does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const m = writeMachine(dir);
  const reg = JSON.parse(fs.readFileSync(m.registry, 'utf8'));
  // a registry copied off another machine: no install path, so no map to read
  reg.plugins['blind-lsp@elsewhere'] = [{ scope: 'user' }];
  writeJson(m.registry, reg);
  const corpus = path.join(dir, 'corpus');
  writeSession(corpus, SID.a1, [
    human(m.projA, '2026-07-15T07:00:00.000Z'),
    attach('2026-07-15T07:00:01.000Z', { type: 'diagnostics', files: [{ uri: `file://${m.projA}/a.ts`, diagnostics: [] }, { uri: `file://${m.projA}/b.go`, diagnostics: [] }] }),
  ]);
  const inv = runJson([corpus, '--plugins', m.registry]).inventory;
  assert.deepStrictEqual(row(inv.plugins, 'ts-lsp').how, ['diagnostics .ts x1']);
  assert.deepStrictEqual(row(inv.plugins, 'blind-lsp').how, ['diagnostics .go x1'], 'the .go file no known map claims');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins: malformed registry, manifests and settings never throw, and a session with no cwd gets user scope only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const cfg = path.join(dir, 'cfg');
  const root = path.join(dir, 'cache', 'bad');
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{ not json');
  writeJson(path.join(root, 'hooks', 'hooks.json'), { hooks: { SessionStart: 'not a list', Stop: [null, { hooks: 'nope' }] } });
  fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'plugins', 'known_marketplaces.json'), '[garbage');
  fs.writeFileSync(path.join(cfg, 'settings.json'), 'garbage');
  writeJson(path.join(cfg, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'bad@m': [null, { scope: 'user', installPath: root }], 'proj-only@m': [{ scope: 'project', projectPath: path.join(dir, 'p') }], 'odd@m': 'not a list' },
  });
  const corpus = path.join(dir, 'corpus');
  writeSession(corpus, SID.a1, [asst('m1', '2026-07-15T07:00:00.000Z', [toolUse('t1', 'Read', { file_path: 'x.md' })]), result('t1', '2026-07-15T07:00:01.000Z')]);
  const inv = runJson([corpus, '--plugins', path.join(cfg, 'plugins', 'installed_plugins.json')]).inventory;
  assert.strictEqual(row(inv.plugins, 'bad').installedIn, 1, 'user scope reaches a session with no cwd');
  assert.strictEqual(row(inv.plugins, 'proj-only'), undefined, 'a project-scope record cannot be placed without a cwd');
  assert.strictEqual(row(inv.plugins, 'odd'), undefined);

  // an unreadable registry is no plugin layer at all
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), '{ broken');
  const none = runJson([corpus, '--plugins', path.join(cfg, 'plugins', 'installed_plugins.json')]).inventory;
  assert.deepStrictEqual(none.plugins, []);
  assert.strictEqual(none.source.plugins, 'unknown');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugins: the two normalizers - a hook command across releases, a path across spellings', () => {
  const { hookCommandKey, samePath } = require('./analyze-usage.js');
  assert.strictEqual(hookCommandKey('node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/x.js"'), hookCommandKey('${CLAUDE_PLUGIN_ROOT}/stack/hooks/x.js'));
  assert.strictEqual(hookCommandKey('"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd"  session-start'), '$CLAUDE_PLUGIN_ROOT/hooks/run-hook.cmd session-start');
  assert.strictEqual(hookCommandKey('bash "${CLAUDE_PLUGIN_ROOT}/a.sh" "${CLAUDE_PLUGIN_ROOT}/b.py"'), '$CLAUDE_PLUGIN_ROOT/a.sh $CLAUDE_PLUGIN_ROOT/b.py');
  assert.strictEqual(hookCommandKey('Loading demo mode...'), 'Loading demo mode...', 'a statusMessage is its own key');
  assert.notStrictEqual(hookCommandKey('node "${CLAUDE_PLUGIN_ROOT}/a.js"'), hookCommandKey('node "${CLAUDE_PLUGIN_ROOT}/b.js"'));
  assert.ok(samePath('/p/proj/', '/p/proj'));
  assert.ok(samePath('C:\\Users\\Dev\\proj', 'c:/users/dev/proj'), 'a Windows drive path compares case-insensitively');
  assert.ok(!samePath('/p/Proj', '/p/proj'), 'a POSIX path does not');
  assert.ok(!samePath('/p/proj', '/p/proj/sub'), 'a subdirectory is another project');
  assert.ok(!samePath(null, '/p'));
});

test('plugins: a namespace no registry lists is scored in every session that used it, not only the first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-plugins-'));
  const registry = path.join(dir, 'cfg', 'plugins', 'installed_plugins.json');
  writeJson(registry, { version: 2, plugins: {} });
  const corpus = path.join(dir, 'corpus');
  for (const [sid, ts] of [[SID.a1, '2026-07-15T07:00:00.000Z'], [SID.a2, '2026-07-16T07:00:00.000Z']]) {
    writeSession(corpus, sid, [asst(`m-${sid}`, ts, [toolUse(`t-${sid}`, 'Skill', { skill: 'obs-plug:helper' })]), result(`t-${sid}`, ts)]);
  }
  const inv = runJson([corpus, '--plugins', registry]).inventory;
  assert.strictEqual(row(inv.plugins, 'obs-plug').source, 'observed');
  assert.strictEqual(row(inv.plugins, 'obs-plug').sessionsUsed, 2, 'the second session is a use too');
  assert.deepStrictEqual(row(inv.plugins, 'obs-plug').how, ['namespaced skill/command x2']);
  fs.rmSync(dir, { recursive: true, force: true });
});
