// The shell-guard dispatcher (R11): one node process judges a Bash / PowerShell call for every shell guard,
// in-process, and answers as Claude Code would merge the same guards run as separate hooks. Each guard
// keeps its own file, entry and tests (they spawn the files standalone); these cases pin the COMBINATION -
// every guard's block reaching the one answer, the ledger row per blocking guard, the gates applied per
// guard, a throwing guard failing open alone - and the wiring both routes generate.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
const { verdictOf, blockText, askText } = require('./hook-test-env');
require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // RU04: the background note's once-per-actor marker sits in the hook temp dir
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const vm = require('node:vm');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const DISPATCH = path.join(HOOKS, 'shell-guards.js');
const shell = require(DISPATCH);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-guards-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const BIG = path.join(__dirname, 'lint-skills.js');
const { blockVerdict } = require('../stack/hooks/hook-prelude.js');

// The containment every guard suite applies: an empty account dir, no ambient stack settings from the
// session this suite may run inside (an installed checkout exports ALFRED_CODE_* into every tool call).
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
for (const k of Object.keys(process.env))
  if (/^ALFRED_CODE_/.test(k) || k === 'CLAUDE_PLUGIN_ROOT' || k === 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE') delete process.env[k];
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));

const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
const forty = () => Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');

// A set-up project (its stamp is the install record GATE 4 looks for) holding a non-trivial dirty diff,
// so an unreceipted `git commit -am` is the commit gate's block.
function project(prefix = 'proj-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(TMP, prefix)));
  git(dir, 'init', '-q', '-b', 'feature');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'seed');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), forty());
  git(dir, 'add', '-A');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
  return dir;
}
// A plugin root the prelude reads as the 2.x core's cache entry, never the 1.x alias.
const PLUGIN_ROOT = path.join(TMP, 'cache', 'envoydev', 'alfred-code', '2.0.0');

function run(file, payload, { cwd, env = {}, args = [] } = {})
{
  const r = spawnSync(process.execPath, [file, ...args], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: cwd || process.env.CLAUDE_PROJECT_DIR,
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const bashPayload = (command, cwd, tool = 'Bash') => ({ session_id: 'sg', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd });
const ledgerRows = (dir, session = 'sg') =>
{
  const f = path.join(dir, '.alfred', 'statistics', 'hook-blocks', `${session}.jsonl`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const hooksOf = (rows) => rows.filter((r) => !r.mode).map((r) => r.hook).sort();

// ---- the combination rule, as a pure function ---------------------------------------------------
// Claude Code merges the hooks matching one PreToolUse call (code.claude.com/docs/en/hooks, PreToolUse
// decision control): a deny from any hook blocks, updatedInput objects merge, additionalContext and
// systemMessage concatenate. Measured on CLI 2.1.283 with separate probe hooks: two blocks show the model
// ONE reason, picked non-deterministically; context still arrives beside a block.
const r = (guard, code, stdout = '', stderr = '') => ({ guard, code, stdout, stderr });
const deny = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const ctx = (text) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
const rewrite = (command) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { command, description: 'd' } } });

test('combine: nothing to say is exit 0 and no output', () => {
  assert.deepStrictEqual(shell.combine([r('a.js', 0), r('b.js', 0, 'plain text goes to the debug log')]), { code: 0, stdout: '', stderr: '' });
});

test('combine: one exit-2 block is that guard\'s stderr, verbatim', () => {
  const out = shell.combine([r('a.js', 0), r('b.js', 2, '', 'Blocked: b\n')]);
  assert.deepStrictEqual(out, { code: 2, stdout: '', stderr: 'Blocked: b\n' });
});

test('combine: two blocks carry BOTH reasons, in guard order, where separate hooks showed one', () => {
  const out = shell.combine([r('a.js', 2, '', 'Blocked: a\n'), r('b.js', 0), r('c.js', 2, '', 'Blocked: c\n')]);
  assert.strictEqual(out.code, 2);
  assert.strictEqual(out.stderr, 'Blocked: a\n\nBlocked: c\n');
});

test('combine: a JSON deny alone stays a JSON deny; beside an exit-2 block it joins the stderr', () => {
  const only = shell.combine([r('d.js', 0, deny('Docs not read yet'))]);
  assert.strictEqual(only.code, 0);
  assert.deepStrictEqual(JSON.parse(only.stdout), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Docs not read yet' } });
  const two = shell.combine([r('d.js', 0, deny('first')), r('e.js', 0, deny('second'))]);
  assert.strictEqual(JSON.parse(two.stdout).hookSpecificOutput.permissionDecisionReason, 'first\n\nsecond');
  const mixed = shell.combine([r('a.js', 2, '', 'Blocked: a\n'), r('d.js', 0, deny('Docs not read yet'))]);
  assert.strictEqual(mixed.code, 2);
  assert.strictEqual(mixed.stderr, 'Blocked: a\n\nDocs not read yet\n');
});

const ask = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } });

test('combine: a block beside an ask keeps the ask reason after it, prefixed Also', () => {
  const exit = shell.combine([r('a.js', 0, ask('Read of data/x.csv: a data dump')), r('b.js', 2, '', 'Blocked: b\n')]);
  assert.strictEqual(exit.code, 2);
  assert.strictEqual(exit.stderr, 'Blocked: b\n\nAlso: Read of data/x.csv: a data dump\n');
  const json = shell.combine([r('a.js', 0, ask('first ask')), r('d.js', 0, deny('Docs not read yet')), r('c.js', 0, ask('second ask'))]);
  assert.strictEqual(json.code, 0);
  assert.strictEqual(JSON.parse(json.stdout).hookSpecificOutput.permissionDecisionReason, 'Docs not read yet\n\nAlso: first ask\n\nAlso: second ask');
});

test('combine: a lone ask and two blocks read as before', () => {
  const lone = shell.combine([r('a.js', 0, ask('only ask')), r('b.js', 0)]);
  assert.deepStrictEqual(JSON.parse(lone.stdout).hookSpecificOutput, { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'only ask' });
  const twoAsks = shell.combine([r('a.js', 0, ask('one')), r('b.js', 0, ask('two'))]);
  assert.strictEqual(JSON.parse(twoAsks.stdout).hookSpecificOutput.permissionDecisionReason, 'one\ntwo');
  assert.strictEqual(shell.combine([r('a.js', 2, '', 'Blocked: a\n'), r('c.js', 2, '', 'Blocked: c\n')]).stderr, 'Blocked: a\n\nBlocked: c\n');
});

test('combine: context concatenates with a newline and still rides beside a block', () => {
  const free = shell.combine([r('a.js', 0, ctx('one')), r('b.js', 0, ctx('two'))]);
  assert.deepStrictEqual(JSON.parse(free.stdout), { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'one\ntwo' } });
  const blocked = shell.combine([r('a.js', 0, ctx('one')), r('b.js', 2, '', 'Blocked: b\n')]);
  assert.strictEqual(blocked.code, 2);
  assert.strictEqual(blocked.stderr, 'Blocked: b\n');
  assert.strictEqual(JSON.parse(blocked.stdout).hookSpecificOutput.additionalContext, 'one');
});

test('combine: a rewrite passes alone, and any block wins over it', () => {
  const alone = shell.combine([r('s.js', 0, rewrite('node x.js --redacted-env'))]);
  assert.strictEqual(alone.code, 0);
  assert.deepStrictEqual(JSON.parse(alone.stdout).hookSpecificOutput.updatedInput, { command: 'node x.js --redacted-env', description: 'd' });
  const beaten = shell.combine([r('s.js', 0, rewrite('node x.js --redacted-env')), r('b.js', 2, '', 'Blocked: b\n')]);
  assert.strictEqual(beaten.code, 2);
  assert.ok(!beaten.stdout.includes('updatedInput'), 'a blocked call runs nothing, so no rewrite is sent');
});

test('combine: a crashed guard fails open for itself and the user still sees the notice', () => {
  const out = shell.combine([r('a.js', 1, '', 'TypeError: boom\n    at x'), r('b.js', 0)]);
  assert.strictEqual(out.code, 0);
  assert.match(JSON.parse(out.stdout).systemMessage, /a\.js.*TypeError: boom/);
  assert.ok(!out.stdout.includes('at x'), 'the first stderr line, as Claude Code shows a non-blocking error');
  const bad = shell.combine([r('a.js', 0, '{"hookSpecificOutput": '), r('b.js', 2, '', 'Blocked: b\n')]);
  assert.strictEqual(bad.code, 2, 'unparseable JSON from one guard never cancels another guard\'s block');
  // A valid object decides whatever the exit code (hooks reference, 'Any other exit code').
  const late = shell.combine([r('a.js', 1, ctx('still read'))]);
  assert.strictEqual(JSON.parse(late.stdout).hookSpecificOutput.additionalContext, 'still read');
});

// ---- the wiring ---------------------------------------------------------------------------------
test('wiringRows: every dispatched Bash|PowerShell|Monitor row folds into ONE dispatcher row, in place', () => {
  const rows = ['a.js::@Stop', 'guard-protected-force-push.js::Bash|PowerShell|Monitor', 'guard-read-whole-file.js::Read', 'guard-catastrophic-rm.js::Bash|PowerShell|Monitor', 'guard-read-whole-file.js::Bash', 'instrument-tool-usage.js::.*'];
  assert.deepStrictEqual(shell.wiringRows(rows), ['a.js::@Stop', 'shell-guards.js::Bash|PowerShell|Monitor', 'guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'instrument-tool-usage.js::.*']);
  // The copy route names its selection when it is a strict subset; the whole set needs no list.
  assert.deepStrictEqual(shell.wiringRows(rows, { listGuards: true }), ['a.js::@Stop', 'shell-guards.js::Bash|PowerShell|Monitor::guard-protected-force-push guard-catastrophic-rm', 'guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'instrument-tool-usage.js::.*']);
  const all = shell.GUARDS.map((g) => `${g}.js::Bash|PowerShell|Monitor`);
  assert.deepStrictEqual(shell.wiringRows(all, { listGuards: true }), ['shell-guards.js::Bash|PowerShell|Monitor'], 'all eight: no list');
  assert.deepStrictEqual(shell.wiringRows(all.slice(1), { listGuards: true }), [`shell-guards.js::Bash|PowerShell|Monitor::${shell.GUARDS.slice(1).join(' ')}`], 'seven of eight: listed');
  assert.deepStrictEqual(shell.wiringRows(all.slice(-1), { listGuards: true }), [`shell-guards.js::Bash|PowerShell|Monitor::${shell.GUARDS.slice(-1)[0]}`], 'one: listed');
  assert.deepStrictEqual(shell.wiringRows(['x.js::Bash|PowerShell|Monitor', { file: 'guard-catastrophic-rm.js', matcher: 'Bash|PowerShell|Monitor' }], { listGuards: true }), ['x.js::Bash|PowerShell|Monitor', 'shell-guards.js::Bash|PowerShell|Monitor::guard-catastrophic-rm']);
  assert.deepStrictEqual(shell.wiringRows(['a.js::@Stop']), ['a.js::@Stop'], 'no dispatched row, no dispatcher');
});

test('the manifest wires every dispatched guard on the shell tools, and nothing else on them but instrumentation', () => {
  const { loadManifest } = require('./install/manifest.js');
  const rows = loadManifest(path.join(__dirname, '..')).catalogs.hooks.map((row) => row.replace(/::$/, ''));
  for (const g of shell.GUARDS) assert.ok(rows.includes(`${g}.js::Bash|PowerShell|Monitor`), `${g} keeps its own Bash|PowerShell|Monitor catalog row`);
  const onShell = rows.filter((row) => { const m = row.split('::')[1] || ''; return !m.startsWith('@') && /(^|\|)(Bash|PowerShell|Monitor)(\||$)/.test(m); });
  assert.deepStrictEqual(onShell.filter((row) => !shell.GUARDS.includes(row.split('::')[0].replace(/\.js$/, ''))), [], 'a shell-tool wiring outside the dispatcher is a second process per Bash call');
  for (const g of shell.GUARDS) assert.ok(fs.existsSync(path.join(HOOKS, `${g}.js`)), `${g}.js exists`);
});

test('the core entry launches the dispatcher once on the shell tools, with the summed timeout', () => {
  const build = require('./build-marketplace.js');
  const block = build.hooksBlock(build.parseHookWirings());
  const shellGroups = block.PreToolUse.filter((g) => /(^|\|)(Bash|PowerShell)(\||$)/.test(g.matcher || ''));
  const commands = shellGroups.flatMap((g) => g.hooks.map((h) => [h.command, ...(h.args || [])].join(' ')));
  assert.deepStrictEqual(commands, ['node ${CLAUDE_PLUGIN_ROOT}/stack/hooks/shell-guards.js']);
  assert.strictEqual(shellGroups[0].hooks[0].timeout, 10 * shell.GUARDS.length, 'every guard keeps the 10s it had as its own hook');
  const settings = require('./install/settings.js');
  assert.strictEqual(settings.timeoutFor('shell-guards.js', 'PreToolUse'), 10 * shell.GUARDS.length);
});

test('copy route: the dispatcher replaces the per-guard shell rows an older install wrote, and a re-run changes nothing', () => {
  const settings = require('./install/settings.js');
  const dir = fs.mkdtempSync(path.join(TMP, 'copy-'));
  const file = path.join(dir, 'settings.json');
  const cmd = (f) => `"$CLAUDE_PROJECT_DIR/.claude/hooks/${f}"`;
  // What c727385's copy route wrote for the shell tools, beside the user's own Bash hook.
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [
    { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: cmd('guard-catastrophic-rm.js'), timeout: 10 }] },
    { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: cmd('guard-ungated-commit.js'), timeout: 10 }] },
    { matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell', hooks: [{ type: 'command', command: cmd('guard-config-protection.js'), timeout: 10 }] },
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'node ./my-own-hook.js', timeout: 5 }] },
  ] } }, null, 2));
  const specs = ['guard-catastrophic-rm.js::Bash|PowerShell|Monitor', 'guard-ungated-commit.js::Bash|PowerShell|Monitor', 'guard-config-protection.js::Write|Edit|MultiEdit|NotebookEdit', 'guard-config-protection.js::Bash|PowerShell|Monitor'];
  settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} });
  const pre = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse;
  const wired = pre.flatMap((e) => e.hooks.map((h) => `${e.matcher}  ${h.command}  ${h.timeout}`));
  assert.deepStrictEqual(wired.sort(), [
    `Bash  node ./my-own-hook.js  5`,
    `Bash|PowerShell|Monitor  ${cmd('shell-guards.js')} guard-catastrophic-rm guard-ungated-commit guard-config-protection  ${10 * shell.GUARDS.length}`,
    // its file-tool row folds into the file-guard dispatcher since 2.1.5 (M3)
    `Edit|Write|MultiEdit|NotebookEdit  ${cmd('file-guards.js')} guard-config-protection  ${10 * require(path.join(HOOKS, 'file-guards.js')).GUARDS.length}`,
  ].sort());
  const before = fs.readFileSync(file, 'utf8');
  const again = settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'idempotent');
  assert.strictEqual(again.written, false, 'the re-run writes nothing');
});

