'use strict';
// The forge line at session and seat start: which forge the remote is, which forge CLIs are on PATH, which MCP servers
// are forge servers (by their launch command or URL, never their name) and whether the ref watch is on - facts the
// model maps each concept onto, so it never guesses the remote. No network in this half.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'forge-session.js');
const { profile, profileLine } = require(HOOK);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-session-'));

function repo(url) {
  const dir = fs.mkdtempSync(path.join(TMP, 'repo-'));
  spawnSync('git', ['init', '-q', dir]);
  if (url) spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', url]);
  return dir;
}
// An env with an empty account dir and an empty PATH dir, so the machine's own CLIs and servers never leak into a case.
function envFor(dir, extra = {}) {
  const acct = fs.mkdtempSync(path.join(TMP, 'acct-'));
  const bin = fs.mkdtempSync(path.join(TMP, 'bin-'));
  return { PATH: bin, HOME: acct, CLAUDE_CONFIG_DIR: acct, CLAUDE_PROJECT_DIR: dir, ...extra };
}
const onPath = (env, name) => {
  const file = path.join(env.PATH, process.platform === 'win32' ? `${name}.cmd` : name);
  fs.writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  fs.chmodSync(file, 0o755);
};

test('github origin line', () => {
  const dir = repo('git@github.com:o/r.git');
  const p = profile(dir, envFor(dir));
  assert.strictEqual(p.kind, 'github');
  assert.strictEqual(p.host, 'github.com');
  assert.strictEqual(p.remote, 'origin');
  assert.strictEqual(p.watch, 'on');
  const line = profileLine(p);
  assert.match(line, /^Forge: github\.com \(github\), remote origin; /);
  assert.match(line, /CLIs on PATH: none; forge MCP servers: none; ref watch: on\.$/);
});

test('self-hosted unknown', () => {
  const dir = repo('https://user@code.example.com/x.git');
  const p = profile(dir, envFor(dir));
  assert.strictEqual(p.kind, 'unknown');
  assert.strictEqual(p.host, 'code.example.com');
  assert.match(profileLine(p), /^Forge: code\.example\.com \(unknown\), remote origin;/);
});

test('a self-hosted GitLab and an Azure remote are read from the host', () => {
  const lab = repo('ssh://git@gitlab.corp.example:2222/g/r.git');
  assert.strictEqual(profile(lab, envFor(lab)).kind, 'gitlab');
  assert.strictEqual(profile(lab, envFor(lab)).host, 'gitlab.corp.example');
  const az = repo('https://org@dev.azure.com/org/proj/_git/r');
  assert.strictEqual(profile(az, envFor(az)).kind, 'azure');
});

test('no remote', () => {
  const dir = repo(null);
  const p = profile(dir, envFor(dir));
  assert.strictEqual(p.remote, null);
  assert.strictEqual(p.watch, 'off');
  assert.strictEqual(p.why, 'no remote');
  assert.match(profileLine(p), /ref watch: off \(no remote\)\.$/);
});

test('mcp found by launch', () => {
  const dir = repo('git@gitlab.com:g/r.git');
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {
    work: { command: 'npx', args: ['@zereight/mcp-gitlab'] },
    github: { command: 'npx', args: ['some-unrelated-server'] }, // the key alone never makes a forge server
    'alfred-navigation': { command: 'npx', args: ['github-mcp-server'] }, // the stack's own servers are never listed
  } }));
  const env = envFor(dir);
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({
    mcpServers: { hub: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
    projects: { [dir]: { mcpServers: { ado: { command: 'npx', args: ['-y', '@azure-devops/mcp', 'org'] } } } },
  }));
  assert.deepStrictEqual(profile(dir, env).mcp.sort(), ['ado', 'hub', 'work']);
});

test('a CLI on PATH is listed', () => {
  const dir = repo('git@gitlab.com:g/r.git');
  const env = envFor(dir);
  onPath(env, 'glab');
  onPath(env, 'tea');
  assert.deepStrictEqual(profile(dir, env).clis, ['glab', 'tea']);
  assert.match(profileLine(profile(dir, env)), /CLIs on PATH: glab, tea;/);
});

test('garbage MCP configs read as no servers', () => {
  const dir = repo('git@github.com:o/r.git');
  fs.writeFileSync(path.join(dir, '.mcp.json'), '{not json');
  const env = envFor(dir);
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'), '[]');
  assert.deepStrictEqual(profile(dir, env).mcp, []);
});

