#!/usr/bin/env node
'use strict';
// scripts/memory-usage.eval.js - Task 8: proves, with REAL Claude Code sessions (`claude -p`), that
// sessions AND dispatched agents write to and read from the shared memory MCP end to end. Five
// scenarios (session writes/reads, agent writes/reads, related-project reads), each run N times
// (default 3, pass mark 2/3), --parallel at once (default 5 - each run owns its own temp project and
// db, so runs are independent). Evidence per run, both required: (a) the tool call in the transcript -
// the main session's own stream-json stdout, a dispatched subagent's own
// ~/.claude/projects/<slug>/<sessionId>/subagents/agent-*.jsonl; (b) the db row (node:sqlite,
// read-only) or, for a read scenario, the seeded fact in the answer.
//
// Until the installer (Task 6) lands the memory MCP + hook wiring, this harness builds each temp
// project ITSELF (buildProjectSelf): copies stack/rules/baseline-memory.md and
// stack/hooks/{memory,memory-session,docs}.js, writes .mcp.json (the memory server, pointed at that
// project's OWN throwaway .memory-mcp/memory.db - never ~/.memory-mcp) and .claude/settings.json (the
// SessionStart wiring) by hand, and copies only the agent(s) a scenario needs into .claude/agents/.
// That is behind ONE function so a later run can swap it for a real
// `scripts/install/alfred-code.js --source <worktree>` install without touching anything else.
//
// --setup self|install|update (default self): 'install' is a FRESH real install from this worktree
// (buildProjectInstall - no notes to import, never exercises an update). 'update' (buildProjectUpdate)
// is the edge case CLAUDE.md requires and 'install' does not - an update over an OLDER install: a
// pre-feature project built by the installer as it stood one commit before this branch's own
// memory-feature commits begin (a pinned SHA, `git archive`'d - a clean release-shaped snapshot, no
// node_modules, no .git), a Claude-own-memory note seeded for it under a sandboxed CLAUDE_CONFIG_DIR
// (never the real account), then updated in place by THIS working tree's HEAD (also `git archive`'d,
// same release shape). Asserts baseline-memory.md landed, memory is registered, the seeded note
// became a db row, and autoMemoryEnabled is false - each a thrown Error on failure, which the
// existing per-run try/catch already turns into a reported FAIL record rather than a crash.
//
// Results are written to scripts/fixtures/memory-usage/results-<date>-<HHMMSS>.json - timestamped
// (not just dated) so a same-day rerun never overwrites an earlier run's evidence. The printed and
// recorded verdict's pass mark scales with --runs, fixed before the run: ceil(2/3 x runs) - 1 for
// --runs 1, 2 for the default --runs 3.
//
// CLI flags (verified against `claude --help` on this machine, Claude Code 2.1.278, plus
// https://code.claude.com/docs/en/cli-reference and /headless via context7):
//   -p / --output-format stream-json --verbose   non-interactive, one JSON object per line, ending in
//                                                 a `result` message carrying total_cost_usd (headless
//                                                 doc's own examples always pair stream-json with
//                                                 --verbose)
//   --mcp-config <file> --strict-mcp-config       load ONLY the memory server from our own .mcp.json,
//                                                 ignoring any other MCP config - and per the MCP doc,
//                                                 "In claude -p runs ... Claude Code can't show that
//                                                 prompt: it loads project-scoped servers without
//                                                 asking", so no approval prompt either way
//   --allowedTools "<tool,tool,...>"              auto-approves exactly the tools a scenario needs;
//                                                 supports the mcp__<server>__* wildcard and
//                                                 mcp__<server> server-level pattern (agent-sdk/mcp doc)
//   --permission-prompts none                     "Pass none when nobody can answer, and Claude Code
//                                                 denies them instead" (headless doc) - the correct
//                                                 unattended-run setting instead of bypassPermissions,
//                                                 which disables ALL safety checks
//   --session-id <uuid>                           pins the transcript filename so it never needs
//                                                 discovering
//   --max-budget-usd <n>                          "only works with --print" per `claude --help` -
//                                                 the spend cap
//   --model sonnet                                the alias Claude Code resolves to the latest Sonnet
// Subagent transcripts: "find IDs in the transcript files at
// ~/.claude/projects/{project}/{sessionId}/subagents/. Each transcript is stored as
// agent-{agentId}.jsonl" (code.claude.com/docs/en/sub-agents, via context7) - confirmed live in this
// harness's own manual dry run (see task-8-report.md).
//
// Isolation: every run's temp project lives under CLAUDE_STACK_EVAL_SCRATCH (default
// <os.tmpdir()>/claude-stack-memory-usage-eval/), matching this repo's own "session scratchpad (or
// os.tmpdir())" convention - the harness has to be runnable outside any one agent session's own
// scratchpad. CLAUDE_CONFIG_DIR is NEVER set (auth lives in the default account). After a run, the temp
// project AND the exact ~/.claude/projects/<slug>/ folder it created are deleted - found by searching
// that directory listing for the run's own random hex id, which appears verbatim inside whatever
// slugification Claude Code applies to the rest of the temp path, so cleanup is exact even under
// --parallel with other Claude Code sessions active on the same machine.
//
// Seeding for the read scenarios goes through the REAL server over the same JSON-RPC-over-stdio route
// as scripts/memory-import.js (initialize -> notifications/initialized -> tools/call memory_store),
// duplicated here rather than imported - memory-import.js (Task 3) exports no reusable RPC client, and
// file ownership during the parallel build (cross-task-facts.md) keeps this script out of Task 8's own
// files. Never an sqlite INSERT - a hand-inserted row has no vector.
//
// Not wired into `npm test` - run explicitly: `npm run test:memory` (see package.json).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RULE_SRC = path.join(ROOT, 'stack', 'rules', 'baseline-memory.md');
const HOOK_MEMORY_SRC = path.join(ROOT, 'stack', 'hooks', 'memory.js');
const HOOK_MEMORY_SESSION_SRC = path.join(ROOT, 'stack', 'hooks', 'memory-session.js');
// memory-session.js does `require('./docs.js').DOCS_ROOT` for the related-projects lookup - copied
// beside it, never wired (same split as a real install), so that require does not throw.
const HOOK_DOCS_SRC = path.join(ROOT, 'stack', 'hooks', 'docs.js');
const AGENTS_SRC_DIR = path.join(ROOT, 'stack', 'agents');
const FIXTURES_DIR = path.join(ROOT, 'scripts', 'fixtures', 'memory-usage');

// FACT-EMBED (spike-facts.md): the [sqlite] extra is what gives real 384-dim embeddings; without it
// the server hard-refuses on a db that already holds memories. Pinned to the version the spike proved
// live; override for a later pin via env, never hardcode a second place.
const MEMORY_VERSION = process.env.CLAUDE_STACK_EVAL_MEMORY_VERSION || '11.13.0';
const TMP_BASE = process.env.CLAUDE_STACK_EVAL_SCRATCH || path.join(os.tmpdir(), 'claude-stack-memory-usage-eval');
// A SIBLING of every per-run project/acct dir, never touched by cleanupRun() (which only ever removes
// the three paths it is handed) - so a forensics dump written here survives cleanup on purpose.
const FORENSICS_DIR = path.join(TMP_BASE, 'forensics');

const splitTags = (tags) => String(tags || '').split(',').map((t) => t.trim()).filter(Boolean);
const truncate = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? `${s.slice(0, n - 1)}...` : s; };

// ---------------------------------------------------------------------------------------------------
// Project builder (self-built until Task 6's installer lands)
// ---------------------------------------------------------------------------------------------------

