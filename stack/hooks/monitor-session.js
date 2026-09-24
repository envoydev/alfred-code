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
// otherwise. State: <docs-path>/flow/monitor-<session>.json, rewritten per call, reset on garbage.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPEAT_AT = 5;
const SCOPE_OVER = 20;
const CONTEXT_SHARE = 0.8;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const fresh = () => ({ turn: 0, writes: 0, calls: {}, files: {}, context: 0 });

// One call through the monitor. Pure over its inputs - the file, the clock and the transcript stay
// outside - so the budget test times exactly this.
function step(state, payload, { contextNow = () => 0, trigger = () => null, floor = () => 0 } = {})
{
  const s = state && typeof state === 'object' && state.calls && typeof state.calls === 'object' && state.files && typeof state.files === 'object'
    ? state : fresh();
  const notes = [];
  if (payload.hook_event_name === 'UserPromptSubmit')
    return { state: { ...fresh(), turn: (Number(s.turn) || 0) + 1, context: s.context || 0 }, notes };

  const tool = String(payload.tool_name || '');
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const actor = String(payload.agent_id || 'main');
  const hash = crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12);
  const key = `${actor}|${tool}|${hash}`;
  const seen = s.calls[key] || (s.calls[key] = { n: 0, w: s.writes || 0 });
  seen.n += 1;
  // Exactly at the threshold, so the sixth call of a turn is never a second note.
  if (seen.n === REPEAT_AT)
    notes.push({
      kind: 'repeat', tool,
      reason: `you repeated ${tool} ${REPEAT_AT} times with identical input - stop and change approach`,
      detail: { actor, count: REPEAT_AT, writesBetween: (s.writes || 0) - seen.w },
    });

  const target = input.file_path || input.notebook_path;
  if (WRITE_TOOLS.has(tool) && target)
  {
    s.writes = (s.writes || 0) + 1;
    const mine = s.files[actor] || (s.files[actor] = { count: 0, seen: {} });
    const abs = path.resolve(String(payload.cwd || '.'), String(target));
    if (!mine.seen[abs])
    {
      mine.seen[abs] = 1;
      mine.count += 1;
      if (mine.count === SCOPE_OVER + 1)
        notes.push({
          kind: 'scope', tool,
          reason: `this turn has written ${mine.count} distinct files - check the change is still the one that was asked for, and say so`,
          detail: { actor, files: mine.count },
        });
    }
  }

  // The context note is the main session's own: a subagent's calls say nothing about its size.
  if (actor === 'main' && !s.context)
  {
    const ctx = contextNow();
    const low = floor();
    if (low && ctx >= low * CONTEXT_SHARE)
    {
      const at = trigger();
      if (at && ctx >= at * CONTEXT_SHARE)
      {
        s.context = ctx;
        notes.push({
          kind: 'context', tool,
          reason: `context is at ${ctx} tokens, ${Math.round((ctx / at) * 100)}% of this session's fresh-session trigger (${at}) - finish the current step before starting a new one`,
          detail: { context: ctx, trigger: at },
        });
      }
    }
  }
  return { state: s, notes };
}

module.exports = { step, REPEAT_AT, SCOPE_OVER, CONTEXT_SHARE };

if (require.main === module)
{
  // STACK HOOK GATES - both live in hook-prelude.js, never inlined in every hook: the
  // ALFRED_CODE_HOOKS_OFF csv, and the migration window where the plugin copy stands down while a
  // project still wires its copied twin. Fail-open - no prelude leaves this hook running.
  try
  {
    const { standDown } = require('./hook-prelude.js');
    if (standDown('monitor-session')) process.exit(0);
  }
  catch { /* an install without the prelude runs the hook unchanged */ }
  const mode = String(process.env.ALFRED_CODE_MONITOR || 'log').trim().toLowerCase();
  if (mode === '0' || mode === 'off') process.exit(0);

  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
  if (!payload || typeof payload !== 'object') process.exit(0);
  const event = payload.hook_event_name;
  if (event !== 'PostToolUse' && event !== 'UserPromptSubmit') process.exit(0);

  // ALFRED_CODE_DOCS_PATH is the name; CLAUDE_DOCS_PATH the pre-0.2.43 spelling, still read.
  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const docs = path.resolve(root, process.env.ALFRED_CODE_DOCS_PATH || process.env.CLAUDE_DOCS_PATH || '.claude/docs');
  const sid = String(payload.session_id || 'nosession');
  const stateFile = path.join(docs, 'flow', `monitor-${sid.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  let state = null;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* absent or garbage - a fresh count */ }

  // The trigger is the fresh-session engine's, from this hook's own directory. Without it the context
  // note stays off; the other two need nothing from it.
  let engine = null;
  try { engine = require(path.join(__dirname, 'fresh-session.js')); engine.use(payload); } catch { engine = null; }
  const { state: next, notes } = step(state, payload, {
    contextNow: () => (engine && engine.contextNow ? engine.contextNow() : 0),
    floor: () => (engine && engine.lowestTrigger ? engine.lowestTrigger() : 0),
    trigger: () => (engine && !engine.FRESH_OFF ? engine.ctxThreshold() : null),
  });
  try
  {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(next));
  }
  catch { /* state is best-effort - a lost write only restarts the count */ }
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
