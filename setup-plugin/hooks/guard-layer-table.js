#!/usr/bin/env node
// PreToolUse (AskUserQuestion): a guided-walk ask must follow the PASTED table it asks about.
// init's install phase / configure / validate render each layer's catalog with `stack-select.js --table <layer>`
// and the command body mandates pasting that output before the selection ask. As prose it failed:
// a real setup run asked the agents question naming rows '3-5, 11-19, 32-34' with no table on
// screen, and the user had to answer 'I do not see any table'. The tool result is collapsed in the
// UI, so only the assistant's own text reaches the user.
// Lives in the PLUGIN, not stack/hooks: a fresh install has no stack hooks until its install step.
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
// table to have RUN since the typed prompt - same valve, counted per layer (2.1.7). Audit 2026-10-11: configure step 1's
// `update-preflight.js --inventory` table is a decision table too (proof: its `total: <n> installed` line), and step 1's
// closing ask ('Adjust the installed selection?') needs it to have run; inside a typed init / configure / validate run
// that has printed a step banner, a gap in the banner numbers denies the next ask. Each has its own valve of three.
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unreadable.
//
// PreToolUse (Bash), 2026-10-21: a walk that never ASKS gives the gate above nothing to judge. A real init run printed the
// hooks table, narrated 'Next I'll decide which to keep' and moved on; its plugins layer rendered a table of its own
// through `node -e` and went straight to the prerequisite check. Inside a typed init / configure walk the walk's next
// step - a `stack-select.js`, `plugin-settings.js` or installer call - is denied while the latest layer table has no
// answered ask after it, and in init (which walks all six layers) while an earlier layer's table never ran. Each has its
// own valve of three. Any other Bash command leaves before the prelude loads.
// Step 6.5 (the same day): the walk outlives a typed reply. It is found back to the newest TYPED init / configure command
// (a 2MB tail on this path): a typed reply counts as the user's answer where it stands, a harness prompt (a task notice, a
// seat's hand-back, a command's output) is neither, another typed slash command ends the walk, a compaction summary
// starts it again only when it names the walk - and past one init's order check stands down, since the layers walked
// before it are out of the span (hooks track H1) - and an ask the idle timeout closed, or one whose result is an error
// (another hook's denial, a validation error, the user's rejection), is no answer (H2). The layer ask check above
// reads the same span, and only inside such a walk (commands track T2-03: validate's '<Layer>: ...' consent asks were
// denied for a `--table` call validate never makes).
//
// STACK HOOK GATES (2.1.5 M4) - the core's hook-prelude.js, reached from the plugin root (the core entry ships
// the whole repo). The csv opt-out, `hook_profile: minimal` and a Cursor payload all stand it down
// like any non-protective hook; GATE 4 is skipped (`setUp: false`), since it serves the install walk before any
// install record exists - and such a repo is written nothing (R54), so the block row waits for an installed one.
const fs = require('fs');
const path = require('path');

const MARKER = 'alfred-code layer-table gate';
const MAX_DENIALS = 3;
const PRELUDE = path.join(__dirname, '..', '..', 'stack', 'hooks', 'hook-prelude.js');

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!payload || typeof payload !== 'object') process.exit(0);
const WALK_STEP = /(?:stack-select|plugin-settings|install[\\/]alfred-code)\.js\b/;
const bashCommand = payload.tool_name === 'Bash' ? String((payload.tool_input && payload.tool_input.command) || '') : '';
if (payload.tool_name === 'Bash' && !WALK_STEP.test(bashCommand)) process.exit(0);

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