function memoryRegistration(dbPath) {
  return {
    type: 'stdio',
    command: 'uvx',
    args: ['--with', 'numpy', '--from', `mcp-memory-service[sqlite]==${MEMORY_VERSION}`, 'memory', 'server'],
    env: {
      MCP_MEMORY_STORAGE_BACKEND: 'sqlite_vec',
      MCP_MEMORY_SQLITE_PATH: dbPath,
      MCP_MEMORY_SQLITE_PRAGMAS: 'busy_timeout=15000',
    },
  };
}

function buildProjectSelf(projectDir, { agents = [] } = {}) {
  fs.mkdirSync(projectDir, { recursive: true });
  // A git repo of its own: memory.js's projectName() (and the model's own `basename "$(pwd)"` check)
  // both resolve the project tag from `git rev-parse --show-toplevel`, which must be THIS dir, not the
  // claude-stack worktree the harness itself runs from.
  execFileSync('git', ['init', '-q'], { cwd: projectDir });

  const claudeDir = path.join(projectDir, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'agents'), { recursive: true });

  fs.copyFileSync(RULE_SRC, path.join(claudeDir, 'rules', 'baseline-memory.md'));
  fs.copyFileSync(HOOK_MEMORY_SRC, path.join(claudeDir, 'hooks', 'memory.js'));
  fs.copyFileSync(HOOK_MEMORY_SESSION_SRC, path.join(claudeDir, 'hooks', 'memory-session.js'));
  fs.copyFileSync(HOOK_DOCS_SRC, path.join(claudeDir, 'hooks', 'docs.js'));
  for (const f of ['memory.js', 'memory-session.js', 'docs.js']) fs.chmodSync(path.join(claudeDir, 'hooks', f), 0o755);

  for (const agent of agents) {
    fs.copyFileSync(path.join(AGENTS_SRC_DIR, `${agent}.md`), path.join(claudeDir, 'agents', `${agent}.md`));
  }

  const dbPath = path.join(projectDir, '.memory-mcp', 'memory.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const mcpConfigPath = path.join(projectDir, '.mcp.json');
  fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { memory: memoryRegistration(dbPath) } }, null, 2));

  // Exact shape the Node seed writes (scripts/install/settings.js): the quoted
  // $CLAUDE_PROJECT_DIR placeholder, no matcher (fires on every SessionStart source), timeout 10.
  const settings = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/memory-session.js"', timeout: 10 }] },
      ],
    },
  };
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));

  return { projectDir, dbPath, mcpConfigPath };
}

const INSTALLER_SEED = path.join(ROOT, 'scripts', 'install', 'alfred-code.js');

// Builds a temp project with the REAL installer from this worktree (--source), confirming
// buildProjectSelf's hand-built approximation once Task 6 has landed. Selection is deliberately
// narrow - just what the five scenarios need - not a full 79-skill install: `hook docs-session` is
// selected (not just `hook memory-session`) because memory-session.js's related-projects lookup
// requires docs.js, which ONLY ships alongside a SELECTED docs-session.js (scripts/install/copy.js:
// memory-session.js's own companion copy is memory.js, not docs.js) - this also means the real
// install additionally WIRES docs-session.js as a live hook, which buildProjectSelf deliberately does
// not (see diffSetups() for the full comparison). `--scope project` + `--memory-level project` keep
// everything inside this one throwaway directory; no CLAUDE_CONFIG_DIR override, so `claude mcp add`
// and the auth the installer's own `claude` calls need both resolve through the real default account.
function buildProjectInstall(projectDir, { agents = [] } = {}) {
  fs.mkdirSync(projectDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: projectDir });

  const selectionPath = path.join(projectDir, '.eval-selection.txt');
  const selectionLines = ['rule baseline-memory', 'hook memory-session', 'hook docs-session', 'mcp memory', ...agents.map((a) => `agent ${a}`)];
  fs.writeFileSync(selectionPath, `${selectionLines.join('\n')}\n`);

  execFileSync(process.execPath, [INSTALLER_SEED, 'install', '--scope', 'project', '--selection', selectionPath, '--source', ROOT, '--memory-level', 'project'], {
    cwd: projectDir, stdio: 'pipe', timeout: 180000,
  });

  return {
    projectDir,
    dbPath: path.join(projectDir, '.memory-mcp', 'memory.db'),
    mcpConfigPath: path.join(projectDir, '.mcp.json'),
  };
}

