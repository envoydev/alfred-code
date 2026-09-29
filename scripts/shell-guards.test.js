// The shell-guard dispatcher (R11): one node process judges a Bash / PowerShell call for every shell guard,
// in-process, and answers as Claude Code would merge the same guards run as separate hooks. Each guard
// keeps its own file, entry and tests (they spawn the files standalone); these cases pin the COMBINATION -
// every guard's block reaching the one answer, the ledger row per blocking guard, the gates applied per
// guard, a throwing guard failing open alone - and the wiring both routes generate.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const DISPATCH = path.join(HOOKS, 'shell-guards.js');
const shell = require(DISPATCH);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-guards-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const BIG = path.join(__dirname, 'lint-skills.js');

// The containment every guard suite applies: an empty account dir, no ambient stack settings from the
// session this suite may run inside (an installed checkout exports ALFRED_CODE_* into every tool call).
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
for (const k of Object.keys(process.env))
  if (/^(ALFRED_CODE_|CLAUDE_STACK_)/.test(k) || k === 'CLAUDE_DOCS_PATH' || k === 'CLAUDE_PLUGIN_ROOT' || k === 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE') delete process.env[k]; // legacy-name
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
  const f = path.join(dir, '.alfred', 'docs', 'hook-blocks', `${session}.jsonl`);
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
  const commands = shellGroups.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepStrictEqual(commands, ['node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/shell-guards.js"']);
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
test('each guard\'s block reaches the combined answer, with its own ledger row', () => {
  const dir = project();
  const other = fs.mkdtempSync(path.join(TMP, 'other-'));
  fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
  const FAKE_JWT = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
  const cases = [
    ['guard-protected-force-push', 'git push --force origin main'],
    ['guard-catastrophic-rm', 'rm -rf ~'],
    ['guard-read-whole-file', `cat ${BIG}`],
    ['guard-secret-value', `curl -H "Authorization: Bearer ${FAKE_JWT}" https://example.test/api`],
    ['guard-ungated-commit', 'git commit -am "wip"'],
    ['guard-config-protection', 'echo "export default [{}];" > eslint.config.js'],
    ['guard-cross-project-write', `echo x > ${path.join(other, 'f.txt')}`],
  ];
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' };
  for (const [guard, command] of cases)
  {
    const session = `each-${guard}`;
    const payload = { ...bashPayload(command, dir), session_id: session };
    const alone = run(path.join(HOOKS, `${guard}.js`), payload, { cwd: dir, env });
    assert.strictEqual(alone.status, 2, `${guard} blocks '${command}' on its own: ${alone.stderr}`);
    fs.rmSync(path.join(dir, '.alfred', 'docs'), { recursive: true, force: true });
    const both = run(DISPATCH, payload, { cwd: dir, env });
    assert.strictEqual(both.status, 2, `${guard}: the dispatcher blocks too`);
    assert.ok(both.stderr.includes(alone.stderr.trim()), `${guard}: its own message reaches the model\n--- alone\n${alone.stderr}\n--- dispatched\n${both.stderr}`);
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
  const alone = shell.GUARDS.map((g) => ({ g, ...run(path.join(HOOKS, `${g}.js`), payload, { cwd: dir, env }) })).filter((x) => x.status === 2);
  fs.rmSync(path.join(dir, '.alfred', 'docs'), { recursive: true, force: true });
  assert.ok(alone.length >= 2 && alone.some((x) => x.g === 'guard-read-whole-file') && alone.some((x) => x.g === 'guard-ungated-commit'), alone.map((x) => x.g).join(', '));
  const out = run(DISPATCH, payload, { cwd: dir, env });
  assert.strictEqual(out.status, 2);
  for (const x of alone) assert.ok(out.stderr.includes(x.stderr.trim()), `${x.g}'s reason is in the one answer`);
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
  assert.strictEqual(out.status, 2);
  const rows = ledgerRows(dir).filter((x) => !x.mode);
  const commit = rows.find((x) => x.hook === 'guard-ungated-commit.js');
  const cross = rows.find((x) => x.hook === 'guard-cross-project-write.js');
  assert.deepStrictEqual(commit && commit.detail, { branch: 'staged-scan', count: 1 }, 'the commit guard names its branch');
  assert.ok(cross, 'the cross-project write blocks too');
  assert.strictEqual(cross.detail, undefined, 'and its row carries none of the commit guard\'s detail');

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
  assert.deepStrictEqual(ledgerRows(dir), []);
});

test('empty or malformed input: every guard fails open, the dispatcher says nothing and writes nothing', () => {
  const dir = project();
  for (const input of ['', 'not json', '{}', '[1,2]', JSON.stringify({ tool_name: 'Bash' }), JSON.stringify({ tool_name: 'Bash', tool_input: { command: '' } })])
  {
    const r = spawnSync(process.execPath, [DISPATCH], { input, encoding: 'utf8', cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.deepStrictEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, { status: 0, stdout: '', stderr: '' }, `input ${JSON.stringify(input)}`);
  }
  assert.ok(!fs.existsSync(path.join(dir, '.alfred', 'docs', 'hook-blocks')), 'no ledger row');
});

test('PowerShell is the same shell route', () => {
  const dir = project();
  const out = run(DISPATCH, bashPayload('Remove-Item -Recurse -Force $HOME', dir, 'PowerShell'), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.strictEqual(out.status, 2);
  assert.match(out.stderr, /recursive rm of a catastrophic/);
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
    input: JSON.stringify(bashPayload('rm -rf ~ && git commit -am "wip"', dir)), encoding: 'utf8', cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 15000,
  });
  assert.strictEqual(res.status, 2, `the rm block arrives before the stalled guard runs (status ${res.status}, ${Date.now() - started}ms)`);
  assert.match(res.stderr, /recursive rm of a catastrophic/);
  assert.doesNotMatch(res.stderr, /COMMIT-GATE/, 'a guard after the protective block never ran');
  assert.deepStrictEqual(hooksOf(ledgerRows(dir)), ['guard-catastrophic-rm.js'], 'one row, the protective guard\'s own');
  const prelude = require(path.join(HOOKS, 'hook-prelude.js'));
  assert.deepStrictEqual([...shell.PROTECTIVE].sort(), shell.GUARDS.filter((g) => prelude.PROTECTIVE.has(g)).sort(),
    'the dispatcher\'s protective set is the prelude\'s, on the shell route');
});

test('a throwing guard fails open for itself only - the others still judge', () => {
  const copy = path.join(TMP, 'thrower');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'guard-read-whole-file.js'), "'use strict';\nthrow new TypeError('boom from a broken guard');\n");
  const dir = project();
  const blocked = run(path.join(copy, 'shell-guards.js'), bashPayload('rm -rf ~', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.strictEqual(blocked.status, 2, 'the rm guard still blocks');
  assert.match(blocked.stderr, /recursive rm of a catastrophic/);
  const open = run(path.join(copy, 'shell-guards.js'), bashPayload('git status', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
  assert.strictEqual(open.status, 0, 'the throw blocks nothing');
  assert.match(JSON.parse(open.stdout).systemMessage, /guard-read-whole-file\.js.*boom from a broken guard/);
});

test('the csv opt-out switches off one guard inside the dispatcher, not its neighbours', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_HOOKS_OFF: 'guard-catastrophic-rm' };
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf .', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }).status, 2, 'only the rm guard blocks this one');
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf .', dir), { cwd: dir, env }).status, 0, 'the named guard stands down');
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env }).status, 2, 'the commit gate still judges');
});

