#!/usr/bin/env node
// PreToolUse (AskUserQuestion): a guided-walk ask must follow the PASTED table it asks about.
// setup / configure / validate render each layer's catalog with `stack-select.js --table <layer>`
// and the command body mandates pasting that output before the selection ask. As prose it failed:
// a real setup run asked the agents question naming rows '3-5, 11-19, 32-34' with no table on
// screen, and the user had to answer 'I do not see any table'. The tool result is collapsed in the
// UI, so only the assistant's own text reaches the user.
// Lives in the PLUGIN, not stack/hooks: a fresh setup has no stack hooks until its install step.
// Decision tables: `stack-select.js --table <layer>` (proof: its `total: N <layer>` footer), the
// four validate-only audit flags `--redundant`/`--missing`/`--evidence-gaps`/`--judgment` (proof: the
// rendered table's own state words - REDUNDANT/MISSING/DISABLED or JUDGMENT-DROP/JUDGMENT-ADD - since
// those calls redirect to a file and print no footer of their own), and two reports proven by the
// result's closing line - the `plugin-settings.js` report without `--apply`, and validate's install
// audit (`audit-install.js`) without `--json`. Fires only when
// the LATEST such call has no proof in the assistant text after it. It keeps denying: the measured skills turn announced 'pasted
// below' three times running with no table, and once in the ask's preview panel, which the user
// never saw. A valve lets the ask through after MAX_DENIALS for the same table since the last ANSWERED
// ask (a re-run table does not reset it), so a paste the transcript never shows cannot loop the walk.
// The transcript is written asynchronously: at PreToolUse time the ask's OWN message (the pasted text
// rows sharing message.id with the AskUserQuestion tool_use) may not be on disk yet. The hook waits for
// the row carrying the payload's tool_use_id, and allows when it never lands - it cannot judge a
// message it cannot see. ALFRED_CODE_LAYER_GATE_WAIT_MS overrides the 2000ms budget (tests). With no
// table call since the typed prompt it never waits: there is nothing to judge (M15). A layer's own
// selection ask ('Agents: ...', 'Add to the installed skills?') inside a walk also needs that layer's
// table to have RUN since the typed prompt - same valve, counted per layer (2.1.7).
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unreadable.
//
// STACK HOOK GATES (2.1.5 M4) - the core's hook-prelude.js, reached from the plugin root (the core entry ships
// the whole repo). The csv opt-out, `hook_profile: minimal`, the 1.x alias and a Cursor payload all stand it down
// like any non-protective hook; GATE 4 is skipped (`setUp: false`), since it serves the setup walk before any
// install record exists - and such a repo is written nothing (R54), so the block row waits for an installed one.
const fs = require('fs');
const path = require('path');

const MARKER = 'alfred-code layer-table gate';
const MAX_DENIALS = 3;
const PRELUDE = path.join(__dirname, '..', '..', 'stack', 'hooks', 'hook-prelude.js');

let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
let unsetRepo = true;
if (require.main === module) {
  let off = false;
  try {
    const prelude = require(PRELUDE);
    envOf = prelude.envOf;
    off = prelude.standDown('guard-layer-table', process.env, process.argv, { setUp: false });
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the gate unchanged, writing no row */ }
  if (off) process.exit(0);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!payload || typeof payload !== 'object') process.exit(0);
// GATE 6: a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
let cursorOff = false;
try { cursorOff = require(PRELUDE).cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
if (cursorOff) process.exit(0);
if (payload.tool_name !== 'AskUserQuestion' || !payload.transcript_path) process.exit(0);

// One block row in the hook-blocks ledger, so this gate's block RATE is measured like every other guard's.
// Best-effort; a repo never set up gets none.
function blockRow(reason, table) {
  if (unsetRepo) return;
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const dir = path.resolve(root, envOf(process.env, 'DOCS_PATH') || '.alfred/docs', 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: path.basename(__filename), event: payload.hook_event_name || 'PreToolUse',
      tool: payload.tool_name || '', reason: reason.slice(0, 200), detail: { branch: table },
    }) + '\n');
  } catch { /* telemetry is never allowed to break the gate */ }
}

const readRows = () => {
  const size = fs.statSync(payload.transcript_path).size;
  const start = Math.max(0, size - 512 * 1024);
  const fd = fs.openSync(payload.transcript_path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8').split('\n');
  } finally {
    fs.closeSync(fd);
  }
};

