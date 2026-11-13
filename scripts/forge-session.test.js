'use strict';
// The forge line at session and seat start: which forge the remote is, which forge CLIs are on PATH, which MCP servers
// are forge servers (by their launch command or URL, never their name) - facts the model maps each concept onto, so it
// never guesses the remote. No network.
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
  const line = profileLine(p);
  assert.match(line, /^Forge: github\.com \(github\), remote origin; /);
  assert.match(line, /CLIs on PATH: none; forge MCP servers: none\.$/);
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
  assert.match(profileLine(p), /^Forge: no remote; CLIs on PATH: none; forge MCP servers: none\.$/);
});

test('mcp found by launch', () => {
  const dir = repo('git@gitlab.com:g/r.git');
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {
    work: { command: 'npx', args: ['@zereight/mcp-gitlab'] },
    'My Odd.Server-1': { command: '/opt/homebrew/bin/glab', args: ['mcp', 'serve'] }, // glab's own stdio server (1.124.0)
    github: { command: 'npx', args: ['some-unrelated-server'] }, // the key alone never makes a forge server
    'alfred-navigation': { command: 'npx', args: ['github-mcp-server'] }, // a name is no exemption: the stack ships no server (2026-10-24)
  } }));
  const env = envFor(dir);
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({
    mcpServers: { hub: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
    projects: { [dir]: { mcpServers: { ado: { command: 'npx', args: ['-y', '@azure-devops/mcp', 'org'] } } } },
  }));
  assert.deepStrictEqual(profile(dir, env).mcp.sort(), ['My Odd.Server-1', 'ado', 'alfred-navigation', 'hub', 'work']);
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
    clis: ['gh', 'glab', 'az', 'tea', 'bb'], mcp: ['github-enterprise', 'gitlab-self-hosted', 'azure-devops-org', 'gitea-home', 'bitbucket-cloud', 'forgejo-home'] };
  const line = profileLine(p);
  assert.ok(line.length <= 200, `${line.length}: ${line}`);
  assert.match(line, /\+\d+ more/);
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

