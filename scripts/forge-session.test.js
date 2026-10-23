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
