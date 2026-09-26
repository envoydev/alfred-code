// The shell-guard dispatcher (R11): one node process judges a Bash / PowerShell call for every shell guard,
// in-process, and answers as Claude Code would merge the same guards run as separate hooks. Each guard
// keeps its own file, entry and tests (they spawn the files standalone); these cases pin the COMBINATION -
// every guard's block reaching the one answer, the ledger row per blocking guard, the gates applied per
// guard, a throwing guard failing open alone - and the wiring both routes generate.
'use strict';
const test = require('node:test');
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
test('wiringRows: every dispatched Bash|PowerShell row folds into ONE dispatcher row, in place', () => {
  const rows = ['a.js::@Stop', 'guard-protected-force-push.js::Bash|PowerShell', 'guard-read-whole-file.js::Read', 'guard-catastrophic-rm.js::Bash|PowerShell', 'guard-read-whole-file.js::Bash', 'instrument-tool-usage.js::.*'];
  assert.deepStrictEqual(shell.wiringRows(rows), ['a.js::@Stop', 'shell-guards.js::Bash|PowerShell', 'guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'instrument-tool-usage.js::.*']);
  // The copy route names its selection when it is a strict subset; the whole set needs no list.
  assert.deepStrictEqual(shell.wiringRows(rows, { listGuards: true }), ['a.js::@Stop', 'shell-guards.js::Bash|PowerShell::guard-protected-force-push guard-catastrophic-rm', 'guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'instrument-tool-usage.js::.*']);
  const all = shell.GUARDS.map((g) => `${g}.js::Bash|PowerShell`);
  assert.deepStrictEqual(shell.wiringRows(all, { listGuards: true }), ['shell-guards.js::Bash|PowerShell'], 'all eight: no list');
  assert.deepStrictEqual(shell.wiringRows(all.slice(1), { listGuards: true }), [`shell-guards.js::Bash|PowerShell::${shell.GUARDS.slice(1).join(' ')}`], 'seven of eight: listed');
  assert.deepStrictEqual(shell.wiringRows(all.slice(-1), { listGuards: true }), [`shell-guards.js::Bash|PowerShell::${shell.GUARDS.slice(-1)[0]}`], 'one: listed');
  assert.deepStrictEqual(shell.wiringRows(['x.js::Bash|PowerShell', { file: 'guard-catastrophic-rm.js', matcher: 'Bash|PowerShell' }], { listGuards: true }), ['x.js::Bash|PowerShell', 'shell-guards.js::Bash|PowerShell::guard-catastrophic-rm']);
  assert.deepStrictEqual(shell.wiringRows(['a.js::@Stop']), ['a.js::@Stop'], 'no dispatched row, no dispatcher');
});

test('the manifest wires every dispatched guard on the shell tools, and nothing else on them but instrumentation', () => {
  const { loadManifest } = require('./install/manifest.js');
  const rows = loadManifest(path.join(__dirname, '..')).catalogs.hooks.map((row) => row.replace(/::$/, ''));
  for (const g of shell.GUARDS) assert.ok(rows.includes(`${g}.js::Bash|PowerShell`), `${g} keeps its own Bash|PowerShell catalog row`);
  const onShell = rows.filter((row) => { const m = row.split('::')[1] || ''; return !m.startsWith('@') && /(^|\|)(Bash|PowerShell)(\||$)/.test(m); });
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
  const specs = ['guard-catastrophic-rm.js::Bash|PowerShell', 'guard-ungated-commit.js::Bash|PowerShell', 'guard-config-protection.js::Write|Edit|MultiEdit|NotebookEdit', 'guard-config-protection.js::Bash|PowerShell'];
  settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} });
  const pre = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.PreToolUse;
  const wired = pre.flatMap((e) => e.hooks.map((h) => `${e.matcher}  ${h.command}  ${h.timeout}`));
  assert.deepStrictEqual(wired.sort(), [
    `Bash  node ./my-own-hook.js  5`,
    `Bash|PowerShell  ${cmd('shell-guards.js')} guard-catastrophic-rm guard-ungated-commit guard-config-protection  ${10 * shell.GUARDS.length}`,
    `Write|Edit|MultiEdit|NotebookEdit  ${cmd('guard-config-protection.js')}  10`,
  ].sort());
  const before = fs.readFileSync(file, 'utf8');
  const again = settings.writeSettings({ file, hookSpecs: specs, log: () => {}, note: () => {} });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'idempotent');
  assert.strictEqual(again.written, false, 'the re-run writes nothing');
});

test('copy route: the ledger keeps the dispatcher wiring this run wrote', () => {
  const settings = require('./install/settings.js');
  const dir = fs.mkdtempSync(path.join(TMP, 'ledger-'));
  const file = path.join(dir, 'settings.json');
  const specs = ['guard-catastrophic-rm.js::Bash|PowerShell', 'guard-read-whole-file.js::Read'];
  const catalog = [...shell.GUARDS.map((g) => `${g}.js::Bash|PowerShell`), 'guard-read-whole-file.js::Read'];
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
  const payload = bashPayload('rm -rf ~ && git commit -am "wip"', dir);
  // What the separate hooks do with it: each guard standalone, its ledger cleared after.
  const alone = shell.GUARDS.map((g) => ({ g, ...run(path.join(HOOKS, `${g}.js`), payload, { cwd: dir, env }) })).filter((x) => x.status === 2);
  fs.rmSync(path.join(dir, '.alfred', 'docs'), { recursive: true, force: true });
  assert.ok(alone.length >= 2 && alone.some((x) => x.g === 'guard-catastrophic-rm') && alone.some((x) => x.g === 'guard-ungated-commit'), alone.map((x) => x.g).join(', '));
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