test('line length', () => {
  const p = { host: 'a-very-long-self-hosted-forge-host.internal.example.com', kind: 'unknown', remote: 'upstream-mirror',
    clis: ['gh', 'glab', 'az', 'tea', 'bb'], mcp: ['github-enterprise', 'gitlab-self-hosted', 'azure-devops-org', 'gitea-home', 'bitbucket-cloud'],
    watch: 'off', why: 'switched off by ALFRED_CODE_HOOKS_OFF' };
  const line = profileLine(p);
  assert.ok(line.length <= 200, `${line.length}: ${line}`);
  assert.match(line, /ref watch: off/);
  assert.match(line, /\+\d+ more/);
});

test('loud-only shown', () => {
  const dir = repo('git@github.com:o/r.git');
  const p = profile(dir, envFor(dir, { ALFRED_CODE_FORGE_WATCH: 'loud-only' }));
  assert.strictEqual(p.watch, 'loud-only');
  assert.match(profileLine(p), /ref watch: loud-only\.$/);
});

test('the watch switch turns it off', () => {
  const dir = repo('git@github.com:o/r.git');
  const p = profile(dir, envFor(dir, { ALFRED_CODE_HOOKS_OFF: 'forge-session:watch' }));
  assert.strictEqual(p.watch, 'off');
  assert.match(profileLine(p), /ref watch: off \(switched off\)\.$/);
});

// --- the hook entry -------------------------------------------------------------------------------------------------
const runHook = (dir, payload, env) => spawnSync(process.execPath, [HOOK], {
  input: typeof payload === 'string' ? payload : JSON.stringify({ cwd: dir, session_id: 'fs-1', ...payload }),
  encoding: 'utf8', cwd: dir, env: { ...process.env, ...env },
});

test('the line reaches the session and every seat', () => {
  const dir = repo('git@github.com:o/r.git');
  const env = envFor(dir);
  for (const event of ['SessionStart', 'SubagentStart']) {
    const r = runHook(dir, { hook_event_name: event, source: 'startup', agent_id: event === 'SubagentStart' ? 'a1' : undefined }, { ...env, PATH: process.env.PATH });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.strictEqual(out.hookEventName, event);
    assert.match(out.additionalContext, /^Forge: github\.com \(github\), remote origin;/);
  }
});

test('outside a git repo, and on garbage stdin, the hook is silent', () => {
  const plain = fs.mkdtempSync(path.join(TMP, 'plain-'));
  const r = runHook(plain, { hook_event_name: 'SessionStart' }, { ...envFor(plain), PATH: process.env.PATH });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  const g = runHook(plain, '{garbage', { ...envFor(plain), PATH: process.env.PATH });
  assert.strictEqual(g.status, 0);
  assert.strictEqual(g.stdout, '');
});

