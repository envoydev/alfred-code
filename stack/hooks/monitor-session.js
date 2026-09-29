#!/usr/bin/env node
// monitor-session.js - PostToolUse (every tool) + UserPromptSubmit. A live monitor that NEVER denies:
// three facts read from the call stream, each noted once, each a `mode: monitor` row in the
// hook-blocks ledger so `analyze-usage.js --hook-blocks` tallies them.
//   repeat  - one actor ran the same tool with the same input 5 times inside one turn;
//   scope   - one actor wrote more than 20 distinct files inside one turn;
//   context - the session's context reached 80% of the fresh-session trigger `fresh-session.js`
//             computes (one table - no second window guess), once per session.
// A turn is the span between two UserPromptSubmit events; a subagent is counted under its own
// agent_id. ALFRED_CODE_MONITOR: `log` (the seed, and the value when absent) writes the rows and
// injects nothing - the week that says whether a threshold is right; `inject` also hands the note
// back as PostToolUse additionalContext; `0` is off. Thresholds stay constants until those rows say
// otherwise. State: <docs-path>/flow/monitor-<session>.jsonl, the turn's LOG - each call APPENDS its own
// row and counts the rows up to it, and a UserPromptSubmit empties it (2.1.5 M15: parallel tool calls fire
// their hooks in parallel, and a read-modify-write of one state file lost updates, so a note fired never or
// twice). A garbage line is skipped. The once-per-session context note is a `wx` marker beside it.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPEAT_AT = 5;
const SCOPE_OVER = 20;
const CONTEXT_SHARE = 0.8;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// One call's row in the turn log: a unique id, its actor, the repeat key and, for a write, the file.
function rowFor(payload, id)
{
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const actor = String(payload.agent_id || 'main');
  const hash = crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12);
  const target = input.file_path || input.notebook_path;
  const file = WRITE_TOOLS.has(tool) && target ? path.resolve(String(payload.cwd || '.'), String(target)) : '';
  return { id, a: actor, t: tool, k: `${actor}|${tool}|${hash}`, f: file };
}

// The log's text as rows; a line that is not a row is skipped.
function parseLog(text)
{
  const rows = [];
  for (const line of String(text || '').split('\n'))
  {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && typeof r === 'object' && r.id && r.k) rows.push(r); } catch { /* a torn or garbage line */ }
  }
  return rows;
}

// The notes ONE call earns, judged on the turn's rows up to and including its own (`id`). Pure over its
// inputs - the file, the clock and the transcript stay outside - so the budget test times exactly this. Calls
// that ran in parallel each judge the order the log recorded, so every threshold is crossed by exactly one.
// `contextNoted` says the session's context note is already out; the caller claims it atomically.
function notesFor(rows, id, { contextNow = () => 0, trigger = () => null, floor = () => 0, contextNoted = () => false } = {})
{
  const at = rows.findIndex((r) => r.id === id);
  if (at < 0) return [];
  const mine = rows[at];
  const tool = mine.t;
  const notes = [];
  // Exactly at the threshold, so the sixth call of a turn is never a second note.
  let first = -1;
  let same = 0;
  for (let i = 0; i <= at; i++) if (rows[i].k === mine.k) { same += 1; if (first < 0) first = i; }
  if (same === REPEAT_AT)
  {
    let writesBetween = 0;
    for (let i = first; i < at; i++) if (rows[i].f) writesBetween += 1;
    notes.push({
      kind: 'repeat', tool,
      reason: `you repeated ${tool} ${REPEAT_AT} times with identical input - stop and change approach`,
      detail: { actor: mine.a, count: REPEAT_AT, writesBetween },
    });
  }

  if (mine.f)
  {
    const earlier = new Set();
    for (let i = 0; i < at; i++) if (rows[i].a === mine.a && rows[i].f) earlier.add(rows[i].f);
    const count = earlier.size + 1;
    if (!earlier.has(mine.f) && count === SCOPE_OVER + 1)
      notes.push({
        kind: 'scope', tool,
        reason: `this turn has written ${count} distinct files - check the change is still the one that was asked for, and say so`,
        detail: { actor: mine.a, files: count },
      });
  }

  // The context note is the main session's own: a subagent's calls say nothing about its size.
  if (mine.a === 'main' && !contextNoted())
  {
    const ctx = contextNow();
    const low = floor();
    if (low && ctx >= low * CONTEXT_SHARE)
    {
      const limit = trigger();
      if (limit && ctx >= limit * CONTEXT_SHARE)
        notes.push({
          kind: 'context', tool,
          reason: `context is at ${ctx} tokens, ${Math.round((ctx / limit) * 100)}% of this session's fresh-session trigger (${limit}) - finish the current step before starting a new one`,
          detail: { context: ctx, trigger: limit },
        });
    }
  }
  return notes;
}

