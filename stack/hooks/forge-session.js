#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// forge-session.js - SessionStart + SubagentStart: ONE line of facts about this repo's forge, so the model maps each
// concept (merge a change, write a branch, watch a pipeline - forge.js) onto whatever tool it has and never guesses the
// remote: the host and its kind, the remote the branch pushes to, the forge CLIs on PATH and the MCP servers that are
// forge servers. A forge MCP server is found by its launch command or URL in the MCP configs
// (forge-lexicon.json hints.mcpLaunch), never by its name - a server keyed 'github' that runs something else is not
// one. No network in the line: it is git config, PATH and two JSON files. Fail-open: garbage stdin, no git, no prelude -
// exit 0, print nothing. Outside a git repo it says nothing at all. The ref watch and the act ledger it read left in
// complexity stage 1 (B9: 0 fires in 442 sessions).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The classifier engine beside it; an install without it says nothing (fail-open, like a missing prelude).
let forge = null;
try { forge = require(path.join(__dirname, 'forge.js')); } catch { /* no engine: no line */ }
// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every hook. Fail-open: no
// prelude runs the hook ungated.
let prelude = null;
try { prelude = require(path.join(__dirname, 'hook-prelude.js')); prelude.blockingStdio(); } catch { /* no prelude: no gates */ }

const LINE_MAX = 200;
const hints = (root = null, env = process.env) => { try { return forge.loadLexicon(root, env).hints || {}; } catch { return {}; } };

// The host a remote URL names: scp form (git@host:path), a URL (ssh://, https://), or a local path ('local').
function hostOf(url) {
  const u = String(url || '').trim();
  const proto = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(u);
  if (proto) return /^file:/i.test(u) ? 'local' : proto[1].toLowerCase();
  const scp = /^(?:[^@/\\]+@)?([^:/\\]{2,}):(?!\/\/)/.exec(u);
  return scp ? scp[1].toLowerCase() : 'local';
}
function kindOf(host, kinds) {
  if (host === 'local') return 'local';
  for (const [word, kind] of Object.entries(kinds || {})) if (host.includes(word.toLowerCase())) return kind;
  return 'unknown';
}

// Each forge CLI the lexicon names, when an executable of that name is on PATH (PATHEXT on Windows) - no spawn.
function clisOnPath(names, env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  const runnable = (file) => {
    try {
      const st = fs.statSync(file);
      return st.isFile() && (process.platform === 'win32' || (st.mode & 0o111) !== 0);
    } catch { return false; }
  };
  return names.filter((name) => dirs.some((dir) => exts.some((ext) => runnable(path.join(dir, name + ext)) || runnable(path.join(dir, name + ext.toLowerCase())))));
}

// { host, kind, remote, clis, mcp, root } for the repo at `cwd`; `root` is the project whose vocabulary was read, so
// cliPlan reads the same one.
function profile(cwd, env = process.env) {
  const root = env.CLAUDE_PROJECT_DIR || forge.gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd;
  // The vocabulary of the project profiled (its overlay may name a self-hosted forge - R013), not this process's folder.
  const h = hints(root, env);
  const remote = forge.remoteOf(cwd);
  const url = remote ? forge.gitOut(cwd, ['remote', 'get-url', remote]) : null;
  const host = remote ? hostOf(url) : null;
  const clis = clisOnPath([...new Set(Object.values(h.clis || {}))], env);
  let mcp = [];
  // A forge MCP server is found by its launch command or URL in the MCP configs (forge.js forgeServersOf).
  try { mcp = forge.forgeServersOf(path.resolve(root), env, h.mcpLaunch); } catch { /* a config we cannot read lists no server */ }
  return { host, kind: remote ? kindOf(host, h.kinds) : null, remote, clis, mcp, root };
}