test('a repo never set up keeps only the rm, secret and force-push guards, writing no row', () => {
  const dir = project('unset-');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const rm = run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env });
  assert.strictEqual(rm.status, 2, 'a protective guard stays live');
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env }).status, 0, 'the commit gate stands down');
  assert.ok(!fs.existsSync(path.join(dir, '.alfred', 'docs')), 'nothing is written into a repo merely opened');
});

test('hook_profile minimal keeps the protective three inside the dispatcher', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' };
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env }).status, 2);
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env }).status, 0);
});

test('the plugin dispatcher steps aside for a wired copy of itself; the copy judges', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/shell-guards.js"', timeout: 80 }] }] } }));
  const plugin = run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
  assert.deepStrictEqual(plugin, { status: 0, stdout: '', stderr: '' });
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }).status, 2);
});

test('an old per-guard copy still wired: the plugin dispatcher skips exactly that guard', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-catastrophic-rm.js"', timeout: 10 }] }] } }));
  const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf .', dir), { cwd: dir, env }).status, 0, 'the copied twin judges rm, not the plugin');
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env }).status, 2, 'every other guard still runs here');
});

test('in-process, every guard\'s stand-down ends it where it stands - no exit is swallowed', () => {
  const dir = project();
  const stdin = Buffer.from(JSON.stringify(bashPayload('rm -rf ~ && git commit -am "wip"', dir)));
  const saved = { ...process.env };
  try {
    process.env.CLAUDE_PROJECT_DIR = dir;
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
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  assert.deepStrictEqual(hooksOf(ledgerRows(dir)), ['guard-catastrophic-rm.js'], 'under minimal the protective rm guard still blocks, and logs it');
});

test('a guard list in the wiring runs exactly those guards', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir };
  assert.strictEqual(run(DISPATCH, bashPayload('rm -rf ~', dir), { cwd: dir, env, args: ['guard-ungated-commit'] }).status, 0);
  assert.strictEqual(run(DISPATCH, bashPayload('git commit -am "wip"', dir), { cwd: dir, env, args: ['guard-ungated-commit'] }).status, 2);
});