// --- the ref watch: every branch and tag, diffed after a strong call and at the end of a turn -----------------------
// A local bare repo is `origin`; a teammate's clone moves refs the session never made. The baseline is the start
// snapshot the SessionStart child takes (`--snapshot`, run inline here so the case never races a detached process).
const forge = require(path.join(__dirname, '..', 'stack', 'hooks', 'forge.js'));
function watchRepo() {
  const base = fs.mkdtempSync(path.join(TMP, 'watch-'));
  const remote = path.join(base, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const clone = (name) => {
    const at = path.join(base, name);
    spawnSync('git', ['clone', '-q', remote, at]);
    const g = (...a) => spawnSync('git', ['-C', at, ...a], { encoding: 'utf8' });
    g('config', 'user.email', `${name}@example.com`); g('config', 'user.name', name); g('config', 'commit.gpgsign', 'false');
    return g;
  };
  const git = clone('repo');
  const dir = path.join(base, 'repo');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed'); git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main');
  const mate = clone('mate');
  mate('checkout', '-q', 'main');
  const mateCommit = (msg) => { fs.writeFileSync(path.join(base, 'mate', `${msg}.txt`), `${msg}\n`); mate('add', '-A'); mate('commit', '-qm', msg); return mate('rev-parse', 'HEAD').stdout.trim(); };
  return { dir, git, mate, mateCommit, remote, base };
}
const SID = 'watch-s1';
const watchEnv = (dir, extra = {}) => ({ ...process.env, CLAUDE_PROJECT_DIR: dir, ALFRED_CODE_HOOKS_OFF: '', ...extra });
const snap = (dir, session = SID, extra = {}) => spawnSync(process.execPath, [HOOK, '--snapshot', dir, session], { encoding: 'utf8', cwd: dir, env: watchEnv(dir, extra) });
function turn(dir, calls) {
  const file = path.join(dir, '..', `t-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  const now = new Date().toISOString();
  const rows = [{ type: 'user', timestamp: now, message: { role: 'user', content: 'go on' } },
    { type: 'assistant', timestamp: now, message: { role: 'assistant', content: calls.map(([name, input], i) => ({ type: 'tool_use', id: `tu${i}`, name, input })) } }];
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
const BUILD = [['Bash', { command: 'node build.js' }]];
const stop = (dir, calls = BUILD, extra = {}, session = SID) => runHook(dir, { hook_event_name: 'Stop', session_id: session, stop_hook_active: false, transcript_path: turn(dir, calls) }, watchEnv(dir, extra));
const post = (dir, toolName, input, extra = {}) => runHook(dir, { hook_event_name: 'PostToolUse', session_id: SID, tool_name: toolName, tool_input: input, tool_response: {} }, watchEnv(dir, extra));
const out = (r) => (r.stdout.trim() ? JSON.parse(r.stdout) : {});

test('uncovered main move is loud', () => {
  const w = watchRepo();
  const before = w.git('rev-parse', 'HEAD').stdout.trim();
  assert.strictEqual(snap(w.dir).status, 0);
  const after = w.mateCommit('hotfix');
  w.mate('push', '-q', 'origin', 'main');
  const r = stop(w.dir);
  assert.strictEqual(r.status, 0, r.stderr);
  const o = out(r);
  assert.strictEqual(o.decision, 'block', r.stdout);
  assert.match(o.reason, new RegExp(`main moved ${before.slice(0, 7)}\\.\\.${after.slice(0, 7)} this turn; no gated act explains it`));
  assert.strictEqual(out(stop(w.dir)).decision, undefined, 'a move is reported once');
});

test('ledger-covered move is silent', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  fs.writeFileSync(path.join(w.dir, 'b.txt'), 'b\n');
  w.git('add', '-A'); w.git('commit', '-qm', 'b');
  forge.recordAct(w.dir, SID, { concept: 'branch.write', ref: 'main', head: w.git('rev-parse', 'HEAD').stdout.trim() }, watchEnv(w.dir));
  w.git('push', '-q', 'origin', 'main');
  const r = stop(w.dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('a gated push of one branch does not cover a move of another', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  forge.recordAct(w.dir, SID, { concept: 'branch.write', ref: 'feat/mine', head: null }, watchEnv(w.dir));
  w.mateCommit('sneak');
  w.mate('push', '-q', 'origin', 'main');
  assert.strictEqual(out(stop(w.dir)).decision, 'block');
});

test('teammate feature branch is summary', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.mate('checkout', '-q', '-b', 'feat/x'); w.mateCommit('x');
  w.mate('push', '-q', 'origin', 'feat/x');
  const o = out(stop(w.dir));
  assert.strictEqual(o.decision, undefined);
  assert.match(o.systemMessage, /^Ref watch: other branches moved this turn: feat\/x - teammates or this session\.$/);
});

test('local commit on any branch is loud', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.git('checkout', '-q', '-b', 'feat/y');
  fs.writeFileSync(path.join(w.dir, 'y.txt'), 'y\n');
  w.git('add', '-A'); w.git('commit', '-qm', 'y');
  w.git('push', '-q', 'origin', 'feat/y');
  const o = out(stop(w.dir));
  assert.strictEqual(o.decision, 'block', JSON.stringify(o));
  assert.match(o.reason, /feat\/y appeared at [0-9a-f]{7} this turn/);
  assert.match(o.reason, /a commit in this checkout/);
});

test('new tag is loud', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.mate('tag', 'v9'); w.mate('push', '-q', 'origin', 'v9');
  const o = out(stop(w.dir));
  assert.strictEqual(o.decision, 'block');
  assert.match(o.reason, /tag v9 appeared at/);
});

test('a release covers the tag it makes', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.git('tag', 'v2'); w.git('push', '-q', 'origin', 'v2');
  const p = post(w.dir, 'Bash', { command: 'gh release create v2 --notes x' });
  assert.strictEqual(p.status, 0, p.stderr);
  assert.strictEqual(p.stdout, '');
  assert.strictEqual(stop(w.dir).stdout, '');
});

test('post-call window blocks', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.mateCommit('landed'); w.mate('push', '-q', 'origin', 'main');
  const read = post(w.dir, 'mcp__gitlab__get_merge_request', { merge_request_iid: 4 });
  assert.strictEqual(read.stdout, '', 'a read arms no window');
  const r = post(w.dir, 'mcp__gitlab__pull_request_frobnicate', { iid: 4 });
  assert.strictEqual(r.status, 0, r.stderr);
  const o = out(r);
  assert.strictEqual(o.decision, 'block');
  assert.match(o.reason, /main moved/);
  assert.match(o.reason, /report/i);
  assert.strictEqual(out(stop(w.dir)).decision, undefined, 'the window\'s report is not repeated at Stop');
});

test('read-only turn skips the diff', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.git('remote', 'set-url', 'origin', path.join(w.base, 'gone.git'));
  const reads = [['Read', { file_path: 'a.txt' }], ['Bash', { command: 'git status && git diff --stat && ls -la | head -5' }], ['Grep', { pattern: 'x' }], ['mcp__gitlab__get_merge_request', { merge_request_iid: 1 }]];
  assert.strictEqual(stop(w.dir, reads).stdout, '', 'no ls-remote ran, so nothing was not checked');
  assert.match(out(stop(w.dir, [['Bash', { command: 'npm test' }]])).systemMessage, /^Ref watch: not checked \('.+gone\.git' does not appear to be a git repository\)\.$/);
});

test('a seat dispatch and an unknown tool count as a non-read turn', () => {
  for (const calls of [[['Agent', { prompt: 'x' }]], [['mcp__browser__click', { ref: 'e1' }]]]) {
    const w = watchRepo();
    assert.strictEqual(snap(w.dir).status, 0);
    w.mateCommit('seat'); w.mate('push', '-q', 'origin', 'main');
    assert.strictEqual(out(stop(w.dir, calls)).decision, 'block', calls[0][0]);
  }
});

test('unreachable remote', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.git('remote', 'set-url', 'origin', 'ssh://git@nohost.invalid/x.git');
  const t0 = Date.now();
  const o = out(stop(w.dir));
  assert.ok(Date.now() - t0 < 9000, `took ${Date.now() - t0}ms`);
  assert.strictEqual(o.decision, undefined);
  assert.match(o.systemMessage, /^Ref watch: not checked \(.+\)\.$/);
});

test('many branches', () => {
  const w = watchRepo();
  const seed = w.git('rev-parse', 'HEAD').stdout.trim();
  const refs = Array.from({ length: 3000 }, (_, i) => `refs/heads/team/b${i}`);
  spawnSync('git', ['-C', w.remote, 'update-ref', '--stdin'], { input: refs.map((r) => `create ${r} ${seed}\n`).join('') });
  assert.strictEqual(snap(w.dir).status, 0);
  w.mate('checkout', '-q', '-b', 'team/base'); const moved = w.mateCommit('wide'); w.mate('push', '-q', 'origin', 'team/base');
  spawnSync('git', ['-C', w.remote, 'update-ref', '--stdin'], { input: refs.slice(0, 60).map((r) => `update ${r} ${moved}\n`).join('') });
  const t0 = Date.now();
  const o = out(stop(w.dir));
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0}ms`);
  assert.strictEqual(o.decision, undefined);
  assert.ok(!o.systemMessage.includes('\n'), 'one line');
  assert.match(o.systemMessage, /\+\d+ more/);
  assert.ok(o.systemMessage.length < 400, o.systemMessage.length);
});