// GATE 6: a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
let cursorOff = false;
try { cursorOff = require(PRELUDE).cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
if (cursorOff) process.exit(0);
if (!['AskUserQuestion', 'Bash'].includes(payload.tool_name) || !payload.transcript_path) process.exit(0);

// One block row in the hook-blocks ledger, so this gate's block RATE is measured like every other guard's - in the data
// root's statistics/ (2.8.0, stack/hooks/layout.js; this plugin's hooks ship apart from it, so the reader is inline).
// Best-effort; a repo never set up gets none.
// data-root-reader (meta/shared-rules.json): ALFRED_CODE_DATA_PATH, relative to the project, else .alfred.
const dataRoot = (env = process.env) => String(envOf(env, 'DATA_PATH') || '.alfred').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.alfred';
function blockRow(reason, table) {
  if (unsetRepo) return;
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const dir = path.resolve(root, dataRoot(), 'statistics', 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), hook: path.basename(__filename), event: payload.hook_event_name || 'PreToolUse',
      tool: payload.tool_name || '', reason: reason.slice(0, 200), detail: { branch: table },
    }) + '\n');
  } catch { /* telemetry is never allowed to break the gate */ }
}

const WALK_TAIL = 2 * 1024 * 1024;
const readRows = (tail = 512 * 1024) => {
  const size = fs.statSync(payload.transcript_path).size;
  const start = Math.max(0, size - tail);
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
// script print no table; `empty` is the all-clear line, which init's install phase and validate pass over silently.
const NEVER = /(?!)/;
const INVENTORY_RE = /update-preflight\.js\b(?:[^\n]|\\\r?\n)*?--inventory\b/;
const LAST_LINE_REPORTS = [
  { re: /plugin-settings\.js\b/, skip: /--apply\b/, empty: /nothing to offer/, name: 'plugin-settings report' },
  { re: /audit-install\.js\b/, skip: /--json\b/, empty: /nothing to report/, name: 'install audit' },
  // configure step 1's inventory table, proven by its `total: <n> installed` line (audit 2026-10-11, session a9e06780).
  { re: INVENTORY_RE, skip: NEVER, empty: NEVER, name: 'install inventory' },
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
// The MCP layer is asked as 'MCPs' or 'MCP servers' (commands track T2-15: the second passed with no table).
const ASKED_LAYERS = 'rules|agents|skills|hooks|mcps|mcp\\s+servers?|plugins';
const LAYER_ASK = new RegExp(`^\\s*(?:(${ASKED_LAYERS})\\s*:|(?:add to|drop from) the installed (${ASKED_LAYERS})\\b)`, 'i');
const layersAsked = (input) => {
  const qs = input && Array.isArray(input.questions) ? input.questions : [];
  const out = new Set();
  for (const q of qs) {
    const m = LAYER_ASK.exec(String((q && q.question) || ''));
    if (m) out.add(/^mcp/i.test(m[1] || m[2]) ? 'mcps' : (m[1] || m[2]).toLowerCase());
  }
  return [...out];
};
const unrunLayer = (rs, asked) => {
  const w = walkSpan(rs);
  if (!w || !w.uses.some((b) => /stack-select\.js\b/.test(String((b.input && b.input.command) || '')))) return null;
  const ran = new Set();
  let denials = {};
  for (const b of w.uses) {
    if (b.typed || answeredAsk(w, b)) { denials = {}; continue; }
    const d = b.id in w.results && new RegExp(`${MARKER}: the (${LAYERS}) table never ran`).exec(w.results[b.id]);
    if (d) denials[d[1]] = (denials[d[1]] || 0) + 1;
    const m = TABLE_RE.exec(String((b.input && b.input.command) || ''));
    if (m) ran.add(m[1].toLowerCase());
  }
  return asked.find((l) => !ran.has(l) && (denials[l] || 0) < MAX_DENIALS) || null;
};

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('\n') : '');

// One pass back to the typed prompt: the prompt itself, the assistant text, the commands run, and how many of OUR
// denials of `kind` came after the last answered ask - so each check below keeps its own valve of MAX_DENIALS.
const span = (rs, kind) => {
  const out = { prompt: '', texts: [], commands: [], denials: 0 };
  const results = {};
  let answered = false;
  for (let i = rs.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(rs[i]); } catch { continue; }
    const content = o && o.message && o.message.content;
    if (o && o.type === 'user' && typeof content === 'string') { out.prompt = content; break; }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (o.type === 'user' && b.type === 'tool_result') {
        const r = resultText(b.content);
        results[b.tool_use_id] = r;
        if (!answered && r.includes(`${MARKER}: ${kind}`)) out.denials += 1;
      }
      if (o.type !== 'assistant') continue;
      if (b.type === 'text') out.texts.push(b.text || '');
      if (b.type !== 'tool_use') continue;
      if (b.name === 'AskUserQuestion' && b.id !== ownId && b.id in results && !results[b.id].includes(MARKER)) answered = true;
      out.commands.push(String((b.input && b.input.command) || ''));
    }
  }
  return out;
};