test('the secret rewrite passes through unchanged, and a block from another guard wins over it', () => {
  const dir = project();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const payload = bashPayload('echo $SENTRY_ACCESS_TOKEN', dir);
  const alone = run(path.join(HOOKS, 'guard-secret-value.js'), payload, { cwd: dir, env });
  const both = run(DISPATCH, payload, { cwd: dir, env });
  assert.strictEqual(both.status, 0);
  assert.deepStrictEqual(JSON.parse(both.stdout), JSON.parse(alone.stdout), 'the rewrite is the secret guard\'s own, byte for byte');
  // The other guards judge the ORIGINAL command, as they do beside it in parallel today.
  const mixed = bashPayload(`echo $SENTRY_ACCESS_TOKEN; cat ${BIG}`, dir);
  const secret = run(path.join(HOOKS, 'guard-secret-value.js'), mixed, { cwd: dir, env });
  assert.ok(JSON.parse(secret.stdout).hookSpecificOutput.updatedInput, 'standalone, the secret guard rewrites this command');
  const out = run(DISPATCH, mixed, { cwd: dir, env });
  assert.strictEqual(out.status, 2, 'the whole-file guard blocks the original command');
  assert.ok(!out.stdout.includes('updatedInput'), 'the rewrite never reaches a blocked call');
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
    'docs-session.js::Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob', 'docs-session.js::@Stop', 'instrument-tool-usage.js::.*'];
  assert.deepStrictEqual(fg.wiringRows(rows), ['a.js::@Stop', `file-guards.js::${fg.MATCHER}`, 'guard-read-whole-file.js::Bash|PowerShell|Monitor', 'docs-session.js::@Stop', 'instrument-tool-usage.js::.*']);
  assert.strictEqual(fg.MATCHER, 'Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob');
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
  const onFile = (tool) => block.PreToolUse.filter((g) => g.matcher === undefined || new RegExp(`^(?:${g.matcher})$`).test(tool)).flatMap((g) => g.hooks.map((h) => h.command));
  for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob'])
    assert.deepStrictEqual(onFile(tool), ['node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/file-guards.js"', 'node "${CLAUDE_PLUGIN_ROOT}/stack/hooks/instrument-tool-usage.js"'], `${tool}: the dispatcher and instrumentation only`);
  const group = block.PreToolUse.find((g) => g.matcher === fg.MATCHER);
  assert.strictEqual(group.hooks[0].timeout, 10 * fg.GUARDS.length, 'every guard keeps the 10s it had as its own hook');
  assert.strictEqual(require('./install/settings.js').timeoutFor('file-guards.js', 'PreToolUse'), 10 * fg.GUARDS.length);
});

