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
// - SessionStart spawns a detached `--snapshot` child: the session's baseline in <data root>/state/forge/REFS-<session>.json,
//   under the repository's root (forge.js ledgerRoot), beside the commit guard's act ledger.
// - PostToolUse on every gated route: confirm the call's ledgered act, and mark the cycle dirty when the call could move a
//   ref (a seat's calls too). After a merge, a branch write, a release or a forge call nobody could read: re-read and diff;
//   a LOUD move no ledger act covers blocks with feedback to stop and report it.
// - Stop, when the turn ran anything but a known read, the cycle is dirty, or background work was left running: diff once
//   more. Loud moves block once per cycle; the rest is one summary line for the user (`systemMessage`). Loud: the default
//   branch, the upstream, a branch GIT-PREFERENCES.md names, a branch whose new sha a local branch holds, any tag. The
//   baseline then moves to now.
// - The end snapshot is kept per repo (REFS-LAST.json); the next session's child diffs against it and reports only when
//   that session asked about a forge call (an armed auto-merge landing later).
// NETWORK EGRESS (audit 2026-10-30 HK-27, kept and recorded): the watch is the network half of this hook - `git ls-remote`
// to the branch's own remote, from the detached SessionStart child, after a ref-moving call (PostToolUse) and at Stop;
// bounded by forge.js (LS_REMOTE_MS 6s, GIT_TERMINAL_PROMPT=0, ssh BatchMode), sending nothing beyond git's own protocol.
// The session line above makes no network call.
// An unreachable remote is `ref watch: not checked (<why>)`, never clean. `forge-session:watch` in ALFRED_CODE_HOOKS_OFF
// turns the watch off; ALFRED_CODE_FORGE_WATCH=loud-only drops the summary tier and the session line says so. A check
// that fails or answers slowly pauses the catch-all (THE PAUSE below); ALFRED_CODE_FORGE_WATCH=publish-only holds it to
// turns that made a forge call or a gated push.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The classifier engine beside it; an install without it says nothing (fail-open, like a missing prelude).
let forge = null;
try { forge = require(path.join(__dirname, 'forge.js')); } catch { /* no engine: no line */ }
// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every hook. Fail-open: no
// prelude runs the hook, the switches read bare.
let prelude = null;
try { prelude = require(path.join(__dirname, 'hook-prelude.js')); prelude.blockingStdio(); } catch { /* no prelude: the bare ALFRED_CODE_ reads */ }
const envOf = (env, suffix) => (prelude ? prelude.envOf(env, suffix) : env[`ALFRED_CODE_${suffix}`]);
const watchSetting = (env) => String(envOf(env, 'FORGE_WATCH') || '').trim().toLowerCase();
const partOff = (part, env) => !!prelude && prelude.partOff('forge-session', part, env);

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

