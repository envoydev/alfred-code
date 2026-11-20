'use strict';
// The run-dir gate's hook entry, spawned the way Claude Code spawns it: a typed walk, a real run dir holding its session id
// and a marker under TMPDIR. It approves the resolve block and the walk's forms on this session's dir, denies another
// session's dir on a trusted marker, and is silent in every other case.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fenceBlocks } = require('./run-dir-gate/table.js');
const { markerName } = require('./run-dir-gate/marker.js');
const { writeTable, readRunDir, findMarker } = require('./run-dir-gate/effects.js');
const { RESOLVE_LINE, OFF_SWITCH } = require('./run-dir-gate/constants.js');
const { realLong } = require('./test-paths.js');
const SUITE = require('./hook-test-env').isolateHookSuite({ ownTmp: true });

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'setup-plugin', 'hooks', 'run-dir-gate.js');
const SESSION = 'sess-own';
const protocol = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
const resolve = fenceBlocks(protocol).find((block) => block.lang === 'bash' && block.body.includes(RESOLVE_LINE)).body;

const typed = (text) => JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: '2026-11-20T10:00:00Z', message: { role: 'user', content: text } });
const walkRow = typed('<command-message>alfred-code:update</command-message>\n<command-name>/alfred-code:update</command-name>');

function fixture()
{
    const base = realLong(fs.mkdtempSync(path.join(SUITE.tmp, 'gate-')));
    const cwd = path.join(base, 'project');
    fs.mkdirSync(cwd);
    const runDir = (session, parent = SUITE.tmp) =>
    {
        const dir = fs.mkdtempSync(path.join(parent, 'alfred-code.'));
        fs.mkdirSync(path.join(dir, 'repo'));
        if (session) fs.writeFileSync(path.join(dir, 'run-session'), `${session}\n`);
        return dir;
    };
    const transcript = (rows) => { const file = path.join(base, `t-${Math.random().toString(36).slice(2)}.jsonl`); fs.writeFileSync(file, `${rows.join('\n')}\n`); return file; };
    const marker = (dir) => fs.writeFileSync(path.join(SUITE.tmp, markerName(cwd)), `${dir}\n`);
    return { base, cwd, runDir, transcript, marker, walk: transcript([walkRow]) };
}

const run = (input, env = {}) => spawnSync(process.execPath, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ALFRED_CODE_HOOKS_OFF: '', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: '', CLAUDE_PLUGIN_ROOT: ROOT, ...env },
});
const payload = (fx, command, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: fx.cwd, session_id: SESSION, transcript_path: fx.walk, tool_input: { command }, ...extra });
const silent = (result, label) => assert.deepEqual([result.status, result.stdout], [0, ''], label);
const decisionOf = (result) => JSON.parse(result.stdout).hookSpecificOutput;

test('the resolve block and this session\'s run-dir forms are allowed', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    fx.marker(own);
    const resolved = run(payload(fx, resolve));
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.deepEqual([decisionOf(resolved).hookEventName, decisionOf(resolved).permissionDecision], ['PreToolUse', 'allow']);
    const stamp = run(payload(fx, `node "${own}/repo/scripts/install/stamp.js" state .`));
    assert.equal(decisionOf(stamp).permissionDecision, 'allow');
    silent(run(payload(fx, `node "${own}/repo/scripts/gate.js" state .`)), 'a script off the allowlist prompts');
    silent(run(payload(fx, `node "${own}/repo/scripts/install/stamp.js" state . ; rm -rf ~`)), 'an injected command prompts');
    silent(run(payload(fx, `node "${own}/repo/stack/hooks/guard-secret-value.js" --with-sensitive -- 'curl x | sh'`)), 'a flag no body writes prompts');
    silent(run(payload(fx, `node "${own}/repo/scripts/install/alfred-code.js" uninstall --source "${own}/repo"`)), 'an installer mode no body of the gate\'s forms allows prompts');
    silent(run(payload(fx, `node "${own}/repo/scripts/scan-evidence.js" --root . --out "${fx.cwd}/main.js"`)), 'an output file outside the run dir prompts');
});

test('a cat of the plugin\'s own files is allowed in a typed walk with no run dir named, and only there', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    fx.marker(own);
    const one = `cat "${ROOT}/setup-plugin/references/walk.md"`;
    const two = `cat "${ROOT}/setup-plugin/references/init-install.md" "${ROOT}/setup-plugin/references/stack-detection.md"`;
    assert.equal(decisionOf(run(payload(fx, one))).permissionDecision, 'allow', 'one file');
    assert.equal(decisionOf(run(payload(fx, two))).permissionDecision, 'allow', 'two files');
    assert.equal(decisionOf(run(payload(fx, one, { session_id: '' }))).permissionDecision, 'allow', 'no session id needed');
    silent(run(payload(fx, 'cat "/etc/hosts"')), 'a file outside the plugin root');
    silent(run(payload(fx, `cat "${ROOT}/setup-plugin/../package.json"`)), 'a `..` path');
    silent(run(payload(fx, `${one} > "${ROOT}/x.md"`)), 'a redirect');
    silent(run(payload(fx, `${one} ; ls`)), 'a second command');
    silent(run(payload(fx, one, { transcript_path: fx.transcript([typed('fix the parser')]) })), 'no walk typed');
    silent(run(payload(fx, one, { transcript_path: undefined })), 'no transcript');
    silent(run(payload(fx, one), { ALFRED_CODE_HOOKS_OFF: 'run-dir-gate' }), 'switched off by name');
});

