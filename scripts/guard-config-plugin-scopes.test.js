'use strict';
// B1 (session audit 2026-11-27, row R1): `claude plugin uninstall|disable alfred-code... --scope <s>` took the core out of
// one settings scope only, yet the config guard asked as if every guard went down. When another scope's `enabledPlugins`
// still holds the core, the call passes with a one-line note; the last scope that keeps the core still asks.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { blockText } = require('./hook-test-env');
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runHook } = require('./hook-inprocess.js');
const { realLong } = require('./test-paths.js');

const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-scopes-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const CORE = 'alfred-code@envoydev';
const SCOPE_FILE = { user: ['home', '.claude', 'settings.json'], project: ['root', '.claude', 'settings.json'], local: ['root', '.claude', 'settings.local.json'] };
const settings = (plugins) => `${JSON.stringify({ model: 'sonnet', enabledPlugins: plugins }, null, 2)}\n`;

// A set-up project with a home of its own: the user scope file lives under that home, never the runner's ~/.claude.
function project(name, enabledAt = {}) {
  const root = realLong(fs.mkdtempSync(path.join(TMP, `${name}-`)));
  const home = realLong(fs.mkdtempSync(path.join(TMP, `${name}-home-`)));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'version: 3.6.0\n');
  spawnSync('git', ['init', '-q'], { cwd: root });
  const at = { root, home };
  for (const [scope, plugins] of Object.entries(enabledAt)) {
    const [base, ...rest] = SCOPE_FILE[scope];
    fs.writeFileSync(path.join(at[base], ...rest), typeof plugins === 'string' ? plugins : settings(plugins));
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CLAUDE_PROJECT_DIR: root,
    ALFRED_CODE_HOOK_LOG_DIR: path.join(root, 'log') };
  return { root, home, env };
}
const run = (p, command) => {
  const r = runHook('guard-config-protection.js', { session_id: 'scopes-sess', cwd: p.root, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } },
    { env: p.env, cwd: p.root });
  return { ask: blockText(r) !== null && blockText(r) !== undefined && blockText(r) !== '', text: blockText(r) || '', stdout: r.stdout, status: r.status };
};
const noteOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
const ON = { [CORE]: true };

// Claude Code's precedence is local > project > user: a disable writes false at its scope, and a false there beats a true below it.
const RANK = { local: 3, project: 2, user: 1 };
for (const [keeper, removed] of [['user', 'project'], ['user', 'local'], ['project', 'user'], ['project', 'local'], ['local', 'user'], ['local', 'project']]) {
  test(`B1: removing the core at ${removed} scope passes with a note when ${keeper} scope still enables it`, () => {
    const p = project(`keep-${keeper}-${removed}`, { [keeper]: ON, [removed]: ON });
    for (const verb of ['uninstall', 'remove']) {
      const r = run(p, `claude plugin ${verb} ${CORE} --scope ${removed}`);
      assert.equal(r.ask, false, `${verb} at ${removed} drops its key, ${keeper} keeps it: ${r.text}`);
      assert.match(noteOf(r), new RegExp(`${keeper} scope`), `the note names the ${keeper} scope that keeps it`);
      assert.match(noteOf(r), /guards stay up/, 'the note says what stays');
    }
  });
  test(`B1: disable at ${removed} scope while ${keeper} scope enables it ${RANK[keeper] > RANK[removed] ? 'passes' : 'asks: its false outranks the lower scope'}`, () => {
    const p = project(`disable-${keeper}-${removed}`, { [keeper]: ON, [removed]: ON });
    const r = run(p, `claude plugin disable ${CORE} --scope ${removed}`);
    if (RANK[keeper] > RANK[removed]) {
      assert.equal(r.ask, false, `${keeper} outranks ${removed}: ${r.text}`);
      assert.match(noteOf(r), new RegExp(`${keeper} scope`));
    } else {
      assert.equal(r.ask, true, `the false written at ${removed} decides over ${keeper}`);
      assert.match(r.text, /every Alfred Code guard/);
    }
  });
}

test('B1: a false at a higher scope decides over a true below it, for uninstall as for disable', () => {
  const projectFalse = project('prec-project-false', { user: ON, project: { [CORE]: false }, local: ON });
  assert.equal(run(projectFalse, `claude plugin uninstall ${CORE} --scope local`).ask, true, 'local drops, project false now decides');
  const localFalse = project('prec-local-false', { user: ON, project: ON, local: { [CORE]: false } });
  assert.equal(run(localFalse, `claude plugin uninstall ${CORE} --scope project`).ask, true, 'local false outranks the project and user trues');
  assert.equal(run(localFalse, `claude plugin uninstall ${CORE} --scope user`).ask, true, 'local false outranks user too');
  const projectTrue = project('prec-project-true', { user: ON, project: ON, local: { [CORE]: false } });
  assert.equal(run(projectTrue, `claude plugin uninstall ${CORE} --scope local`).ask, false, 'the false is dropped, project true decides');
  assert.match(noteOf(run(projectTrue, `claude plugin uninstall ${CORE} --scope local`)), /project scope/);
});