// I1 (2.1.4 audit): the shell route gained Monitor. A 2.1.3 copy-route install wired the dispatcher on
// `Bash|PowerShell`; the update rewires it on the widened matcher, once, and keeps the user's own hook.
test('copy route: a dispatcher wired on the old Bash|PowerShell matcher is rewired onto the Monitor route, once', () => {
  const settings = require('./install/settings.js');
  const dir = fs.mkdtempSync(path.join(TMP, 'copy-monitor-'));
  const file = path.join(dir, 'settings.json');
  const cmd = (f) => `"$CLAUDE_PROJECT_DIR/.claude/hooks/${f}"`;
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [
    { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `${cmd('shell-guards.js')} guard-catastrophic-rm`, timeout: 80 }] },
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'node ./my-own-hook.js', timeout: 5 }] },
  ] } }, null, 2));
  const specs = [`guard-catastrophic-rm.js::${shell.MATCHER}`];
  settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} });
  const wired = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => `${e.matcher}  ${h.command}`));
  assert.deepStrictEqual(wired.sort(), [
    'Bash  node ./my-own-hook.js',
    `Bash|PowerShell|Monitor  ${cmd('shell-guards.js')} guard-catastrophic-rm`,
  ].sort());
  const before = fs.readFileSync(file, 'utf8');
  assert.strictEqual(settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} }).written, false, 'a re-run writes nothing');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('copy route: the ledger keeps the dispatcher wiring this run wrote', () => {
  const settings = require('./install/settings.js');
  const dir = fs.mkdtempSync(path.join(TMP, 'ledger-'));
  const file = path.join(dir, 'settings.json');
  const specs = ['guard-catastrophic-rm.js::Bash|PowerShell|Monitor', 'guard-read-whole-file.js::Read'];
  const catalog = [...shell.GUARDS.map((g) => `${g}.js::Bash|PowerShell|Monitor`), 'guard-read-whole-file.js::Read'];
  const first = settings.writeSettings({ file, hookSpecs: specs, ledger: { releaseHooks: catalog }, log: () => {}, note: () => {} });
  const prior = { hooks: first.managed.hooks };
  settings.writeSettings({ file, hookSpecs: specs, ledger: { prior, releaseHooks: catalog }, log: () => {}, note: () => {} });
  const commands = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(commands.some((c) => c.includes('shell-guards.js') && c.endsWith(' guard-catastrophic-rm')), commands.join(' | '));
});

// ---- the dispatcher, end to end -----------------------------------------------------------------
const ASKING = new Set(['guard-protected-force-push', 'guard-catastrophic-rm', 'guard-secret-value', 'guard-ungated-commit', 'guard-config-protection', 'guard-cross-project-write', 'guard-read-whole-file']);
test('each guard\'s block reaches the combined answer, with its own ledger row', () => {
  const dir = project();
  const other = fs.mkdtempSync(path.join(TMP, 'other-'));
  const FAKE_JWT = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
  const cases = [
    ['guard-protected-force-push', 'git push --force origin main'],
    ['guard-catastrophic-rm', 'rm -rf ~'],
    ['guard-read-whole-file', `cat ${BIG}`],
    ['guard-secret-value', `curl -H "Authorization: Bearer ${FAKE_JWT}" https://example.test/api`],
    ['guard-ungated-commit', 'git commit -am "wip"'],
    ['guard-config-protection', `echo '{"disableAllHooks": true}' > .claude/settings.local.json`], // stage 1 B11: its switch-off half
    ['guard-config-protection', `sed -i 's/"0"/"1"/' .claude/settings.local.json`], // mode commands v2: no write turns auto-run on
    ['guard-cross-project-write', `echo x > ${path.join(other, 'f.txt')}`],
  ];
  const home = path.join(dir, 'home'); // a HOME inside the project: `rm -rf ~` is then the rm guard's block alone, not the real home's transcripts'
  fs.mkdirSync(home, { recursive: true });
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '', HOME: home, USERPROFILE: home };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{"env":{"ALFRED_CODE_AUTO_RUN":"0"}}\n');
  for (const [guard, command] of cases)
  {
    const session = `each-${guard}`;
    const payload = { ...bashPayload(command, dir), session_id: session };
    const alone = run(path.join(HOOKS, `${guard}.js`), payload, { cwd: dir, env });
    // the guards in ASKING ask where a person can answer (guards ask, D1, D2)
    const verdict = ASKING.has(guard) ? 'ask' : 2;
    assert.strictEqual(verdictOf(alone), verdict, `${guard} blocks '${command}' on its own: ${alone.stderr}${alone.stdout}`);
    for (const d of ['docs', 'state', 'statistics']) fs.rmSync(path.join(dir, '.alfred', d), { recursive: true, force: true });
    const both = run(DISPATCH, payload, { cwd: dir, env });
    // a force push is also a push without the publish gate: both guards ask, and the one prompt carries both reasons
    assert.strictEqual(verdictOf(both), verdict, `${guard}: the dispatcher blocks too`);
    const said = (x) => (verdict === 2 ? x.stderr : blockText(x));
    assert.ok(said(both).includes(said(alone).trim()), `${guard}: its own message reaches the model\n--- alone\n${said(alone)}\n--- dispatched\n${said(both)}`);
    assert.ok(hooksOf(ledgerRows(dir, session)).includes(`${guard}.js`), `${guard}: one ledger row under its own name`);
  }
});

test('docs-session\'s hold reaches the combined answer as the JSON deny it always was', () => {
  const { repo, section } = require('./docs-fixture');
  const docs = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n', '.claude/alfred-code.stamp': 'version: 2.0.0\n' }, docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') } });
  // docs-session keeps its session state in the temp dir by session id, so every run needs its own.
  const session = `docs-hold-${process.pid}-${Date.now()}`;
  try {
    const env = { CLAUDE_PROJECT_DIR: docs.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_DOCS_VERSIONING: '' };
    const payload = { ...bashPayload("cat > src/Api/Orders/Refund.cs <<'EOF'\nclass Refund {}\nEOF", docs.root), session_id: session };
    const out = run(DISPATCH, payload, { cwd: docs.root, env });
    assert.strictEqual(out.status, 0);
    const hso = JSON.parse(out.stdout).hookSpecificOutput;
    assert.strictEqual(hso.permissionDecision, 'deny');
    assert.match(hso.permissionDecisionReason, /Docs not read yet in this session/);
  } finally {
    docs.rm();
    for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(`docs-session-${session}`)) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  }
});

test('several guards blocking one command: every reason, one ledger row per blocking guard', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir };
  // Two NON-protective blocks: a protective one ends the run where it stands (2.1.5 M2, below).
  const payload = bashPayload(`cat ${BIG} && git commit -am "wip"`, dir);
  // What the separate hooks do with it: each guard standalone, its ledger cleared after.
  const alone = shell.GUARDS.map((g) => ({ g, ...run(path.join(HOOKS, `${g}.js`), payload, { cwd: dir, env }) })).filter((x) => verdictOf(x) !== 0);
  for (const d of ['docs', 'state', 'statistics']) fs.rmSync(path.join(dir, '.alfred', d), { recursive: true, force: true });
  assert.ok(alone.length >= 2 && alone.some((x) => x.g === 'guard-read-whole-file') && alone.some((x) => x.g === 'guard-ungated-commit'), alone.map((x) => x.g).join(', '));
  const out = run(DISPATCH, payload, { cwd: dir, env });
  // the read guard and the commit guard both ask: one prompt names both, and the model text carries both reasons
  assert.strictEqual(verdictOf(out), 'ask', `${out.stdout}${out.stderr}`);
  for (const x of alone) {
    assert.ok(askText(out).includes(askText(x).trim()), `${x.g}'s line is in the one prompt`);
    assert.ok(blockText(out).includes(blockText(x).trim()), `${x.g}'s reason is in the model text`);
  }
  assert.deepStrictEqual(hooksOf(ledgerRows(dir)), alone.map((x) => `${x.g}.js`).sort());
});

