#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// forge-session.js - SessionStart + SubagentStart: ONE line of facts about this repo's forge, so the model maps each
// concept (merge a change, write a branch, watch a pipeline - forge.js) onto whatever tool it has and never guesses the
// remote: the host and its kind, the remote the branch pushes to, the forge CLIs on PATH, the MCP servers that are forge
// servers and whether the ref watch is on. A forge MCP server is found by its launch command or URL in the MCP configs
// (forge-lexicon.json hints.mcpLaunch), never by its name - a server keyed 'github' that runs something else is not
// one. No network in the line: it is git config, PATH and two JSON files. Fail-open: garbage stdin, no git, no prelude -
// exit 0, print nothing. Outside a git repo it says nothing at all.
//
// THE REF WATCH - every branch and tag on the remote, read with plain git (`ls-remote`, bounded in forge.js), so a move no
// gated act explains is reported whichever tool made it: a script, a browser click, a forge tool no lexicon names.
// - SessionStart spawns a detached `--snapshot` child: the session's baseline in <data root>/state/forge/REFS-<session>.json.
// - PostToolUse after a merge, a branch write, a release or a forge call nobody could read: re-read and diff; a LOUD move
//   no ledger act covers blocks with feedback to stop and report it.
// - Stop, when the turn ran anything but a known read: diff once more. Loud moves block once per cycle; the rest is one
//   summary line for the user (`systemMessage`). Loud: the default branch, the upstream, a branch GIT-PREFERENCES.md names,
//   a branch whose new sha is a commit in this checkout, any tag. The baseline then moves to now.
// - The end snapshot is kept per repo (REFS-LAST.json); the next session's child diffs against it and reports only when
//   that session asked about a forge call (an armed auto-merge landing later).
// An unreachable remote is `ref watch: not checked (<why>)`, never clean. `forge-session:watch` in ALFRED_CODE_HOOKS_OFF
// turns the watch off; ALFRED_CODE_FORGE_WATCH=loud-only drops the summary tier and the session line says so.
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

