#!/usr/bin/env node
// check-turn-build.js - PostToolUse (Write|Edit|MultiEdit) + Stop. ONE scoped build check per turn,
// seeded OFF: nothing runs unless ALFRED_CODE_TURN_CHECK=1, and it turns on per project only after a
// measured week shows 'green' claims with no check behind them.
//   PostToolUse  appends the written path to <docs-path>/flow/turn-edits-<session>.
//   Stop         when that list holds source files, runs ONE check per nearest root - `tsc --noEmit -p
//                <tsconfig>` (the project's own node_modules/.bin/tsc) for TypeScript, `dotnet build
//                --no-restore -v q <csproj>` for C# - and hands the first 20 error lines back as a
//                Stop block. Once per turn: the continuation Stop after a block (stop_hook_active)
//                passes, and its fix-up edits wait in the list for the next turn's check.
// A missing compiler, a timeout or anything unreadable is a pass: this hook reports errors, it never
// guesses them. It carries its OWN declared timeout (60s, install/settings.js HOOK_TIMEOUTS) - the one
// documented exception to the 10s rule - and keeps its checks inside BUDGET_MS of it.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_LINES = 20;
const BUDGET_MS = 50000;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const TS_FILE = /\.(ts|tsx|mts|cts)$/i;
const CS_FILE = /\.cs$/i;
const WIN = process.platform === 'win32';

const inside = (file, root) => { const rel = path.relative(root, file); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };

// The nearest directory at or above `dir`, and not above `root`, that `has` a match.
function nearestUp(dir, root, has)
{
  for (let d = dir; ; d = path.dirname(d))
  {
    const hit = has(d);
    if (hit) return hit;
    if (d === root || path.dirname(d) === d || !inside(d, root)) return null;
  }
}
const tsconfigIn = (d) => { const f = path.join(d, 'tsconfig.json'); return fs.existsSync(f) ? f : null; };
const csprojIn = (d) => { try { const n = fs.readdirSync(d).filter((x) => /\.csproj$/i.test(x)).sort()[0]; return n ? path.join(d, n) : null; } catch { return null; } };
const tscIn = (d) => { const f = path.join(d, 'node_modules', '.bin', WIN ? 'tsc.cmd' : 'tsc'); return fs.existsSync(f) ? f : null; };

// The written source files, grouped by the root each one builds under: one entry per tsconfig or csproj.
function groupRoots(files, root)
{
  const roots = new Map();
  for (const file of files)
  {
    if (!inside(file, root)) continue;
    const dir = path.dirname(file);
    if (TS_FILE.test(file))
    {
      const config = nearestUp(dir, root, tsconfigIn);
      if (!config || roots.has(config)) continue;
      const cwd = path.dirname(config);
      roots.set(config, { kind: 'ts', config, cwd, bin: nearestUp(cwd, root, tscIn) });
    }
    else if (CS_FILE.test(file))
    {
      const config = nearestUp(dir, root, csprojIn);
      if (!config || roots.has(config)) continue;
      roots.set(config, { kind: 'cs', config, cwd: path.dirname(config), bin: 'dotnet' });
    }
  }
  return [...roots.values()];
}

// The command line for one root. On Windows the tsc shim is a .cmd, which Node spawns only through the
// shell - and cmd.exe splits an unquoted path at its first space (C:\Users\First Last\...), so the
// shim's path is quoted there. Every other launch is a plain argv, no shell.
function commandFor(r, win = WIN)
{
  const shell = win && r.kind === 'ts';
  const args = r.kind === 'ts' ? ['--noEmit', '-p', path.basename(r.config)] : ['build', '--no-restore', '-v', 'q', r.config];
  return { cmd: shell ? `"${r.bin}"` : r.bin, args, shell };
}