test('a guard\'s ledger detail never leaks into the next guard\'s row', () => {
  // `global.BLOCK_DETAIL` is a process global, and runGuard put back argv, env, exit and the streams but
  // not globals: a staged-scan block chained with a cross-project write wrote the cross-project row with
  // the staged-scan detail (the 2026-09-26 hooks review).
  const dir = project();
  const other = fs.mkdtempSync(path.join(TMP, 'other-'));
  fs.writeFileSync(path.join(dir, 'd.js'), 'debugger;\n');
  git(dir, 'add', 'd.js');
  const out = run(DISPATCH, bashPayload(`git commit -m x && echo x > ${path.join(other, 'f.txt')}`, dir),
    { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' } });
  assert.strictEqual(verdictOf(out), 'ask', 'both guards ask: one prompt');
  const rows = ledgerRows(dir).filter((x) => !x.mode);
  const commit = rows.find((x) => x.hook === 'guard-ungated-commit.js');
  const cross = rows.find((x) => x.hook === 'guard-cross-project-write.js');
  assert.deepStrictEqual(commit && commit.detail, { branch: 'staged-scan', count: 1 }, 'the commit guard names its branch');
  assert.ok(cross, 'the cross-project write blocks too');
  // its own branch since audit 2026-10-20 (the hooks track's minor list), never the commit guard's detail
  assert.deepStrictEqual(cross.detail, { branch: 'shell-write' }, 'and its row carries none of the commit guard\'s detail');

  const probe = path.join(TMP, 'detail-probe.js');
  fs.writeFileSync(probe, "process.stdout.write(global.BLOCK_DETAIL === undefined ? 'clean' : 'leaked');\nglobal.BLOCK_DETAIL = { from: 'probe' };\nprocess.exit(2);\n");
  global.BLOCK_DETAIL = { stale: true };
  const first = shell.runGuard(probe, Buffer.from('{}'));
  assert.strictEqual(first.stdout, 'clean', 'a guard starts with no detail');
  assert.strictEqual(global.BLOCK_DETAIL, undefined, 'and leaves none behind');
});

test('an ordinary command passes silently', () => {
  const dir = project();
  const out = run(DISPATCH, bashPayload('git status', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.deepStrictEqual(out, { status: 0, stdout: '', stderr: '' });
  // a slow runner may log the dispatcher's slow probe (HK15, its own tests below) - log only, never a decision
  assert.deepStrictEqual(ledgerRows(dir).filter((r) => r.kind !== 'slow'), []);
});

test('empty or malformed input: every guard fails open, the dispatcher says nothing and writes nothing', () => {
  const dir = project();
  for (const input of ['', 'not json', '{}', '[1,2]', JSON.stringify({ tool_name: 'Bash' }), JSON.stringify({ tool_name: 'Bash', tool_input: { command: '' } })])
  {
    const r = spawnSync(process.execPath, [DISPATCH], { input, encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.deepStrictEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, { status: 0, stdout: '', stderr: '' }, `input ${JSON.stringify(input)}`);
  }
  assert.ok(!fs.existsSync(path.join(dir, '.alfred', 'statistics', 'hook-blocks')), 'no ledger row');
});

test('PowerShell is the same shell route', () => {
  const dir = project();
  const out = run(DISPATCH, bashPayload('Remove-Item -Recurse -Force $HOME', dir, 'PowerShell'), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.strictEqual(verdictOf(out), 'ask');
  assert.match(blockText(out), /recursive rm of a catastrophic/);
});

test('a protective block is answered at once - a guard that stalls after it cannot drop it (2.1.5 M2)', () => {
  // A timed-out command hook does not block the call (hooks reference), so one stalled guard used to
  // discard the rm, secret and force-push verdicts already reached. The stub sleeps far past the budget.
  const copy = path.join(TMP, 'staller');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'guard-read-whole-file.js'),
    "'use strict';\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);\n");
  const dir = project();
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(copy, 'shell-guards.js')], {
    input: JSON.stringify({ ...bashPayload('rm -rf ~ && git commit -am "wip"', dir), permission_mode: 'dontAsk' }), encoding: 'utf8', cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 15000,
  });
  // where nobody can answer the rm guard denies, and a deny is answered at once (an ask lets every guard judge - next test)
  assert.strictEqual(verdictOf(res), 'deny', `the rm block arrives before the stalled guard runs (status ${res.status}, ${Date.now() - started}ms)`);
  assert.match(blockText(res), /recursive rm of a catastrophic/);
  assert.doesNotMatch(blockText(res), /COMMIT-GATE/, 'a guard after the protective block never ran');
  assert.deepStrictEqual(hooksOf(ledgerRows(dir)), ['guard-catastrophic-rm.js'], 'one row, the protective guard\'s own');
  const prelude = require(path.join(HOOKS, 'hook-prelude.js'));
  assert.deepStrictEqual([...shell.PROTECTIVE].sort(), shell.GUARDS.filter((g) => prelude.PROTECTIVE.has(g)).sort(),
    'the dispatcher\'s protective set is the prelude\'s, on the shell route');
});

test('a protective ask lets every guard judge; a protective deny is answered at once', () => {
  const dir = project();
  const home = path.join(dir, 'home'); // inside the project, so no other guard objects to its removal
  fs.mkdirSync(home, { recursive: true });
  // the commit guard's push half is switched off: it is no protective guard and still blocks with exit 2 until it asks too
  const env = { CLAUDE_PROJECT_DIR: dir, HOME: home, USERPROFILE: home, ALFRED_CODE_HOOKS_OFF: 'guard-ungated-commit:push' };
  const command = 'rm -rf ~ && git push --force origin main';
  const asked = run(DISPATCH, { ...bashPayload(command, dir), session_id: 'prot-ask' }, { cwd: dir, env });
  assert.strictEqual(verdictOf(asked), 'ask', asked.stdout + asked.stderr);
  assert.match(askText(asked), /guard-catastrophic-rm/, 'the one prompt names the rm guard');
  assert.match(askText(asked), /guard-protected-force-push/, '... and the force-push guard');
  assert.deepStrictEqual(hooksOf(ledgerRows(dir, 'prot-ask')), ['guard-catastrophic-rm.js', 'guard-protected-force-push.js'], 'one ledger row per guard');
  const denied = run(DISPATCH, { ...bashPayload(command, dir), session_id: 'prot-deny', permission_mode: 'dontAsk' }, { cwd: dir, env });
  assert.strictEqual(verdictOf(denied), 'deny');
  const first = shell.RUN_ORDER.find((g) => ['guard-catastrophic-rm', 'guard-protected-force-push'].includes(g));
  assert.deepStrictEqual(hooksOf(ledgerRows(dir, 'prot-deny')), [`${first}.js`], 'a deny ends the run at the first protective guard that blocks');
});

test('a throwing guard fails open for itself only - the others still judge', () => {
  const copy = path.join(TMP, 'thrower');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'guard-read-whole-file.js'), "'use strict';\nthrow new TypeError('boom from a broken guard');\n");
  const dir = project();
  const blocked = run(path.join(copy, 'shell-guards.js'), bashPayload('rm -rf ~', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.strictEqual(verdictOf(blocked), 'ask', 'the rm guard still blocks');
  assert.match(blockText(blocked), /recursive rm of a catastrophic/);
  const open = run(path.join(copy, 'shell-guards.js'), bashPayload('git status', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.strictEqual(open.status, 0, 'the throw blocks nothing');
  assert.match(JSON.parse(open.stdout).systemMessage, /guard-read-whole-file\.js.*boom from a broken guard/);
});

test('the csv opt-out switches off one guard inside the dispatcher, not its neighbours', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_HOOKS_OFF: 'guard-catastrophic-rm' };
  assert.strictEqual(verdictOf(run(DISPATCH, bashPayload('rm -rf .', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })), 'ask', 'only the rm guard blocks this one');
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf .', dir), { cwd: dir, env }).status, 0, 'the named guard stands down');
  assert.strictEqual(verdictOf(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env })), 'ask', 'the commit gate still judges');
});

test('a repo never set up keeps only the rm, secret and force-push guards, writing no row', () => {
  const dir = project('unset-');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const rm = run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env });
  assert.strictEqual(verdictOf(rm), 'ask', 'a protective guard stays live');
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env }).status, 0, 'the commit gate stands down');
  for (const d of ['docs', 'state', 'statistics']) assert.ok(!fs.existsSync(path.join(dir, '.alfred', d)), `nothing is written into a repo merely opened (${d}/)`);
});

test('hook_profile minimal keeps the protective three inside the dispatcher', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' };
  assert.strictEqual(verdictOf(run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env })), 'ask');
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env }).status, 0);
});

test('the plugin dispatcher steps aside for a wired copy of itself; the copy judges', () => {
  const dir = project();
  // HK-02: a twin is its file on disk, wired on the plugin row's event and every tool of its matcher
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  fs.copyFileSync(DISPATCH, path.join(dir, '.claude', 'hooks', 'shell-guards.js'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell|Monitor', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/shell-guards.js"', timeout: 80 }] }] } }));
  const plugin = run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
  assert.deepStrictEqual(plugin, { status: 0, stdout: '', stderr: '' });
  assert.strictEqual(verdictOf(run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } })), 'ask');
});

test('an old per-guard copy still wired: the plugin dispatcher skips exactly that guard', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  fs.copyFileSync(path.join(HOOKS, 'guard-catastrophic-rm.js'), path.join(dir, '.claude', 'hooks', 'guard-catastrophic-rm.js'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell|Monitor', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-catastrophic-rm.js"', timeout: 10 }] }] } }));
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf .', dir), { cwd: dir, env }).status, 0, 'the copied twin judges rm, not the plugin');
  assert.strictEqual(verdictOf(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env })), 'ask', 'every other guard still runs here');
});

test('in-process, every guard\'s stand-down ends it where it stands - no exit is swallowed', () => {
  const dir = project();
  const stdin = Buffer.from(JSON.stringify(bashPayload('rm -rf ~ && git commit -am "wip"', dir)));
  const saved = { ...process.env };
  // a home of its own with no plugins folder: `rm -rf ~` then takes no installed plugin code with it
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-home-'));
  try {
    process.env.CLAUDE_PROJECT_DIR = dir;
    Object.assign(process.env, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') });
    for (const [label, env] of [['csv', { ALFRED_CODE_HOOKS_OFF: shell.GUARDS.join(',') }], ['minimal', { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }]]) {
      Object.assign(process.env, env);
      for (const g of shell.GUARDS) {
        const res = shell.runGuard(path.join(HOOKS, `${g}.js`), stdin);
        assert.ok(!res.swallowed, `${label}: ${g} ran on past its exit`);
        const protective = ['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push'].includes(g);
        if (label === 'csv' || !protective) assert.deepStrictEqual([res.code, res.stdout, res.stderr], [0, '', ''], `${label}: ${g} stood down`);
      }
      for (const k of Object.keys(env)) delete process.env[k];
      if (label === 'csv') assert.deepStrictEqual(ledgerRows(dir), [], 'a stood-down guard writes no row');
    }
    // a home holding installed plugin code: the cross guard's plugin half judges under every stand-down (the user's ruling
    // of 2026-11-03), and its exit still ends it where it stands
    fs.mkdirSync(path.join(home, '.claude', 'plugins', 'cache'), { recursive: true });
    for (const env of [{ ALFRED_CODE_HOOKS_OFF: shell.GUARDS.join(',') }, { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }]) {
      Object.assign(process.env, env);
      const res = shell.runGuard(path.join(HOOKS, 'guard-cross-project-write.js'), stdin);
      assert.ok(!res.swallowed, 'the plugin half ran on past its exit');
      assert.strictEqual(verdictOf({ status: res.code, stdout: res.stdout, stderr: res.stderr }), 'ask', `the plugin half asks under ${JSON.stringify(env)}`);
      assert.match(blockText(res), /installed plugins/);
      for (const k of Object.keys(env)) delete process.env[k];
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    fs.rmSync(home, { recursive: true, force: true });
  }
  assert.deepStrictEqual(hooksOf(ledgerRows(dir)).filter((h) => h !== 'guard-cross-project-write.js'), ['guard-catastrophic-rm.js'], 'under minimal the protective rm guard still blocks, and logs it');
});

test('a guard list in the wiring runs exactly those guards', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir };
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env, args: ['guard-ungated-commit'] }).status, 0);
  assert.strictEqual(verdictOf(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env, args: ['guard-ungated-commit'] })), 'ask');
});

// Swap 1 (2026-11-11): the secret guard rewrites nothing any more. A payload naming no transcript is its core mode,
// where a command whose words name a credential file is refused; the stub-guard fixtures above still pin the rewrite merge.
test('the secret guard\'s denial reaches the call through the dispatcher, and no rewrite is written', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir };
  fs.writeFileSync(path.join(dir, '.env'), `API_TOKEN=${'x0'.repeat(20)}\n`);
  const payload = bashPayload('cat .env', dir);
  const alone = run(path.join(HOOKS, 'guard-secret-value.js'), payload, { cwd: dir, env });
  const both = run(DISPATCH, payload, { cwd: dir, env });
  assert.strictEqual(verdictOf(alone), 'ask', alone.stdout);
  assert.strictEqual(verdictOf(both), 'ask', both.stdout);
  assert.ok(blockText(both).includes(blockText(alone).trim()), 'the denial is the secret guard\'s own text');
  assert.ok(!both.stdout.includes('updatedInput') && !alone.stdout.includes('updatedInput'), 'nothing is rewritten');
  // an environment print passes as written: its output is the masker's to cover, never a rewrite
  const print = run(DISPATCH, bashPayload('echo $SENTRY_ACCESS_TOKEN', dir), { cwd: dir, env });
  assert.strictEqual(print.status, 0, print.stderr);
  assert.ok(!print.stdout.includes('updatedInput'), 'no rewrite of a variable print');
});

// ---- the file-guard dispatcher (2.1.5 M3) -------------------------------------------------------
// The file tools paid one process per guard - a Read three, an Edit or a Write three - through a shell. The
// same in-process runtime now runs them as ONE hook; each guard judges only the tools its own row named.
const FILES = path.join(HOOKS, 'file-guards.js');
const filePayload = (tool, input, cwd, session = 'fg') => ({ session_id: session, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd });

