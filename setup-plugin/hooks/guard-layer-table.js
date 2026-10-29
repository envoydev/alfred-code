#!/usr/bin/env node
// PostToolUse (AskUserQuestion): a guided-walk ask must follow the PASTED table it asks about.
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
// the LATEST such call has no proof in the assistant text after it. The measured skills turn announced 'pasted below'
// three times running with no table, and once in the ask's preview panel, which the user never saw.
// F4 (the 2026-10-28 workspace run, docs/workspace-layering-evidence.md 'Fix run'): the ask's OWN message - the pasted
// text rows sharing message.id with the AskUserQuestion tool_use - reaches the transcript only after the PreToolUse hooks
// finish, so a paste check there could never see the paste. It runs at PostToolUse, where the message is on disk, and a
// failed check VOIDS the answer: `decision: block` plus `updatedToolOutput`, the tool_response with each answer replaced
// by the void line. The stored result then carries the marker, which is how every reader below tells a denied ask from
// an answered one. A void Claude Code did not apply leaves its `hook_blocking_error` row carrying the marker, so the
// readers take that row as the void too (`recorded`), and the next gate run writes one `void-not-applied` probe row. A
// valve lets the ask through after MAX_DENIALS voids for the same table since the last ANSWERED ask (a re-run table does
// not reset it), so a paste the transcript never shows cannot loop the walk. F27 (the fix run, live): Sonnet answered
// six voids with the table in thinking only, so a paste void prints the table itself in the block reason the user sees,
// and a re-ask of that table after such a void passes unpasted - one void per layer. Inside a typed init / configure / validate
// run that has printed a step banner, a gap in the banner numbers voids the answer too, with its own valve of three.
// `guard-layer-table:void` in ALFRED_CODE_HOOKS_OFF switches the void off. A tool_response with no answers object is no
// shape this was measured on: no void.
// PreToolUse (AskUserQuestion) keeps the checks that need no paste: a layer's own selection ask ('Agents: ...', 'Add to
// the installed skills?') inside a walk needs that layer's table to have RUN since the typed prompt - its own valve,
// counted per layer (2.1.7) - and configure step 1's closing ask ('Adjust the installed selection?') needs its
// `update-preflight.js --inventory` table (audit 2026-10-11; proof once pasted: its `total: <n> installed` line).
// exit 2 = block (stderr fed back); exit 0 = allow. Fail-open on anything unreadable.
//
// PreToolUse (Bash), 2026-10-21: a walk that never ASKS gives the gate above nothing to judge. A real init run printed the
// hooks table, narrated 'Next I'll decide which to keep' and moved on; its plugins layer rendered a table of its own
// through `node -e` and went straight to the prerequisite check. Inside a typed init / configure walk the walk's next
// step - a `stack-select.js`, `plugin-settings.js` or installer call - is denied while the latest layer table has no
// answered ask after it, and in init (which walks all five layers) while an earlier layer's table never ran. Each has its
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
const PRINTED = 'the gate printed the table for the user';
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