// { host, kind, remote, clis, mcp, watch: 'on' | 'off' | 'loud-only' | 'publish-only', why } for the repo at `cwd`.
function profile(cwd, env = process.env) {
  const h = hints();
  const root = env.CLAUDE_PROJECT_DIR || forge.gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd;
  const remote = forge.remoteOf(cwd);
  const url = remote ? forge.gitOut(cwd, ['remote', 'get-url', remote]) : null;
  const host = remote ? hostOf(url) : null;
  const clis = clisOnPath([...new Set(Object.values(h.clis || {}))], env);
  let mcp = [];
  // A forge MCP server is found by its launch command or URL in the MCP configs (forge.js forgeServersOf).
  try { mcp = forge.forgeServersOf(path.resolve(root), env, h.mcpLaunch); } catch { /* a config we cannot read lists no server */ }
  let watch = 'on', why = null;
  if (partOff('watch', env)) { watch = 'off'; why = 'switched off'; }
  else if (!remote) { watch = 'off'; why = 'no remote'; }
  else if (watchSetting(env) === 'loud-only' || watchSetting(env) === 'publish-only') watch = watchSetting(env);
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
const loudOnly = (env) => watchSetting(env) === 'loud-only';
const rootOf = (cwd, env) => env.CLAUDE_PROJECT_DIR || forge.gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd;
// The watch's state lives with the repository, where the commit guard ledgers its acts (forge.js ledgerRoot): a session
// in the main checkout and a push from its worktree read one ledger.
const stateRoot = (cwd, env) => forge.ledgerRoot(cwd) || rootOf(cwd, env);

// { ok, remote, refs: { ref: sha }, at, ms, head?, reason? } - every branch and tag, and how long the remote took;
// `symref` also reads the default branch, in the same call (one round trip, one key touch).
function snapshot(cwd, remote, { symref = false } = {}) {
  const t0 = Date.now();
  const r = symref ? forge.lsRemote(cwd, remote, ['HEAD', 'refs/heads/*', 'refs/tags/*'], { symref: true }) : forge.lsRemote(cwd, remote);
  const at = Date.now();
  if (!r.ok) return { ok: false, remote, refs: {}, at, ms: at - t0, reason: String(r.reason || 'no answer').replace(/[.\s]+$/, '') };
  const out = { ok: true, remote, refs: Object.fromEntries([...r.refs].filter(([ref]) => /^refs\/(?:heads|tags)\//.test(ref))), at, ms: at - t0 };
  if (symref && r.head) out.head = r.head;
  return out;
}

// THE PAUSE - a check that failed or took over SLOW_MS is what a security key waiting for a touch, or an approval dialog,
// looks like from git's side: asking every turn would prompt every turn. The end-of-turn check then runs at most every
// PAUSE_MS this session; a turn that made a forge call or a gated push still checks, and an answer within SLOW_MS lifts the
// pause. ALFRED_CODE_FORGE_WATCH=publish-only holds the check to those turns from the start. A skipped check loses no move:
// the next one diffs against the same baseline and says 'since the last check'.
const SLOW_MS = 3000;
const PAUSE_MS = 30 * 60 * 1000;
const pauseFile = (root, session, env) => stateFile(root, `PAUSE-${sid(session)}.json`, env);
const slowWhy = (now) => (!now.ok ? 'the check failed' : now.ms > SLOW_MS ? `the remote took ${(now.ms / 1000).toFixed(1)} s to answer` : null);
const pauseActive = (root, session, env) => { const p = readJson(pauseFile(root, session, env)); return !!p && Number(p.until) > Date.now(); };
function afterCheck(root, session, env, now) {
  const file = pauseFile(root, session, env);
  const p = readJson(file);
  const why = slowWhy(now);
  if (why) writeJson(file, { why, until: Date.now() + PAUSE_MS, told: !!(p && p.told) });
  else if (p && Number(p.until) > Date.now()) writeJson(file, { ...p, until: 0 });
}
// The pause named to the user once a session - by the next Stop or PostToolUse, since spawnSnapshot discards the
// snapshot child's output (stdio 'ignore').
function pauseLine(root, session, env) {
  const file = pauseFile(root, session, env);
  const p = readJson(file);
  if (!p || p.told || !(Number(p.until) > Date.now())) return null;
  writeJson(file, { ...p, told: true });
  return `Ref watch: ${p.why} - the end-of-turn check now runs at most every 30 min this session, so a security-key touch or an approval prompt does not ask every turn; a push or forge call is still checked (ALFRED_CODE_FORGE_WATCH=publish-only: only then).`;
}
// THE SSH NOTICE - a key tapped quickly answers inside SLOW_MS, so the pause never trips and that login asks on every checked
// turn; timing cannot tell it from a slow network, and an approval app leaves no trace at all. So the first check over an
// SSH remote names the way out, once per repo - unless the pause line already did, or publish-only is set.
const viaSsh = (url) => /^(?:ssh|git\+ssh|ssh\+git):\/\//i.test(url) || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && /^(?:[^@/\\]+@)?[^:/\\]{2,}:(?!\/\/)/.test(url));
function sshNotice(cwd, remote, root, env, speak) {
  const file = stateFile(root, 'SSH-NOTICE.json', env);
  if (readJson(file) || !viaSsh(String(forge.gitOut(cwd, ['remote', 'get-url', remote]) || ''))) return null;
  writeJson(file, { at: Date.now() });
  return speak ? 'Ref watch: this repo\'s remote is checked over SSH at the end of most turns. If your SSH login asks you each time (a security-key touch, an approval prompt), set ALFRED_CODE_FORGE_WATCH=publish-only to check only after a push or forge call.' : null;
}
const sinceLast = (at) => { const min = Math.floor((Date.now() - Number(at || 0)) / 60000); return `since the last check ${min < 1 ? 'under a minute' : `${min} min`} ago`; };
// Every ref whose sha differs, created (from null) and deleted (to null) included.
function diffRefs(before, after) {
  const a = before || {}, b = after || {};
  const moves = [];
  for (const ref of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[ref] || null) !== (b[ref] || null)) moves.push({ ref, from: a[ref] || null, to: b[ref] || null });
  return moves.sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0));
}
// The commits among `shas` a LOCAL branch holds - this checkout's own work, not a teammate's commit a fetch brought in: one
// `cat-file --batch-check` for which exist, then `for-each-ref --contains` for each that does (capped; past the cap, or when
// git cannot answer, an existing commit counts as local - failing toward loud).
const LOCAL_CHECK_MAX = 16;
function localShas(cwd, shas) {
  const list = [...new Set(shas.filter(Boolean))];
  const local = new Set();
  if (!list.length) return local;
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', 'cat-file', '--batch-check'], { cwd, input: `${list.join('\n')}\n`, encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  const have = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const m = /^([0-9a-f]{40,64}) (\S+)/.exec(line);
    if (m && m[2] !== 'missing') have.push(m[1]);
  }
  have.forEach((sha, n) => {
    if (n >= LOCAL_CHECK_MAX) { local.add(sha); return; }
    const b = spawnSync('git', ['-c', 'core.fsmonitor=false', 'for-each-ref', '--count=1', '--format=%(refname)', '--contains', sha, 'refs/heads'], { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (b.status !== 0 || String(b.stdout || '').trim()) local.add(sha);
  });
  return local;
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
// Which moves the ledger explains. An act AIMED at a ref - a push's refspec, a merge's base, a release's tag - covers that
// ref; a merge also covers the deletion of the branch its head sat on (deleted on merge). A push naming refs it does not
// list (`all`: --all, --tags, --mirror) covers every move. An act naming no ref lands ONE move: the one at its head, else
// the one loud move it could be - with several, it explains none of them and says so (`ambiguous`). An ASKED act, or one
// whose call PostToolUse never confirmed, covers nothing. `used`: the armed acts that explained a move.
const ACT_WORD = { 'change.merge': 'merge', 'release.write': 'release', 'branch.write': 'branch write' };
function explain(moves, acts, remote, ctx) {
  const { MERGE, RELEASE } = forge.CONCEPTS;
  const open = new Set(moves);
  const used = new Set();
  const ambiguous = [];
  const atHead = (a, sha) => { const h = String(a.head || ''); return !!sha && h.length >= 7 && (sha.startsWith(h) || h.startsWith(sha)); };
  const fits = (a, m) => (a.concept === RELEASE ? isTag(m.ref) : a.concept === MERGE ? !isTag(m.ref) : true);
  const take = (a, m) => { open.delete(m); if (a.armed && a.id) used.add(a.id); };
  const loose = [];
  for (const a of (acts || []).filter((x) => x && !x.asked && x.confirmed !== false)) {
    if (a.all) { for (const m of [...open]) take(a, m); continue; }
    if (a.concept === MERGE) for (const m of [...open]) if (!m.to && !isTag(m.ref) && atHead(a, m.from)) take(a, m);
    const target = actTarget(a.ref, remote);
    if (target === null) { loose.push(a); continue; }
    for (const m of [...open]) if (short(m.ref) === target && fits(a, m)) take(a, m);
  }
  for (const a of loose) {
    const can = [...open].filter((m) => m.to && fits(a, m) && (a.concept !== RELEASE || !m.from));
    const hit = can.find((m) => atHead(a, m.to));
    const loud = can.filter((m) => tierOf(m, ctx) === 'loud');
    if (hit) take(a, hit);
    else if (loud.length === 1) take(a, loud[0]);
    else if (loud.length > 1) ambiguous.push({ act: a, moves: loud });
    else if (can.length === 1) take(a, can[0]);
  }
  return { open: [...open], used, ambiguous: ambiguous.map((x) => ({ ...x, moves: x.moves.filter((m) => open.has(m)) })).filter((x) => x.moves.length > 1) };
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
// The loud and summary moves among `moves` that no act covers, the line naming each act that could be one of several, and
// the armed acts used up.
function judge(cwd, remote, state, prefsRoot, moves, acts) {
  const ctx = tierContext(cwd, remote, state, prefsRoot, moves);
  const { open, used, ambiguous } = explain(moves, acts, remote, ctx);
  const loud = open.filter((m) => tierOf(m, ctx) === 'loud');
  const notes = ambiguous.map((x) => `Ref watch: one gated ${ACT_WORD[x.act.concept] || 'act'} this turn explains at most one of: ${x.moves.map((m) => short(m.ref)).join(', ')}.`);
  return { ctx, loud, summary: open.filter((m) => !loud.includes(m)), used, notes };
}
// The acts that can explain a move now: this cycle's (since the baseline, a second of clock slack), and an armed merge from
// any earlier turn of the session until it explains one landing - an auto-merge lands when its checks pass.
function windowActs(root, session, state, env) {
  const consumed = new Set((state && state.consumed) || []);
  const since = Number((state && state.at) || 0) - 1000;
  return forge.readActs(root, session, env).filter((a) => Number(a.at) >= since || (a.armed && a.id && !consumed.has(a.id)));
}
const consumedAfter = (state, used) => [...new Set([...((state && state.consumed) || []), ...(used || [])])].slice(-200);
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
  const root = stateRoot(cwd, env);
  const file = sessionFile(root, session, env);
  // A compaction keeps the live baseline (the turn it interrupted is still being watched); a start, resume or clear
  // retakes it, so moves between sessions are never this session's report.
  if (source === 'compact' && readJson(file)) return;
  const now = snapshot(cwd, remote, { symref: true });
  afterCheck(root, session, env, now);
  if (!now.ok) return;
  writeJson(file, { ...now, reported: {} });
  const last = readJson(lastFile(root, env));
  if (last && last.session !== session && last.unknown && last.remote === remote && last.refs) {
    const moves = diffRefs(last.refs, now.refs);
    if (moves.length) {
      const { ctx, loud, summary } = judge(cwd, remote, now, rootOf(cwd, env), moves, []);
      writeJson(noteFile(root, session, env), {
        loud: loud.map((m) => loudLine(m, ctx, 'since the last session, which made a forge call the gate could not read')),
        summary: summaryLine(summary, 'since the last session (a forge call the gate could not read), other branches moved'),
      });
    }
  }
  if (!last || last.session !== session) writeJson(lastFile(root, env), { ...now, session, unknown: false });
  if (prelude) for (const prefix of ['REFS-', 'NOTE-', 'ACTS-', 'PAUSE-']) { try { prelude.sweepStale(path.dirname(file), prefix); } catch { /* best effort */ } }
}
function spawnSnapshot(cwd, session, source) {
  try {
    const child = spawn(process.execPath, [__filename, '--snapshot', cwd, String(session || ''), String(source || 'startup')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref();
  } catch { /* no baseline: the Stop says not checked */ }
}

// ---- which calls a turn ran, and which of them could move a ref ------------------------------------------------------
// The turn is everything after the last real prompt in the transcript's tail; null when the transcript cannot be read, or
// the tail holds no prompt - the turn began before it (the Stop then diffs - failing toward a check).
const TAIL_BYTES = 4 * 1024 * 1024;
function turnCalls(file) {
  let text, from;
  try {
    const size = fs.statSync(file).size;
    from = Math.max(0, size - TAIL_BYTES);
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
  let prompt = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'user' && isPrompt(o)) { prompt = true; break; }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) if (b && b.type === 'tool_use') calls.push({ name: String(b.name || ''), input: b.input || {} });
    }
  }
  return prompt || from === 0 ? calls : null;
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
// The tools that cannot move a remote ref by themselves: readers, local editors, the model's own bookkeeping. Anything not
// named - a seat dispatch, a message to one, a workflow, a tool a later release adds - counts as one that can.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead',
  'TodoWrite', 'TodoRead', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'WebFetch', 'WebSearch',
  'ToolSearch', 'Skill', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'LSP', 'ListMcpResourcesTool',
  'ReadMcpResourceTool']);
// A call that cannot move a remote ref: a read tool, a local type's tool (forge.js localTool), a forge read, a read-only shell turn.
function callIsRead(call, cwd) {
  const name = String(call.name || '');
  if (/^(?:Bash|PowerShell|Monitor)$/.test(name)) return shellIsRead(call.input && call.input.command, cwd);
  if (/^mcp__/.test(name)) {
    if (forge.localTool(name)) return true;
    let r = null;
    try { r = forge.classify({ tool_name: name, tool_input: call.input, cwd }); } catch { r = null; }
    return !!r && r.strength === 'known' && (r.concept === forge.CONCEPTS.READ || r.concept === forge.CONCEPTS.WATCH);
  }
  return READ_TOOLS.has(name);
}

// PostToolUse: confirm the call's ledgered act (forge.js confirmAct), mark the cycle dirty when the call could move a ref -
// a seat's calls included, which the Stop's main transcript never shows - and the strong window after a call that may have
// moved one.
async function postCall(payload, env) {
  const { MERGE, BRANCH, RELEASE } = forge.CONCEPTS;
  const cwd = payload.cwd || process.cwd();
  const root = stateRoot(cwd, env);
  const session = payload.session_id;
  const gated = forge.confirmAct(root, session, payload.tool_use_id, env);
  const file = sessionFile(root, session, env);
  let state = readJson(file);
  if (!state) return null; // no baseline (no remote, or the child failed): the Stop speaks
  let r = null;
  try { r = forge.classify(payload); } catch { r = null; }
  const strong = !!r && (r.strength === 'unknown' || [MERGE, BRANCH, RELEASE].includes(r.concept));
  // `strong`: this turn made a forge call or a gated push, so its Stop checks even while the end-of-turn check is paused.
  const marks = { ...(!state.dirty && !callIsRead({ name: payload.tool_name, input: payload.tool_input || {} }, cwd) ? { dirty: true } : {}),
    ...(!state.strong && (gated || strong) ? { strong: true } : {}) };
  if (Object.keys(marks).length) { state = { ...state, ...marks }; writeJson(file, state); }
  if (!strong) return null;
  // The gate ledgers merges and pushes; a release is held by preferences, not gated, so its act is written here.
  if (r.strength === 'known' && r.concept === RELEASE) forge.recordAct(root, session, { concept: RELEASE, ref: r.ref }, env);
  const remote = forge.remoteOf(cwd);
  if (!remote) return null;
  const now = snapshot(cwd, remote);
  afterCheck(root, session, env, now);
  const told = pauseLine(root, session, env);
  if (!now.ok) return { systemMessage: [`Ref watch: not checked (${now.reason}).`, told].filter(Boolean).join('\n') };
  const reported = state.reported || {};
  const moves = diffRefs(state.refs, now.refs).filter((m) => reported[m.ref] !== (m.to || ''));
  // An armed act is used up at the Stop, which judges these moves again.
  const { ctx, loud, notes } = judge(cwd, remote, state, rootOf(cwd, env), moves, windowActs(root, session, state, env));
  if (!loud.length) return told ? { systemMessage: told } : null;
  for (const m of loud) reported[m.ref] = m.to || '';
  writeJson(file, { ...state, reported });
  const when = state.skipped ? sinceLast(state.at) : 'right after this call';
  return { decision: 'block', reason: `${[...loud.map((m) => loudLine(m, ctx, when)), ...notes].join('\n')}\nStop and report this to the user before anything else; do not try to undo it unless they ask.`, ...(told ? { systemMessage: told } : {}) };
}

// Work still running when the turn ends can move a ref after this diff, so the next Stop diffs too - the Stop input's
// `background_tasks` (code.claude.com/docs/en/hooks; the settled statuses as docs-session.js reads them).
const SETTLED_STATUS = /^(?:completed?|done|failed|killed|stopped|cancell?ed|error|finished)$/i;
const backgroundLive = (payload) => Array.isArray(payload.background_tasks)
  && payload.background_tasks.some((t) => t && typeof t === 'object' && !SETTLED_STATUS.test(String(t.status || '')));

// Stop: the catch-all diff, and the report the last session left. It diffs when the turn's transcript ran anything but a
// read, or a PostToolUse marked the cycle dirty.
async function stopTurn(payload, env) {
  const cwd = payload.cwd || process.cwd();
  const remote = forge.remoteOf(cwd);
  if (!remote) return null;
  const root = stateRoot(cwd, env);
  const session = payload.session_id;
  const note = readJson(noteFile(root, session, env));
  if (note) { try { fs.rmSync(noteFile(root, session, env), { force: true }); } catch { /* reported once either way */ } }
  const calls = typeof payload.transcript_path === 'string' ? turnCalls(payload.transcript_path) : null;
  const marked = readJson(sessionFile(root, session, env));
  const ran = calls === null || !!(marked && marked.dirty) || calls.some((c) => !callIsRead(c, cwd));
  // Paused, or publish-only: only a turn that made a forge call or a gated push checks. A turn held back keeps the cycle
  // dirty, so the first check after the pause diffs whatever it was.
  const held = (watchSetting(env) === 'publish-only' || pauseActive(root, session, env)) && !(marked && marked.strong);
  if (ran && held && marked && !(marked.skipped && marked.dirty)) writeJson(sessionFile(root, session, env), { ...marked, skipped: true, dirty: true });
  const loudLines = [...((note && note.loud) || [])];
  const notes = [];
  if (note && note.summary && !loudOnly(env)) notes.push(note.summary);
  if (ran && !held) {
    const state = await baselineOf(root, session, env, 1500);
    const now = snapshot(cwd, remote);
    afterCheck(root, session, env, now);
    const live = backgroundLive(payload);
    if (!now.ok) notes.push(`Ref watch: not checked (${now.reason}).`);
    else if (!state) {
      notes.push('Ref watch: not checked (no start snapshot yet; watching from now).');
      writeJson(sessionFile(root, session, env), { ...now, reported: {}, dirty: live });
    } else {
      const reported = state.reported || {};
      const moves = diffRefs(state.refs, now.refs).filter((m) => reported[m.ref] !== (m.to || ''));
      const { ctx, loud, summary, used, notes: unsure } = judge(cwd, remote, state, rootOf(cwd, env), moves, windowActs(root, session, state, env));
      const when = state.skipped ? sinceLast(state.at) : 'this turn';
      loudLines.push(...loud.map((m) => loudLine(m, ctx, when)), ...unsure);
      const line = loudOnly(env) ? null : summaryLine(summary, `other branches moved ${when}`);
      if (line) notes.push(line);
      writeJson(sessionFile(root, session, env), { ...now, head: state.head || now.head, reported: {}, consumed: consumedAfter(state, used), dirty: live });
      const unknown = forge.readActs(root, session, env).some((a) => a && a.asked && a.confirmed);
      writeJson(lastFile(root, env), { ...now, head: state.head || now.head, session, unknown });
    }
  }
  const told = pauseLine(root, session, env);
  const ssh = ran && !held && watchSetting(env) !== 'publish-only' ? sshNotice(cwd, remote, root, env, !told) : null;
  const forUser = [told, ssh].filter(Boolean);
  if (loudLines.length && !(prelude && prelude.stopHeldThisCycle('forge-session', payload, env))) {
    if (prelude) prelude.markStopHeld('forge-session', payload, env);
    return { decision: 'block', reason: [...loudLines, ...notes, 'Tell the user what moved before anything else; do not try to undo it unless they ask.'].join('\n'), ...(forUser.length ? { systemMessage: forUser.join('\n') } : {}) };
  }
  const shown = [...loudLines, ...notes, ...forUser];
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
    // A malformed overlay is ignored - said to the user once a session, or the words they added go unread unnoticed.
    let notice = null;
    if (event === 'SessionStart') { try { notice = forge.loadLexicon(cwd, process.env).notice; } catch { notice = null; } }
    process.stdout.write(JSON.stringify({ ...(notice ? { systemMessage: `Forge: ${notice}.` } : {}), hookSpecificOutput: { hookEventName: event, additionalContext: profileLine(p) } }));
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

module.exports = { profile, profileLine, hostOf, cliPlan, askLine, LINE_MAX, snapshot, diffRefs, tierOf, explain, turnCalls, callIsRead };
if (require.main === module) main().catch(() => 0).then((code) => process.exit(code));