test('file-guards wiringRows: every guard\'s own file-tool row folds into ONE dispatcher row, on the tools the folded guards match', () => {
  const fg = require(FILES);
  const rows = ['a.js::@Stop', 'guard-read-whole-file.js::Read', 'guard-secret-value.js::Read', 'guard-read-whole-file.js::Bash|PowerShell|Monitor',
    'guard-secret-value.js::Grep', 'guard-config-protection.js::Write|Edit|MultiEdit|NotebookEdit', 'guard-cross-project-write.js::Write|Edit|MultiEdit|NotebookEdit',
    'docs-session.js::Read|Edit|Write|MultiEdit|NotebookEdit|Grep', 'docs-session.js::@Stop', 'instrument-tool-usage.js::.*'];
  assert.deepStrictEqual(fg.wiringRows(rows), ['a.js::@Stop', `file-guards.js::${fg.MATCHER}`, 'guard-read-whole-file.js::Bash|PowerShell|Monitor', 'docs-session.js::@Stop', 'instrument-tool-usage.js::.*']);
  assert.strictEqual(fg.MATCHER, 'Read|Edit|Write|MultiEdit|NotebookEdit|Grep', 'no Glob: nothing in the dispatcher judges one');
  // A strict subset is named in the args, and the wiring matches only the tools those guards judge.
  assert.deepStrictEqual(fg.wiringRows(['guard-config-protection.js::Write|Edit|MultiEdit|NotebookEdit'], { listGuards: true }),
    ['file-guards.js::Edit|Write|MultiEdit|NotebookEdit::guard-config-protection'], 'no Read spawn for a write guard');
  assert.deepStrictEqual(fg.wiringRows(['guard-secret-value.js::Read', 'guard-secret-value.js::Grep'], { listGuards: true }), ['file-guards.js::Read|Grep::guard-secret-value']);
  // A row naming a tool its guard's table does not is left alone, and so is one with args.
  assert.deepStrictEqual(fg.wiringRows(['guard-read-whole-file.js::Read|Write', 'docs-session.js::Read::x']), ['guard-read-whole-file.js::Read|Write', 'docs-session.js::Read::x']);
  assert.deepStrictEqual(fg.wiringRows(['a.js::@Stop']), ['a.js::@Stop'], 'no file row, no dispatcher');
});

test('file-guards: the table is the manifest\'s own file-tool rows, and nothing else PreToolUse sits on a file tool but instrumentation', () => {
  const fg = require(FILES);
  const { loadManifest } = require('./install/manifest.js');
  const rows = loadManifest(path.join(__dirname, '..')).catalogs.hooks.map((row) => row.replace(/::$/, ''));
  for (const [g, tools] of fg.GUARDS)
  {
    const own = rows.filter((r) => r.startsWith(`${g}.js::`) && !/::@/.test(r)).map((r) => r.split('::')[1]).filter((m) => m.split('|').every((t) => fg.MATCHER.split('|').includes(t)));
    assert.deepStrictEqual([...new Set(own.flatMap((m) => m.split('|')))].sort(), [...tools].sort(), `${g}: the table matches its manifest rows`);
  }
  const onFiles = rows.filter((row) => { const m = row.split('::')[1] || ''; return !m.startsWith('@') && m.split('|').some((t) => fg.MATCHER.split('|').includes(t)); });
  assert.deepStrictEqual(onFiles.filter((row) => !fg.NAMES.includes(row.split('::')[0].replace(/\.js$/, ''))), [], 'a file-tool wiring outside the dispatcher is a second process per call');
});

test('file-guards: the core entry launches ONE process per file-tool call, with the summed timeout, beside the shell dispatcher', () => {
  const fg = require(FILES);
  const build = require('./build-marketplace.js');
  const block = build.hooksBlock(build.parseHookWirings());
  const onFile = (tool) => block.PreToolUse.filter((g) => g.matcher === undefined || new RegExp(`^(?:${g.matcher})$`).test(tool)).flatMap((g) => g.hooks.map((h) => [h.command, ...(h.args || [])].join(' ')));
  for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep'])
    assert.deepStrictEqual(onFile(tool), ['node ${CLAUDE_PLUGIN_ROOT}/stack/hooks/file-guards.js', 'node ${CLAUDE_PLUGIN_ROOT}/stack/hooks/instrument-tool-usage.js'], `${tool}: the dispatcher and instrumentation only`);
  assert.deepStrictEqual(onFile('Glob'), ['node ${CLAUDE_PLUGIN_ROOT}/stack/hooks/instrument-tool-usage.js'], 'a Glob starts no dispatcher (deep hooks review 2026-10-16)');
  const group = block.PreToolUse.find((g) => g.matcher === fg.MATCHER);
  assert.strictEqual(group.hooks[0].timeout, 10 * fg.GUARDS.length, 'every guard keeps the 10s it had as its own hook');
  assert.strictEqual(require('./install/settings.js').timeoutFor('file-guards.js', 'PreToolUse'), 10 * fg.GUARDS.length);
});

test('file-guards: each guard\'s block reaches the combined answer through the dispatcher, with its own ledger row', () => {
  const dir = project();
  const other = fs.mkdtempSync(path.join(TMP, 'fg-other-'));
  fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { SENTRY_ACCESS_TOKEN: 'x0'.repeat(20) } }, null, 2));
  const cases = [
    ['guard-read-whole-file', 'Read', { file_path: BIG }],
    ['guard-secret-value', 'Read', { file_path: path.join(dir, 'settings.local.json') }, { permission_mode: 'bypassPermissions' }], // where nobody can answer the ask: a block
    ['guard-config-protection', 'Write', { file_path: path.join(dir, '.claude', 'settings.local.json'), content: '{ "disableAllHooks": true }' }], // stage 1 B11: its switch-off half
    ['guard-cross-project-write', 'Write', { file_path: path.join(other, 'f.txt'), content: 'x' }],
  ];
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' };
  for (const [guard, tool, input, more] of cases)
  {
    const session = `fg-${guard}`;
    const payload = { ...filePayload(tool, input, dir, session), ...more };
    const alone = run(path.join(HOOKS, `${guard}.js`), payload, { cwd: dir, env });
    // the secret case runs under bypassPermissions: a deny, one JSON object; the read, config and cross-project guards ask (D1, D2)
    const verdict = guard === 'guard-secret-value' ? 'deny' : 'ask';
    assert.strictEqual(verdictOf(alone), verdict, `${guard} blocks ${tool} on its own: ${alone.stderr}${alone.stdout}`);
    for (const d of ['docs', 'state', 'statistics']) fs.rmSync(path.join(dir, '.alfred', d), { recursive: true, force: true });
    const both = run(FILES, payload, { cwd: dir, env });
    assert.strictEqual(verdictOf(both), verdict, `${guard}: the dispatcher blocks too`);
    const said = (x) => (verdict === 2 ? x.stderr : blockText(x));
    assert.ok(said(both).includes(said(alone).trim()), `${guard}: its own message reaches the model\n--- alone\n${said(alone)}\n--- dispatched\n${said(both)}`);
    assert.deepStrictEqual(hooksOf(ledgerRows(dir, session)), [`${guard}.js`], `${guard}: one ledger row, its own`);
  }
});

test('file-guards: the secret guard\'s ask reaches the host through the dispatcher; a Cursor Read is denied there', () => {
  const dir = project();
  const file = path.join(dir, 'deploy.yaml');
  fs.writeFileSync(file, `users:\n- name: dev\n  user:\n    token: ${'kc-' + 'w6'.repeat(8)}\n`);
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_ENTRYPOINT: 'cli', ALFRED_CODE_UNATTENDED: '' };
  const payload = { ...filePayload('Read', { file_path: file }, dir, 'fg-ask'), permission_mode: 'default', tool_use_id: 'toolu_fg1' };
  const r = run(FILES, payload, { cwd: dir, env });
  assert.strictEqual(r.status, 0, r.stderr);
  const h = JSON.parse(r.stdout).hookSpecificOutput;
  assert.deepStrictEqual([h.hookEventName, h.permissionDecision], ['PreToolUse', 'ask']);
  assert.match(h.permissionDecisionReason, /in this transcript permanently/);
  assert.ok(ledgerRows(dir, 'fg-ask').some((x) => x.hook === 'guard-secret-value.js' && x.mode === 'ask' && x.tool_use_id === 'toolu_fg1'), 'the ask row');
  const cursor = run(FILES, { ...payload, session_id: 'fg-ask-cursor', cursor_version: '2.1.0', hook_event_name: 'preToolUse' }, { cwd: dir, env });
  assert.strictEqual(cursor.status, 2, 'a Cursor Read is denied');
  assert.match(cursor.stderr, /nobody can answer an ask here/);
  assert.doesNotMatch(cursor.stdout, /permissionDecision/);
});

test('file-guards: a guard never judges a tool its row did not name; an ordinary call and garbage pass silently', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' };
  // The read guard is wired on Read only: a Write of a large file is not its business.
  const big = run(FILES, filePayload('Write', { file_path: path.join(dir, 'big.js'), content: fs.readFileSync(BIG, 'utf8') }, dir, 'fg-big'), { cwd: dir, env });
  assert.deepStrictEqual([big.status, hooksOf(ledgerRows(dir, 'fg-big'))], [0, []], 'the read guard never judged the Write');
  const plain = run(FILES, filePayload('Read', { file_path: path.join(dir, 'a.txt') }, dir, 'fg-plain'), { cwd: dir, env });
  assert.deepStrictEqual([plain.status, plain.stdout, plain.stderr], [0, '', ''], 'an ordinary Read: nothing to say');
  for (const input of ['', '{oops', 'null', '42'])
  {
    const r = spawnSync(process.execPath, [FILES], { input, encoding: 'utf8', cwd: dir, env: { ...process.env, ...env } });
    assert.deepStrictEqual([r.status, r.stdout, r.stderr], [0, '', ''], `garbage ${JSON.stringify(input)} fails open, silently`);
  }
});

test('file-guards sends one additionalContext for an edit that two guards note', () => {
  const copy = path.join(TMP, 'fg-two-notes');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'docs-session.js'), "'use strict';\nprocess.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'docs note' } }));\n");
  const home = require('./test-paths').realLong(fs.mkdtempSync(path.join(TMP, 'fg-home-')));
  const dir = path.join(home, 'ws');
  fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'rules', 'cs-style.md'), '---\npaths:\n  - "**/*.cs"\n---\n\nWrite C# in the house style. More.\n');
  fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
  const r = run(path.join(copy, 'file-guards.js'), filePayload('Edit', { file_path: path.join(dir, 'a.cs'), old_string: 'a', new_string: 'b' }, dir, 'fg-two'),
    { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, HOME: home, USERPROFILE: home } });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.strictEqual(out.hookEventName, 'PreToolUse');
  assert.strictEqual(out.additionalContext, 'docs note\nRules for a.cs (key lines - the full text is in context):\n- cs-style: Write C# in the house style.', 'one block, the guards\' notes in manifest order');
  const read = run(path.join(copy, 'file-guards.js'), filePayload('Read', { file_path: path.join(dir, 'a.cs') }, dir, 'fg-two-read'),
    { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, HOME: home, USERPROFILE: home } });
  assert.strictEqual(read.stdout.includes('Rules for'), false, 'a Read gets no reminder');
});

test('file-guards: the protective secret guard is answered at once, and a guard list in the wiring runs exactly those guards', () => {
  const copy = path.join(TMP, 'fg-staller');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'docs-session.js'), "'use strict';\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);\n");
  const dir = project();
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=abc123\n');
  const r = spawnSync(process.execPath, [path.join(copy, 'file-guards.js')], {
    input: JSON.stringify({ ...filePayload('Read', { file_path: path.join(dir, '.env') }, dir, 'fg-prot'), permission_mode: 'bypassPermissions' }), encoding: 'utf8', cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 15000,
  });
  assert.strictEqual(verdictOf(r), 'deny', `the secret block arrives before the stalled guard runs (status ${r.status})`);
  assert.deepStrictEqual(hooksOf(ledgerRows(dir, 'fg-prot')), ['guard-secret-value.js']);
  // Named in the args: only that guard judges.
  const only = run(FILES, filePayload('Read', { file_path: BIG }, dir, 'fg-only'), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir }, args: ['guard-secret-value'] });
  assert.deepStrictEqual([only.status, hooksOf(ledgerRows(dir, 'fg-only'))], [0, []], 'the read guard was not in the list');
});

