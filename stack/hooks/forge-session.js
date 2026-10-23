#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// forge-session.js - SessionStart + SubagentStart: ONE line of facts about this repo's forge, so the model maps each
// concept (merge a change, write a branch, watch a pipeline - forge.js) onto whatever tool it has and never guesses the
// remote: the host and its kind, the remote the branch pushes to, the forge CLIs on PATH, the MCP servers that are forge
// servers and whether the ref watch is on. A forge MCP server is found by its launch command or URL in the MCP configs
// (forge-lexicon.json hints.mcpLaunch), never by its name - a server keyed 'github' that runs something else is not
// one. No network here: the line is git config, PATH and two JSON files. Fail-open: garbage stdin, no git, no prelude -
// exit 0, print nothing. Outside a git repo it says nothing at all.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The classifier engine beside it; an install without it says nothing (fail-open, like a missing prelude).
let forge = null;
try { forge = require(path.join(__dirname, 'forge.js')); } catch { /* no engine: no line */ }
// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every hook. Fail-open: no
// prelude runs the hook, the switches read bare.
let prelude = null;
try { prelude = require(path.join(__dirname, 'hook-prelude.js')); } catch { /* no prelude: the bare ALFRED_CODE_ reads */ }
const envOf = (env, suffix) => (prelude ? prelude.envOf(env, suffix) : env[`ALFRED_CODE_${suffix}`]);
const partOff = (part, env) => (prelude ? prelude.partOff('forge-session', part, env)
  : String(env.ALFRED_CODE_HOOKS_OFF || '').split(',').some((e) => e.trim().toLowerCase() === `forge-session:${part}`));

const LINE_MAX = 200;
const hints = () => { try { return forge.loadLexicon(null).hints || {}; } catch { return {}; } };
const readJson = (file) => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };

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

// Every MCP server outside the stack whose launch command, arguments or URL carries a forge server's mark: the project's
// .mcp.json, the account's user-scope servers and its entry for this project (keyed by the path as the CLI spelled it).
function forgeServers(root, env, marks) {
  const home = env.HOME || env.USERPROFILE || (() => { try { return os.homedir(); } catch { return ''; } })();
  const account = readJson(path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json')) || {};
  const projects = account.projects && typeof account.projects === 'object' ? account.projects : {};
  const own = projects[root] || projects[root.split(path.sep).join('/')] || {};
  const sources = [(readJson(path.join(root, '.mcp.json')) || {}).mcpServers, account.mcpServers, own.mcpServers];
  const wanted = (marks || []).map((m) => String(m).toLowerCase());
  const found = new Set();
  for (const servers of sources) {
    if (!servers || typeof servers !== 'object') continue;
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry || typeof entry !== 'object' || forge.isStackServer(`mcp__${name}__x`)) continue;
      const args = Array.isArray(entry.args) ? entry.args : [];
      const launch = [entry.command, ...args, entry.url].filter((v) => typeof v === 'string').join(' ').toLowerCase();
      if (wanted.some((m) => launch.includes(m))) found.add(name);
    }
  }
  return [...found];
}

// { host, kind, remote, clis, mcp, watch: 'on' | 'off' | 'loud-only', why } for the repo at `cwd`.
function profile(cwd, env = process.env) {
  const h = hints();
  const root = env.CLAUDE_PROJECT_DIR || forge.gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd;
  const remote = forge.remoteOf(cwd);
  const url = remote ? forge.gitOut(cwd, ['remote', 'get-url', remote]) : null;
  const host = remote ? hostOf(url) : null;
  const clis = clisOnPath([...new Set(Object.values(h.clis || {}))], env);
  let mcp = [];
  try { mcp = forgeServers(path.resolve(root), env, h.mcpLaunch); } catch { /* a config we cannot read lists no server */ }
  let watch = 'on', why = null;
  if (partOff('watch', env)) { watch = 'off'; why = 'switched off'; }
  else if (!remote) { watch = 'off'; why = 'no remote'; }
  else if (String(envOf(env, 'FORGE_WATCH') || '').trim().toLowerCase() === 'loud-only') watch = 'loud-only';
  return { host, kind: remote ? kindOf(host, h.kinds) : null, remote, clis, mcp, watch, why };
}

// The line, at most LINE_MAX chars: long lists keep their first names and count the rest.
function profileLine(p) {
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}~` : String(s));
  const list = (xs, k) => (!xs.length ? 'none' : k >= xs.length ? xs.join(', ') : `${xs.slice(0, k).join(', ')} +${xs.length - k} more`);
  const head = p.remote ? `Forge: ${clip(p.host, 48)} (${p.kind}), remote ${clip(p.remote, 24)}` : 'Forge: no remote';
  const watch = p.watch === 'off' ? `off (${clip(p.why || 'off', 40)})` : p.watch;
  const clis = p.clis || [], mcp = (p.mcp || []).map((n) => clip(n, 32));
  let line = '';
  for (let k = Math.max(clis.length, mcp.length); k >= 0; k--) {
    line = `${head}; CLIs on PATH: ${list(clis, k)}; forge MCP servers: ${list(mcp, k)}; ref watch: ${watch}.`;
    if (line.length <= LINE_MAX) return line;
  }
  return `${line.slice(0, LINE_MAX - 1)}.`;
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
  if (!forge || (prelude && prelude.standDown('forge-session'))) return 0;
  let payload;
  try { payload = JSON.parse(await readStdinBounded(STDIN_TIMEOUT_MS)); } catch { return 0; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards.
  if (prelude && prelude.cursorStandDown(payload, __filename)) return 0;
  const event = payload.hook_event_name || '';
  if (event !== 'SessionStart' && event !== 'SubagentStart') return 0;
  const cwd = payload.cwd || process.cwd();
  if (!forge.gitOut(cwd, ['rev-parse', '--git-dir'])) return 0;
  const line = profileLine(profile(cwd, process.env));
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: line } }));
  return 0;
}

module.exports = { profile, profileLine, hostOf, LINE_MAX };
if (require.main === module) main().catch(() => 0).then((code) => process.exit(code));