// configure step 1's closing ask (its two templates open with this question): the inventory table must have RUN since
// the typed prompt - audit 2026-10-11, session a9e06780 asked 'Installed set is shown above' over a collapsed result.
// Once it ran, the report gate below holds its `total:` line to the assistant text like any other table.
const STEP1_ASK = /^\s*Adjust the installed selection\?/i;
const asksStep1 = (input) => (input && Array.isArray(input.questions) ? input.questions : []).some((q) => STEP1_ASK.test(String((q && q.question) || '')));

// THE SKELETON (audit 2026-10-11): init (both phases), configure and validate print one `[step n/N - <name>]` banner per step, a
// skipped step's banner with one line saying why. Six of six guided runs in one consuming project skipped banners
// (session 5f9fec85 printed 6 of 13, 6288ad94 2 of 12), and nothing read the clause. Judged only inside such a run once
// it has printed a banner: every step number from the first banner seen since the typed prompt to the highest must have
// printed one. A run that prints none is not judged here (configure step 1's inventory gate catches its first ask).
// setup merged into init on 2026-10-17; init's bootstrap phase prints banners too.
const GUIDED = /\balfred-code:(init|configure|validate)\b/;
const BANNER = /\[step (\d+)\/(\d+) - /g;
const bannerGap = (rs) => {
  const s = span(rs, 'step banner');
  if (!GUIDED.test(s.prompt) || s.denials >= MAX_DENIALS) return null;
  const seen = new Set();
  let total = 0;
  for (const t of s.texts) for (const m of t.matchAll(BANNER)) { seen.add(Number(m[1])); total = Number(m[2]); }
  if (!seen.size) return null;
  const lo = Math.min(...seen);
  const hi = Math.max(...seen);
  const missing = [];
  for (let n = lo; n <= hi; n++) if (!seen.has(n)) missing.push(n);
  return missing.length ? { missing, total } : null;
};
const guidedRun = (rs) => {
  const s = span(rs, 'step banner');
  return GUIDED.test(s.prompt) && s.texts.some((t) => /\[step \d+\/\d+ - /.test(t));
};

// THE NEXT STEP (2026-10-21): a Bash walk step is judged against the walk so far - the latest layer table needs an
// answered ask after it, and init's walk (all six layers, in order) needs every earlier layer's table to have run before
// a later table, the prerequisite check (`--emit`) or the installer. Configure walks only the areas its user picked, so
// it gets the first check alone. Both are judged only since a typed init / configure prompt.
const ORDER = ['rules', 'agents', 'skills', 'hooks', 'mcps', 'plugins'];
const WALKS = /\balfred-code:(init|configure)\b/;
const EMIT_RE = /stack-select\.js\b(?:[^\n]|\\\r?\n)*?--emit\b/;
const INSTALL_RE = /install[\\/]alfred-code\.js["']?\s+install\b/;
// The walk's span (step 6.5): rows back to the newest typed init / configure command, its tool calls in order with each
// typed reply as a `{ typed: true }` entry where it stands, and the results by tool_use_id; null outside a walk.
const SLASH_RE = /^\s*(?:<command-(?:message|name)>|\/[A-Za-z][\w:-]*(?:\s|$))/;
const SHELL_ROW_RE = /^\s*<bash-(?:input|stdout|stderr)>/;
let harnessPrompt = () => false;   // no prelude: a harness prompt reads as a typed reply, an answer - the open side
try { harnessPrompt = require(PRELUDE).harnessPrompt; } catch { /* run without it */ }
let askTimedOut = () => false;
try { askTimedOut = require(PRELUDE).askTimedOut; } catch { /* run without it */ }
const rowText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.type === 'text' && x.text) || '').join('\n') : '');
function walkSpan(rs) {
  const rows = [];
  let walk = null;
  let compacted = false;
  for (let i = rs.length - 1; i >= 0 && !walk; i--) {
    let o;
    try { o = JSON.parse(rs[i]); } catch { continue; }
    const content = o && o.message && o.message.content;
    if (o && o.type === 'user' && o.isCompactSummary) {
      walk = WALKS.exec(rowText(content));
      if (!walk) return null;
      compacted = true;
      break;
    }
    if (o && o.type === 'user' && typeof content === 'string') {
      if (o.isMeta || harnessPrompt(content) || SHELL_ROW_RE.test(content)) continue;
      walk = WALKS.exec(content);
      if (walk) break;
      if (SLASH_RE.test(content)) return null;
      rows.unshift({ typed: true });
      continue;
    }
    if (Array.isArray(content)) rows.unshift({ type: o.type, content });
  }
  if (!walk) return null;
  const results = {};
  const failed = {};
  const uses = [];
  for (const o of rows) {
    if (o.typed) { uses.push(o); continue; }
    for (const b of o.content) {
      if (!b) continue;
      if (o.type === 'user' && b.type === 'tool_result') {
        results[b.tool_use_id] = resultText(b.content);
        if (b.is_error === true) failed[b.tool_use_id] = true;
      }
      if (o.type === 'assistant' && b.type === 'tool_use' && b.id !== ownId) uses.push(b);
    }
  }
  return { walk: walk[1], compacted, uses, results, failed };
}
// An ask the user answered: a result that is no error (every real answer arrives with is_error false), no denial of
// ours, and no idle timeout's close (ruling S3).
const answeredAsk = (w, b) => b.name === 'AskUserQuestion' && b.id !== ownId && b.id in w.results && !w.failed[b.id]
  && !w.results[b.id].includes(MARKER) && !askTimedOut(w.results[b.id]);