// Builds one project each way (self-built vs the real installer) and reports every difference in
// what actually matters for the five scenarios: the rule, the hook files + their settings.json
// wiring, the .mcp.json memory entry, and the agent file(s). Cleans both up itself.
async function diffSetups(agents) {
  const lines = [];
  const selfDir = path.join(TMP_BASE, `diff-self-${crypto.randomBytes(6).toString('hex')}`);
  const installDir = path.join(TMP_BASE, `diff-install-${crypto.randomBytes(6).toString('hex')}`);
  let installSlug = null;
  try {
    const self = buildProjectSelf(selfDir, { agents });
    let install;
    try {
      install = buildProjectInstall(installDir, { agents });
    } catch (err) {
      lines.push(`INSTALL BUILD FAILED: ${err && err.message ? err.message : err}`);
      if (err && err.stderr) lines.push(String(err.stderr).slice(-2000));
      return lines;
    }

    const readOr = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
    const same = (a, b) => a === b;

    // Rule
    const ruleSelf = readOr(path.join(selfDir, '.claude', 'rules', 'baseline-memory.md'));
    const ruleInstall = readOr(path.join(installDir, '.claude', 'rules', 'baseline-memory.md'));
    lines.push(`rule baseline-memory.md: ${same(ruleSelf, ruleInstall) ? 'identical' : 'DIFFERS'}`);

    // Hook engine files
    for (const f of ['memory.js', 'memory-session.js', 'docs.js']) {
      const a = readOr(path.join(selfDir, '.claude', 'hooks', f));
      const b = readOr(path.join(installDir, '.claude', 'hooks', f));
      lines.push(`hook ${f} content: ${same(a, b) ? 'identical' : (b === null ? 'MISSING in install' : 'DIFFERS')}`);
    }
    const installOnlyHooks = ['docs-session.js'].filter((f) => fs.existsSync(path.join(installDir, '.claude', 'hooks', f)));
    if (installOnlyHooks.length) lines.push(`install-only hook file(s) (expected - needed to bring docs.js along): ${installOnlyHooks.join(', ')}`);

    // .mcp.json memory entry (paths compared by suffix, since the real install resolves the realpath and the self-built one does not)
    const mcpSelf = JSON.parse(readOr(path.join(selfDir, '.mcp.json')) || '{}').mcpServers.memory;
    const mcpInstall = JSON.parse(readOr(path.join(installDir, '.mcp.json')) || '{}').mcpServers.memory;
    const argsMatch = JSON.stringify(mcpSelf.args) === JSON.stringify(mcpInstall.args);
    const envMatch = mcpSelf.env.MCP_MEMORY_STORAGE_BACKEND === mcpInstall.env.MCP_MEMORY_STORAGE_BACKEND
      && mcpSelf.env.MCP_MEMORY_SQLITE_PRAGMAS === mcpInstall.env.MCP_MEMORY_SQLITE_PRAGMAS
      && mcpInstall.env.MCP_MEMORY_SQLITE_PATH.endsWith('/.memory-mcp/memory.db');
    lines.push(`.mcp.json memory command/args: ${mcpSelf.command === mcpInstall.command && argsMatch ? 'identical' : 'DIFFERS'}`);
    lines.push(`.mcp.json memory env (backend/pragmas/path-shape): ${envMatch ? 'identical' : 'DIFFERS'}`);
    if (mcpInstall.env.MCP_MEMORY_SQLITE_PATH !== path.join(installDir, '.memory-mcp', 'memory.db')) {
      lines.push(`  note: install's db path is the REALPATH (${mcpInstall.env.MCP_MEMORY_SQLITE_PATH}), self-built uses the literal os.tmpdir() form - same file, different spelling`);
    }

    // Agents
    for (const a of agents) {
      const x = readOr(path.join(selfDir, '.claude', 'agents', `${a}.md`));
      const y = readOr(path.join(installDir, '.claude', 'agents', `${a}.md`));
      lines.push(`agent ${a}.md: ${same(x, y) ? 'identical' : 'DIFFERS'}`);
    }

    // settings.json wiring
    const settingsSelf = JSON.parse(readOr(path.join(selfDir, '.claude', 'settings.json')) || '{}');
    const settingsInstall = JSON.parse(readOr(path.join(installDir, '.claude', 'settings.json')) || '{}');
    const memWireSelf = (settingsSelf.hooks && settingsSelf.hooks.SessionStart || []).some((e) => e.hooks.some((h) => h.command.includes('memory-session.js')));
    const memWireInstall = (settingsInstall.hooks && settingsInstall.hooks.SessionStart || []).some((e) => e.hooks.some((h) => h.command.includes('memory-session.js')));
    lines.push(`settings.json SessionStart -> memory-session.js wired: self=${memWireSelf} install=${memWireInstall}`);
    const installExtraKeys = Object.keys(settingsInstall).filter((k) => !(k in settingsSelf));
    lines.push(`settings.json keys only the real install writes: ${installExtraKeys.join(', ') || '(none)'}`);
    const installExtraEventKeys = Object.keys(settingsInstall.hooks || {}).filter((k) => !((settingsSelf.hooks || {})[k]));
    lines.push(`settings.json hook EVENTS only the real install wires (docs-session.js, from selecting it to get docs.js): ${installExtraEventKeys.join(', ') || '(none)'}`);

    // Other install-only artifacts
    for (const extra of ['CLAUDE.md', 'claude-stack.stamp']) {
      lines.push(`.claude/${extra}: self=${fs.existsSync(path.join(selfDir, '.claude', extra))} install=${fs.existsSync(path.join(installDir, '.claude', extra))}`);
    }
    lines.push(`settings.json autoMemoryEnabled: self=${settingsSelf.autoMemoryEnabled} install=${settingsInstall.autoMemoryEnabled} (install switches Claude's own auto-memory off; self-built leaves it untouched)`);

    installSlug = null; // no claude session was started for either build - nothing under ~/.claude/projects/ to clean here
  } finally {
    fs.rmSync(selfDir, { recursive: true, force: true });
    fs.rmSync(installDir, { recursive: true, force: true });
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------
// --setup update: a PRE-FEATURE install (the installer as it stood the commit before this branch's
// own memory-feature commits begin) updated in place by the installer AT THE TIP OF THIS WORKING
// TREE - the one edge case CLAUDE.md requires ("an update over an older install") that neither
// buildProjectSelf nor buildProjectInstall exercises: both build a project that already has the
// feature from a fresh install, never a project the feature was ADDED to later. Both installer
// snapshots come from `git archive`, not a raw directory copy - CLAUDE.md's own release path
// (releases/latest archive or a shallow clone) never carries node_modules or .git, and buildProjectInstall's
// `--source ROOT` (the live checkout) does; this is the gap final-review-A.md C1 names, and I9 asks
// this mode to exercise the release-shaped snapshot for that reason.
// ---------------------------------------------------------------------------------------------------

// The last commit before this branch's shared-memory feature work begins (cross-task-facts.md's own
// commit log: f3fa404/76a8166/77105df/883a366/0fd7a72 are the feature commits; bb5c684 is the tip
// immediately before them, still reachable from this branch's history). Pinned to a SHA, never a
// branch name, so this stays the pre-feature baseline even as develop/main move on independently.
const PRE_FEATURE_COMMIT = 'bb5c684';

// `git archive <committish> | tar -x` into destDir - a clean tree (no .git, no node_modules, no
// gitignored files), the same shape a real release archive or shallow-clone snapshot has. Piped
// through node buffers rather than a shell pipeline so destDir never needs shell-quoting.
//
// ALSO writes RELEASE-SOURCE (sha/ref/version/source lines, the exact shape a real release archive
// carries) - without it, the Node seed's source.js has no git checkout (no .git, deliberately) and no
// RELEASE-SOURCE to read the source revision from, so its stamp writer takes its 'no source revision
// resolved' fail-soft branch and writes NO stamp file at all
// (confirmed live: a first attempt at this without the file produced no stamp). A `git archive`
// snapshot with no RELEASE-SOURCE is not actually release-shaped - a real release archive always
// carries one (.github/workflows/release.yml) - so this was a gap in what 'release-shaped' claimed.
function extractGitArchive(committish, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const archive = spawnSync('git', ['archive', committish], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  if (archive.error || archive.status !== 0) {
    throw new Error(`git archive ${committish} failed: ${archive.error ? archive.error.message : String(archive.stderr || '').slice(-2000)}`);
  }
  const tar = spawnSync('tar', ['-x', '-C', destDir], { input: archive.stdout, maxBuffer: 256 * 1024 * 1024 });
  if (tar.error || tar.status !== 0) {
    throw new Error(`tar extract of ${committish} into ${destDir} failed: ${tar.error ? tar.error.message : String(tar.stderr || '').slice(-2000)}`);
  }
  const shaRes = spawnSync('git', ['rev-parse', committish], { cwd: ROOT, encoding: 'utf8' });
  const sha = (shaRes.stdout || '').trim();
  if (shaRes.status !== 0 || !sha) throw new Error(`git rev-parse ${committish} failed: ${shaRes.stderr || ''}`);
  const pluginJsonRes = spawnSync('git', ['show', `${committish}:setup-plugin/.claude-plugin/plugin.json`], { cwd: ROOT, encoding: 'utf8' });
  const versionMatch = /"version"\s*:\s*"([^"]+)"/.exec(pluginJsonRes.stdout || '');
  const version = versionMatch ? versionMatch[1] : '0.0.0';
  fs.writeFileSync(path.join(destDir, 'RELEASE-SOURCE'), `sha: ${sha}\nref: ${committish}\nversion: ${version}\nsource: memory-usage-eval-archive\n`);
  return destDir;
}

// Both snapshots are fixed for the lifetime of one `main()` invocation (one pinned SHA, one HEAD) -
// extracted once and reused across every --parallel run instead of once per run. Plain memoized
// values, not promises: extractGitArchive is fully synchronous (spawnSync), so the first caller runs
// it to completion before any concurrent caller (cooperatively scheduled, single-threaded) can observe
// the cache as empty - no lock needed, unlike seedMemory's genuinely async server round-trips.
let preFeatureSrcDir = null;
function preFeatureSrc() {
  if (!preFeatureSrcDir) preFeatureSrcDir = extractGitArchive(PRE_FEATURE_COMMIT, path.join(TMP_BASE, `pre-feature-src-${PRE_FEATURE_COMMIT}`));
  return preFeatureSrcDir;
}
let releaseSrcDir = null;
function releaseSrcSnapshot() {
  if (!releaseSrcDir) releaseSrcDir = extractGitArchive('HEAD', path.join(TMP_BASE, `release-src-HEAD-${crypto.randomBytes(4).toString('hex')}`));
  return releaseSrcDir;
}

// A single frontmatter'd note, the same shape Claude Code's own per-project auto-memory writes
// (memory-import.js's parseNote: `type` / `name` / `description` + body). A distinctive fact
// (port 8213) so the post-update db row is identifiable as THIS note, not a coincidence.
const PRE_FEATURE_NOTE = `---
type: reference
name: pre-feature-fact
description: The staging cache in this project listens on port 8213.
---
Recorded before the memory feature existed - proves an update's one-time import carries a project's
existing auto-memory notes into the shared MCP.
`;

// Seeds <acctDir>/projects/<slug>/memory/<note>.md - exactly where memory-import.js's own
// defaultMemoryDir() looks (configDir/projects/slug/memory), computed by REQUIRING that module's own
// slugify()/gitTopLevel() rather than duplicating the regex, so this stays correct even after F1's
// fix round changes it (memory-import.js is read here, never written - Task 8 does not own it).
function seedPreFeatureNote(acctDir, projectDir) {
  // eslint-disable-next-line global-require
  const { slugify, gitTopLevel } = require(path.join(ROOT, 'scripts', 'memory-import.js'));
  const slug = slugify(gitTopLevel(projectDir));
  const memDir = path.join(acctDir, 'projects', slug, 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'pre-feature-fact.md'), PRE_FEATURE_NOTE);
}