const EVENT = payload.hook_event_name || 'PreToolUse';
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
let unsetRepo = true;
let prelude = null;
if (require.main === module) {
  let off = false;
  try {
    prelude = require(PRELUDE);
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
const blocksFile = () => path.join(path.resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd(), dataRoot(), 'statistics', 'hook-blocks'),
  `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`);
const appendRow = (row) => {
  const file = blocksFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: path.basename(__filename), event: EVENT, tool: payload.tool_name || '', ...row }) + '\n');
};
function blockRow(reason, table) {
  if (unsetRepo) return;
  try { appendRow({ reason: reason.slice(0, 200), detail: { branch: table } }); } catch { /* telemetry is never allowed to break the gate */ }
}
// One probe row per kind and id: a later gate run reads the same transcript again and writes none.
function probeRow(kind, id) {
  if (unsetRepo) return;
  try {
    let have = '';
    try { have = fs.readFileSync(blocksFile(), 'utf8'); } catch { /* none yet */ }
    const seen = have.split('\n').some((l) => { try { const o = JSON.parse(l); return o.kind === kind && o.detail && o.detail.id === id; } catch { return false; } });
    if (!seen) appendRow({ mode: 'probe', kind, detail: { id } });
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
// F24 (2026-10-28): update's workspace plan prints its project table with a `total: <n> projects` line - a decision table
// only when that line is in its result (a standalone plan prints none).
const WS_PLAN_RE = /workspace\.js\b(?:[^\n]|\\\r?\n)*?\bplan\b/;
const WS_PLAN_PROOF = /total:\s*\d+\s+projects?\b/;
const WS_PLAN_HEADER = /^project\s*\|/;
const LAST_LINE_REPORTS = [
  { re: /plugin-settings\.js\b/, skip: /--apply\b/, empty: /nothing to offer/, name: 'plugin-settings report' },
  { re: /audit-install\.js\b/, skip: /--json\b/, empty: /nothing to report/, name: 'install audit' },
  // configure step 1's inventory table, proven by its `total: <n> installed` line (audit 2026-10-11, session a9e06780).
  { re: INVENTORY_RE, skip: NEVER, empty: NEVER, name: 'install inventory' },
];
// With no table call since the typed prompt there is nothing to prove (M15).
const tableCall = (cmd) => TABLE_RE.test(cmd) || AUDIT_RE.test(cmd) || WS_PLAN_RE.test(cmd) || LAST_LINE_REPORTS.some((r) => r.re.test(cmd) && !r.skip.test(cmd));
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
const LAYERS = 'rules|agents|skills|hooks|plugins';
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

// The void's own record: each `hook_blocking_error` row carrying the marker, by its toolUseID. The 2026-10-28 probe
// recorded the field names, not their nesting, so the id is read at the row's top level or under `attachment`.
const blockingRecords = (rs) => {
  const out = new Map();
  for (const line of rs) {
    if (!line.includes('hook_blocking_error') || !line.includes(MARKER)) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const a = (o && o.attachment) || {};
    const id = o.toolUseID ?? a.toolUseID;
    if (typeof id !== 'string' || !id) continue;
    const v = a.blockingError ?? o.blockingError;
    out.set(id, typeof v === 'string' && v.includes(MARKER) ? v : line);
  }
  return out;
};
// A stored result as the readers take it: a void Claude Code did not apply is still a void.
const recorded = (records, id, text) => (text.includes(MARKER) || !records.has(id) ? text : `${text}\n${records.get(id)}`);
// The model saw the blind answer beside the reason (the block-only behaviour): one probe row per such ask.
const probeUnapplied = (rs) => {
  const records = blockingRecords(rs);
  if (!records.size) return;
  for (const line of rs) {
    if (!line.includes('tool_result')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const content = o && o.type === 'user' && o.message && o.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b && b.type === 'tool_result' && records.has(b.tool_use_id) && !resultText(b.content).includes(MARKER)) probeRow('void-not-applied', b.tool_use_id);
    }
  }
};

// One pass back to the typed prompt: the prompt itself, the assistant text, the commands run, and how many of OUR
// denials of `kind` came after the last answered ask - so each check below keeps its own valve of MAX_DENIALS.
const span = (rs, kind) => {
  const out = { prompt: '', texts: [], commands: [], denials: 0 };
  const records = blockingRecords(rs);
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
        const r = recorded(records, b.tool_use_id, resultText(b.content));
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
// answered ask after it, and init's walk (all five layers, in order) needs every earlier layer's table to have run before
// a later table, the prerequisite check (`--emit`) or the installer. Configure walks only the areas its user picked, so
// it gets the first check alone. Both are judged only since a typed init / configure prompt.
const ORDER = ['rules', 'agents', 'skills', 'hooks', 'plugins'];
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
  const records = blockingRecords(rs);
  const results = {};
  const failed = {};
  const uses = [];
  for (const o of rows) {
    if (o.typed) { uses.push(o); continue; }
    for (const b of o.content) {
      if (!b) continue;
      if (o.type === 'user' && b.type === 'tool_result') {
        results[b.tool_use_id] = recorded(records, b.tool_use_id, resultText(b.content));
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
    const Layer = last.layer[0].toUpperCase() + last.layer.slice(1);
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
    deny(`${MARKER}: layers never walked - init walks all five layers in order (rules, agents, skills, hooks, ` +
      `plugins), and the ${missing.join(', ')} table${missing.length > 1 ? 's' : ''} never ran. Walk each missing layer ` +
      `first (walk.md, its three beats): \`node "$TMP/repo/scripts/stack-select.js" --selection "$TMP/raw.json" --table ` +
      `${missing[0]} ...\` with the walk's other flags, never redirected and never a table of your own (a \`node -e\` ` +
      `script or a hand-written list is no table), its output pasted in a fenced code block, then the layer's ask.\n`, 'layers never walked');
  }
}

// The answers replaced by the void line - null for a shape this was not measured on (no answers object, or an empty one).
const voidedResponse = (resp, line) => {
  const answers = resp && resp.answers;
  if (Object.prototype.toString.call(answers) !== '[object Object]' || !Object.keys(answers).length) return null;
  const out = { ...resp, answers: Object.fromEntries(Object.keys(answers).map((k) => [k, line])) };
  if ('annotations' in resp) out.annotations = {};
  return out;
};

// What a void prints (F27): a table closed by its total line (`to`) ends there, and the plan starts at its header - the
// update call cats update-workspace.md after the plan, and its preflight lines come before it. A report or an audit,
// whose proof is no closing line, prints whole.
function tableAlone(text, { to, from }) {
  const lines = text.split('\n');
  let end = lines.length;
  if (to) for (let i = lines.length - 1; i >= 0; i--) if (to.test(lines[i])) { end = i + 1; break; }
  const start = from ? Math.max(0, lines.slice(0, end).findIndex((l) => from.test(l))) : 0;
  return lines.slice(start, end).join('\n').trimEnd();
}

// The paste check: walk backwards, collecting assistant text, tool results and our own earlier voids until the latest
// decision-table call. The walk goes on PAST the latest table call, only to count our own voids of that table back to
// the last answered ask (or typed prompt), so re-running the table cannot reset the valve. Returns the void line or null.
function unpasted(rows) {
  const records = blockingRecords(rows);
  let texts = '';
  let table = null;   // { name, proof: RegExp | null }
  const results = {};
  const errored = new Set();   // a call a hook denied or that failed printed no table, so it is never the latest one
  const denialTexts = [];
  let stop = false;
  let output = '';    // the table's own output, printed for the user by a void
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
        const r = recorded(records, b.tool_use_id, resultText(b.content));
        if (r.includes(MARKER)) denialTexts.push(r);
        if (b.is_error) errored.add(b.tool_use_id);
        results[b.tool_use_id] = r;
      }
      if (o.type === 'assistant' && b.type === 'tool_use' && b.name === 'AskUserQuestion' && b.id !== ownId
          && b.id in results && !results[b.id].includes(MARKER)) {
        stop = true;   // an answered ask: a new decision point
        break;
      }
      if (o.type === 'assistant' && b.type === 'tool_use' && !table && !errored.has(b.id)) {
        const cmd = String((b.input && b.input.command) || '');
        const m = TABLE_RE.exec(cmd);
        const am = !m && AUDIT_RE.exec(cmd);
        const report = !m && !am && LAST_LINE_REPORTS.find((r) => r.re.test(cmd) && !r.skip.test(cmd));
        const plan = !m && !am && !report && WS_PLAN_RE.test(cmd) && WS_PLAN_PROOF.test(results[b.id] || '');
        if (plan) table = { name: 'workspace plan table', proof: WS_PLAN_PROOF, to: WS_PLAN_PROOF, from: WS_PLAN_HEADER };
        else if (m) {
          const total = new RegExp(`total:\\s*\\d+\\s+${m[1]}\\b`);
          table = { name: `${m[1]} table`, proof: total, to: total };
        }
        else if (am) table = { name: `${am[1]} audit`, proof: AUDIT_PROOF };
        else if (report) {
          const last = (results[b.id] || '').split('\n').map((l) => l.trim()).filter(Boolean).pop();
          // no result read back (a truncated tail) - nothing to prove against, so nothing to void; and an
          // all-clear run printed no table, which the walk skips silently (measured on plugin-settings:
          // every later ask was denied three times over a table that never existed)
          const noTable = !last || report.empty.test(results[b.id] || '');
          table = { name: report.name, proof: noTable ? null : { test: (t) => t.includes(last) } };
        }
        if (table) output = tableAlone(results[b.id] || '', table);
      }
    }
  }
  const ours = table ? denialTexts.filter((t) => t.includes(`the ${table.name} ran`)) : [];
  // A void that printed this table put it on screen, so the re-ask is answered with it in view (F27).
  if (!table || !table.proof || ours.length >= MAX_DENIALS || ours.some((t) => t.includes(PRINTED)) || table.proof.test(texts)) return null;
  // F27: no text block at all since the table - the measured fact, so the model cannot read it as a paste it made. Six
  // re-asks after such a void held thinking only, whatever the line said, so the gate prints the table itself, in the
  // block reason the user sees in full; the line then asks for the same ask again and nothing else.
  const silent = !texts.trim();
  if (output) return {
    branch: `void ${table.name}`,
    shown: output,
    // Claude Code shows the reason under 'hook returned blocking error', so it opens with a plain line for the user.
    lead: `Alfred: the model's message left out the ${table.name}, so it is printed below - your answer was not used, and the same question comes back next.`,
    line: `${MARKER}: the ${table.name} ran but its output is not in your message - ` +
      (silent ? 'your message held no text at all, only thinking, which is never on screen - the user answered without it'
        : 'the user answered without it on screen') +
      ` - this answer is void; ${PRINTED}; send this same ask again, unchanged - do not re-run or paste the table.`,
  };
  if (silent) return {
    branch: `void ${table.name}`,
    line: `${MARKER}: the ${table.name} ran but its output is not in your message - your message held no text at all, only ` +
      `thinking, and thinking is never on screen - the user answered without it - this answer is void; reply with text ` +
      `first: the step banner, the output byte-for-byte in a fenced block, then this same ask. Do not re-run the table - ` +
      `its output is already in your context.`,
  };
  return {
    branch: `void ${table.name}`,
    line: `${MARKER}: the ${table.name} ran but its output is not in your message - the user answered without it on screen - ` +
      `this answer is void; send ONE message: the step banner, the output byte-for-byte in a fenced block, then this same ` +
      `ask, the first two as reply text before the ask - your thinking is never on screen. Do not re-run the table - its ` +
      `output is already in your context; 'pasted below' or the ask's preview panel is no paste.`,
  };
}