test('file-guards: each guard\'s block reaches the combined answer through the dispatcher, with its own ledger row', () => {
  const dir = project();
  const other = fs.mkdtempSync(path.join(TMP, 'fg-other-'));
  fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
  fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { SENTRY_ACCESS_TOKEN: 'x0'.repeat(20) } }, null, 2));
  const cases = [
    ['guard-read-whole-file', 'Read', { file_path: BIG }],
    ['guard-secret-value', 'Read', { file_path: path.join(dir, 'settings.local.json') }],
    ['guard-config-protection', 'Edit', { file_path: path.join(dir, 'eslint.config.js'), old_string: '[]', new_string: '[{}]' }],
    ['guard-cross-project-write', 'Write', { file_path: path.join(other, 'f.txt'), content: 'x' }],
  ];
  const env = { CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' };
  for (const [guard, tool, input] of cases)
  {
    const session = `fg-${guard}`;
    const payload = filePayload(tool, input, dir, session);
    const alone = run(path.join(HOOKS, `${guard}.js`), payload, { cwd: dir, env });
    assert.strictEqual(alone.status, 2, `${guard} blocks ${tool} on its own: ${alone.stderr}`);
    fs.rmSync(path.join(dir, '.alfred', 'docs'), { recursive: true, force: true });
    const both = run(FILES, payload, { cwd: dir, env });
    assert.strictEqual(both.status, 2, `${guard}: the dispatcher blocks too`);
    assert.ok(both.stderr.includes(alone.stderr.trim()), `${guard}: its own message reaches the model\n--- alone\n${alone.stderr}\n--- dispatched\n${both.stderr}`);
    assert.deepStrictEqual(hooksOf(ledgerRows(dir, session)), [`${guard}.js`], `${guard}: one ledger row, its own`);
  }
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

test('file-guards: the protective secret guard is answered at once, and a guard list in the wiring runs exactly those guards', () => {
  const copy = path.join(TMP, 'fg-staller');
  fs.cpSync(HOOKS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'docs-session.js'), "'use strict';\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);\n");
  const dir = project();
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=abc123\n');
  const r = spawnSync(process.execPath, [path.join(copy, 'file-guards.js')], {
    input: JSON.stringify(filePayload('Read', { file_path: path.join(dir, '.env') }, dir, 'fg-prot')), encoding: 'utf8', cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 15000,
  });
  assert.strictEqual(r.status, 2, `the secret block arrives before the stalled guard runs (status ${r.status})`);
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
  const read = spawnIt('file-guards.js', filePayload('Read', { file_path: path.join(dir, '.env') }, dir, 'stall-read'));
  assert.strictEqual(read.status, 2, `file-guards: the secret block arrives though the read guard stalls (status ${read.status})`);
  assert.deepStrictEqual(hooksOf(ledgerRows(dir, 'stall-read')), ['guard-secret-value.js']);
  const sh = spawnIt('shell-guards.js', { ...bashPayload('cat .env && npm run build', dir), session_id: 'stall-bash' });
  assert.strictEqual(sh.status, 2, `shell-guards: the secret block arrives though the read guard stalls (status ${sh.status})`);
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
  const md = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
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