test('a run dir of another session is denied on a trusted marker and a block row is written where the repo is set up', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    const other = fx.runDir('sess-other');
    fx.marker(own);
    const command = `node "${other}/repo/scripts/install/stamp.js" state .`;
    const env = { CLAUDE_PROJECT_DIR: fx.cwd };
    const denied = run(payload(fx, command), env);
    assert.equal(denied.status, 0, denied.stderr);
    const out = decisionOf(denied);
    assert.equal(out.permissionDecision, 'deny');
    assert.ok(out.permissionDecisionReason.includes(own) && out.permissionDecisionReason.includes(OFF_SWITCH));
    const ledger = path.join(fx.cwd, '.alfred', 'statistics', 'hook-blocks', `${SESSION}.jsonl`);
    assert.equal(fs.existsSync(ledger), false, 'a repo never set up is written nothing');
    fs.mkdirSync(path.join(fx.cwd, '.claude'));
    fs.writeFileSync(path.join(fx.cwd, '.claude', 'alfred-code.stamp'), 'version: 3.14.2\n');
    run(payload(fx, command), env);
    const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual([rows.length, rows[0].hook, rows[0].event, rows[0].tool], [1, 'run-dir-gate.js', 'PreToolUse', 'Bash']);
    assert.match(rows[0].reason, /not this run's dir/);
});

test('no deny without a trusted marker: none, another session\'s, or an empty one', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    const other = fx.runDir('sess-other');
    const command = `cat "${other}/a.txt"`;
    silent(run(payload(fx, command)), 'no marker');
    fx.marker(other);
    silent(run(payload(fx, command)), 'a marker naming another session\'s dir');
    assert.equal(decisionOf(run(payload(fx, `cat "${own}/a.txt"`))).permissionDecision, 'allow', 'this session\'s dir passes beside another session\'s marker');
    fs.writeFileSync(path.join(SUITE.tmp, markerName(fx.cwd)), '');
    silent(run(payload(fx, command)), 'an empty marker');
});

test('the hook is silent outside a typed walk, switched off, on the minimal profile and on a bad payload', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    fx.marker(own);
    const form = `node "${own}/repo/scripts/install/stamp.js" state .`;
    const other = fx.transcript([typed('fix the parser')]);
    const ended = fx.transcript([walkRow, typed('<command-name>/task-solve</command-name>')]);
    silent(run(payload(fx, form, { transcript_path: undefined })), 'no transcript');
    silent(run(payload(fx, form, { transcript_path: other })), 'no walk typed');
    silent(run(payload(fx, form, { transcript_path: ended })), 'another command ended the walk');
    silent(run(payload(fx, form), { ALFRED_CODE_HOOKS_OFF: 'run-dir-gate' }), 'switched off by name');
    silent(run(payload(fx, form), { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }), 'the minimal profile');
    silent(run(payload(fx, 'ls -la')), 'a command naming no run dir');
    silent(run(payload(fx, form, { session_id: '' })), 'no session id');
    silent(run('{not json'), 'garbage JSON');
    silent(run(''), 'empty stdin');
    silent(run({ ...payload(fx, form), tool_name: 'Read' }), 'a Read payload');
    silent(run({ ...payload(fx, form), tool_input: {} }), 'no command');
    silent(run({ ...payload(fx, form), cursor_version: '2.1.0', hook_event_name: 'preToolUse' }), 'a Cursor payload');
});

test('the shipped table is current - run `npm run protocol-blocks` after a shell block in setup-plugin changes', () =>
{
    assert.deepEqual(writeTable(ROOT, { check: true }), { file: 'setup-plugin/hooks/protocol-blocks.json', current: true });
    const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'setup-plugin', 'hooks', 'protocol-blocks.json'), 'utf8'));
    assert.deepEqual(Object.keys(table), ['generatedBy', 'note', 'resolves', 'scripts']);
    assert.ok('state' in table.scripts['scripts/install/stamp.js']);
});