// Runs each root's check inside one shared budget; returns the first MAX_LINES distinct error lines and
// one outcome per root. `spawn` is spawnSync's shape, injected so the budget and timeouts are testable.
function runChecks(roots, { budgetMs = BUDGET_MS, spawn = spawnSync, now = Date.now } = {})
{
  const started = now();
  const errors = [];
  const outcomes = [];
  for (const r of roots)
  {
    const left = budgetMs - (now() - started);
    if (!r.bin || left <= 0) { outcomes.push({ root: r.config, outcome: r.bin ? 'no-budget' : 'missing' }); continue; }
    const { cmd, args, shell } = commandFor(r);
    const res = spawn(cmd, args, { cwd: r.cwd, encoding: 'utf8', timeout: left, shell, windowsHide: true }) || {};
    if (res.error && res.error.code === 'ENOENT') { outcomes.push({ root: r.config, outcome: 'missing' }); continue; }
    if (res.status === null) { outcomes.push({ root: r.config, outcome: 'timeout' }); continue; }
    const pattern = r.kind === 'ts' ? /error TS\d+/ : /: error [A-Z]+\d+/;
    const lines = `${res.stdout || ''}\n${res.stderr || ''}`.split(/\r?\n/).filter((l) => pattern.test(l));
    outcomes.push({ root: r.config, outcome: res.status === 0 ? 'clean' : 'errors', errors: lines.length });
    for (const l of lines) if (errors.length < MAX_LINES && !errors.includes(l.trim())) errors.push(l.trim());
  }
  return { errors, outcomes };
}

module.exports = { groupRoots, runChecks, commandFor, MAX_LINES, BUDGET_MS };

if (require.main === module)
{
  // STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in
  // every hook. Fail-open: envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour: 'an
  // install without the prelude runs the hook unchanged') when hook-prelude.js cannot be loaded - a
  // skewed copy (a newer hook beside an older/missing engine) must still orient, not crash.
  let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
  try
  {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('check-turn-build')) process.exit(0);
  }
  catch { /* an install without the prelude runs the hook unchanged */ }
  if (String(envOf(process.env, 'TURN_CHECK') || '').trim() !== '1') process.exit(0);

  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (!payload || typeof payload !== 'object') process.exit(0);
  const event = payload.hook_event_name;
  const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
  const docs = path.resolve(root, envOf(process.env, 'DOCS_PATH') || '.claude/docs');
  const sid = String(payload.session_id || 'nosession');
  const list = path.join(docs, 'flow', `turn-edits-${sid.replace(/[^A-Za-z0-9_-]/g, '_')}`);

  if (event === 'PostToolUse')
  {
    const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    if (!WRITE_TOOLS.has(payload.tool_name) || !input.file_path) process.exit(0);
    try
    {
      fs.mkdirSync(path.dirname(list), { recursive: true });
      fs.appendFileSync(list, `${path.resolve(String(payload.cwd || root), String(input.file_path))}\n`);
    }
    catch { /* a lost path only skips that file's check */ }
    process.exit(0);
  }
  if (event !== 'Stop') process.exit(0);
  // The continuation after a block - ours or another Stop hook's - is not a new turn: pass, and keep
  // what it wrote for the next turn's check.
  if (payload.stop_hook_active) process.exit(0);

  let files = [];
  try { files = [...new Set(fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => path.isAbsolute(l)))]; }
  catch { process.exit(0); }
  try { fs.rmSync(list, { force: true }); } catch { /* the next turn re-checks these files, no harm */ }
  const roots = groupRoots(files, root);
  if (!roots.length) process.exit(0);
  const { errors, outcomes } = runChecks(roots);
  if (!errors.length) process.exit(0);

  const ran = outcomes.filter((o) => o.outcome === 'errors').map((o) => o.root);
  const commands = roots.filter((r) => ran.includes(r.config)).map((r) => (r.kind === 'ts'
    ? `tsc --noEmit -p ${path.basename(r.config)} (in ${path.relative(root, r.cwd) || '.'})`
    : `dotnet build --no-restore -v q ${path.relative(root, r.config)}`));
  try
  {
    const dir = path.join(docs, 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${sid}.jsonl`), `${JSON.stringify({
      ts: new Date().toISOString(), hook: path.basename(__filename), event: 'Stop', mode: 'block',
      reason: `the turn's build check failed: ${errors.length} error line(s) shown`, detail: { roots: outcomes },
    })}\n`);
  }
  catch { /* a log row never throws */ }
  process.stderr.write(
    `This turn changed source files and the build check for them fails - ${commands.join('; ')}.\n` +
    `The first ${errors.length} error line(s):\n${errors.join('\n')}\n` +
    'Fix them, or say plainly why they stand, before ending the turn. The check runs once per turn;\n' +
    'ALFRED_CODE_TURN_CHECK=0 in the settings.json env switches it off.\n',
  );
  process.exit(2);
}