module.exports = { rowFor, parseLog, notesFor, REPEAT_AT, SCOPE_OVER, CONTEXT_SHARE };

if (require.main === module)
{
  // STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in
  // every hook. Fail-open - no prelude leaves this hook running, and envOf falls back to the bare
  // ALFRED_CODE_ read (pre-2.0.0 behaviour) the same way.
  let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
  try
  {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('monitor-session')) process.exit(0);
  }
  catch { /* an install without the prelude runs the hook unchanged */ }
  const mode = String(envOf(process.env, 'MONITOR') || 'log').trim().toLowerCase();
  if (mode === '0' || mode === 'off') process.exit(0);

  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (!payload || typeof payload !== 'object') process.exit(0);
  // GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
  let cursorOff = false;
  try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) process.exit(0);
  const event = payload.hook_event_name;
  if (event !== 'PostToolUse' && event !== 'UserPromptSubmit') process.exit(0);

  // ALFRED_CODE_DOCS_PATH is the name; envOf also answers CLAUDE_STACK_DOCS_PATH (pre-2.0.0) and // legacy-name
  // CLAUDE_DOCS_PATH (pre-0.2.43).
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const docs = path.resolve(root, envOf(process.env, 'DOCS_PATH') || '.alfred/docs');
  const sid = String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_');
  const base = path.join(docs, 'flow', `monitor-${sid.replace(/[^A-Za-z0-9_-]/g, '_')}`);
  const logFile = `${base}.jsonl`;
  const contextMarker = `${base}.context`;
  // A new turn empties the log; the context marker is the session's and stays.
  if (event === 'UserPromptSubmit')
  {
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.writeFileSync(logFile, ''); } catch { /* best-effort */ }
    process.exit(0);
  }
  // One append per call: a short line is written whole under O_APPEND, so parallel calls never lose a row; it
  // opens on a newline, so a torn last line left by a killed call never swallows it.
  const id = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  let rows = [];
  try
  {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `\n${JSON.stringify(rowFor(payload, id))}\n`);
    rows = parseLog(fs.readFileSync(logFile, 'utf8'));
  }
  catch { process.exit(0); /* state is best-effort - a lost row only loses a note */ }

  // The trigger is the fresh-session engine's, from this hook's own directory. Without it the context
  // note stays off; the other two need nothing from it.
  let engine = null;
  try { engine = require(path.join(__dirname, 'fresh-session.js')); engine.use(payload); } catch { engine = null; }
  let notes = notesFor(rows, id, {
    contextNow: () => (engine && engine.contextNow ? engine.contextNow() : 0),
    floor: () => (engine && engine.lowestTrigger ? engine.lowestTrigger() : 0),
    trigger: () => (engine && !engine.FRESH_OFF ? engine.ctxThreshold() : null),
    contextNoted: () => fs.existsSync(contextMarker),
  });
  // Once per session: the note is claimed by creating the marker - exclusively, so a parallel call that
  // judged the same context drops its copy.
  notes = notes.filter((n) =>
  {
    if (n.kind !== 'context') return true;
    try { fs.closeSync(fs.openSync(contextMarker, 'wx')); return true; } catch { return false; }
  });
  if (!notes.length) process.exit(0);

  const inject = mode === 'inject';
  try
  {
    const dir = path.join(docs, 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${sid}.jsonl`), notes.map((n) => JSON.stringify({
      ts: new Date().toISOString(),
      hook: path.basename(__filename),
      event,
      tool: n.tool,
      mode: 'monitor',
      kind: n.kind,
      injected: inject,
      reason: n.reason,
      detail: n.detail,
    })).join('\n') + '\n');
  }
  catch { /* a log row never throws */ }
  if (inject)
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.map((n) => `Session monitor: ${n.reason}.`).join('\n') },
    }));
  process.exit(0);
}