test('next session reports only after an unknown call', () => {
  for (const unknown of [true, false]) {
    const w = watchRepo();
    assert.strictEqual(snap(w.dir, 'prev').status, 0);
    if (unknown) forge.recordAct(w.dir, 'prev', { concept: 'change.merge', change: '4', asked: true }, watchEnv(w.dir));
    assert.strictEqual(stop(w.dir, BUILD, {}, 'prev').stdout, '');
    w.mateCommit('auto-merged'); w.mate('push', '-q', 'origin', 'main');
    assert.strictEqual(snap(w.dir, 'next').status, 0);
    const o = out(stop(w.dir, [['Read', { file_path: 'a.txt' }]], {}, 'next'));
    if (unknown) {
      assert.match(o.reason || '', /since the last session/i);
      assert.match(o.reason, /main moved/);
    } else assert.deepStrictEqual(o, {});
  }
});

test('switch off', () => {
  const w = watchRepo();
  const off = { ALFRED_CODE_HOOKS_OFF: 'forge-session:watch' };
  assert.strictEqual(snap(w.dir, SID, off).status, 0);
  assert.ok(!fs.existsSync(path.join(w.dir, '.alfred', 'state', 'forge', `REFS-${SID}.json`)), 'no snapshot taken');
  assert.strictEqual(snap(w.dir).status, 0);
  w.mateCommit('off'); w.mate('push', '-q', 'origin', 'main');
  assert.strictEqual(post(w.dir, 'mcp__gitlab__pull_request_frobnicate', { iid: 4 }, off).stdout, '');
  assert.strictEqual(stop(w.dir, BUILD, off).stdout, '');
});