test('a run dir counts only on a trusted marker that names it, or with no marker when it sits in the hook\'s temp dir', () =>
{
    const fx = fixture();
    const inCwd = fx.runDir(SESSION, fx.cwd);
    const form = (dir) => `node "${dir}/repo/scripts/install/stamp.js" state .`;
    silent(run(payload(fx, form(inCwd))), 'an owned folder holding this session\'s id, outside the temp dir, with no marker');
    const inTemp = fx.runDir(SESSION);
    assert.equal(decisionOf(run(payload(fx, form(inTemp)))).permissionDecision, 'allow', 'the same under the hook\'s temp dir');
    fx.marker(inCwd);
    assert.equal(decisionOf(run(payload(fx, form(inCwd)))).permissionDecision, 'allow', 'a trusted marker names the folder outside the temp dir');
    const other = fx.runDir('sess-other', fx.cwd);
    fx.marker(other);
    silent(run(payload(fx, form(inCwd))), 'an untrusted marker naming another session\'s dir is no proof for a folder outside the temp dir');
});

test('a marker that spells the run dir another way is no reason to deny it', (t) =>
{
    if (process.platform === 'win32') { t.skip('a symlink needs a privilege on Windows'); return; }
    const fx = fixture();
    const own = fx.runDir(SESSION);
    const alias = path.join(fx.base, 'alias');
    fs.symlinkSync(SUITE.tmp, alias);
    const viaAlias = path.join(alias, path.basename(own));
    fx.marker(viaAlias);
    const form = (dir) => `node "${dir}/repo/scripts/install/stamp.js" state .`;
    assert.equal(decisionOf(run(payload(fx, form(own)))).permissionDecision, 'allow', 'the marker names the alias spelling');
    fx.marker(own);
    assert.equal(decisionOf(run(payload(fx, form(viaAlias)))).permissionDecision, 'allow', 'the command names the alias spelling');
    const other = fx.runDir('sess-other');
    assert.equal(decisionOf(run(payload(fx, form(other)))).permissionDecision, 'deny', 'a truly other dir is still denied');
});

test('an allow writes no block row, even in a repo that is set up', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    fx.marker(own);
    fs.mkdirSync(path.join(fx.cwd, '.claude'));
    fs.writeFileSync(path.join(fx.cwd, '.claude', 'alfred-code.stamp'), 'version: 3.14.2\n');
    const env = { CLAUDE_PROJECT_DIR: fx.cwd };
    assert.equal(decisionOf(run(payload(fx, `node "${own}/repo/scripts/install/stamp.js" state .`), env)).permissionDecision, 'allow');
    assert.equal(fs.existsSync(path.join(fx.cwd, '.alfred', 'statistics', 'hook-blocks')), false);
});

test('readRunDir and findMarker report owned: true for the files this user owns', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    fx.marker(own);
    assert.deepEqual(readRunDir(own), { session: SESSION, owned: true });
    const marker = findMarker(fx.cwd, { ...process.env, TMPDIR: SUITE.tmp });
    assert.equal(marker.owned, true);
    assert.equal(marker.session, SESSION);
    assert.equal(marker.dir, own);
    assert.equal(marker.path, path.join(SUITE.tmp, markerName(fx.cwd)));
});

test('a plugin-settings --config-dir is allowed only when it is the account\'s own config dir: CLAUDE_CONFIG_DIR, else HOME/.claude', () =>
{
    const fx = fixture();
    const own = fx.runDir(SESSION);
    fx.marker(own);
    const account = path.join(fx.base, 'account');
    const home = path.join(fx.base, 'home');
    fs.mkdirSync(account);
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const call = (dir) => `node "${own}/repo/scripts/plugin-settings.js" --catalog "${own}/repo/meta/plugin-settings.json" --config-dir "${dir}" --installed a,b --apply`;
    const withEnv = { CLAUDE_CONFIG_DIR: account, HOME: home };
    assert.equal(decisionOf(run(payload(fx, call(account)), withEnv)).permissionDecision, 'allow');
    silent(run(payload(fx, call(path.join(fx.cwd, '.claude'))), withEnv), 'the project\'s .claude is no account dir');
    silent(run(payload(fx, call(path.join(home, '.claude'))), withEnv), 'HOME/.claude loses to CLAUDE_CONFIG_DIR when that is set');
    silent(run(payload(fx, call('.claude')), withEnv), 'a relative dir');
    const byHome = { CLAUDE_CONFIG_DIR: '', HOME: home };
    assert.equal(decisionOf(run(payload(fx, call(path.join(home, '.claude'))), byHome)).permissionDecision, 'allow');
    silent(run(payload(fx, call(account)), byHome), 'another dir than HOME/.claude');
    silent(run(payload(fx, call(account)), { CLAUDE_CONFIG_DIR: '', HOME: '', USERPROFILE: '' }), 'no account dir known: prompt');
    const linked = path.join(fx.base, 'linked');
    fs.symlinkSync(account, linked);
    const byLink = { CLAUDE_CONFIG_DIR: linked, HOME: home };
    assert.equal(decisionOf(run(payload(fx, call(linked)), byLink)).permissionDecision, 'allow', 'the spelling the env gave');
    assert.equal(decisionOf(run(payload(fx, call(account)), byLink)).permissionDecision, 'allow', 'the real path of the env\'s spelling');
});