// The forge CLI a profile needs, and how it gets on PATH (--forge-cli, init's ask, the prerequisite check): `none` - no CLI
// is known for this forge or there is no remote; `present` - already on PATH; `brew` - Homebrew on macOS installs it,
// then runs `after` (az's devops extension); `manual` - what the user installs by hand, `need` naming it.
function cliPlan(p, { platform = process.platform, hasBrew = false } = {}) {
  const h = hints();
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

// ---- the ref watch -------------------------------------------------------------------------------------------------
const { spawn, spawnSync } = require('node:child_process');
const sid = (s) => String(s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
const stateFile = (root, name, env) => require(path.join(__dirname, 'layout.js')).statePath(root, 'forge', name, env);
const sessionFile = (root, session, env) => stateFile(root, `REFS-${sid(session)}.json`, env);
const lastFile = (root, env) => stateFile(root, 'REFS-LAST.json', env);
const noteFile = (root, session, env) => stateFile(root, `NOTE-${sid(session)}.json`, env);
function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch { /* the watch never breaks a turn */ }
}
const short = (ref) => String(ref).replace(/^refs\/(?:heads|tags)\//, '');
const isTag = (ref) => /^refs\/tags\//.test(String(ref));
const s7 = (sha) => String(sha || '').slice(0, 7);
const loudOnly = (env) => String(envOf(env, 'FORGE_WATCH') || '').trim().toLowerCase() === 'loud-only';
const rootOf = (cwd, env) => env.CLAUDE_PROJECT_DIR || forge.gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd;

// { ok, remote, refs: { ref: sha }, at, head?, reason? } - every branch and tag; `symref` also reads the default branch.
function snapshot(cwd, remote, { symref = false } = {}) {
  const r = forge.lsRemote(cwd, remote);
  const at = Date.now();
  if (!r.ok) return { ok: false, remote, refs: {}, at, reason: String(r.reason || 'no answer').replace(/[.\s]+$/, '') };
  const out = { ok: true, remote, refs: Object.fromEntries(r.refs), at };
  if (symref) {
    const h = forge.lsRemote(cwd, remote, ['HEAD'], { symref: true });
    if (h.ok && h.head) out.head = h.head;
  }
  return out;
}
// Every ref whose sha differs, created (from null) and deleted (to null) included.
function diffRefs(before, after) {
  const a = before || {}, b = after || {};
  const moves = [];
  for (const ref of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[ref] || null) !== (b[ref] || null)) moves.push({ ref, from: a[ref] || null, to: b[ref] || null });
  return moves.sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0));
}
// The commits among `shas` this checkout holds - one `cat-file --batch-check` for all of them.
function localShas(cwd, shas) {
  const list = [...new Set(shas.filter(Boolean))];
  const have = new Set();
  if (!list.length) return have;
  const r = spawnSync('git', ['cat-file', '--batch-check'], { cwd, input: `${list.join('\n')}\n`, encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  for (const line of String(r.stdout || '').split('\n')) {
    const m = /^([0-9a-f]{40,64}) (\S+)/.exec(line);
    if (m && m[2] !== 'missing') have.add(m[1]);
  }
  return have;
}
// The branch names GIT-PREFERENCES.md spells in backticks (`main`, `develop`, `release/2.x`) - the first copy found.
function preferenceBranches(root) {
  const names = new Set();
  try {
    const ps = require(path.join(__dirname, 'preferences-session.js'));
    for (const dir of ps.contextOf(root).prefsDirs) {
      let text;
      try { text = fs.readFileSync(path.join(dir, 'GIT-PREFERENCES.md'), 'utf8').slice(0, 65536); } catch { continue; }
      for (const m of text.matchAll(/`([A-Za-z0-9._/-]+)`/g)) names.add(m[1].replace(/^refs\/heads\//, ''));
      break;
    }
  } catch { /* no preferences engine or doc: no named branches */ }
  return names;
}
function tierContext(cwd, remote, state, root, moves) {
  let head = state && state.head;
  if (!head) {
    const s = forge.gitOut(cwd, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`]);
    if (s) head = s.replace(`refs/remotes/${remote}/`, 'refs/heads/');
  }
  let upstream = null;
  const branch = forge.gitOut(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (branch) {
    const own = forge.gitOut(cwd, ['config', `branch.${branch}.remote`]);
    const merge = forge.gitOut(cwd, ['config', `branch.${branch}.merge`]);
    if (merge && (!own || own === remote)) upstream = merge;
  }
  return { head, upstream, named: preferenceBranches(root), local: localShas(cwd, moves.map((m) => m.to)) };
}
// 'loud' or 'summary'. With no default branch known, main and master stand in for it.
function tierOf(move, ctx) {
  if (isTag(move.ref)) return 'loud';
  if (move.to && ctx.local && ctx.local.has(move.to)) return 'loud';
  const head = ctx.head || null;
  if (head ? move.ref === head : /^refs\/heads\/(?:main|master)$/.test(move.ref)) return 'loud';
  if (ctx.upstream && move.ref === ctx.upstream) return 'loud';
  return ctx.named && ctx.named.has(short(move.ref)) ? 'loud' : 'summary';
}
// A ledger act's target as a short name (`+src:refs/heads/x` -> x, `origin/x` -> x); null when it names none.
function actTarget(ref, remote) {
  if (!ref) return null;
  let s = String(ref).replace(/^\+/, '');
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  s = s.replace(/^refs\/(?:heads|tags)\//, '');
  if (remote && s.startsWith(`${remote}/`)) s = s.slice(remote.length + 1);
  return !s || s === 'HEAD' ? null : s;
}
// Covered: the new sha is a ledger act's head, or a gated merge / push targeted this ref (or named none), or a release
// explains a new tag. An ASKED act covers nothing - the gate could not read it, so what moved after it is reported.
function covered(move, acts, remote) {
  const { MERGE, BRANCH, RELEASE } = forge.CONCEPTS;
  const name = short(move.ref);
  return (acts || []).some((a) => {
    if (!a || a.asked) return false;
    const head = String(a.head || '');
    if (move.to && head.length >= 7 && (move.to.startsWith(head) || head.startsWith(move.to))) return true;
    const target = actTarget(a.ref, remote);
    const aims = target === null || target === name;
    if (a.concept === RELEASE) return isTag(move.ref) && aims;
    if (a.concept === BRANCH) return aims;
    return a.concept === MERGE && !isTag(move.ref) && aims;
  });
}
function moveText(m) {
  const name = isTag(m.ref) ? `tag ${short(m.ref)}` : short(m.ref);
  if (!m.from) return `${name} appeared at ${s7(m.to)}`;
  if (!m.to) return `${name} was deleted (was ${s7(m.from)})`;
  return `${name} moved ${s7(m.from)}..${s7(m.to)}`;
}
const loudLine = (m, ctx, when = 'this turn') => `Ref watch: ${moveText(m)} ${when}; no gated act explains it - if a tool in this session did it, it bypassed the gate${m.to && ctx.local.has(m.to) ? ` (${s7(m.to)} is a commit in this checkout)` : ''}.`;
const SUMMARY_NAMES = 8;
function summaryLine(moves, lead) {
  if (!moves.length) return null;
  const names = moves.map((m) => (short(m.ref).length > 40 ? `${short(m.ref).slice(0, 39)}~` : short(m.ref)));
  const shown = names.slice(0, SUMMARY_NAMES).join(', ') + (names.length > SUMMARY_NAMES ? ` +${names.length - SUMMARY_NAMES} more` : '');
  return `Ref watch: ${lead}: ${shown} - teammates or this session.`;
}
// The loud and summary moves among `moves` that no act covers and nothing reported already.
function judge(cwd, remote, state, root, moves, acts) {
  const open = moves.filter((m) => !covered(m, acts, remote));
  const ctx = tierContext(cwd, remote, state, root, open);
  const loud = open.filter((m) => tierOf(m, ctx) === 'loud');
  return { ctx, loud, summary: open.filter((m) => !loud.includes(m)) };
}
const actsSince = (root, session, at, env) => forge.readActs(root, session, env).filter((a) => Number(a.at) >= Number(at || 0) - 1000);
async function baselineOf(root, session, env, waitMs) {
  const file = sessionFile(root, session, env);
  for (let waited = 0; ; waited += 100) {
    const s = readJson(file);
    if (s && s.refs) return s;
    if (waited >= waitMs) return null;
    await new Promise((ok) => setTimeout(ok, 100));
  }
}

// The detached child SessionStart spawns: the session's baseline, and the report owed from the last session.
function snapshotChild(cwd, session, source, env) {
  if (!forge || !cwd || partOff('watch', env)) return;
  const remote = forge.remoteOf(cwd);
  if (!remote) return;
  const root = rootOf(cwd, env);
  const file = sessionFile(root, session, env);
  // A compaction keeps the live baseline (the turn it interrupted is still being watched); a start, resume or clear
  // retakes it, so moves between sessions are never this session's report.
  if (source === 'compact' && readJson(file)) return;
  const now = snapshot(cwd, remote, { symref: true });
  if (!now.ok) return;
  writeJson(file, { ...now, reported: {} });
  const last = readJson(lastFile(root, env));
  if (last && last.session !== session && last.unknown && last.remote === remote && last.refs) {
    const moves = diffRefs(last.refs, now.refs);
    if (moves.length) {
      const { ctx, loud, summary } = judge(cwd, remote, now, root, moves, []);
      writeJson(noteFile(root, session, env), {
        loud: loud.map((m) => loudLine(m, ctx, 'since the last session, which made a forge call the gate could not read')),
        summary: summaryLine(summary, 'since the last session (a forge call the gate could not read), other branches moved'),
      });
    }
  }
  if (!last || last.session !== session) writeJson(lastFile(root, env), { ...now, session, unknown: false });
  if (prelude) for (const prefix of ['REFS-', 'NOTE-', 'ACTS-']) { try { prelude.sweepStale(path.dirname(file), prefix); } catch { /* best effort */ } }
}
function spawnSnapshot(cwd, session, source) {
  try {
    const child = spawn(process.execPath, [__filename, '--snapshot', cwd, String(session || ''), String(source || 'startup')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
  } catch { /* no baseline: the Stop says not checked */ }
}

// ---- which calls a turn ran, and which of them could move a ref ------------------------------------------------------
// The turn is everything after the last real prompt in the transcript's tail; null when the transcript cannot be read
// (the Stop then diffs - failing toward a check).
const TAIL_BYTES = 4 * 1024 * 1024;
function turnCalls(file) {
  let text;
  try {
    const size = fs.statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(size - from); fs.readSync(fd, buf, 0, buf.length, from); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return null; }
  const isPrompt = (o) => {
    if (o.isMeta || o.isCompactSummary) return false;
    const c = o.message && o.message.content;
    if (typeof c === 'string') return true;
    return Array.isArray(c) && c.some((b) => b && b.type === 'text') && !c.some((b) => b && b.type === 'tool_result');
  };
  const calls = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'user' && isPrompt(o)) break;
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) if (b && b.type === 'tool_use') calls.push({ name: String(b.name || ''), input: b.input || {} });
    }
  }
  return calls;
}
// The local programs a shell turn may run and still be a read for the remote's refs, and git's local subcommands. Not a
// boundary - anything else, a script or a build included, makes the Stop diff.
const READ_PROGRAMS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'egrep', 'fgrep', 'wc', 'pwd', 'echo', 'printf', 'stat',
  'which', 'type', 'file', 'diff', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'tree', 'jq',
  'cd', 'pushd', 'popd', 'true', 'false', 'test', '[', 'date', 'du', 'df', 'find',
  'get-childitem', 'gci', 'dir', 'get-content', 'gc', 'select-string', 'sls', 'get-item', 'get-location', 'test-path',
  'write-output', 'write-host', 'measure-object', 'select-object', 'sort-object', 'format-table', 'format-list',
  'out-string', 'resolve-path', 'split-path', 'join-path']);
const GIT_LOCAL = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'ls-remote', 'blame', 'cat-file',
  'merge-base', 'describe', 'shortlog', 'grep', 'fetch', 'reflog', 'for-each-ref', 'rev-list', 'name-rev', 'show-ref',
  'symbolic-ref', 'branch', 'tag', 'add', 'commit', 'restore', 'checkout', 'switch', 'stash', 'reset', 'merge', 'rebase',
  'cherry-pick', 'revert', 'config', 'remote', 'init', 'clone', 'worktree', 'mv', 'rm', 'clean', 'apply', 'format-patch',
  'bisect', 'notes', 'gc', 'fsck', 'pull', 'version', 'help', 'check-ignore', 'count-objects', 'range-diff', 'whatchanged']);
function shellIsRead(command, cwd) {
  let sw;
  try { sw = require(path.join(__dirname, 'shell-writes.js')); } catch { return false; }
  let t, words, acts;
  try { t = sw.gitText(String(command || ''), cwd); words = sw.commandWords(t.command, t.parsed); } catch { return false; }
  for (const call of t.calls || []) if (call.opaque || !GIT_LOCAL.has(call.sub)) return false;
  try { acts = forge.classifyCommand(command, cwd, { parsed: t.parsed }); } catch { acts = []; }
  const { READ, WATCH } = forge.CONCEPTS;
  if (acts.some((r) => r.concept !== READ && r.concept !== WATCH)) return false;
  const forgeReads = new Set(acts.map((r) => r.at));
  for (const w of words) {
    const name = String(w.name || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    if (name === 'git' || forgeReads.has(w.at)) continue;
    if (!READ_PROGRAMS.has(name)) return false;
    if (name === 'find' && (w.argv || []).some((a) => /^-(?:exec|execdir|ok|okdir|delete)$/.test(String(a)))) return false;
  }
  return true;
}
// A call that cannot move a remote ref: an editor or reader tool, a stack server, a forge read, a read-only shell turn.
function callIsRead(call, cwd) {
  const name = call.name;
  if (/^(?:Agent|Task)$/.test(name)) return false;
  if (/^(?:Bash|PowerShell|Monitor)$/.test(name)) return shellIsRead(call.input && call.input.command, cwd);
  if (/^mcp__/.test(name)) {
    if (forge.isStackServer(name)) return true;
    let r = null;
    try { r = forge.classify({ tool_name: name, tool_input: call.input, cwd }); } catch { r = null; }
    return !!r && r.strength === 'known' && (r.concept === forge.CONCEPTS.READ || r.concept === forge.CONCEPTS.WATCH);
  }
  return true;
}

// PostToolUse: the strong window after a call that may have moved a ref.
async function postCall(payload, env) {
  const { MERGE, BRANCH, RELEASE } = forge.CONCEPTS;
  const cwd = payload.cwd || process.cwd();
  const root = rootOf(cwd, env);
  const session = payload.session_id;
  if (!readJson(sessionFile(root, session, env))) return null; // no baseline (no remote, or the child failed): the Stop speaks
  let r = null;
  try { r = forge.classify(payload); } catch { r = null; }
  if (!r || !(r.strength === 'unknown' || [MERGE, BRANCH, RELEASE].includes(r.concept))) return null;
  // The gate ledgers merges and pushes; a release is held by preferences, not gated, so its act is written here.
  if (r.strength === 'known' && r.concept === RELEASE) forge.recordAct(root, session, { concept: RELEASE, ref: r.ref }, env);
  const remote = forge.remoteOf(cwd);
  const state = readJson(sessionFile(root, session, env));
  if (!remote || !state) return null;
  const now = snapshot(cwd, remote);
  if (!now.ok) return { systemMessage: `Ref watch: not checked (${now.reason}).` };
  const reported = state.reported || {};
  const moves = diffRefs(state.refs, now.refs).filter((m) => reported[m.ref] !== (m.to || ''));
  const { ctx, loud } = judge(cwd, remote, state, root, moves, actsSince(root, session, state.at, env));
  if (!loud.length) return null;
  for (const m of loud) reported[m.ref] = m.to || '';
  writeJson(sessionFile(root, session, env), { ...state, reported });
  return { decision: 'block', reason: `${loud.map((m) => loudLine(m, ctx, 'right after this call')).join('\n')}\nStop and report this to the user before anything else; do not try to undo it unless they ask.` };
}

// Stop: the catch-all diff, and the report the last session left.
async function stopTurn(payload, env) {
  const cwd = payload.cwd || process.cwd();
  const remote = forge.remoteOf(cwd);
  if (!remote) return null;
  const root = rootOf(cwd, env);
  const session = payload.session_id;
  const note = readJson(noteFile(root, session, env));
  if (note) { try { fs.rmSync(noteFile(root, session, env), { force: true }); } catch { /* reported once either way */ } }
  const calls = typeof payload.transcript_path === 'string' ? turnCalls(payload.transcript_path) : null;
  const ran = calls === null || calls.some((c) => !callIsRead(c, cwd));
  const loudLines = [...((note && note.loud) || [])];
  const notes = [];
  if (note && note.summary && !loudOnly(env)) notes.push(note.summary);
  if (ran) {
    const state = await baselineOf(root, session, env, 1500);
    const now = snapshot(cwd, remote);
    if (!now.ok) notes.push(`Ref watch: not checked (${now.reason}).`);
    else if (!state) {
      notes.push('Ref watch: not checked (no start snapshot yet; watching from now).');
      writeJson(sessionFile(root, session, env), { ...now, reported: {} });
    } else {
      const reported = state.reported || {};
      const moves = diffRefs(state.refs, now.refs).filter((m) => reported[m.ref] !== (m.to || ''));
      const { ctx, loud, summary } = judge(cwd, remote, state, root, moves, actsSince(root, session, state.at, env));
      loudLines.push(...loud.map((m) => loudLine(m, ctx)));
      const line = loudOnly(env) ? null : summaryLine(summary, 'other branches moved this turn');
      if (line) notes.push(line);
      writeJson(sessionFile(root, session, env), { ...now, head: state.head || now.head, reported: {} });
      const unknown = forge.readActs(root, session, env).some((a) => a && a.asked);
      writeJson(lastFile(root, env), { ...now, head: state.head || now.head, session, unknown });
    }
  }
  if (loudLines.length && !(prelude && prelude.stopHeldThisCycle('forge-session', payload, env))) {
    if (prelude) prelude.markStopHeld('forge-session', payload, env);
    return { decision: 'block', reason: [...loudLines, ...notes, 'Tell the user what moved before anything else; do not try to undo it unless they ask.'].join('\n') };
  }
  const shown = [...loudLines, ...notes];
  return shown.length ? { systemMessage: shown.join('\n') } : null;
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
  // The detached child the session start spawned (its parent already passed every gate).
  if (process.argv[2] === '--snapshot') {
    try { snapshotChild(process.argv[3], process.argv[4], process.argv[5], process.env); } catch { /* no baseline: the Stop says so */ }
    return 0;
  }
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
  const cwd = payload.cwd || process.cwd();
  if (!forge.gitOut(cwd, ['rev-parse', '--git-dir'])) return 0;
  if (event === 'SessionStart' || event === 'SubagentStart') {
    const p = profile(cwd, process.env);
    // The baseline is the main session's; a seat's own compaction runs SessionStart inside it with the main session id.
    if (event === 'SessionStart' && !payload.agent_id && p.watch !== 'off') spawnSnapshot(cwd, payload.session_id, payload.source);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: profileLine(p) } }));
    return 0;
  }
  if (partOff('watch', process.env)) return 0;
  let out = null;
  try {
    if (event === 'PostToolUse') out = await postCall(payload, process.env);
    else if (event === 'Stop' && !payload.agent_id) out = await stopTurn(payload, process.env);
  } catch { out = null; }
  if (out) process.stdout.write(JSON.stringify(out));
  return 0;
}

module.exports = { profile, profileLine, hostOf, cliPlan, askLine, LINE_MAX, snapshot, diffRefs, tierOf, covered, turnCalls, callIsRead };
if (require.main === module) main().catch(() => 0).then((code) => process.exit(code));