test('a malformed lexicon overlay is named to the user at start, once - the line still goes out', () => {
  const dir = repo('git@gitlab.com:o/r.git');
  fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.alfred', 'forge-lexicon.json'), '{ not json');
  const env = { ...envFor(dir), PATH: process.env.PATH };
  const start = JSON.parse(runHook(dir, { hook_event_name: 'SessionStart', source: 'startup' }, env).stdout);
  assert.match(start.systemMessage, /forge-lexicon\.json overlay at .* is not valid JSON .* ignored, the base vocabulary applies/);
  assert.match(start.hookSpecificOutput.additionalContext, /^Forge: gitlab\.com \(gitlab\)/);
  const seat = JSON.parse(runHook(dir, { hook_event_name: 'SubagentStart', agent_id: 'a1' }, env).stdout);
  assert.strictEqual(seat.systemMessage, undefined);
  fs.writeFileSync(path.join(dir, '.alfred', 'forge-lexicon.json'), JSON.stringify({ verbs: { merge: ['ship'] } }));
  assert.strictEqual(JSON.parse(runHook(dir, { hook_event_name: 'SessionStart', source: 'startup' }, env).stdout).systemMessage, undefined);
});

test('R013: an overlay host kind teaches a self-hosted forge', () => {
  const dir = repo('https://git.acme.example/g/r.git');
  fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.alfred', 'forge-lexicon.json'), JSON.stringify({ hints: { kinds: { 'git.acme.example': 'gitlab', 'bad.example': 'nonsense' } } }));
  assert.strictEqual(profile(dir, envFor(dir)).kind, 'gitlab');
  const start = JSON.parse(runHook(dir, { hook_event_name: 'SessionStart', source: 'startup' }, { ...envFor(dir), PATH: process.env.PATH }).stdout);
  assert.match(start.systemMessage, /^Forge: the forge-lexicon\.json overlay at .* names keys the vocabulary does not read - ignored: hints\.kinds\.bad\.example \(not a known kind\)/);
  assert.match(start.hookSpecificOutput.additionalContext, /\(gitlab\)/);
});

// Complexity stage 1 B9: the act ledger and the ref watch left (0 fires in 442 sessions). The hook keeps its start line
// for init and every seat; a no-ledger install still wiring PostToolUse and Stop gets a silent no-op.
test('stage 1 B9: PostToolUse and Stop are no-ops; the start line has no ref watch', () => {
  const base = fs.mkdtempSync(path.join(TMP, 'b9-'));
  const remote = path.join(base, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const dir = path.join(base, 'repo');
  spawnSync('git', ['clone', '-q', remote, dir]);
  const g = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n');
  g('add', '-A'); g('commit', '-qm', 'seed'); g('branch', '-M', 'main'); g('push', '-q', '-u', 'origin', 'main');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: test\n');
  const env = { ...envFor(dir), PATH: process.env.PATH, ALFRED_CODE_HOOKS_OFF: '' };
  const transcript = path.join(base, 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'node build.js' } }] } })}\n`);
  for (const payload of [
    { hook_event_name: 'PostToolUse', session_id: 'b9', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_use_id: 'tu1', tool_response: {} },
    { hook_event_name: 'Stop', session_id: 'b9', stop_hook_active: false, transcript_path: transcript },
  ]) {
    const r = runHook(dir, payload, env);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', payload.hook_event_name);
  }
  const forgeState = path.join(dir, '.alfred', 'state', 'forge');
  const left = fs.existsSync(forgeState) ? fs.readdirSync(forgeState).filter((n) => /^(?:ACTS|REFS)-/.test(n)) : [];
  assert.deepStrictEqual(left, [], 'no act ledger, no ref snapshot');
  const start = runHook(dir, { hook_event_name: 'SessionStart', session_id: 'b9', source: 'startup' }, env);
  assert.strictEqual(start.status, 0, start.stderr);
  assert.strictEqual(start.stderr, '');
  const line = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
  assert.match(line, /^Forge: /);
  assert.doesNotMatch(line, /ref watch/);
  const hooksDir = path.join(__dirname, '..', 'stack', 'hooks');
  const naming = fs.readdirSync(hooksDir).filter((n) => /FORGE_WATCH|forge-session:watch/.test(fs.readFileSync(path.join(hooksDir, n), 'utf8')));
  assert.deepStrictEqual(naming, [], 'no hook reads the retired key or the watch part');
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

// Review 2026-11-05 (#8): the plan reads the PROFILED project's vocabulary, as profile() does (R013) - never the overlay of
// the folder this process happens to run in.
test('R013 review: the CLI plan reads the overlay of the profiled project, not of the process folder', () => {
  // Only an overlay can name a CLI for a kind the base gives none (bitbucket) and that CLI's install line (OPEN_KEYS).
  const dir = repo('https://bitbucket.acme.example/g/r.git');
  fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.alfred', 'forge-lexicon.json'), JSON.stringify({ hints: { clis: { bitbucket: 'bbcli' }, install: { bbcli: { how: 'https://bitbucket.acme.example/tools/bbcli' } } } }));
  const env = envFor(dir);
  const p = profile(dir, env);
  assert.strictEqual(p.kind, 'bitbucket');
  assert.notStrictEqual(path.resolve(process.cwd()), path.resolve(dir), 'the test runs outside the profiled project');
  assert.deepStrictEqual(cliPlan(p, { platform: 'linux', hasBrew: false, env }), { action: 'manual', cli: 'bbcli', need: 'bbcli', how: 'install bbcli by hand: https://bitbucket.acme.example/tools/bbcli' });
  onPath(env, 'bbcli');
  assert.deepStrictEqual(cliPlan(profile(dir, env), { platform: 'linux', hasBrew: false, env }), { action: 'present', cli: 'bbcli' });
});

// The CLI runs git, so its PATH keeps the machine's dirs - minus any that hold a forge CLI this machine happens to have.
// A dropped dir's own git keeps its place through a link in a folder of its own: GitHub's Ubuntu runners keep gh and
// git side by side in /usr/bin, and dropping it left the hook no git at all.
const gitOnlyPath = (env) => [env.PATH, ...String(process.env.PATH).split(path.delimiter).flatMap((d) => {
  const has = (n) => fs.existsSync(path.join(d, n)) || fs.existsSync(path.join(d, `${n}.exe`));
  if (!['gh', 'glab', 'tea', 'az'].some(has)) return [d];
  const git = ['git', 'git.exe'].map((n) => path.join(d, n)).find((f) => fs.existsSync(f));
  if (!git) return [];
  const own = fs.mkdtempSync(path.join(TMP, 'git-'));
  fs.symlinkSync(git, path.join(own, path.basename(git)));
  return [own];
})].join(path.delimiter);
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