// The 2.1.5 hooks review: the secret guard ran after the read guard, so a read guard stalling past the budget dropped
// the secret block too - the M2 shape again. Both dispatchers RUN the protective guards first; the answer keeps the
// manifest order for its messages.
test('both dispatchers run every protective guard before any other, the rest in manifest order', () => {
  const fg = require(FILES);
  const prelude = require(path.join(HOOKS, 'hook-prelude.js'));
  for (const [name, table, order, protective] of [['shell-guards', shell.GUARDS, shell.RUN_ORDER, shell.PROTECTIVE], ['file-guards', fg.NAMES, fg.RUN_ORDER, fg.PROTECTIVE]])
  {
    assert.deepStrictEqual([...order].sort(), [...table].sort(), `${name}: the run order holds every guard once`);
    const firstOther = order.findIndex((g) => !protective.has(g));
    assert.ok(order.slice(firstOther).every((g) => !protective.has(g)), `${name}: no protective guard runs after another guard: ${order.join(', ')}`);
    assert.deepStrictEqual(order.slice(firstOther), table.filter((g) => !protective.has(g)), `${name}: the rest keep the manifest order`);
    assert.deepStrictEqual([...protective].sort(), table.filter((g) => prelude.PROTECTIVE.has(g)).sort(), `${name}: its protective set is the prelude's`);
  }
});

test('a stalled guard ahead of the secret guard in the manifest cannot drop its block, on either dispatcher', () => {
  const copy = path.join(TMP, 'staller-read');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'guard-read-whole-file.js'), "'use strict';\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);\n");
  const dir = project();
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=abc123abc123abc123\n');
  const spawnIt = (file, payload) => spawnSync(process.execPath, [path.join(copy, file)], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 15000,
  });
  const read = spawnIt('file-guards.js', { ...filePayload('Read', { file_path: path.join(dir, '.env') }, dir, 'stall-read'), permission_mode: 'bypassPermissions' });
  assert.strictEqual(verdictOf(read), 'deny', `file-guards: the secret block arrives though the read guard stalls (status ${read.status})`);
  assert.deepStrictEqual(hooksOf(ledgerRows(dir, 'stall-read')), ['guard-secret-value.js']);
  // a second read that PRINTS the file forces the whole-command rewrite, which would drop the build - a block, not a
  // splice (a count of it no longer forces it: audit 2026-10-11 SD01)
  const sh = spawnIt('shell-guards.js', { ...bashPayload('cat .env && head -1 .env && npm run build', dir), session_id: 'stall-bash', permission_mode: 'dontAsk' });
  assert.strictEqual(verdictOf(sh), 'deny', `shell-guards: the secret block arrives though the read guard stalls (status ${sh.status})`);
  assert.deepStrictEqual(hooksOf(ledgerRows(dir, 'stall-bash')), ['guard-secret-value.js']);
});

test('file-guards copy route: the dispatcher replaces the per-guard file rows an older install wrote, and a re-run changes nothing', () => {
  const settings = require('./install/settings.js');
  const fg = require(FILES);
  const dir = fs.mkdtempSync(path.join(TMP, 'fg-copy-'));
  const file = path.join(dir, 'settings.json');
  const cmd = (f) => `"$CLAUDE_PROJECT_DIR/.claude/hooks/${f}"`;
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [
    { matcher: 'Read', hooks: [{ type: 'command', command: cmd('guard-read-whole-file.js'), timeout: 10 }] },
    { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: cmd('guard-config-protection.js'), timeout: 10 }] },
    { matcher: 'Read', hooks: [{ type: 'command', command: 'node ./my-own-read-hook.js', timeout: 5 }] },
  ] } }, null, 2));
  const specs = ['guard-read-whole-file.js::Read', 'guard-config-protection.js::Write|Edit|MultiEdit|NotebookEdit', 'guard-config-protection.js::Bash|PowerShell|Monitor'];
  settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} });
  const wired = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => `${e.matcher}  ${h.command}  ${h.timeout}`));
  assert.deepStrictEqual(wired.sort(), [
    `Read  node ./my-own-read-hook.js  5`,
    `Bash|PowerShell|Monitor  ${cmd('shell-guards.js')} guard-config-protection  ${10 * shell.GUARDS.length}`,
    `Read|Edit|Write|MultiEdit|NotebookEdit  ${cmd('file-guards.js')} guard-read-whole-file guard-config-protection  ${10 * fg.GUARDS.length}`,
  ].sort());
  const before = fs.readFileSync(file, 'utf8');
  assert.strictEqual(settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} }).written, false, 'the re-run writes nothing');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'idempotent');
});

test('the docs label every shell guard with the shell route, never Bash alone (2.1.5 final review R2)', () => {
  // CLAUDE.md said `(PreToolUse \`Bash\`)` for the rm and commit guards beside siblings saying 'the shell route', and
  // the HTML matcher cells read `Bash` / `Read + Bash` for all eight (no PowerShell, no Monitor, no Grep row).
  const md = require('./claude-docs.js').readClaudeDocs();
  for (const g of ['guard-catastrophic-rm', 'guard-ungated-commit'])
    assert.match(md, new RegExp(`\`${g}\\.js\` \\(PreToolUse, the shell route\\)`), `CLAUDE.md: ${g}`);
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'alfred-code.html'), 'utf8');
  for (const g of shell.GUARDS) {
    const cell = (html.match(new RegExp(`\\["${g}", "([^"]*)"`)) || [])[1];
    assert.ok(cell !== undefined, `the HTML has a ${g} row`);
    assert.match(cell, /the shell route/, `${g}: the matcher cell names the shell route - ${cell}`);
  }
  assert.match((html.match(/\["guard-secret-value", "([^"]*)"/) || [])[1], /Grep/, 'the secret guard\'s Grep row is named');
});