const ownId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : '';
const hasOwnRow = (rs) => rs.some((line) => line.includes(ownId) && (() => {
  try {
    const c = JSON.parse(line).message.content;
    return Array.isArray(c) && c.some((b) => b && b.type === 'tool_use' && b.id === ownId);
  } catch { return false; }
})());
const waitMs = (() => {
  const v = Number(process.env.ALFRED_CODE_LAYER_GATE_WAIT_MS);
  return process.env.ALFRED_CODE_LAYER_GATE_WAIT_MS !== undefined && Number.isFinite(v) && v >= 0 ? v : 2000;
})();

// A trailing-backslash continuation keeps the command on one logical line.
const TABLE_RE = /stack-select\.js\b(?:[^\n]|\\\r?\n)*?--table\s+["']?([a-z]+)/;
// validate's own audit battery (no --table footer to prove against - the calls redirect to a file);
// proof is the state word its rendered table is required to print verbatim.
const AUDIT_RE = /stack-select\.js\b(?:[^\n]|\\\r?\n)*?--(redundant|missing|evidence-gaps|judgment)\b/;
const AUDIT_PROOF = /\b(REDUNDANT|MISSING|DISABLED|JUDGMENT-DROP|JUDGMENT-ADD)\b/;
// Reports proven by their LAST line in the assistant text. `skip` is the flag that makes the same
// script print no table; `empty` is the all-clear line, which setup and validate pass over silently.
const LAST_LINE_REPORTS = [
  { re: /plugin-settings\.js\b/, skip: /--apply\b/, empty: /nothing to offer/, name: 'plugin-settings report' },
  { re: /audit-install\.js\b/, skip: /--json\b/, empty: /nothing to report/, name: 'install audit' },
];
// M15: the own-row wait only buys a view of the ask's own message, which matters only when a table call
// since the typed prompt could need proving - with none, there is nothing to judge and the ask passes now.
const tableCall = (cmd) => TABLE_RE.test(cmd) || AUDIT_RE.test(cmd) || LAST_LINE_REPORTS.some((r) => r.re.test(cmd) && !r.skip.test(cmd));
const tailHasTable = (rs) => {
  for (let i = rs.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(rs[i]); } catch { continue; }
    const content = o && o.message && o.message.content;
    if (o && o.type === 'user' && typeof content === 'string') return false;
    if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_use' && tableCall(String((b.input && b.input.command) || '')))) return true;
  }
  return false;
};

// A layer's selection ask, by the walk's own templates (walk.md): 'Agents: install the marked rows?',
// 'Add to the installed skills?'. The gate above judges a table that RAN; a walk that never ran the
// layer's table at all asked with nothing on screen (the user's report of 2026-10-06: 'No tables with
// hooks, skills, agents, rules are shown'), so such an ask needs that layer's `--table` call since the
// typed prompt - judged only inside a walk (a `stack-select.js` call in the same span).
const LAYERS = 'rules|agents|skills|hooks|mcps|plugins';
const LAYER_ASK = new RegExp(`^\\s*(?:(${LAYERS})\\s*:|(?:add to|drop from) the installed (${LAYERS})\\b)`, 'i');
const layersAsked = (input) => {
  const qs = input && Array.isArray(input.questions) ? input.questions : [];
  const out = new Set();
  for (const q of qs) {
    const m = LAYER_ASK.exec(String((q && q.question) || ''));
    if (m) out.add((m[1] || m[2]).toLowerCase());
  }
  return [...out];
};
const unrunLayer = (rs, asked) => {
  const ran = new Set();
  const results = {};
  let walk = false;
  let answered = false;
  const denials = {};
  for (let i = rs.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(rs[i]); } catch { continue; }
    const content = o && o.message && o.message.content;
    if (o && o.type === 'user' && typeof content === 'string') break;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (o.type === 'user' && b.type === 'tool_result') {
        const r = resultText(b.content);
        results[b.tool_use_id] = r;
        const d = !answered && new RegExp(`${MARKER}: the (${LAYERS}) table never ran`).exec(r);
        if (d) denials[d[1]] = (denials[d[1]] || 0) + 1;
      }
      if (o.type !== 'assistant' || b.type !== 'tool_use') continue;
      if (b.name === 'AskUserQuestion' && b.id !== ownId && b.id in results && !results[b.id].includes(MARKER)) answered = true;
      const cmd = String((b.input && b.input.command) || '');
      if (/stack-select\.js\b/.test(cmd)) walk = true;
      const m = TABLE_RE.exec(cmd);
      if (m) ran.add(m[1].toLowerCase());
    }
  }
  if (!walk) return null;
  return asked.find((l) => !ran.has(l) && (denials[l] || 0) < MAX_DENIALS) || null;
};

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('\n') : '');