// The line, at most LINE_MAX chars: long lists keep their first names and count the rest.
function profileLine(p) {
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}~` : String(s));
  const list = (xs, k) => (!xs.length ? 'none' : k >= xs.length ? xs.join(', ') : `${xs.slice(0, k).join(', ')} +${xs.length - k} more`);
  const head = p.remote ? `Forge: ${clip(p.host, 48)} (${p.kind}), remote ${clip(p.remote, 24)}` : 'Forge: no remote';
  const clis = p.clis || [], mcp = (p.mcp || []).map((n) => clip(n, 32));
  let line = '';
  for (let k = Math.max(clis.length, mcp.length); k >= 0; k--) {
    line = `${head}; CLIs on PATH: ${list(clis, k)}; forge MCP servers: ${list(mcp, k)}.`;
    if (line.length <= LINE_MAX) return line;
  }
  return `${line.slice(0, LINE_MAX - 1)}.`;
}

// The forge CLI a profile needs, and how it gets on PATH (--forge-cli, init's ask, the prerequisite check): `none` - no CLI
// is known for this forge or there is no remote; `present` - already on PATH; `brew` - Homebrew on macOS installs it,
// then runs `after` (az's devops extension); `manual` - what the user installs by hand, `need` naming it. The vocabulary is
// the profiled project's (`p.root`, its overlay - R013), never this process's folder (review 2026-11-05, #8).
function cliPlan(p, { platform = process.platform, hasBrew = false, env = process.env } = {}) {
  const h = hints(p && p.root, env);
  const cli = p && p.remote ? (h.clis || {})[p.kind] : null;
  if (!cli) return { action: 'none' };
  if ((p.clis || []).includes(cli)) return { action: 'present', cli };
  const inst = (h.install || {})[cli] || {};
  if (platform === 'darwin' && inst.brew) {
    return hasBrew ? { action: 'brew', cli, formula: inst.brew, after: inst.after || null, how: inst.how }
      : { action: 'manual', cli, need: 'Homebrew', how: `install Homebrew, then brew install ${inst.brew} (macOS) - or ${inst.how}` };
  }
  return { action: 'manual', cli, need: cli, how: `install ${cli} by hand: ${inst.how || 'see its forge docs'}` };
}
// Init's one read: the session line, then whether its forge-CLI ask is due - the forge known, its CLI absent, no forge MCP
// server configured.
function askLine(p) {
  const plan = cliPlan(p);
  if (plan.action === 'none') return `forge-cli: no ask - no CLI is known for ${p.remote ? `an ${p.kind} forge` : 'a repo with no remote'}`;
  if (plan.action === 'present') return `forge-cli: no ask - ${plan.cli} is on PATH`;
  if (p.mcp.length) return `forge-cli: no ask - the forge MCP server ${p.mcp.join(', ')} is configured`;
  return `forge-cli: ask - ${plan.cli} is not on PATH and no forge MCP server is configured`;
}

const STDIN_TIMEOUT_MS = 2000;
function readStdinBounded(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { process.stdin.pause(); process.stdin.removeAllListeners(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(data), timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => finish(data));
      process.stdin.on('error', () => finish(data));
      process.stdin.resume();
    } catch { finish(''); }
  });
}

async function main() {
  if (!forge) return 0;
  // /alfred-code:init's read (`node forge-session.js --profile [<dir>]`): the line and the forge-CLI ask condition.
  if (process.argv[2] === '--profile') {
    const cwd = path.resolve(process.argv[3] || process.cwd());
    if (!forge.gitOut(cwd, ['rev-parse', '--git-dir'])) { process.stdout.write('Forge: not a git repository.\nforge-cli: no ask - not a git repository\n'); return 0; }
    const p = profile(cwd, { ...process.env, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || cwd });
    process.stdout.write(`${profileLine(p)}\n${askLine(p)}\n`);
    return 0;
  }
  if (prelude && prelude.standDown('forge-session')) return 0;
  let payload;
  try { payload = JSON.parse(await readStdinBounded(STDIN_TIMEOUT_MS)); } catch { return 0; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards.
  if (prelude && prelude.cursorStandDown(payload, __filename)) return 0;
  const event = payload.hook_event_name || '';
  // The start line alone is left (complexity stage 1 B9): a PostToolUse or Stop row an older install still wires is a no-op.
  if (event !== 'SessionStart' && event !== 'SubagentStart') return 0;
  const cwd = payload.cwd || process.cwd();
  if (!forge.gitOut(cwd, ['rev-parse', '--git-dir'])) return 0;
  const p = profile(cwd, process.env);
  // A malformed overlay is ignored - said to the user once a session, or the words they added go unread unnoticed.
  let notice = null;
  if (event === 'SessionStart') { try { notice = forge.loadLexicon(cwd, process.env).notice; } catch { notice = null; } }
  process.stdout.write(JSON.stringify({ ...(notice ? { systemMessage: `Forge: ${notice}.` } : {}), hookSpecificOutput: { hookEventName: event, additionalContext: profileLine(p) } }));
  return 0;
}

module.exports = { profile, profileLine, hostOf, cliPlan, askLine, LINE_MAX };
if (require.main === module) main().catch(() => 0).then((code) => process.exit(code));