test('B1: a settings file that does not parse at the scope being removed asks', () => {
  const p = project('malformed-removed', { user: ON, project: '{ not json' });
  assert.equal(run(p, `claude plugin uninstall ${CORE} --scope project`).ask, true);
});

test('B1: a scope name that is an Object.prototype key is no scope, and no account folder means no user scope file', () => {
  const p = project('proto-scope', { user: ON, project: ON });
  for (const scope of ['constructor', 'toString', '__proto__']) assert.equal(run(p, `claude plugin uninstall ${CORE} --scope ${scope}`).ask, true, scope);
  const bare = project('no-account', { project: ON });
  fs.writeFileSync(path.join(bare.root, 'settings.json'), settings(ON));
  const env = { ...bare.env, CLAUDE_CONFIG_DIR: '', HOME: '', USERPROFILE: '' };
  const r = runHook('guard-config-protection.js', { session_id: 'scopes-sess', cwd: bare.root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: `claude plugin uninstall ${CORE} --scope project` } }, { env, cwd: bare.root });
  assert.ok(blockText(r), 'a cwd-relative settings.json is never the user scope: the last scope asks');
});

test('B1: the user scope that keeps the core is read from the account folder, and the default scope is user', () => {
  const p = project('default-user', { project: ON });
  const r = run(p, `claude plugin uninstall ${CORE}`);
  assert.equal(r.ask, false, `a user-scope removal while the project scope keeps it: ${r.text}`);
  assert.match(noteOf(r), /project scope/);
});

test('B1: removing the last scope that keeps the core still asks, for each of user, project and local', () => {
  for (const scope of ['user', 'project', 'local']) {
    const p = project(`last-${scope}`, { [scope]: ON });
    const r = run(p, `claude plugin uninstall ${CORE} --scope ${scope}`);
    assert.equal(r.ask, true, `${scope} is the only scope that enables it`);
    assert.match(r.text, /every Alfred Code guard/);
  }
});

test('B1: no scope enables the core, so removing it at one scope still asks', () => {
  const p = project('none-enabled');
  assert.equal(run(p, `claude plugin uninstall ${CORE} --scope project`).ask, true);
  assert.equal(run(p, `claude plugin disable ${CORE}`).ask, true);
});

test('B1: a command that removes every scope that enables the core asks, though each scope alone has a keeper', () => {
  const p = project('both-gone', { user: ON, project: ON });
  const both = run(p, `claude plugin uninstall ${CORE} --scope user && claude plugin uninstall ${CORE} --scope project`);
  assert.equal(both.ask, true, 'user and project go together');
  const one = run(p, `claude plugin uninstall ${CORE} --scope user`);
  assert.equal(one.ask, false, 'user alone leaves project');
  const three = project('two-of-three', { user: ON, project: ON, local: ON });
  assert.equal(run(three, `claude plugin uninstall ${CORE} --scope user && claude plugin uninstall ${CORE} --scope project`).ask, false, 'local still keeps it');
});

test('B1: a keeper that holds the core false, another plugin only, or a file that does not parse is no keeper', () => {
  for (const [why, kept] of [['the core false', { [CORE]: false }], ['another plugin only', { 'other@m': true }], ['a file that does not parse', '{ not json']]) {
    const p = project(`nokeeper-${why.replace(/\W+/g, '-')}`, { user: kept, project: ON });
    const r = run(p, `claude plugin uninstall ${CORE} --scope project`);
    assert.equal(r.ask, true, why);
  }
});

test('B1: disable --all at one scope passes while another scope keeps the core, a bare name is the same core', () => {
  const p = project('all-bare', { user: ON, project: ON });
  assert.equal(run(p, 'claude plugin disable --all --scope user').ask, false, 'disable --all at user, project keeps it');
  assert.equal(run(p, 'claude plugin disable --all --scope project').ask, true, 'disable --all at project writes false over the user true');
  assert.equal(run(p, 'claude plugin uninstall alfred-code --scope project').ask, false, 'the bare name');
  const other = project('other-market', { user: { 'alfred-code@elsewhere': true }, project: ON });
  assert.equal(run(other, `claude plugin uninstall ${CORE} --scope project`).ask, true, 'another marketplace\'s core is not the named one');
});

test('B1: a scope the guard does not read, and a reinstall in one call, keep their old verdicts', () => {
  const p = project('unknown-scope', { user: ON, project: ON });
  assert.equal(run(p, `claude plugin uninstall ${CORE} --scope managed`).ask, true, 'an unknown scope asks');
  assert.equal(run(p, `claude plugin uninstall ${CORE} --scope project && claude plugin install ${CORE} --scope project`).ask, false, 'a reinstall');
});