// ---------------------------------------------------------------------------------------------
// audit 2026-10-10 (C14, C25, T5 cross-track): the dispatcher's own checks - zsh quoting, the foreground poll loop,
// an unaddressed sed -i over several lines
// ---------------------------------------------------------------------------------------------
const own = (dir, command, { env = {}, extra = {}, mode } = {}) => {
  const r = run(DISPATCH, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command, ...extra }, session_id: 'own', cwd: dir, ...(mode ? { permission_mode: mode } : {}) }, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, ...env } });
  let h = {};
  try { h = JSON.parse(r.stdout).hookSpecificOutput || {}; } catch { h = {}; }
  return { status: r.status, stderr: r.stderr, verdict: verdictOf(r), text: blockText(r), asked: askText(r), command: h.updatedInput ? h.updatedInput.command : null, context: h.additionalContext || '' };
};
const ZSH = { env: { SHELL: '/bin/zsh' } };
const rowsIn = (dir) => { try { return fs.readFileSync(path.join(dir, '.alfred', 'statistics', 'hook-blocks', 'own.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };

test('audit 2026-10-10 C14: under zsh a tool-owned glob and a bare =word are quoted before any guard reads the command', () => {
  const dir = project('zsh-');
  assert.equal(own(dir, 'grep -n --include=*.ts foo a.txt', ZSH).command, "grep -n --include='*.ts' foo a.txt", '7491ab75, 0498718d');
  assert.equal(own(dir, 'grep -n --include=*.{ts,tsx} foo a.txt', ZSH).command, "grep -n --include='*.ts' --include='*.tsx' foo a.txt", 'a brace list, expanded as the shell would');
  assert.equal(own(dir, 'find . -name *.md -type f', ZSH).command, "find . -name '*.md' -type f");
  assert.equal(own(dir, 'echo =====; cat a.txt | head -1', ZSH).command, "echo '====='; cat a.txt | head -1", '458953b8, f10cb06a, db6c1ae1');
  assert.equal(own(dir, '[ "$a" == "b" ] && echo y', ZSH).command, `[ "$a" '==' "b" ] && echo y`);
  for (const c of ["grep -n --include='*.ts' foo a.txt", '[[ $a == b ]] && echo y', '(( 1 == 1 )) && echo y', 'echo "====="', 'X=1; echo $X', "cat <<'EOF'\n=====\n--include=*.ts\nEOF"])
    assert.equal(own(dir, c, ZSH).command, null, `left as written: ${c}`);
  assert.equal(own(dir, 'grep -n --include=*.ts foo a.txt', { env: { SHELL: '/bin/bash' } }).command, null, 'bash leaves an unmatched glob as written');
  assert.ok(rowsIn(dir).some((r) => r.mode === 'rewrite' && r.detail.branch === 'zsh-quote'), 'each rewrite is one rewrite row');
  // audit 2026-10-10 C09: the permission mode a rewrite met is counted
  run(DISPATCH, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo =====' }, session_id: 'own', cwd: dir, permission_mode: 'auto' }, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, SHELL: '/bin/zsh' } });
  assert.equal(rowsIn(dir).filter((r) => r.detail && r.detail.branch === 'zsh-quote').pop().detail.permissionMode, 'auto');
  // the guards judge the fixed command: the commit gate still blocks an unreceipted commit, and nothing else changes
  assert.equal(own(dir, 'echo ===== && git commit -am x', ZSH).verdict, 'ask', 'a block wins over the quoting');
});

test('audit 2026-10-10 C25: a foreground until / while loop that sleeps is blocked, naming the background routes', () => {
  const dir = project('poll-');
  const r = own(dir, 'until grep -q READY run.log; do sleep 5; done');
  assert.equal(r.verdict, 'ask', '516e653d, 3b53e0e8');
  assert.match(r.text, /FOREGROUND wait[\s\S]*run_in_background: true[\s\S]*ToolSearch select:Monitor/, 'the background routes lead');
  assert.doesNotMatch(r.text, /timeout 60 <the loop>/, 'no bounded-loop hint - the model chained them (deep hooks review 2026-10-16)');
  assert.equal(own(dir, 'while true; do curl -s localhost:1 && break; sleep 2; done').verdict, 'ask');
  assert.equal(own(dir, "bash -c 'until test -f done.flag; do sleep 1; done'").verdict, 'ask', 'inside a shell -c string');
  assert.equal(own(dir, 'until grep -q READY run.log; do sleep 5; done', { extra: { run_in_background: true } }).verdict, 0, 'in the background');
  assert.equal(own(dir, 'timeout 60 bash -c "until test -f done.flag; do sleep 1; done"').verdict, 0, 'bounded at 60s');
  assert.equal(own(dir, 'timeout 600 bash -c "until test -f done.flag; do sleep 1; done"').verdict, 'ask', 'a 600s bound is the wait it replaces');
  // hooks review 2026-10-16: the duration takes its unit and the options before it
  for (const t of ['timeout 2m', 'timeout -s KILL 60', 'timeout --signal=KILL 90s', 'timeout -k 5 1m'])
    assert.equal(own(dir, `${t} bash -c "until test -f done.flag; do sleep 1; done"`).verdict, 0, `bounded: ${t}`);
  assert.equal(own(dir, 'timeout 3m bash -c "until test -f done.flag; do sleep 1; done"').verdict, 'ask', 'three minutes is past the bound');
  assert.equal(own(dir, 'while read -r l; do echo "$l"; sleep 0.1; done < a.txt').verdict, 0, 'a read loop reads input');
  assert.equal(own(dir, 'echo "until x; do sleep 1; done"').verdict, 0, 'text in quotes');
  assert.equal(own(dir, 'for i in 1 2 3; do sleep 1; done').verdict, 0, 'a for loop is bounded by its list');
  // deep hooks review 2026-10-16: the turn was freed in 2 of 11 episodes - the loop came back as a tail -f or a chain
  assert.equal(own(dir, 'timeout 280 tail -f run.log').verdict, 'ask', 'a long follow');
  assert.equal(own(dir, 'tail -n 50 -f run.log').verdict, 'ask', 'an unbounded follow');
  assert.equal(own(dir, 'tail -F run.log | grep -m1 READY').verdict, 'ask', 'a follow piped into its sentinel');
  assert.equal(own(dir, 'timeout 90 tail -f run.log').verdict, 0, 'a follow bounded at 90s');
  assert.equal(own(dir, 'tail -n 50 run.log').verdict, 0, 'a plain tail');
  assert.equal(own(dir, 'tail -f run.log', { extra: { run_in_background: true } }).verdict, 0, 'a background follow');
  const chain = 'timeout 110 bash -c "until test -f a; do sleep 5; done"; timeout 110 bash -c "until test -f b; do sleep 5; done"';
  assert.equal(own(dir, chain).verdict, 'ask', 'two 110s waits hold 220s');
  assert.equal(own(dir, 'timeout 60 bash -c "until test -f a; do sleep 1; done"; timeout 60 bash -c "until test -f b; do sleep 1; done"').verdict, 0, 'two 60s waits stay inside 120s');
  assert.ok(rowsIn(dir).some((x) => !x.mode && x.detail && x.detail.branch === 'poll-loop'), 'a block row');
});

// audit 2026-10-14 RU04: the watch mechanics left the always-on quality-gates rule (533 chars every session) for the
// first background call of each actor, where they apply (a background Bash call in 24.8% of sessions).
test('audit 2026-10-14 RU04: the first background Bash call of each actor carries the watch note, once', () => {
  const dir = project('bg-');
  const marks = fs.mkdtempSync(path.join(TMP, 'marks-'));
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_HOOK_LOG_DIR: marks };
  const call = (session, input, { tool = 'Bash', agent } = {}) => {
    const r = run(DISPATCH, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: session, cwd: dir, ...(agent ? { agent_id: agent, agent_type: 'alfred-code:implementer' } : {}) }, { cwd: dir, env });
    let h = {};
    try { h = JSON.parse(r.stdout).hookSpecificOutput || {}; } catch { h = {}; }
    return { status: r.status, context: h.additionalContext || '' };
  };
  const bg = { command: 'npm test > run.log 2>&1', run_in_background: true };
  assert.equal(call('bg1', { command: 'npm test' }).context, '', 'a foreground call says nothing');
  // audit 2026-10-20 C32: a Monitor call carries its own note (MONITOR_NOTE), under its own marker - tested below
  assert.equal(call('bg1', { ...bg, run_in_background: 'true' }).context, '', 'only a real true is a background call');
  const first = call('bg1', bg);
  assert.equal(first.status, 0, 'a note, never a block');
  assert.equal(first.context, shell.BACKGROUND_NOTE);
  // the clauses the rule carried before RU04 (rule-prose M69, F4, C25)
  assert.match(first.context, /one command whose end is all that matters needs nothing more - its exit re-invokes you/);
  assert.match(first.context, /a condition inside a run or across several arms takes the `Monitor` tool when you start it/);
  assert.match(first.context, /`ToolSearch select:Monitor`/);
  assert.match(first.context, /Poll it through `Monitor` or its new lines, never a whole-log re-read\./);
  assert.match(first.context, /never a bare process-name grep; task lists track tasks, not shells\./);
  // the 2026-10-17 usage audit: progress narrated sample by sample (35 finals ~5.07M) or left silent (users asked 3 and 2 times)
  assert.match(first.context, /ONE start line - what runs and when it should finish - then nothing until the result or a failure: one watch whose command ends on either/);
  assert.match(first.context, /never a reply per sample, never silence past the finish time you gave/);
  assert.equal(call('bg1', bg).context, '', 'once per actor');
  assert.equal(call('bg1', bg, { agent: 'a1' }).context, shell.BACKGROUND_NOTE, 'a seat is its own actor');
  assert.equal(call('bg1', bg, { agent: 'a1' }).context, '', 'and hears it once too');
  assert.equal(call('bg2', bg).context, shell.BACKGROUND_NOTE, 'a new session hears it again');
  assert.ok(fs.readdirSync(marks).some((f) => f === 'alfred-bg-note-bg1-main') && fs.readdirSync(marks).some((f) => f === 'alfred-bg-note-bg1-a1'), 'one marker per actor, in the hook temp dir');
  const rows = ledgerRows(dir, 'bg1').filter((x) => x.detail && x.detail.branch === 'bg-note');
  assert.deepEqual(rows.map((x) => x.mode), ['probe', 'probe'], 'one probe row per note');
  assert.strictEqual(rows[0].kind, 'bg-note', 'the probe row names its kind (item 7)');
  // a marker dir that cannot be written: silent, never a note on every call
  const gone = { ...env, ALFRED_CODE_HOOK_LOG_DIR: path.join(marks, 'missing', 'deeper') };
  const r = run(DISPATCH, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: bg, session_id: 'bg3', cwd: dir }, { cwd: dir, env: gone });
  assert.equal(r.status, 0);
  assert.ok(!/Background wait/.test(r.stdout), 'no marker, no note');
  // a block still wins: the note rides beside it
  const blocked = run(DISPATCH, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -am x', run_in_background: true }, session_id: 'bg4', cwd: dir }, { cwd: dir, env });
  assert.equal(verdictOf(blocked), 'ask', 'the commit gate still blocks');
});

// audit 2026-10-20 C32 (7c1af769, 9a0314ed): the note rode only the first background Bash call, an hour before the Monitor
// whose per-sample lines woke 12 and 35 turns - the first Monitor call of each actor now hears the per-wake rule itself.
test('audit 2026-10-20 C32: the first Monitor call of each actor carries the per-wake note, once, beside the Bash note', () => {
  const dir = project('mon-');
  const marks = fs.mkdtempSync(path.join(TMP, 'marks-'));
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_HOOK_LOG_DIR: marks };
  const call = (session, tool, input, agent) => {
    const r = run(DISPATCH, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: session, cwd: dir, ...(agent ? { agent_id: agent, agent_type: 'alfred-code:implementer' } : {}) }, { cwd: dir, env });
    let h = {};
    try { h = JSON.parse(r.stdout).hookSpecificOutput || {}; } catch { h = {}; }
    return { status: r.status, context: h.additionalContext || '' };
  };
  const mon = { command: 'while true; do echo "$(date) $(pgrep -f node | wc -l)"; sleep 30; done', description: 'mem watch' };
  // the shape of 7c1af769: a background Bash heard its note first, the Monitor came later
  assert.equal(call('m1', 'Bash', { command: 'npm run build > b.log 2>&1', run_in_background: true }).context, shell.BACKGROUND_NOTE);
  const first = call('m1', 'Monitor', mon);
  assert.equal(first.status, 0, 'a note, never a block');
  assert.equal(first.context, shell.MONITOR_NOTE);
  assert.match(first.context, /every line this command prints wakes a turn/);
  assert.match(first.context, /never a line per sample/);
  assert.match(first.context, /ONE start line/);
  assert.equal(call('m1', 'Monitor', mon).context, '', 'once per actor');
  assert.equal(call('m1', 'Bash', { command: 'npm test > t.log 2>&1', run_in_background: true }).context, '', 'the Bash note stays once too');
  assert.equal(call('m1', 'Monitor', mon, 'a1').context, shell.MONITOR_NOTE, 'a seat is its own actor');
  // the other order: a Monitor first leaves the background Bash note unspent
  assert.equal(call('m2', 'Monitor', mon).context, shell.MONITOR_NOTE);
  assert.equal(call('m2', 'Bash', { command: 'npm test > t.log 2>&1', run_in_background: true }).context, shell.BACKGROUND_NOTE);
  assert.ok(fs.readdirSync(marks).includes('alfred-bg-note-mon-m1-main'), 'its own marker, under the swept prefix');
  const rows = ledgerRows(dir, 'm1').filter((x) => x.detail && x.detail.branch === 'monitor-note');
  assert.deepEqual(rows.map((x) => x.mode), ['probe', 'probe'], 'one probe row per note (main, a1)');
  assert.strictEqual(rows[0].kind, 'monitor-note', 'the probe row names its kind (item 7)');
});

test('audit 2026-10-10: an unaddressed sed -i s/// over several lines of its file gets a note naming them', () => {
  const dir = project('sed-');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# plan\n- status: TODO\nx\n- status: TODO\n');
  const r = own(dir, "sed -i '' 's/^- status: TODO$/- status: IN_PROGRESS/' plan.md");
  assert.match(r.context, /has no address and its pattern matches 2 lines of plan\.md \(lines 2, 4\)/, '49cb4b82');
  assert.equal(own(dir, "sed -i '' '2s/^- status: TODO$/- status: IN_PROGRESS/' plan.md").context, '', 'an addressed command');
  assert.equal(own(dir, "sed -i '' 's/^# plan$/# Plan/' plan.md").context, '', 'one line matches');
  assert.equal(own(dir, "sed -i '' 's/(/[/' plan.md").context, '', 'a pattern that is not a regex in JS is skipped, never thrown');
  const sedRow = rowsIn(dir).find((x) => x.detail && x.detail.branch === 'sed-multi-match');
  assert.strictEqual(sedRow.kind, 'sed-multi-match', 'the probe row names its kind (item 7)');
});

test('stage 1 A3: a recursive symbol grep in the main session writes no probe row', () => {
  const dir = project('sym-');
  assert.equal(own(dir, 'grep -rn SearchTermNormalizer .').status, 0);
  assert.equal(own(dir, 'grep -rn "cartTotal(" .').status, 0);
  assert.deepStrictEqual(rowsIn(dir).filter((x) => x.mode === 'probe'), [], 'the symbol-grep probe is gone');
});

test('audit 2026-10-10: the dispatcher\'s own checks stand down where the stack does - a repo never set up, hook_profile minimal', () => {
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'unset-')));
  git(bare, 'init', '-q');
  assert.equal(own(bare, 'until test -f x; do sleep 1; done', { env: { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } }).status, 0, 'never set up');
  const dir = project('min-');
  assert.equal(own(dir, 'until test -f x; do sleep 1; done', { env: { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' } }).status, 0, 'minimal');
  assert.equal(own(dir, 'echo =====', { env: { SHELL: '/bin/zsh', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' } }).command, null);
});

// ---------------------------------------------------------------------------------------------
// audit 2026-10-14 HK15: 86 dispatcher runs took 1s or more in a week (max 12,086ms) and no row named the guard that
// spent it - a run past 1,000ms now writes one probe row with each guard's ms
// ---------------------------------------------------------------------------------------------
test('HK15: slowProbe is null at 1,000ms and a probe row one over', () => {
  assert.strictEqual(shell.SLOW_MS, 1000);
  assert.strictEqual(shell.slowProbe({ guards: {} }, 1000), null, 'at the line');
  assert.strictEqual(shell.slowProbe({ guards: {} }, 999), null, 'under it');
  const row = shell.slowProbe({ startup_ms: 30, own_ms: 2, guards: { 'guard-catastrophic-rm': 1 } }, 1001);
  assert.deepStrictEqual(row, { mode: 'probe', kind: 'slow', reason: 'probe: slow - the dispatcher ran 1001ms',
    detail: { branch: 'slow', total_ms: 1001, startup_ms: 30, own_ms: 2, guards: { 'guard-catastrophic-rm': 1 } } });
});

test('HK15: a dispatcher run past 1s writes one slow row naming each guard\'s ms; a fast run and a repo never set up write none', () => {
  const copy = path.join(TMP, 'slowpoke');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'guard-read-whole-file.js'), "'use strict';\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);\n");
  const dir = project('slow-');
  const res = spawnSync(process.execPath, [path.join(copy, 'shell-guards.js')], {
    input: JSON.stringify(bashPayload('ls', dir)), encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 15000,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const slow = ledgerRows(dir).filter((r) => r.kind === 'slow');
  assert.strictEqual(slow.length, 1, JSON.stringify(ledgerRows(dir)));
  assert.strictEqual(slow[0].mode, 'probe');
  assert.strictEqual(slow[0].hook, 'shell-guards.js');
  assert.strictEqual(slow[0].tool, 'Bash');
  assert.ok(slow[0].detail.total_ms > 1000, `total ${slow[0].detail.total_ms}`);
  assert.ok(slow[0].detail.guards['guard-read-whole-file'] >= 1000, 'the stalled guard is named with its own ms');
  assert.deepStrictEqual(Object.keys(slow[0].detail.guards).sort(), [...shell.GUARDS].sort(), 'every guard that ran');
  assert.ok(Number.isInteger(slow[0].detail.startup_ms) && Number.isInteger(slow[0].detail.own_ms));
  // the real dispatcher on an ordinary command stays under the line and writes nothing
  const fast = project('fast-');
  assert.strictEqual(run(DISPATCH, bashPayload('ls', fast), { cwd: fast, env: { CLAUDE_PROJECT_DIR: fast } }).status, 0);
  assert.deepStrictEqual(ledgerRows(fast).filter((r) => r.kind === 'slow'), []);
  // a repo never set up keeps its ledger empty (GATE 4)
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'slow-unset-')));
  git(bare, 'init', '-q');
  spawnSync(process.execPath, [path.join(copy, 'shell-guards.js')], {
    input: JSON.stringify(bashPayload('ls', bare)), encoding: 'utf8', cwd: bare, env: { ...process.env, CLAUDE_PROJECT_DIR: bare, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, timeout: 15000,
  });
  assert.ok(!fs.existsSync(path.join(bare, '.alfred', 'statistics', 'hook-blocks')), 'no row where the stack was never set up');
});

// Deep hooks review 2026-10-16: the dispatcher keeps V8's cached data per guard body under a key of its source and this
// Node. An edited guard compiles afresh (its new verdict, never the cached one), and a corrupt entry is a plain compile.
test('the compile cache never serves an edited guard, and a corrupt entry falls back to a plain compile', () => {
  const dir = project();
  const hooks = fs.mkdtempSync(path.join(TMP, 'hooks-copy-'));
  for (const f of fs.readdirSync(HOOKS)) if (f.endsWith('.js') || f.endsWith('.json')) fs.copyFileSync(path.join(HOOKS, f), path.join(hooks, f));
  const cacheDir = fs.mkdtempSync(path.join(TMP, 'v8-'));
  const env = { CLAUDE_PROJECT_DIR: dir, TMPDIR: cacheDir, TMP: cacheDir, TEMP: cacheDir };
  const SHARED = /rewriting or deleting a shared branch/;
  const push = () => { const r = run(path.join(hooks, 'shell-guards.js'), bashPayload('git push --force origin main', dir), { cwd: dir, env }); return SHARED.test(`${blockText(r)}${r.stderr}`); };
  assert.ok(push(), 'a cold run blocks');
  const entries = () => fs.readdirSync(cacheDir).filter((f) => /^alfred-v8-guard-protected-force-push-[0-9a-f]{16}\.bin$/.test(f));
  assert.equal(entries().length, 1, 'and leaves one entry for the guard');
  assert.ok(push(), 'a warm run blocks the same');
  const guard = path.join(hooks, 'guard-protected-force-push.js');
  const src = fs.readFileSync(guard, 'utf8');
  fs.writeFileSync(guard, src.replace(/^(#!.*\n)?/, (m) => `${m}process.exit(0);\n`));
  assert.ok(!push(), 'the edited guard runs as edited - no stale entry');
  assert.equal(entries().length, 2, 'under a key of its own');
  fs.writeFileSync(guard, src);
  for (const f of entries()) fs.writeFileSync(path.join(cacheDir, f), 'not v8 data');
  assert.ok(push(), 'a corrupt entry is a plain compile with the same verdict');
});

// Hooks audit 2026-11-19 (B11-C1): V8 runs a cache entry after checking only the source's LENGTH, and the key is the hash
// of a public source, so on a temp dir every account shares another one could plant code the dispatcher would run.
// An entry is read only where its owner is this user and no other account can write it, and it is written as 0600.
test('trustedCacheEntry: a regular file this user owns and no other account can write, any file where there is no uid', () => {
  const stat = (over = {}) => ({ isFile: () => true, uid: 501, mode: 0o100600, ...over });
  assert.equal(shell.trustedCacheEntry(stat(), 501), true, 'its own entry');
  assert.equal(shell.trustedCacheEntry(stat({ mode: 0o100644 }), 501), true, 'readable by others is no risk');
  assert.equal(shell.trustedCacheEntry(stat({ uid: 502 }), 501), false, 'another account planted it');
  assert.equal(shell.trustedCacheEntry(stat({ mode: 0o100664 }), 501), false, 'its group can rewrite it');
  assert.equal(shell.trustedCacheEntry(stat({ mode: 0o100666 }), 501), false, 'anyone can rewrite it');
  assert.equal(shell.trustedCacheEntry(stat({ isFile: () => false }), 501), false, 'a link, a FIFO or a folder');
  assert.equal(shell.trustedCacheEntry(stat({ uid: 0, mode: 0o100666 }), undefined), true, 'no uid (Windows): a per-user temp dir');
});

test('a planted cache entry anyone could write never runs: the guard compiles afresh and blocks', { skip: typeof process.getuid !== 'function' && 'no uid on this platform' }, () => {
  const dir = project();
  const cacheDir = fs.mkdtempSync(path.join(TMP, 'v8-planted-'));
  const env = { CLAUDE_PROJECT_DIR: dir, TMPDIR: cacheDir, TMP: cacheDir, TEMP: cacheDir };
  const guard = path.join(HOOKS, 'guard-protected-force-push.js');
  const text = fs.readFileSync(guard, 'utf8').replace(/^#!/, '//');
  const marker = path.join(cacheDir, 'planted-code-ran');
  const planted = new vm.Script(`(function (exports, require, module, __filename, __dirname) {${`require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`.padEnd(text.length)}\n})`, { filename: guard });
  planted.runInThisContext();
  const key = crypto.createHash('sha1').update(`${process.version}\0${text}`).digest('hex').slice(0, 16);
  const entry = path.join(cacheDir, `alfred-v8-guard-protected-force-push-${key}.bin`);
  const SHARED = /rewriting or deleting a shared branch/;
  const push = () => { const r = run(DISPATCH, bashPayload('git push --force origin main', dir), { cwd: dir, env }); return SHARED.test(`${blockText(r)}${r.stderr}`); };
  fs.writeFileSync(entry, planted.createCachedData());
  fs.chmodSync(entry, 0o666);
  assert.ok(push(), 'an entry others can write is a plain compile: the force-push guard still blocks');
  assert.ok(!fs.existsSync(marker), 'and the planted code never ran');
  assert.equal(fs.lstatSync(entry).mode & 0o777, 0o600, 'the entry the run wrote back is its owner\'s alone');
  fs.rmSync(entry);
  const elsewhere = path.join(cacheDir, 'elsewhere.bin');
  fs.writeFileSync(elsewhere, planted.createCachedData(), { mode: 0o600 });
  fs.symlinkSync(elsewhere, entry);
  assert.ok(push(), 'a link in the entry\'s place is no entry');
  assert.ok(!fs.existsSync(marker), 'and its target never ran');
});

// Hooks audit 2026-11-19 (B11-C3, round 2): the save writes `<entry>.<pid>.tmp` first, and a write that followed a link
// planted at that name overwrote the link's target with V8 data. The tmp is created or the save is skipped.
test('the cache save never writes through a link at its tmp name, and saves once the name is free', { skip: process.platform === 'win32' && 'a link needs a privilege there' }, () => {
  const cacheDir = fs.mkdtempSync(path.join(TMP, 'v8-tmp-link-'));
  const probe = path.join(cacheDir, 'probe-guard.js');
  const source = 'process.exit(0);\n';
  fs.writeFileSync(probe, source);
  const key = crypto.createHash('sha1').update(`${process.version}\0${source}`).digest('hex').slice(0, 16);
  const entry = path.join(cacheDir, `alfred-v8-probe-guard-${key}.bin`);
  const tmpName = `${entry}.${process.pid}.tmp`;
  const victim = path.join(cacheDir, 'victim.txt');
  fs.writeFileSync(victim, 'original\n');
  fs.symlinkSync(victim, tmpName);
  const saved = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map((k) => [k, process.env[k]]));
  for (const k of Object.keys(saved)) process.env[k] = cacheDir;
  try
  {
    assert.equal(shell.runGuard(probe, Buffer.from('{}')).code, 0, 'the guard runs');
    assert.equal(fs.readFileSync(victim, 'utf8'), 'original\n', 'the link\'s target is untouched');
    assert.ok(!fs.existsSync(entry), 'and the save is skipped');
    fs.unlinkSync(tmpName);
    assert.equal(shell.runGuard(probe, Buffer.from('{}')).code, 0, 'the guard runs again');
    assert.equal(fs.lstatSync(entry).mode & 0o777, 0o600, 'with the name free the entry is written, its owner\'s alone');
  }
  finally
  {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// Audit 2026-10-20 A-T1: a read-only seat carries Bash, and a verifier's `git reset -q` unstaged a user's `git rm` (audit
// 2026-10-10). The dispatcher's own check denies such a seat - by the payload's agent_type, bare or house-prefixed - a
// file write outside the OS temp dirs and any git call that moves the index, the tree, a ref or a stash; a read, a build,
// a scratch write and every writing seat pass.
test('A-T1: a read-only seat may not write through the shell; a writing seat, the main session and a scratch write may', () => {
  const dir = project('seat-');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'seat-tmp-')));
  const fire = (command, agent_type, tool = 'Bash') => spawnSync(process.execPath, [DISPATCH], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command }, session_id: 'seat', cwd: dir, ...(agent_type ? { agent_id: 'a1', agent_type } : {}) }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
  });
  for (const seat of ['alfred-code:aspnet-verifier', 'wpf-solution-designer', 'code-quality-analyzer', 'integration-reviewer', 'security-auditor',
    'evidence-gatherer', 'alfred-code:issue-diagnoser-ci']) {
    for (const c of ['git reset -q', 'git restore --staged a.txt', 'git checkout -- a.txt', 'git stash', 'git rm --cached a.txt', 'git add .',
      'git commit -m x', 'git switch main', 'git clean -fd', 'echo x > notes.txt', 'sed -i s/a/b/ a.txt', 'cp a.txt b.txt', 'rm a.txt']) {
      const r = fire(c, seat);
      // the seat rule asks where a person can answer (guards ask, D1), and so does the commit gate
      assert.equal(verdictOf(r), 'ask', `${seat}: ${c} must block`);
      assert.match(blockText(r), /read-only seat/, `${seat}: ${c} names the seat rule`);
    }
  }
  const verifier = 'alfred-code:web-angular-verifier';
  const denied = fire('git reset -q', verifier);
  assert.match(blockText(denied), /read-only seat/);
  assert.match(blockText(denied), /report/, 'the denial routes the change to the report');
  for (const c of ['git status', 'git diff', 'git stash list', 'git clean -n', 'git log -p -1', 'npm test', `echo x > ${path.join(scratch, 'out.txt')}`,
    'echo x > /dev/null', 'out=$(mktemp); echo x > "$out"']) {
    assert.equal(verdictOf(fire(c, verifier)), 0, `${verifier}: ${c} must pass`);
  }
  assert.equal(verdictOf(fire('Set-Content -Path notes.txt -Value x', verifier, 'PowerShell')), 'ask', 'PowerShell: a write cmdlet');
  for (const [c, a] of [['git reset -q', 'alfred-code:aspnet-implementer'], ['echo x > notes.txt', undefined], ['git add .', 'dotnet-build-error-resolver'],
    ['git reset -q', 'other-plugin:aspnet-verifier']]) {
    assert.equal(verdictOf(fire(c, a)), 0, `${a || 'the main session'}: ${c} must pass`);
  }
  // a project that itself lives in a temp dir is never scratch (the gate's Linux leg: /tmp held the project, and every
  // write in it passed as a temp-dir write)
  const inTmp = fs.realpathSync(fs.mkdtempSync(path.join(scratch, 'proj-')));
  const fireIn = (command) => spawnSync(process.execPath, [DISPATCH], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'seat', cwd: inTmp, agent_id: 'a1', agent_type: verifier }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: inTmp, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
  });
  assert.equal(verdictOf(fireIn('echo x > notes.txt')), 'ask', 'a write into a project under the temp dir is the seat\'s write');
  const beside = fireIn(`echo x > ${path.join(scratch, 'out2.txt')}`);
  assert.doesNotMatch(blockText(beside), /read-only seat/, `a scratch write beside that project is no seat write: ${blockText(beside).slice(0, 200)}`);
});

// Audit 2026-10-21 agents T1-2 / A-Q2: `git bisect` moves HEAD and the tree, so a read-only seat's bisect in the shared
// checkout is a write; its log / visualize / terms read. A git call whose directory is a clone of its own under the OS
// temp dir (a `.git` directory there, never a `.git` file that may point back at the project's repository) is scratch,
// so the seat can bisect or reproduce there.
test('agents T1-2: a read-only seat may not bisect the project; a bisect read and a scratch clone may', () => {
  const dir = project('seat-bisect-');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'seat-bisect-tmp-')));
  const seat = 'alfred-code:issue-diagnoser-runtime';
  const fire = (command, cwd = dir) => spawnSync(process.execPath, [DISPATCH], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'seat', cwd, agent_id: 'a1', agent_type: seat }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TMPDIR: scratch, TEMP: scratch, TMP: scratch },
  });
  for (const c of ['git bisect start', 'git bisect good HEAD~1', 'git bisect bad', 'git bisect reset', 'git bisect run npm test',
    'git bisect skip', 'git bisect replay log.txt']) {
    assert.equal(verdictOf(fire(c)), 'ask', `${c} in the project must block`);
  }
  for (const c of ['git bisect log', 'git bisect visualize', 'git bisect view', 'git bisect terms']) {
    assert.equal(verdictOf(fire(c)), 0, `${c} reads`);
  }
  const clone = path.join(scratch, 'clone');
  git(scratch, 'clone', '-q', dir, clone);
  for (const c of [`git -C ${clone} bisect start`, `cd ${clone} && git bisect run npm test`, `git -C ${clone} checkout -q HEAD~0`]) {
    assert.equal(verdictOf(fire(c)), 0, `${c} works in a scratch clone`);
  }
  assert.equal(verdictOf(fire('git bisect start', clone)), 0, 'a seat whose cwd is the scratch clone');
  // a worktree of the project under the temp dir shares its refs: a `.git` file is never scratch
  const wt = path.join(scratch, 'wt');
  git(dir, 'worktree', 'add', '-q', '--detach', wt);
  assert.equal(verdictOf(fire(`git -C ${wt} bisect start`)), 'ask', 'a worktree of the project is the project');
  assert.equal(verdictOf(fire(`git -C ${wt} commit -m x`)), 'ask', 'a commit in a worktree of the project');
  assert.equal(verdictOf(fire(`git -C ${path.join(dir, '.claude')} bisect start`)), 'ask', 'a subdirectory of the project');
});