let rows;
try {
  rows = readRows();
  const asked = layersAsked(payload.tool_input);
  const missing = asked.length ? unrunLayer(rows, asked) : null;
  if (missing) {
    const denial =
      `${MARKER}: the ${missing} table never ran - this ask is the ${missing} layer's selection, and the user decides ` +
      `from the layer's WHOLE catalog. Run \`node "$TMP/repo/scripts/stack-select.js" --selection raw.json --table ${missing}\` ` +
      `with the walk's other flags (walk.md, per layer beat 2), never redirected, then send ONE message: the step banner, ` +
      `its output byte-for-byte inside a fenced code block, then this same ask.\n`;
    blockRow(denial.split('\n')[0], `${missing} table`);
    process.stderr.write(denial);
    process.exit(2);
  }
  if (!tailHasTable(rows)) process.exit(0);
  if (ownId && !hasOwnRow(rows)) {
    const until = Date.now() + waitMs;
    while (Date.now() < until && !hasOwnRow(rows)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      rows = readRows();
    }
    if (!hasOwnRow(rows)) process.exit(0);
  }
} catch {
  process.exit(0);
}

// Walk backwards: collect assistant text, tool results and our own earlier denials until the latest
// decision-table call.
// The walk goes on PAST the latest table call, only to count our own denials of that table back to the
// last answered ask (or typed prompt), so re-running the table cannot reset the valve.
let texts = '';
let table = null;   // { name, proof: RegExp | null, id }
const results = {};
const denialTexts = [];
let stop = false;
for (let i = rows.length - 1; i >= 0 && !stop; i--) {
  let o;
  try { o = JSON.parse(rows[i]); } catch { continue; }
  const content = o && o.message && o.message.content;
  if (o && o.type === 'user' && typeof content === 'string') break;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (!b) continue;
    if (o.type === 'assistant' && b.type === 'text' && !table) texts += `\n${b.text || ''}`;
    if (o.type === 'user' && b.type === 'tool_result') {
      const r = resultText(b.content);
      if (r.includes(MARKER)) denialTexts.push(r);
      results[b.tool_use_id] = r;
    }
    if (o.type === 'assistant' && b.type === 'tool_use' && b.name === 'AskUserQuestion' && b.id !== ownId
        && b.id in results && !results[b.id].includes(MARKER)) {
      stop = true;   // an answered ask: a new decision point
      break;
    }
    if (o.type === 'assistant' && b.type === 'tool_use' && !table) {
      const cmd = String((b.input && b.input.command) || '');
      const m = TABLE_RE.exec(cmd);
      const am = !m && AUDIT_RE.exec(cmd);
      const report = !m && !am && LAST_LINE_REPORTS.find((r) => r.re.test(cmd) && !r.skip.test(cmd));
      if (m) table = { name: `${m[1]} table`, proof: new RegExp(`total:\\s*\\d+\\s+${m[1]}\\b`) };
      else if (am) table = { name: `${am[1]} audit`, proof: AUDIT_PROOF };
      else if (report) {
        const last = (results[b.id] || '').split('\n').map((l) => l.trim()).filter(Boolean).pop();
        // no result read back (a truncated tail) - nothing to prove against, so nothing to deny; and an
        // all-clear run printed no table, which the walk skips silently (measured on plugin-settings:
        // every later ask was denied three times over a table that never existed)
        const noTable = !last || report.empty.test(results[b.id] || '');
        table = { name: report.name, proof: noTable ? null : { test: (t) => t.includes(last) } };
      }
    }
  }
}

const denials = table ? denialTexts.filter((t) => t.includes(`the ${table.name} ran`)).length : 0;
if (!table || !table.proof || denials >= MAX_DENIALS) process.exit(0);
if (table.proof.test(texts)) process.exit(0);

const denial =
  `${MARKER}: the ${table.name} ran but its output is not in your message - the tool result is ` +
  `collapsed, so the user sees no table. Table before question: do not re-run the table - its output is already ` +
  `in your context from the call above. Send ONE message: the step banner, that output byte-for-byte inside a fenced ` +
  `code block, then this same ask. Writing 'pasted below' or 'shown above' ` +
  `is not a paste, and the ask's preview panel does not count. Never summarize the rows into prose.\n`;
blockRow(denial.split('\n')[0], table.name);
process.stderr.write(denial);
process.exit(2);