// Dedicated to the update-path asserts - a PLAIN read-only open only, never the `immutable=1` URI
// fallback the shared readDbRows() (used by scenario evaluation, out of scope for this fix) falls
// back to on a failed first open. `immutable=1` tells SQLite the file will never change for the
// lifetime of the connection, so it is free to ignore the `-wal` file entirely and answer from
// whatever the base db file held at open time - a write sitting in the WAL, not yet checkpointed
// back into the main file, reads back as 0 rows that are really there. Controller directive after
// the S4 run-2 miss: treated as a real bug, not a transient - do not mask it behind that fallback.
function readDbRowsForAssert(dbPath) {
  let sqliteMod;
  try { process.removeAllListeners('warning'); sqliteMod = require('node:sqlite'); } catch { return null; }
  const { DatabaseSync } = sqliteMod;
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  try { return db.prepare('SELECT id, content, tags, memory_type, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC').all(); }
  catch { return null; }
  finally { try { db.close(); } catch { /* ignore */ } }
}

// On ANY failed post-update assert: copy the install log, the update log, and the db file plus its
// `-wal`/`-shm` sidecars (whichever exist - WAL mode may or may not be in play) into a forensics
// folder OUTSIDE the temp project (a FORENSICS_DIR sibling, never a path cleanupRun() touches), so
// they survive the run's own cleanup. Returns the folder's path, which the caller folds into the
// thrown error - "name it in the record".
function writeUpdateForensics(projectDir, { preInstallLog, updateLog, dbPath }) {
  const dir = path.join(FORENSICS_DIR, `${path.basename(projectDir)}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  try { fs.writeFileSync(path.join(dir, 'pre-feature-install.log'), preInstallLog || ''); } catch { /* best effort */ }
  try { fs.writeFileSync(path.join(dir, 'update.log'), updateLog || ''); } catch { /* best effort */ }
  for (const suffix of ['', '-wal', '-shm']) {
    const src = `${dbPath}${suffix}`;
    if (fs.existsSync(src)) { try { fs.copyFileSync(src, path.join(dir, `memory.db${suffix}`)); } catch { /* best effort */ } }
  }
  return dir;
}

// Builds a project two ways in sequence: (1) `install` from the PRE-FEATURE snapshot (no memory
// feature at all - the old installer has no `mcp memory` / `rule baseline-memory` / `--memory-level`
// to select in the first place; the scenario's own agent(s), if any, are selected here too - see the
// note above the selection lines), then seeds a Claude-own-memory note for it, then (2) `update`
// --installed-only from THIS working tree's HEAD snapshot - the real path a user's no-questions
// `update` takes, not an explicit --selection - which should register the memory MCP, drop
// baseline-memory.md in, import the seeded note, and switch autoMemoryEnabled off. Both installer
// invocations run under one sandboxed CLAUDE_CONFIG_DIR (never the real account - the whole point of
// a temp-project matrix, CLAUDE.md's own invariant) so the note-seeding step has a folder to seed
// into that is not the real ~/.claude, and never touches it.
//
// Every failure - a spawn error, a non-zero installer exit, a failed assertion - is a thrown Error,
// which runOne()'s existing try/catch already turns into a reported record (pass:false, error
// message) rather than crashing the batch; nothing extra is needed here for that requirement.
async function buildProjectUpdate(projectDir, { agents = [], acctDir } = {}) {
  const preSrc = preFeatureSrc();
  const relSrc = releaseSrcSnapshot();
  // The caller (runOne) computes this BEFORE calling in, so it stays known for cleanup even if this
  // function throws partway through; a standalone caller (a smoke test) gets the same derivation.
  if (!acctDir) acctDir = path.join(path.dirname(projectDir), `${path.basename(projectDir)}-acct`);
  fs.mkdirSync(acctDir, { recursive: true });
  const sandboxEnv = { ...process.env, CLAUDE_CONFIG_DIR: acctDir };

  fs.mkdirSync(projectDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: projectDir });

  // Step 1: pre-feature install. A minimal, deliberately narrow selection (one always-on rule, no
  // plugin/skill/agent lines) - the old installer has no memory categories to name, and this is
  // meant to be fast + deterministic, not a full-catalog install; hooks install in full regardless
  // ("a selection with no 'hook' lines installs all hooks", both installer twins' own --help text).
  // The scenario's own agent(s) (evidence-gatherer for scenarios 3/4) are selected HERE, pre-feature,
  // not in step 2 - step 2 now runs `--installed-only` (real-user update path, controller directive
  // after the re-review: real users update through --installed-only, not --selection), which refreshes
  // whatever is ALREADY installed rather than adding anything new; an agent named only in step 2's own
  // selection would never have landed under that mode.
  const preSelectionPath = path.join(projectDir, '.eval-pre-feature-selection.txt');
  const preSelectionLines = ['rule baseline-navigation', ...agents.map((a) => `agent ${a}`)];
  fs.writeFileSync(preSelectionPath, `${preSelectionLines.join('\n')}\n`);
  // spawnSync (not execFileSync): the log is captured regardless of exit code, not only on a throw -
  // needed so a LATER assert failure (the install itself having exited 0) can still dump what it saw.
  // PRE_FEATURE_COMMIT predates Phase 7b (R33): that archive genuinely still carries the frozen shell
  // twin, so this call targets it on purpose - it is not a live reference to a file this repo ships.
  const preInstallRes = spawnSync('bash', [path.join(preSrc, 'scripts', 'os', 'claude-stack.sh'), 'install', '--scope', 'project', '--selection', preSelectionPath, '--source', preSrc], {   // legacy-name
    cwd: projectDir, encoding: 'utf8', timeout: 180000, env: sandboxEnv, maxBuffer: 64 * 1024 * 1024,
  });
  const preInstallLog = `$ install --selection ${preSelectionPath} --source ${preSrc}\nexit=${preInstallRes.status}\n--- stdout ---\n${preInstallRes.stdout || ''}\n--- stderr ---\n${preInstallRes.stderr || ''}\n`;
  if (preInstallRes.error || preInstallRes.status !== 0) {
    throw new Error(`pre-feature install (${PRE_FEATURE_COMMIT}) failed: ${preInstallRes.error ? preInstallRes.error.message : `exit ${preInstallRes.status}`} - ${String(preInstallRes.stderr || '').slice(-2000)}`);
  }
  const preMcp = fs.existsSync(path.join(projectDir, '.mcp.json')) ? JSON.parse(fs.readFileSync(path.join(projectDir, '.mcp.json'), 'utf8') || '{}') : {};
  const preHasMemory = fs.existsSync(path.join(projectDir, '.claude', 'rules', 'baseline-memory.md')) || !!(preMcp.mcpServers && preMcp.mcpServers.memory);
  if (preHasMemory) throw new Error(`pre-feature install (${PRE_FEATURE_COMMIT}) unexpectedly already has the memory feature - not a valid pre-feature baseline`);
  // Controller directive: the seed install must genuinely LOOK like an older real install, not just
  // lack the memory feature by construction - a stamp, but one written before a4c0828's
  // installed-always-rules:/installed-always-mcps: lines existed (bb5c684 predates that commit, so
  // its own write_stamp() heredoc never had those lines at all - not merely empty-valued). This is
  // what proves the update path is exercising the real 'a locked item this project never had before'
  // case a4c0828 fixed, not an already-always-aware fixture.
  const preStampPath = path.join(projectDir, '.claude', 'claude-stack.stamp');
  if (!fs.existsSync(preStampPath)) throw new Error(`pre-feature install (${PRE_FEATURE_COMMIT}) wrote no claude-stack.stamp - not a valid pre-feature baseline`);
  const preStamp = fs.readFileSync(preStampPath, 'utf8');
  if (/^installed-always-(rules|mcps):/m.test(preStamp)) {
    throw new Error(`pre-feature install (${PRE_FEATURE_COMMIT}) stamp already carries installed-always- keys - not a pre-a4c0828 baseline`);
  }

  // A pre-feature project has no `memory` MCP registration yet, so there is nothing to seed a note
  // INTO via the real server (unlike scenarios 2/4/5's seedMemory) - this note stands in for Claude's
  // own auto-memory, written directly to where memory-import.js will find it, exactly as a real
  // session would have left it there before this project ever had the shared MCP.
  seedPreFeatureNote(acctDir, projectDir);

  // Step 2: update, from a release-shaped snapshot of THIS working tree's HEAD (C1's exact gap - no
  // node_modules). `--installed-only` (not an explicit --selection) - the real path a user's
  // no-questions `update` actually takes, per the re-review: baseline-memory / memory-session /
  // docs-session / the memory MCP are all NEW categories this pre-feature project never had, so this
  // depends on the installer treating them as locked/always-add rather than 'not currently installed,
  // so not wanted' - the fix the controller flagged as landing separately. Do not run this until told to.
  const updateRes = spawnSync(process.execPath, [path.join(relSrc, 'scripts', 'install', 'alfred-code.js'), 'update', '--scope', 'project', '--installed-only', '--source', relSrc, '--memory-level', 'project'], {
    cwd: projectDir, encoding: 'utf8', timeout: 180000, env: sandboxEnv, maxBuffer: 64 * 1024 * 1024,
  });
  const updateLog = `$ update --installed-only --source ${relSrc} --memory-level project\nexit=${updateRes.status}\n--- stdout ---\n${updateRes.stdout || ''}\n--- stderr ---\n${updateRes.stderr || ''}\n`;
  if (updateRes.error || updateRes.status !== 0) {
    throw new Error(`update --installed-only (HEAD, over the ${PRE_FEATURE_COMMIT} baseline) failed: ${updateRes.error ? updateRes.error.message : `exit ${updateRes.status}`} - ${String(updateRes.stderr || '').slice(-2000)}`);
  }

  const dbPath = path.join(projectDir, '.memory-mcp', 'memory.db');
  const mcpConfigPath = path.join(projectDir, '.mcp.json');

  // Assert per the brief: baseline-memory.md present, memory registered, the note imported (a row in
  // the db), autoMemoryEnabled false. Each check names exactly what it found, not just pass/fail, so
  // a failure record is diagnosable from the JSON results file alone. Wrapped so ANY assert failure
  // (controller directive after the S4 run-2 miss, now treated as a real bug, not a transient) dumps
  // forensics - the install/update logs plus the db and its -wal/-shm sidecars - to a folder OUTSIDE
  // the temp project, before cleanupRun() removes everything, and names that folder in the error text
  // that ends up in the record.
  try {
    const asserts = [];
    const ruleOk = fs.existsSync(path.join(projectDir, '.claude', 'rules', 'baseline-memory.md'));
    asserts.push(`baseline-memory.md present: ${ruleOk}`);
    if (!ruleOk) throw new Error(`update assertion failed - baseline-memory.md missing after update (${asserts.join('; ')})`);

    const mcpData = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8') || '{}');
    const memEntry = mcpData.mcpServers && mcpData.mcpServers.memory;
    asserts.push(`memory registered in .mcp.json: ${!!(memEntry && memEntry.command)}`);
    if (!memEntry || !memEntry.command) throw new Error(`update assertion failed - no memory server registered in .mcp.json (${asserts.join('; ')})`);

    const settingsPath = path.join(projectDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
    asserts.push(`autoMemoryEnabled false: ${settings.autoMemoryEnabled === false}`);
    if (settings.autoMemoryEnabled !== false) throw new Error(`update assertion failed - autoMemoryEnabled is ${JSON.stringify(settings.autoMemoryEnabled)}, expected false (${asserts.join('; ')})`);

    // Plain read-only open ONLY - no immutable=1 URI fallback (readDbRowsForAssert, not the shared
    // readDbRows()). Controller directive: immutable tells SQLite the file never changes, so a reader
    // opened that way can ignore the -wal file entirely and see a stale, pre-write snapshot - 0 rows
    // that are really there the moment a write landed in the WAL and had not yet been checkpointed
    // into the main db file. That masked the real bug behind the S4 run-2 miss as a false 'no row'.
    const rows = readDbRowsForAssert(dbPath) || [];
    const importedRow = rows.find((r) => /8213/.test(r.content));
    asserts.push(`note imported (a row in the db): ${!!importedRow}`);
    if (!importedRow) throw new Error(`update assertion failed - no db row for the seeded pre-feature note (${rows.length} row(s) total) (${asserts.join('; ')})`);

    return { projectDir, dbPath, mcpConfigPath, acctDir, updateAsserts: asserts };
  } catch (assertErr) {
    const forensicsDir = writeUpdateForensics(projectDir, { preInstallLog, updateLog, dbPath });
    throw new Error(`${assertErr.message} - forensics: ${forensicsDir}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Seeding: the real server, JSON-RPC over stdio - same route as scripts/memory-import.js
// ---------------------------------------------------------------------------------------------------

function readRegistration(mcpConfigPath) {
  const data = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  const entry = data && data.mcpServers && data.mcpServers.memory;
  if (!entry || !entry.command) throw new Error(`no memory server registered in ${mcpConfigPath}`);
  return entry;
}

function createRpcClient(child) {
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  let fatal = null;
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  const fail = (err) => { if (!fatal) fatal = err; for (const { reject } of pending.values()) reject(err); pending.clear(); };
  child.on('error', (err) => fail(err));
  child.on('exit', (code, signal) => fail(new Error(`memory server exited (code=${code} signal=${signal})`)));
  function call(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (fatal) { reject(fatal); return; }
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`'${method}' timed out after ${timeoutMs}ms`)); }, timeoutMs);
      pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  function notify(method, params) { if (!fatal) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
  return { call, notify };
}