// audit 2026-10-21 H5: the `[[ ]]` / `(( ))` scan ran a lazy match from every opener to the end of the text when no
// closer followed - 64 / 105 / 260 ms at 10K / 20K / 40K openers, past the 100 s dispatcher budget near 400K (and
// `onFailure: block` then blocks the call). With no closer in the text there is no test to find.
test('audit 2026-10-21 H5: the zsh test scan stays linear when the openers have no closer', () => {
  const dir = project('h5-');
  const t = process.hrtime.bigint();
  const r = own(dir, `echo "a${'('.repeat(320000)}b"`, ZSH);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 3000, `320,000 openers judged in ${Math.round(ms)}ms`);
  assert.notEqual(r.status, null, 'the dispatcher finished');
  assert.equal(own(dir, '(( 1 == 1 )) && [[ $a == b ]] && echo y', ZSH).command, null, 'a closed test is still left as written');
});

// audit 2026-10-30 HK-01 (BLOCKER): the sanctioned runner `node <guard> --with-sensitive -- "<command line>"` ran its line
// through a shell no guard read - `rm -rf ~`, a force push to main, `cat .env`, a write outside the project and an ungated
// commit all passed. The line is a carried script now: every guard judges it, the masked legitimate use still runs.
test('audit 2026-10-30 HK-01: the --with-sensitive runner carries its command line to every shell guard', () => {
  const dir = project('hk01-');
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=sk-live-abcdef1234567890abcdef12\n');
  const other = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'hk01-other-')));
  const runner = (line) => `node "${path.join(HOOKS, 'guard-secret-value.js')}" --with-sensitive -- ${line}`;
  const fire = (command) => run(DISPATCH, bashPayload(command, dir), { env: { CLAUDE_PROJECT_DIR: dir } });
  const blocked = (command, why, re) => {
    const r = fire(command);
    assert.strictEqual(verdictOf(r), 'ask', `${why}: ${command} -> ${verdictOf(r)}\n${r.stderr}${r.stdout}`);
    if (re) assert.match(`${r.stderr}${r.stdout}`, re, why);
  };
  blocked(runner('"rm -rf ~"'), 'a recursive rm of home', /recursive rm/);
  blocked(runner('rm -rf ~'), 'the argv form: several words are one command line');
  blocked(runner("'rm -rf ~'"), 'a single-quoted line');
  blocked(runner('"git push --force origin main"'), 'a force push to main');
  // swap 1: this payload names no transcript, so the secret guard's core reads the carried line and refuses the name
  blocked(runner('"cat .env"'), 'a raw credential file read: refused by name where no masker runs', /--presence/);
  // the read guard keeps a reader of its own, so the dispatcher judges the runner's line with it and writes the runner's row
  fs.writeFileSync(path.join(dir, 'big.ts'), 'const a = 1;\n'.repeat(500));
  blocked(runner('"cat big.ts"'), 'a whole-file dump inside the runner', /with-sensitive/);
  blocked(runner(`"echo x > ${other}/f.txt"`), 'a write outside the project');
  blocked(runner('"git commit -am x"'), 'an ungated commit');
  blocked(`bash -c '${runner('"rm -rf ~"')}'`, 'a runner inside a carried script');
  blocked(`node ${path.join(HOOKS, 'guard-secret-value.js')} --with-sensitive 'rm -rf ~'`, 'no `--` before the line');
  // the legitimate, masked use still runs
  for (const ok of ['"npm run deploy"', '\'curl -s -H "Authorization: Bearer $API_KEY" https://api.example.invalid/x\'', '"node scripts/deploy.js --env prod"', 'psql "$DATABASE_URL" -c "select 1"']) {
    const r = fire(runner(ok));
    assert.equal(r.status, 0, `${ok} runs: ${r.stderr}${r.stdout}`);
    assert.ok(!/permissionDecision":"deny/.test(r.stdout), `${ok} is not denied`);
  }
  const rows = ledgerRows(dir).filter((r) => r.detail && r.detail.branch === 'sensitive-runner');
  assert.ok(rows.length >= 1, 'the runner block writes its own ledger row');
});