test('loud-only', () => {
  const w = watchRepo();
  assert.strictEqual(snap(w.dir).status, 0);
  w.mate('checkout', '-q', '-b', 'feat/x'); w.mateCommit('x'); w.mate('push', '-q', 'origin', 'feat/x');
  assert.strictEqual(stop(w.dir, BUILD, { ALFRED_CODE_FORGE_WATCH: 'loud-only' }).stdout, '');
});

test('the session start takes the baseline in the background', async () => {
  const w = watchRepo();
  const r = runHook(w.dir, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'bg-1' }, watchEnv(w.dir));
  assert.strictEqual(r.status, 0, r.stderr);
  const file = path.join(w.dir, '.alfred', 'state', 'forge', 'REFS-bg-1.json');
  for (let i = 0; i < 50 && !fs.existsSync(file); i++) await new Promise((ok) => setTimeout(ok, 100));
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(state.refs['refs/heads/main'], JSON.stringify(state));
  assert.strictEqual(state.head, 'refs/heads/main');
});

test('a push names the refs it writes', () => {
  const cur = repo(null);
  spawnSync('git', ['-C', cur, 'checkout', '-q', '-b', 'feat/here']);
  assert.deepStrictEqual(forge.pushTargets(['origin', 'HEAD:refs/heads/feat/x'], cur), ['feat/x']);
  assert.deepStrictEqual(forge.pushTargets(['--force', 'origin', 'main', 'v1.0'], cur), ['main', 'v1.0']);
  assert.deepStrictEqual(forge.pushTargets(['-o', 'ci.skip', 'origin', '+main:release'], cur), ['release']);
  assert.deepStrictEqual(forge.pushTargets(['origin', ':old', '--delete'], cur), ['old']);
  assert.deepStrictEqual(forge.pushTargets([], cur), ['feat/here']);
  assert.deepStrictEqual(forge.pushTargets(['origin', 'HEAD'], cur), ['feat/here']);
  assert.strictEqual(forge.pushTargets(['--all', 'origin'], cur), null);
  assert.strictEqual(forge.pushTargets(['--tags'], cur), null);
});

// --- the forge CLI: which one, and how it is installed (--forge-cli, init's ask, the prerequisite check) ------------
const { cliPlan } = require(HOOK);
test('the forge CLI plan follows the origin kind', () => {
  const lab = repo('git@gitlab.com:g/r.git');
  const p = profile(lab, envFor(lab));
  assert.deepStrictEqual(cliPlan(p, { platform: 'darwin', hasBrew: true }), { action: 'brew', cli: 'glab', formula: 'glab', after: null, how: 'https://gitlab.com/gitlab-org/cli' });
  assert.strictEqual(cliPlan(p, { platform: 'darwin', hasBrew: false }).action, 'manual');
  assert.match(cliPlan(p, { platform: 'darwin', hasBrew: false }).how, /install Homebrew, then brew install glab/);
  assert.deepStrictEqual(cliPlan(p, { platform: 'linux', hasBrew: false }), { action: 'manual', cli: 'glab', need: 'glab', how: 'install glab by hand: https://gitlab.com/gitlab-org/cli' });
  const az = repo('https://org@dev.azure.com/org/p/_git/r');
  assert.deepStrictEqual(cliPlan(profile(az, envFor(az)), { platform: 'darwin', hasBrew: true }).after, ['az', 'extension', 'add', '--name', 'azure-devops']);
});