// PostToolUse: the ask's own message is on disk now. A missing paste or banner voids the answer.
function voidAsk() {
  const rows = readRows();
  probeUnapplied(rows);
  let off = false;
  try { off = (prelude || require(PRELUDE)).partOff('guard-layer-table', 'void', process.env); } catch { /* no prelude: the void runs */ }
  if (off || !voidedResponse(payload.tool_response, MARKER)) return;
  const guided = guidedRun(rows);
  if (!tailHasTable(rows) && !guided) return;
  const gap = guided ? bannerGap(rows) : null;
  const found = gap ? {
    branch: 'void step banner',
    line: `${MARKER}: step banner missing - step ${gap.missing.join(', ')} of ${gap.total} printed none - the user answered ` +
      `without it - this answer is void; send ONE message: the missing banners in order, each with its one line ` +
      `(\`[step 7/12 - plugins] skipped - area not selected\`), then this step's content and this same ask.`,
  } : tailHasTable(rows) ? unpasted(rows) : null;
  if (!found) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: found.shown ? `${found.lead}\n${found.shown}\n${found.line}` : found.line,
    hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: voidedResponse(payload.tool_response, found.line) } }));
  blockRow(found.line, found.branch);
}

if (payload.tool_name === 'Bash') {
  try {
    const rs = readRows(WALK_TAIL);
    probeUnapplied(rs);
    judgeStep(rs, bashCommand);
  } catch { /* fail-open */ }
  process.exit(0);
}
if (EVENT === 'PostToolUse') {
  try { voidAsk(); } catch { /* fail-open */ }
  process.exit(0);
}
try {
  const rows = readRows();
  probeUnapplied(rows);
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
} catch { /* fail-open */ }
process.exit(0);