// Runs one seedMemory() at a time across the whole process, regardless of --parallel: a 5-way
// concurrent `claude -p` run already spawns up to 5 of ITS OWN memory-server processes (one per
// project), and layering concurrent SEEDING spawns on top of that starves every one of them of
// CPU during the ONNX/CoreML embedding-model warm-up (measured: 3 of 5 concurrent seed spawns under
// --parallel 5 blew a 60s initialize / 30s tools/call timeout that took ~2s uncontended solo - see
// task-8-report.md). Serializing just the seed step (typically ~2s each once warm) removes that
// contention without giving up parallel `claude -p` runs.
let seedQueue = Promise.resolve();
function withSeedLock(fn) {
  const run = seedQueue.then(fn, fn);
  seedQueue = run.then(() => {}, () => {});
  return run;
}

async function seedMemoryNow(mcpConfigPath, cwd, notes) {
  const entry = readRegistration(mcpConfigPath);
  const child = spawn(entry.command, entry.args || [], { cwd, env: { ...process.env, ...(entry.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = createRpcClient(child);
  try {
    // Generous even solo-warm (~2s): covers a cold ONNX/model download (~41s per FACT-EMBED) plus
    // headroom for whatever contention --parallel still creates from claude's OWN concurrent spawns.
    await rpc.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'memory-usage-eval', version: '1.0.0' } }, 120000);
    rpc.notify('notifications/initialized');
    for (const note of notes) {
      const resp = await rpc.call('tools/call', { name: 'memory_store', arguments: { content: note.content, metadata: { tags: note.tags || [], type: note.type } } }, 60000);
      if (resp.error) throw new Error(`seed memory_store failed: ${resp.error.message || JSON.stringify(resp.error)}`);
      const text = resp.result && Array.isArray(resp.result.content) ? resp.result.content.map((c) => c.text || '').join('\n') : '';
      if (/error storing memory/i.test(text) && !/duplicate content detected/i.test(text)) throw new Error(`seed memory_store failed: ${text}`);
    }
  } finally {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function seedMemory(mcpConfigPath, cwd, notes) {
  return withSeedLock(() => seedMemoryNow(mcpConfigPath, cwd, notes));
}

// ---------------------------------------------------------------------------------------------------
// Driving claude -p and reading its evidence back
// ---------------------------------------------------------------------------------------------------

function runClaude(projectDir, prompt, { mcpConfigPath, allowedTools, model, sessionId, maxBudgetUsd, timeoutMs }) {
  const args = [
    '-p', prompt,
    '--model', model,
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--allowedTools', allowedTools.join(','),
    '--permission-prompts', 'none',
    '--session-id', sessionId,
    '--max-budget-usd', String(maxBudgetUsd),
    '--forward-subagent-text',
  ];
  const res = spawnSync('claude', args, { cwd: projectDir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs });
  const lines = String(res.stdout || '').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return { raw: res, lines };
}

function sessionToolCalls(lines, prefix) {
  const calls = [];
  for (const o of lines) {
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
    for (const b of o.message.content) {
      if (b && b.type === 'tool_use' && typeof b.name === 'string' && b.name.startsWith(prefix)) calls.push({ name: b.name, input: b.input });
    }
  }
  return calls;
}

// A subagent's actual final report does not always land in a plain assistant text block: this
// harness's OWN dispatched seats deliver their report through the SubagentHandback tool's `message`
// input instead (confirmed live: scenario 4's memory_search DID find the seeded fact every time, but
// the agent's report text was in a SubagentHandback tool_use, not a text block - the first evaluate()
// here missed it entirely, a harness bug, not a memory-mechanism failure). Both count as "what the
// subagent reported".
function assistantTexts(lines) {
  const texts = [];
  for (const o of lines) {
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
    for (const b of o.message.content) {
      if (b && b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      if (b && b.type === 'tool_use' && b.name === 'SubagentHandback' && b.input && typeof b.input.message === 'string') texts.push(b.input.message);
    }
  }
  return texts;
}

function finalResult(lines) {
  const r = lines.find((o) => o.type === 'result');
  return r ? { text: r.result || '', costUsd: r.total_cost_usd || 0, isError: !!r.is_error } : { text: '', costUsd: 0, isError: true };
}

// The SessionStart hook's own additionalContext, as it appears in the stream (system/hook_response).
function hookInjectedText(lines) {
  const hits = [];
  for (const o of lines) {
    if (o.type === 'system' && o.subtype === 'hook_response' && typeof o.output === 'string') {
      try {
        const parsed = JSON.parse(o.output);
        const ctx = parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
        if (typeof ctx === 'string') hits.push(ctx);
      } catch { /* not JSON - ignore */ }
    }
  }
  return hits.join('\n');
}

// Finds ~/.claude/projects/<slug>/ by searching for the run's own random hex marker, which survives
// whatever character-replacement slugification Claude Code applies to the rest of the temp path -
// robust even with other Claude Code sessions running concurrently on this machine.
function findProjectSlugDir(marker) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { return null; }
  const hit = entries.find((e) => e.includes(marker));
  return hit ? path.join(base, hit) : null;
}

function readTranscriptLines(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function subagentTranscripts(slugDir, sessionId) {
  const dir = path.join(slugDir, sessionId, 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  return files.map((f) => readTranscriptLines(path.join(dir, f)));
}

function readDbRows(dbPath) {
  let sqliteMod;
  try { process.removeAllListeners('warning'); sqliteMod = require('node:sqlite'); } catch { return null; }
  const { DatabaseSync } = sqliteMod;
  const targets = [dbPath, `file:${dbPath}?mode=ro&immutable=1`];
  for (let i = 0; i < targets.length; i++) {
    let db;
    try { db = new DatabaseSync(targets[i], { readOnly: true }); }
    catch { if (i === 0) continue; return null; }
    try { return db.prepare('SELECT id, content, tags, memory_type, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC').all(); }
    catch { return null; }
    finally { try { db.close(); } catch { /* ignore */ } }
  }
  return null;
}

function cleanupRun(projectDir, slugDir, acctDir) {
  try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (slugDir) { try { fs.rmSync(slugDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  if (acctDir) { try { fs.rmSync(acctDir, { recursive: true, force: true }); } catch { /* best effort */ } }
}

// ---------------------------------------------------------------------------------------------------
// The five scenarios (fixed before the first run, per the brief)
// ---------------------------------------------------------------------------------------------------

const RETRY_JS = `'use strict';
// A real, deterministic quirk: this project's test harness requires RETRY_DELAY_MS to be set - a
// bare \`npm test\` throws naming exactly that, \`RETRY_DELAY_MS=250 npm test\` passes.
function getRetryDelayMs() {
  const v = process.env.RETRY_DELAY_MS;
  if (!v) throw new Error("RETRY_DELAY_MS is not set - this project's test harness requires it (see test.js)");
  return Number(v);
}
module.exports = { getRetryDelayMs };
`;

const TEST_JS = `'use strict';
const assert = require('node:assert');
const { getRetryDelayMs } = require('./retry');
assert.strictEqual(getRetryDelayMs(), 250, 'retry delay must be 250ms');
console.log('ok');
`;

const relatedProjectsMd = () => `## billing-service
<!-- id: billing-service -->

\`\`\`yaml
location:   ../billing-service
relation:   consumes
first_read: []
seam:       invoices - this repo reads billing-service's invoice totals
captured:   main@0000000, ${new Date().toISOString().slice(0, 10)}
\`\`\`

What grounds it: seeded for scripts/memory-usage.eval.js scenario 5 - billing-service does not exist
on disk at this path, on purpose.
`;

const MEMORY_TOOLS = ['ToolSearch', 'mcp__plugin_memory_memory__memory_store', 'mcp__plugin_memory_memory__memory_search', 'mcp__plugin_memory_memory__memory_list'];

const SCENARIOS = [
  {
    id: 1,
    name: 'session writes',
    agents: [],
    async setup() { /* nothing to seed */ },
    prompt: 'From now on, always name test files with a .spec suffix in this project.',
    allowedTools: [...MEMORY_TOOLS, 'Bash'],
    evaluate({ lines, rows, projectName }) {
      const storeCalls = sessionToolCalls(lines, 'mcp__plugin_memory_memory__memory_store');
      const row = rows.find((r) => splitTags(r.tags).some((t) => t === `project:${projectName}` || t === projectName)
        && (r.memory_type === 'user_correction' || r.memory_type === 'preference_signal'));
      return {
        toolEvidence: storeCalls.length ? `memory_store x${storeCalls.length}` : 'no memory_store call',
        dbEvidence: row ? `row #${row.id} [${row.memory_type}] tags=${row.tags}` : 'no matching project-tagged row',
        pass: storeCalls.length > 0 && !!row,
      };
    },
  },
  {
    id: 2,
    name: 'session reads',
    agents: [],
    async setup(mcpConfigPath, projectDir) {
      await seedMemory(mcpConfigPath, projectDir, [
        { content: 'The user wants every answer to end with the word DONE.', tags: [], type: 'preference_signal' },
      ]);
    },
    prompt: 'What is 7 + 5?',
    allowedTools: MEMORY_TOOLS,
    evaluate({ lines }) {
      const injected = hookInjectedText(lines);
      const carried = /wants every answer to end with the word done/i.test(injected);
      const { text } = finalResult(lines);
      const ends = /DONE[.!?]*\s*$/.test(text.trim());
      return {
        toolEvidence: carried ? 'SessionStart block carried the preference' : 'SessionStart block missing the preference',
        dbEvidence: ends ? `answer ended with DONE: "${truncate(text.trim(), 60)}"` : `answer did not end with DONE: "${truncate(text.trim(), 60)}"`,
        pass: carried && ends,
      };
    },
  },
  {
    id: 3,
    name: 'agent writes',
    agents: ['evidence-gatherer'],
    async setup(mcpConfigPath, projectDir) {
      fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'quirk-project', private: true, scripts: { test: 'node test.js' } }, null, 2));
      fs.writeFileSync(path.join(projectDir, 'retry.js'), RETRY_JS);
      fs.writeFileSync(path.join(projectDir, 'test.js'), TEST_JS);
    },
    prompt: "`npm test` fails in this project and I don't know why. Dispatch the evidence-gatherer "
      + 'agent (the Agent tool) to investigate the root cause. This project\'s tests come up again and '
      + 'again: if the investigation turns up something worth remembering for next time (the quirk, '
      + 'what fixes it), have the agent save it to the shared memory before it reports back, per this '
      + "project's own memory rule.",
    allowedTools: ['Agent', 'Task', ...MEMORY_TOOLS, 'Bash', 'Read', 'Grep', 'Glob'],
    evaluate({ subTranscripts, rows }) {
      const storeCalls = subTranscripts.flatMap((t) => sessionToolCalls(t, 'mcp__plugin_memory_memory__memory_store'));
      const row = rows.find((r) => splitTags(r.tags).some((t) => t.startsWith('agent:')) && r.memory_type === 'learning');
      return {
        toolEvidence: storeCalls.length ? `subagent memory_store x${storeCalls.length}` : 'no subagent memory_store call',
        dbEvidence: row ? `row #${row.id} tags=${row.tags}` : 'no agent-tagged learning row',
        pass: storeCalls.length > 0 && !!row,
      };
    },
  },
  {
    id: 4,
    name: 'agent reads',
    agents: ['evidence-gatherer'],
    async setup(mcpConfigPath, projectDir, projectName) {
      await seedMemory(mcpConfigPath, projectDir, [
        { content: 'The staging database port in this project is 6543.', tags: ['agent:evidence-gatherer', `project:${projectName}`], type: 'learning' },
      ]);
    },
    prompt: 'Dispatch the evidence-gatherer agent (the Agent tool) to report the staging database '
      + "port used by this project. It will not find this in the code - it should check the shared "
      + 'project memory first.',
    allowedTools: ['Agent', 'Task', ...MEMORY_TOOLS, 'Bash', 'Read', 'Grep', 'Glob'],
    evaluate({ subTranscripts }) {
      const searchCalls = subTranscripts.flatMap((t) => sessionToolCalls(t, 'mcp__plugin_memory_memory__memory_search').concat(sessionToolCalls(t, 'mcp__plugin_memory_memory__memory_list')));
      const found = subTranscripts.some((t) => assistantTexts(t).some((txt) => /6543/.test(txt)));
      return {
        toolEvidence: searchCalls.length ? `subagent memory_search/list x${searchCalls.length}` : 'no subagent search/list call',
        dbEvidence: found ? '6543 present in subagent report' : '6543 not found in subagent report',
        pass: searchCalls.length > 0 && found,
      };
    },
  },
  {
    id: 5,
    name: 'related project reads',
    agents: [],
    async setup(mcpConfigPath, projectDir) {
      const docDir = path.join(projectDir, '.claude', 'docs', 'related-projects');
      fs.mkdirSync(docDir, { recursive: true });
      fs.writeFileSync(path.join(docDir, 'RELATED-PROJECTS.md'), relatedProjectsMd());
      await seedMemory(mcpConfigPath, projectDir, [
        { content: 'billing-service exposes invoices on port 7081.', tags: ['project:billing-service'], type: 'reference' },
      ]);
    },
    prompt: 'Which port does billing-service serve invoices on?',
    allowedTools: [...MEMORY_TOOLS, 'Read', 'Grep', 'Glob', 'Bash'],
    evaluate({ lines }) {
      const { text } = finalResult(lines);
      const has7081 = /7081/.test(text);
      const touchedSibling = lines.some((o) => o.type === 'assistant' && Array.isArray(o.message && o.message.content)
        && o.message.content.some((b) => b && b.type === 'tool_use' && ['Read', 'Glob', 'Grep', 'Bash'].includes(b.name)
          && JSON.stringify(b.input || '').includes('billing-service')));
      return {
        toolEvidence: touchedSibling ? 'a Read/Glob/Grep/Bash call referenced billing-service' : 'no Read/Glob/Grep/Bash referenced billing-service',
        dbEvidence: has7081 ? 'answer contains 7081' : 'answer missing 7081',
        pass: has7081 && !touchedSibling,
      };
    },
  },
];

// ---------------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------------

async function runOne(scenario, runIndex, opts) {
  const runId = crypto.randomBytes(6).toString('hex');
  const projectDir = path.join(TMP_BASE, `s${scenario.id}-run${runIndex}-${runId}`);
  const sessionId = crypto.randomUUID();
  let slugDir = null;
  // Computed BEFORE build(), not read back from its return value: buildProjectUpdate creates acctDir
  // as its very first step, so a THROWN assertion/install failure later in that same function must
  // still leave this known for cleanup - reading it off a successful return only (the previous shape)
  // silently orphaned the sandboxed account dir (and everything under it, including its own
  // projects/<slug>/ folder) on every setup failure. Harmless for self/install (stays null, unused).
  let acctDir = opts.setup === 'update' ? path.join(TMP_BASE, `${path.basename(projectDir)}-acct`) : null;
  const record = { scenario: scenario.id, scenarioName: scenario.name, run: runIndex, runId };
  try {
    const build = opts.setup === 'install' ? buildProjectInstall : opts.setup === 'update' ? buildProjectUpdate : buildProjectSelf;
    const built = opts.setup === 'update' ? await build(projectDir, { agents: scenario.agents, acctDir }) : await build(projectDir, { agents: scenario.agents });
    const { dbPath, mcpConfigPath } = built;
    // The four post-update asserts, always present on a successful buildProjectUpdate (a failing one
    // throws instead, caught below, with the same four folded into record.error's text).
    if (built.updateAsserts) record.updateAsserts = built.updateAsserts;
    const projectName = path.basename(projectDir);
    if (scenario.setup) await scenario.setup(mcpConfigPath, projectDir, projectName);

    const { lines, raw } = runClaude(projectDir, scenario.prompt, {
      mcpConfigPath, allowedTools: scenario.allowedTools, model: opts.model, sessionId, maxBudgetUsd: opts.maxBudgetUsd, timeoutMs: opts.timeoutMs,
    });
    if (raw.error) record.spawnError = raw.error.message;
    record.exitCode = raw.status;

    slugDir = findProjectSlugDir(runId);
    const subTranscripts = slugDir ? subagentTranscripts(slugDir, sessionId) : [];
    const rows = readDbRows(dbPath) || [];
    const { text: finalText, costUsd } = finalResult(lines);
    record.costUsd = costUsd;
    record.finalText = truncate(finalText, 300);

    const evalResult = scenario.evaluate({ lines, subTranscripts, rows, projectName, finalText });
    record.toolEvidence = evalResult.toolEvidence;
    record.dbEvidence = evalResult.dbEvidence;
    record.pass = !!evalResult.pass;
  } catch (err) {
    record.error = err && err.message ? err.message : String(err);
    record.toolEvidence = record.toolEvidence || 'ERROR';
    record.dbEvidence = record.dbEvidence || record.error;
    record.pass = false;
  } finally {
    cleanupRun(projectDir, slugDir, acctDir);
  }
  return record;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

function printTable(records) {
  const headers = ['scenario', 'run', 'tool-call evidence', 'db/answer evidence', 'pass'];
  const rows = records.map((r) => [
    `${r.scenario} ${r.scenarioName}`,
    String(r.run),
    truncate(r.toolEvidence, 55),
    truncate(r.dbEvidence, 55),
    r.pass ? 'PASS' : 'FAIL',
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

// The pass mark scales with --runs, fixed BEFORE the run (never derived from how many records a
// scenario actually produced): ceil(2/3 x runs) - runs 1 -> 1, runs 3 -> 2, runs 15 -> 10. A single
// hardcoded '>= 2' (the old behavior) read every --runs-1 confirmation as FAIL regardless of outcome
// (final-review-A.md I9: the --setup install confirmation run's own printed verdict line was wrong
// for exactly this reason, even though every per-run 'pass' column was correct).
function passMarkFor(runs) { return Math.ceil((2 / 3) * runs); }

function summarize(records, scenarios, runs) {
  const bySc = new Map();
  for (const r of records) { if (!bySc.has(r.scenario)) bySc.set(r.scenario, []); bySc.get(r.scenario).push(r); }
  const mark = passMarkFor(runs);
  return scenarios.map((sc) => {
    const list = bySc.get(sc.id) || [];
    const passes = list.filter((r) => r.pass).length;
    return {
      scenario: sc.id, name: sc.name, passes, of: list.length, passMark: mark,
      verdict: passes >= mark ? `PASS (${mark}+/${runs} mark)` : `FAIL (below ${mark}/${runs} mark)`,
    };
  });
}

function parseArgs(argv) {
  const out = { scenarios: [1, 2, 3, 4, 5], runs: 3, parallel: 5, model: 'sonnet', maxBudgetUsd: 1.5, timeoutMs: 360000, setup: 'self', diff: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') out.scenarios = argv[++i].split(',').map(Number);
    else if (a === '--runs') out.runs = Number(argv[++i]);
    else if (a === '--parallel') out.parallel = Number(argv[++i]);
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--max-budget-usd') out.maxBudgetUsd = Number(argv[++i]);
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else if (a === '--setup') out.setup = argv[++i];
    else if (a === '--diff') out.diff = true;
    else throw new Error(`unrecognized argument '${a}'`);
  }
  if (!['self', 'install', 'update'].includes(out.setup)) throw new Error(`--setup must be 'self', 'install' or 'update', got '${out.setup}'`);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(TMP_BASE, { recursive: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const scenarios = SCENARIOS.filter((s) => opts.scenarios.includes(s.id));
  if (!scenarios.length) throw new Error(`no scenario matched --scenario ${opts.scenarios.join(',')}`);

  // --diff (or --setup install without it) always reports the self-built vs real-install difference
  // FIRST - the whole point of the confirmation run is to know what the swap changes before trusting
  // its scenario results.
  if (opts.diff || opts.setup === 'install') {
    console.log('setup diff (self-built vs real installer, --source this worktree):');
    const agentUnion = [...new Set(scenarios.flatMap((s) => s.agents))];
    const diffLines = await diffSetups(agentUnion.length ? agentUnion : ['evidence-gatherer']);
    for (const l of diffLines) console.log(`  ${l}`);
    console.log('');
  }

  const tasks = [];
  for (const sc of scenarios) for (let run = 1; run <= opts.runs; run++) tasks.push({ sc, run });
  console.log(`memory-usage eval: ${scenarios.length} scenario(s) x ${opts.runs} run(s) = ${tasks.length} claude invocation(s), --parallel ${opts.parallel}, model=${opts.model}`);

  const records = await mapWithConcurrency(tasks, opts.parallel, (t) => runOne(t.sc, t.run, opts));
  records.sort((a, b) => a.scenario - b.scenario || a.run - b.run);

  console.log('');
  printTable(records);
  const verdicts = summarize(records, scenarios, opts.runs);
  console.log('');
  for (const v of verdicts) console.log(`scenario ${v.scenario} (${v.name}): ${v.passes}/${v.of} - ${v.verdict}`);
  const totalCost = records.reduce((s, r) => s + (r.costUsd || 0), 0);
  console.log(`\ntotal spend: $${totalCost.toFixed(4)}`);

  // Timestamped (date + time, not just date): a same-day rerun must never overwrite an earlier run's
  // evidence (final-review-A.md I9 - 0fd7a72's 1-run confirmation silently replaced 77105df's 15-run
  // release evidence at the same results-<date>.json path). Colons are invalid in Windows filenames,
  // so HHMMSS, not ISO time.
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const outFile = path.join(FIXTURES_DIR, `results-${date}-${time}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    ranAt: now.toISOString(), model: opts.model, runs: opts.runs, parallel: opts.parallel, setup: opts.setup,
    records, verdicts, totalCostUsd: totalCost,
  }, null, 2));
  console.log(`results written to ${path.relative(ROOT, outFile)}`);

  // The --setup update archive caches (preFeatureSrc()/releaseSrcSnapshot()) are shared across every
  // run in THIS process for speed, never removed per-run - clean them up once, here, so a script
  // invocation does not leave a pre-feature-src-<sha>/ and a fresh release-src-HEAD-<hex>/ behind on
  // every single run (the latter never reused between invocations, since each carries its own random
  // suffix - an unbounded leak otherwise).
  if (preFeatureSrcDir) { try { fs.rmSync(preFeatureSrcDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  if (releaseSrcDir) { try { fs.rmSync(releaseSrcDir, { recursive: true, force: true }); } catch { /* best effort */ } }

  process.exitCode = verdicts.some((v) => v.passes < v.passMark) ? 1 : 0;
}

module.exports = {
  SCENARIOS, buildProjectSelf, memoryRegistration, findProjectSlugDir,
  passMarkFor, summarize, PRE_FEATURE_COMMIT, extractGitArchive, buildProjectUpdate,
  readDbRowsForAssert, writeUpdateForensics, FORENSICS_DIR,
};

if (require.main === module) {
  main().catch((err) => { console.error(err && err.stack ? err.stack : err); process.exitCode = 1; });
}