test('no CLI is planned for an unknown forge, one already on PATH, or no remote', () => {
  const odd = repo('https://code.example.com/x.git');
  assert.strictEqual(cliPlan(profile(odd, envFor(odd)), { platform: 'darwin', hasBrew: true }).action, 'none');
  const hub = repo('git@github.com:o/r.git');
  const env = envFor(hub);
  onPath(env, 'gh');
  assert.deepStrictEqual(cliPlan(profile(hub, env), { platform: 'darwin', hasBrew: true }), { action: 'present', cli: 'gh' });
  const none = repo(null);
  assert.strictEqual(cliPlan(profile(none, envFor(none)), { platform: 'darwin', hasBrew: true }).action, 'none');
});

// The CLI runs git, so its PATH keeps the machine's dirs - minus any that hold a forge CLI this machine happens to have.
const gitOnlyPath = (env) => [env.PATH, ...String(process.env.PATH).split(path.delimiter)
  .filter((d) => !['gh', 'glab', 'tea', 'az'].some((n) => fs.existsSync(path.join(d, n)) || fs.existsSync(path.join(d, `${n}.exe`))))].join(path.delimiter);
test('init reads the profile and its ask condition from one call', () => {
  const lab = repo('git@gitlab.com:g/r.git');
  const env = envFor(lab);
  env.PATH = gitOnlyPath(env);
  const r = spawnSync(process.execPath, [HOOK, '--profile', lab], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.strictEqual(r.status, 0, r.stderr);
  const [line, ask] = r.stdout.trim().split('\n');
  assert.match(line, /^Forge: gitlab\.com \(gitlab\), remote origin;/);
  assert.strictEqual(ask, 'forge-cli: ask - glab is not on PATH and no forge MCP server is configured');
  fs.writeFileSync(path.join(lab, '.mcp.json'), JSON.stringify({ mcpServers: { work: { command: 'npx', args: ['@zereight/mcp-gitlab'] } } }));
  const r2 = spawnSync(process.execPath, [HOOK, '--profile', lab], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.strictEqual(r2.stdout.trim().split('\n')[1], 'forge-cli: no ask - the forge MCP server work is configured');
  const odd = repo('https://code.example.com/x.git');
  const r3 = spawnSync(process.execPath, [HOOK, '--profile', odd], { encoding: 'utf8', env: { ...process.env, ...envFor(odd), PATH: env.PATH } });
  assert.strictEqual(r3.stdout.trim().split('\n')[1], 'forge-cli: no ask - no CLI is known for an unknown forge');
});

test('--forge-cli installs the forge CLI with Homebrew, or names how', () => {
  const { forgeCliStep } = require(path.join(__dirname, 'install', 'alfred-code.js'));
  const run = (dir, { flag = true, platform = 'darwin', brew = true, fail = false, extraEnv = {} } = {}) => {
    const calls = [], logs = [], notes = [];
    const ctx = { args: { forgeCli: flag }, projectRoot: dir, env: { ...envFor(dir), ...extraEnv }, log: (s) => logs.push(s), note: (s) => notes.push(s),
      rt: { platform, which: (c) => c === 'brew' && brew, execCommand: (bin, argv) => { calls.push([bin, ...argv]); if (fail) throw new Error('Command failed: brew\nno network'); return ''; } } };
    forgeCliStep(ctx);
    return { calls, logs, notes };
  };
  const lab = repo('git@gitlab.com:g/r.git');
  assert.deepStrictEqual(run(lab, { flag: false }), { calls: [], logs: [], notes: [] }, 'no flag, nothing');
  const r = run(lab);
  assert.deepStrictEqual(r.calls, [['brew', 'install', 'glab']]);
  assert.deepStrictEqual(r.logs, ['  forge CLI: glab installed (brew install glab)']);
  const az = repo('https://org@dev.azure.com/org/p/_git/r');
  assert.deepStrictEqual(run(az).calls, [['brew', 'install', 'azure-cli'], ['az', 'extension', 'add', '--name', 'azure-devops']]);
  assert.deepStrictEqual(run(lab, { platform: 'linux', brew: false }).notes, ['forge CLI: install glab by hand: https://gitlab.com/gitlab-org/cli']);
  assert.match(run(lab, { fail: true }).notes[0], /^forge CLI: brew install glab failed \(Command failed: brew\) - https:\/\/gitlab\.com/);
  assert.deepStrictEqual(run(repo('https://code.example.com/x.git')).calls, [], 'no CLI known, nothing run');
});