// ---- guards ask instead of block (2026-11-25): the dispatcher's combine step, its protective stop and its own blocks ----
// A block ask as a guard writes it: the verdict the helper builds for a payload nobody has stopped from asking.
const blockAsk = (reason, guard) => JSON.stringify({ hookSpecificOutput: blockVerdict({ tool_name: 'Bash' }, reason, { env: {}, guard }).hookSpecificOutput });
const DECLINED = 'If the user declined: ';

test('combine: two block asks are one prompt with both user texts and both model texts', () => {
  const one = blockAsk('Blocked: first harm. Fix one.', 'guard-a');
  const two = blockAsk('Blocked: second harm. Fix two.', 'guard-b');
  const out = shell.combine([r('guard-a.js', 0, one), r('guard-b.js', 0, two)]);
  assert.strictEqual(out.code, 0);
  assert.strictEqual(verdictOf(out), 'ask');
  const user = askText(out);
  assert.match(user, /alfred-code guard-a: first harm\./);
  assert.match(user, /alfred-code guard-b: second harm\./);
  assert.ok(user.indexOf('first harm') < user.indexOf('second harm'), 'guard order');
  const model = blockText(out);
  assert.ok(model.includes(`${DECLINED}Blocked: first harm. Fix one.`), model);
  assert.ok(model.includes(`${DECLINED}Blocked: second harm. Fix two.`), model);
});

test('combine: a deny beside a block ask stays a deny, the ask riding after it as Also', () => {
  const askJson = blockAsk('Blocked: the ask harm. Fix it.', 'guard-b');
  const out = shell.combine([r('guard-a.js', 0, deny('Docs not read yet')), r('guard-b.js', 0, askJson)]);
  assert.strictEqual(out.code, 0);
  assert.strictEqual(verdictOf(out), 'deny');
  const reason = JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /^Docs not read yet\n\nAlso: alfred-code guard-b: the ask harm\./);
});

test('isDenied: exit 2 and a JSON deny stop the protective run, an ask does not', () => {
  assert.strictEqual(shell.isDenied(r('g.js', 2, '', 'Blocked\n')), true);
  assert.strictEqual(shell.isDenied(r('g.js', 0, deny('no'))), true);
  assert.strictEqual(shell.isDenied(r('g.js', 0, blockAsk('Blocked: x. y.', 'g'))), false);
  assert.strictEqual(shell.isDenied(r('g.js', 0, ctx('only context'))), false);
  assert.strictEqual(shell.isDenied(r('g.js', 0)), false);
  assert.strictEqual(shell.isDenied(r('g.js', 0, '{"hookSpecificOutput": ')), false, 'unparseable output is no deny');
  assert.strictEqual(shell.isDenied(null), false);
});

test('blockResult: a verdict as a dispatcher result - ask or deny by the payload, exit 2 only on a Cursor deny', () => {
  const plain = { tool_name: 'Bash' };
  const asked = shell.blockResult(plain, 'Blocked: a thing. More.', 'shell-guards.js');
  assert.deepStrictEqual([asked.guard, asked.code, asked.stderr], ['shell-guards.js', 0, '']);
  assert.strictEqual(verdictOf(asked), 'ask');
  const denied = shell.blockResult({ tool_name: 'Bash', permission_mode: 'dontAsk' }, 'Blocked: a thing. More.', 'shell-guards.js');
  assert.strictEqual(denied.code, 0);
  assert.strictEqual(blockText(denied), 'Blocked: a thing. More.');
  const cursor = shell.blockResult({ tool_name: 'Bash', cursor_version: '1.0' }, 'Blocked: a thing. More.', 'shell-guards.js');
  assert.deepStrictEqual([cursor.code, cursor.stderr], [2, 'Blocked: a thing. More.']);
});

// The four own blocks, each by the fixture the older tests use. B5 and B6 name the secret and read guards, whose own
// runs find nothing in these lines.
const OWN_BLOCKS = [
  { name: 'a read-only seat write', branch: 'read-only-seat', re: /read-only seat/, guard: 'shell-guards',
    command: () => 'git reset -q', extra: { agent_id: 'a1', agent_type: 'alfred-code:aspnet-verifier' } },
  { name: 'a foreground wait', branch: 'poll-loop', re: /FOREGROUND wait/, guard: 'shell-guards',
    command: () => 'until grep -q READY run.log; do sleep 5; done', extra: {} },
  { name: 'the runner cap', branch: 'sensitive-runner-cap', re: /more than 4 judged/, guard: 'guard-secret-value',
    command: () => Array.from({ length: 5 }, () => `node "${path.join(HOOKS, 'guard-secret-value.js')}" --with-sensitive -- "true"`).join('; '), extra: {} },
  { name: 'a runner line a guard blocks', branch: 'sensitive-runner', re: /--with-sensitive runner runs/, guard: 'guard-read-whole-file',
    command: () => `node "${path.join(HOOKS, 'guard-secret-value.js')}" --with-sensitive -- "cat big.ts"`, extra: {} },
];
function fireOwn(dir, block, session, mode)
{
  fs.writeFileSync(path.join(dir, 'big.ts'), 'const a = 1;\n'.repeat(500));
  return run(DISPATCH, { ...bashPayload(block.command(), dir), session_id: session, ...block.extra, ...(mode ? { permission_mode: mode } : {}) }, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
}

test('own checks ask: a read-only seat write, a foreground wait, the runner cap, a runner line a guard blocks', () => {
  for (const block of OWN_BLOCKS) {
    const dir = project('ownask-');
    const session = `ask-${block.branch}`;
    const res = fireOwn(dir, block, session);
    assert.strictEqual(res.status, 0, `${block.name}: exit 0, the prompt is the answer (${res.stderr})`);
    assert.strictEqual(verdictOf(res), 'ask', block.name);
    assert.match(blockText(res), block.re, `${block.name}: the model text is today's text`);
    assert.ok(blockText(res).startsWith('A guard asked the user about this call: '), block.name);
    assert.match(askText(res), new RegExp(`^alfred-code ${block.guard}: `), `${block.name}: the prompt names the guard`);
    const rows = ledgerRows(dir, session).filter((x) => !x.mode && x.detail && x.detail.branch === block.branch);
    assert.strictEqual(rows.length, 1, `${block.name}: one ledger row, branch ${block.branch}`);
  }
});

test('own checks deny where nobody can answer', () => {
  for (const block of OWN_BLOCKS) {
    const dir = project('owndeny-');
    const session = `deny-${block.branch}`;
    const asked = fireOwn(dir, block, `${session}-ask`);
    const res = fireOwn(dir, block, session, 'dontAsk');
    assert.strictEqual(res.status, 0, block.name);
    assert.strictEqual(verdictOf(res), 'deny', block.name);
    const reason = blockText(res);
    assert.match(reason, block.re, block.name);
    assert.ok(reason.startsWith('Blocked: '), `${block.name}: the full text, no lead added`);
    const tail = blockText(asked);
    assert.strictEqual(reason, tail.slice(tail.indexOf(DECLINED) + DECLINED.length), `${block.name}: the deny reason is the ask's full text, byte for byte`);
    assert.strictEqual(ledgerRows(dir, session).filter((x) => !x.mode && x.detail && x.detail.branch === block.branch).length, 1, `${block.name}: the row is written on a deny too`);
  }
});