function judgeStep(rs, cmd) {
  const w = walkSpan(rs);
  if (!w) return;
  const { uses, results } = w;
  const ran = new Set();
  let last = null;
  let answeredAt = -1;
  uses.forEach((b, at) => {
    if (b.typed || answeredAsk(w, b)) answeredAt = at;
    const m = TABLE_RE.exec(String((b.input && b.input.command) || ''));
    if (m) { last = { layer: m[1].toLowerCase(), at }; ran.add(last.layer); }
  });
  const denials = (kind) => uses.slice(answeredAt + 1).filter((b) => b.id in results && results[b.id].includes(`${MARKER}: ${kind}`)).length;
  const deny = (text, branch) => {
    blockRow(text.split('\n')[0], branch);
    process.stderr.write(text);
    process.exit(2);
  };
  const next = TABLE_RE.exec(cmd);
  const nextLayer = next && next[1].toLowerCase();
  if (last && answeredAt < last.at && nextLayer !== last.layer && denials(`the ${last.layer} ask never happened`) < MAX_DENIALS) {
    const Layer = last.layer === 'mcps' ? 'MCPs' : last.layer[0].toUpperCase() + last.layer.slice(1);
    deny(`${MARKER}: the ${last.layer} ask never happened - the ${last.layer} table ran, but no answered question ` +
      `followed it, and the user decides every layer (auto mode included). Do not move on: send ONE message - the step ` +
      `banner, the table output byte-for-byte inside a fenced code block (it is already in your context; do not re-run ` +
      `it), then the layer's selection ask from walk.md ('${Layer}: ...' fresh, 'Add to / Drop from the installed ` +
      `${last.layer}?' in configure). Only after the answer, run this step.\n`, `${last.layer} ask`);
  }
  if (w.walk !== 'init' || w.compacted) return;
  const upTo = nextLayer ? ORDER.indexOf(nextLayer) : (EMIT_RE.test(cmd) || INSTALL_RE.test(cmd)) ? ORDER.length : -1;
  const missing = ORDER.slice(0, Math.max(upTo, 0)).filter((l) => !ran.has(l));
  if (missing.length && denials('layers never walked') < MAX_DENIALS) {
    deny(`${MARKER}: layers never walked - init walks all six layers in order (rules, agents, skills, hooks, MCPs, ` +
      `plugins), and the ${missing.join(', ')} table${missing.length > 1 ? 's' : ''} never ran. Walk each missing layer ` +
      `first (walk.md, its three beats): \`node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table ` +
      `${missing[0]} ...\` with the walk's other flags, never redirected and never a table of your own (a \`node -e\` ` +
      `script or a hand-written list is no table), its output pasted in a fenced code block, then the layer's ask.\n`, 'layers never walked');
  }
}

let rows;
if (payload.tool_name === 'Bash') {
  try { judgeStep(readRows(WALK_TAIL), bashCommand); } catch { /* fail-open */ }
  process.exit(0);
}
try {
  rows = readRows();
  const asked = layersAsked(payload.tool_input);
  // A layer ask is rare, so it alone pays for the walk's 2MB tail.
  const missing = asked.length ? unrunLayer(readRows(WALK_TAIL), asked) : null;
  if (missing) {
    const denial =
      `${MARKER}: the ${missing} table never ran - this ask is the ${missing} layer's selection, and the user decides ` +
      `from the layer's WHOLE catalog. Run \`node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table ${missing}\` ` +
      `with the walk's other flags (walk.md, per layer beat 2), never redirected, then send ONE message: the step banner, ` +
      `its output byte-for-byte inside a fenced code block, then this same ask.\n`;
    blockRow(denial.split('\n')[0], `${missing} table`);
    process.stderr.write(denial);
    process.exit(2);
  }
  if (asksStep1(payload.tool_input)) {
    const s = span(rows, 'the install inventory never ran');
    if (!s.commands.some((c) => INVENTORY_RE.test(c)) && s.denials < MAX_DENIALS) {
      const denial =
        `${MARKER}: the install inventory never ran - this is step 1's closing ask, and the user decides it from the ` +
        `inventory table. Run \`node "$TMP/repo/scripts/update-preflight.js" --inventory "$TMP/installed.json"\` (after the ` +
        `step-1 read-back), then send ONE message: the step banner, its output byte-for-byte inside a fenced code block, ` +
        `the update-preview line, then this same ask.\n`;
      blockRow(denial.split('\n')[0], 'install inventory');
      process.stderr.write(denial);
      process.exit(2);
    }
  }
  const guided = guidedRun(rows);
  if (!tailHasTable(rows) && !guided) process.exit(0);
  if (ownId && !hasOwnRow(rows)) {
    const until = Date.now() + waitMs;
    while (Date.now() < until && !hasOwnRow(rows)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      rows = readRows();
    }
    if (!hasOwnRow(rows)) process.exit(0);
  }
  const gap = guided ? bannerGap(rows) : null;
  if (gap) {
    const example = '`[step 7/13 - MCPs] skipped - area not selected`';
    const denial =
      `${MARKER}: step banner missing - step ${gap.missing.join(', ')} of ${gap.total} printed none. The skeleton is ` +
        `invariant: every step prints its banner, a skipped one with ONE line saying why (${example}). Send ONE message: ` +
        `the missing banners in order, each with its one line, then this step's content and this same ask.\n`;
    blockRow(denial.split('\n')[0], 'step banner');
    process.stderr.write(denial);
    process.exit(2);
  }
  if (!tailHasTable(rows)) process.exit(0);
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
