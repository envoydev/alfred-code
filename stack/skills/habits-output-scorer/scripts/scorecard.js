#!/usr/bin/env node
// scorecard.js - the habits-output-scorer's arithmetic and its loop, so no total, verdict or next move is left to the
// model. `grade` recomputes a sealed scorecard against its rubric's json block and never reads the seat's own sum: a yes
// with no quote is a no, an n/a counts only where the check allows one, a finding missing a field is discarded and named,
// a kept BLOCKER caps the total at 60 and a self grade at 99, and the ceiling says how far the draft can still climb.
// `start` allocates each grade's id and paths, `next` reads rounds.log and prints the one move to make, `decide` records
// the user's answer to the continue ask.
// Dependencies: none - Node.js built-ins (git only to find the project root outside Claude Code).
// Usage:
//   node scorecard.js start [--root <dir>] --session <id> --slug <slug> --output <name> [--target <path>]
//        [--regrade-of <id> | --retry-of <id>]
//   node scorecard.js grade <score file> (--output <name> | --rubric <file>) [--level <n>] [--self]
//   node scorecard.js next [--root <dir>] --session <id> --slug <slug> [--level <n>] [--rounds <n>] [--auto]
//   node scorecard.js decide [--root <dir>] --session <id> --slug <slug> --choice accept|revise|answer|keep
// The slug folder is <root>/<data root>/state/sessions/scorer/<session>/<slug>/. --session self allocates a self-<hex>
// session for the SELF route; an empty or literal ${CLAUDE_SESSION_ID} session reads CLAUDE_CODE_SESSION_ID. The level is
// --level when it is a whole number 60..100, the run cap --rounds when it is one in 1..10, else ALFRED_CODE_SCORER_LEVEL /
// _ROUNDS (the environment, then the project's .claude/settings.local.json, then .claude/settings.json), else 80 and 3.
// A score file opens with the seal the hand-back hook wrote (`seal: sha256 <hex>` over the rest of the file), or
// `self: <reason>` for a self grade.
// Exit 0 = pass (grade) or done, 1 = fail (grade), 2 = malformed or refused (a missing, doubled or unknown row, no
// Findings section, an unknown output or slug, a closed slug, nothing asked), 3 = a missing or broken seal, a self grade
// read without --self, or --self with no self: line, 4 = no session id.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const BLOCKER_CAP = 60;
const SELF_CAP = 99;
// A fail this close under the level is graded once more by a fresh seat before the round is decided on the mean - 5
// until the grader's spread is measured (spec S8).
const NOISE_BAND = 5;
// A revise has to gain this much over the round before it, or the loop asks instead.
const STALL = 5;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const ID_RE = '[0-9a-f]{8}';

// The docs each output's grader is handed (spec 5.13), as paths under the docs root: a folder ends with `/`, `target` is
// the --target file, `skill:<name>/<path>` sits beside this skill's folder. references/outputs.md is the same map for
// people, held equal by scripts/habits-scorer-card.test.js.
const PREFERENCE_DOCS = ['preferences/PERSONAL-CODE-PREFERENCES.md', 'preferences/ARCHITECTURE-PREFERENCES.md', 'preferences/PROJECT-CODE-PREFERENCES.md'];
const ASSESSMENTS = ['quality/CODE-ASSESSMENT.md', 'quality/ARCHITECTURE-ASSESSMENT.md'];
const DESIGN_DOCS = ['architecture/ARCHITECTURE.md', 'architecture/references/', ...PREFERENCE_DOCS, 'decisions/', ...ASSESSMENTS];
// Each output: its rubric in ../references/ (R1, R10), its runs per attempt ('rounds' = the run cap, inline-plan one),
// whether it is graded without a typed stack, its producers (spec section 6) and its docs.
const OUTPUTS = {
  'designer-plan': {
    rubric: 'rubric-designer-plan.md', runs: 'rounds', automatic: true,
    skills: ['task-design', 'habits-plan-writing', 'task-solve', 'task-solve-cross', 'task-build-from-scratch', 'loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage'],
    seats: ['<stack>-solution-designer'], docs: DESIGN_DOCS,
  },
  'root-cause': {
    rubric: 'rubric-root-cause.md', runs: 'rounds', automatic: true,
    skills: ['issue-diagnoser'], seats: ['issue-diagnoser-ci', 'issue-diagnoser-runtime'], docs: [...DESIGN_DOCS, 'awareness/PROJECT-AWARENESS.md', 'work/diagnoses/'],
  },
  'inline-plan': { rubric: 'rubric-inline-plan.md', runs: 1, automatic: true, skills: ['habits-execution-strategy'], seats: [], docs: ['target'] },
  'topic-explainer': { rubric: 'rubric-topic-explainer.md', runs: 'rounds', automatic: false, skills: ['habits-explain-topic'], seats: [], docs: PREFERENCE_DOCS },
  ticket: { rubric: 'rubric-ticket.md', runs: 'rounds', automatic: false, skills: ['habits-create-ticket'], seats: [], docs: [] },
  'upgrade-plan': {
    rubric: 'rubric-upgrade-plan.md', runs: 'rounds', automatic: false, skills: ['task-version-upgrade'], seats: [],
    docs: ['skill:task-version-upgrade/references/upgrade-playbooks.md'],
  },
  pick: { rubric: 'rubric-pick.md', runs: 'rounds', automatic: false, skills: ['task-build-from-scratch'], seats: [], docs: [] },
  custom: {
    rubric: 'rubric-custom.md', runs: 'rounds', automatic: false, skills: [], seats: [],
    docs: [...PREFERENCE_DOCS, ...ASSESSMENTS, 'awareness/RELATED-PROJECTS-AWARENESS.md'],
  },
};

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset (env-reader in meta/shared-rules.json pins the copies).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}
// data-root-reader (meta/shared-rules.json): ALFRED_CODE_DATA_PATH, relative to the project, else .alfred.
const dataRoot = (env = process.env) => String(envOf(env, 'DATA_PATH') || '.alfred').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.alfred';

class Stop extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new Stop(code, message); };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self' || a === '--auto') { out[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = i + 1 < argv.length ? argv[++i] : ''; continue; }
    out._.push(a);
  }
  return out;
}

// A whole number in min..max, else `otherwise` - the runtime parse of the level and the run cap (the hooks' own copy
// sits in hook-prelude.js; this script ships in a skill folder and loads no hook file).
function wholeIn(value, min, max, otherwise) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(s)) return otherwise;
  const n = Number(s);
  return n >= min && n <= max ? n : otherwise;
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// The project root: --root when it is an absolute folder that exists and no literal ${CLAUDE_PROJECT_DIR}, else
// CLAUDE_PROJECT_DIR, else the git top of the cwd, else the cwd.
function projectRoot(flag, env = process.env, cwd = process.cwd()) {
  if (flag && path.isAbsolute(flag) && !flag.includes('${') && isDir(flag)) return flag;
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd; } catch { return cwd; }
}
// The stack's setting in the hooks' order: the environment, then the project's settings.local.json, then settings.json.
function setting(suffix, env = process.env, root = projectRoot(undefined, env)) {
  let value = envOf(env, suffix);
  for (const f of ['settings.local.json', 'settings.json']) {
    if (value) break;
    try { value = envOf(JSON.parse(fs.readFileSync(path.join(root, '.claude', f), 'utf8')).env || {}, suffix); } catch { /* absent or unreadable */ }
  }
  return value;
}
const levelOf = (value, env = process.env, root) => wholeIn(value, 60, 100, null) ?? wholeIn(setting('SCORER_LEVEL', env, root), 60, 100, 80);
const roundsOf = (value, env = process.env, root) => wholeIn(value, 1, 10, null) ?? wholeIn(setting('SCORER_ROUNDS', env, root), 1, 10, 3);

// The rubric's first fenced json block: { output, checks: { <id>: { points, na } } }, the points summing to 100 (within
// a double's rounding, so twelve checks of 8.34 and 8.33 pass).
function parseRubric(text) {
  const m = /```json[^\n]*\n([\s\S]*?)\n```/.exec(String(text));
  if (!m) throw new Error('no fenced json block');
  const data = JSON.parse(m[1]);
  if (!data || typeof data.checks !== 'object' || data.checks === null || !Object.keys(data.checks).length) throw new Error('no checks');
  const checks = {};
  let sum = 0;
  for (const [id, c] of Object.entries(data.checks)) {
    if (!c || typeof c.points !== 'number' || !(c.points > 0)) throw new Error(`check ${id} has no points`);
    checks[id] = { points: c.points, na: typeof c.na === 'string' && c.na.trim() ? c.na : null };
    sum += c.points;
  }
  if (Math.abs(sum - 100) >= 1e-9) throw new Error(`the points sum to ${sum}, not 100`);
  return { output: data.output, checks };
}

const sealOf = (body) => crypto.createHash('sha256').update(String(body), 'utf8').digest('hex');

// Line 1 is the seal or the self line; the body is everything after line 1's newline, the bytes the seal covers.
function readScoreFile(text) {
  const s = String(text);
  const nl = s.indexOf('\n');
  const first = (nl < 0 ? s : s.slice(0, nl)).replace(/\r$/, '');
  const seal = /^seal: sha256 ([0-9a-f]{64})$/.exec(first);
  const self = /^self: (.*\S.*)$/.exec(first);
  return { seal: seal ? seal[1] : null, self: self ? self[1].trim() : null, body: nl < 0 ? '' : s.slice(nl + 1) };
}

// The lines of the `## <name>` section, up to the next heading of level one or two; null when there is none.
function section(body, name) {
  const lines = body.split(/\r?\n/);
  const head = new RegExp(`^##\\s+${name}\\b`, 'i');
  const start = lines.findIndex((l) => head.test(l.trim()));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

// The `## Checks` rows: the id (cell 1), the result (cell 2) and the evidence - the rest re-joined with `|`, the
// trailing pipe dropped - so a quote holding a pipe stays one cell.
function readRows(lines) {
  const rows = [];
  for (const raw of lines || []) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1).replace(/\|$/, '').split('|');
    if (cells.length < 2 || cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue;
    const id = cells[0].replace(/[*`]/g, '').trim();
    if (/^id$/i.test(id)) continue;
    rows.push({ id, result: cells[1].replace(/[*`]/g, '').trim().toLowerCase(), evidence: cells.slice(2).join('|').trim() });
  }
  return rows;
}

const FIELDS = ['Failure', 'Trigger', 'Cost', 'Evidence', 'Fix'];
// An item opens on its tag after a bullet, a number or a heading mark, bold or not - `- **[BLOCKER]** B1`, `1. [BLOCKER]`,
// `### [BLOCKER] B1` (final review 1: each of those once read as no finding, and the draft passed at 100).
const ITEM_RE = /^\s*(?:[-*+]|\d+[.)]|#{1,6})\s+(?:\*\*|__)?\[(BLOCKER|MATERIAL|MINOR)\](?:\*\*|__)?\s*(.*)$/i;
// A line that reads as a BLOCKER or MATERIAL finding no item took: the word leading the line, or its tag outside an item.
const LEAD_RE = /^\s*(?:[-*+]|\d+[.)]|#{1,6})?\s*(?:\*\*|__)?\s*(?:BLOCKER|MATERIAL)\b/;
const TAG_RE = /\[(?:BLOCKER|MATERIAL)\]/i;
// A label in any case, bold or not, followed by `:` - `Failure mode` read as Failure (R33).
const LABEL_RE = /(?<![A-Za-z])\*{0,2}(failure(?:\s+mode)?|trigger|cost|evidence|fix)\*{0,2}\s*:/gi;
const NEEDS_RE = /\[needs:\s*([^\]]*?)\s*\]/gi;
const fieldOf = (label) => (/^failure/i.test(label) ? 'Failure' : label[0].toUpperCase() + label.slice(1).toLowerCase());

// The `## Findings` items: one runs from its `- [<SEVERITY>]` line to the next item or heading, so sub-bullets count.
// `stray` holds the lines that read as a BLOCKER or MATERIAL no item took, so the grade can refuse them (exit 2).
function readFindings(lines) {
  const items = [];
  const stray = [];
  let current = null;
  for (const line of lines) {
    const m = ITEM_RE.exec(line);
    if (m) { current = { severity: m[1].toUpperCase(), head: m[2], text: m[2] }; items.push(current); continue; }
    if (LEAD_RE.test(line) || (!current && TAG_RE.test(line))) stray.push(line.trim());
    if (/^#{1,6}\s/.test(line)) { current = null; continue; }
    if (current) current.text += `\n${line}`;
  }
  return { stray, items: items.map((item, i) => {
    const labels = [...item.text.matchAll(LABEL_RE)];
    const have = new Set(labels.map((l) => fieldOf(l[1])));
    const idm = /^\**([A-Za-z]{1,3}\d+)\**[.:)]?\s*/.exec(item.head);
    const rest = idm ? item.head.slice(idm[0].length) : item.head;
    const cut = rest.search(LABEL_RE);
    const fix = labels.filter((l) => fieldOf(l[1]) === 'Fix').pop();
    return {
      id: idm ? idm[1] : `${item.severity[0]}${i + 1}`,
      severity: item.severity,
      title: (cut < 0 ? rest : rest.slice(0, cut)).replace(/\*\*/g, '').replace(/[\s.:;,-]+$/, '').trim(),
      missing: FIELDS.filter((f) => !have.has(f)),
      needs: fix ? [...item.text.slice(fix.index).matchAll(NEEDS_RE)].map((n) => n[1]).filter(Boolean) : [],
    };
  }) };
}

function grade({ scoreText, rubric, level = 80, self = false }) {
  const bad = (exit, why) => ({ exit, why, total: null, verdict: null, blockers: 0, open: [], flipped: [], ceiling: null, needs: [], discarded: [] });
  const file = readScoreFile(scoreText);
  if (self) {
    if (file.self === null) return bad(3, '--self needs a score file whose first line is `self: <reason>`');
  } else if (file.self !== null) return bad(3, 'a self grade - grade it with --self');
  else if (file.seal === null) return bad(3, 'no seal line - the grade did not come through the seat\'s hand-back');
  else if (sealOf(file.body) !== file.seal) return bad(3, 'the seal does not match the body - the score file was edited after the seat returned it');

  const ids = Object.keys(rubric.checks);
  const rows = new Map();
  for (const r of readRows(section(file.body, 'Checks'))) {
    if (!Object.hasOwn(rubric.checks, r.id)) return bad(2, `unknown check id ${r.id}`);
    if (rows.has(r.id)) return bad(2, `two rows for ${r.id}`);
    rows.set(r.id, r);
  }
  const absent = ids.filter((id) => !rows.has(id));
  if (absent.length) return bad(2, `no row for ${absent.join(', ')}`);
  const findingLines = section(file.body, 'Findings');
  if (findingLines === null) return bad(2, 'no ## Findings section');

  let met = 0;
  let closable = 0;
  const flipped = [];
  const rowNeeds = [];
  for (const id of ids) {
    const { result, evidence } = rows.get(id);
    const check = rubric.checks[id];
    let ok = false;
    if (result === 'yes') { if (/[\p{L}\p{N}]/u.test(evidence)) ok = true; else flipped.push(id); }
    else if (result === 'n/a' || result === 'na') { if (check.na) ok = true; else flipped.push(id); }
    if (ok) { met += check.points; continue; }
    if (/\[closable\]/i.test(evidence)) closable += check.points;
    for (const n of evidence.matchAll(NEEDS_RE)) if (n[1]) rowNeeds.push(n[1]);
  }

  const { items: findings, stray } = readFindings(findingLines);
  if (stray.length) return bad(2, `a severity no finding item carries - write it as \`- [<SEVERITY>] <id> <title>. Failure: ...\`: ${stray[0].slice(0, 80)}`);
  const kept = findings.filter((f) => !f.missing.length);
  const blockers = kept.filter((f) => f.severity === 'BLOCKER');
  let total = Math.round(met);
  let ceiling = Math.round(met + closable);
  if (blockers.length) total = Math.min(total, BLOCKER_CAP);
  if (blockers.some((f) => f.needs.length)) ceiling = Math.min(ceiling, BLOCKER_CAP);
  if (self) { total = Math.min(total, SELF_CAP); ceiling = Math.min(ceiling, SELF_CAP); }
  const verdict = total >= level && !blockers.length ? 'pass' : 'fail';
  return {
    exit: verdict === 'pass' ? 0 : 1,
    total,
    verdict,
    blockers: blockers.length,
    blocked: blockers.map((f) => f.title),
    open: kept.filter((f) => f.severity === 'MATERIAL').map((f) => f.title),
    flipped,
    ceiling,
    needs: [...new Set([...rowNeeds, ...kept.flatMap((f) => f.needs)])],
    discarded: findings.filter((f) => f.missing.length).map(({ id, severity, missing }) => ({ id, severity, missing })),
  };
}

const listed = (items, sep) => (items.length ? items.join(sep) : 'none');
const gradeLines = (r) => [
  `total: ${r.total}`,
  `verdict: ${r.verdict}`,
  `blockers: ${r.blockers}`,
  `open: ${listed(r.open, '; ')}`,
  `flipped: ${listed(r.flipped, ', ')}`,
  `ceiling: ${r.ceiling}`,
  `needs: ${listed(r.needs, '; ')}`,
  `discarded: ${listed(r.discarded.map((d) => `${d.id} ${d.severity} (no ${d.missing.join(', ')})`), '; ')}`,
];

// The rubric of --rubric, else of the --output row beside this script.
function rubricFrom(args) {
  let file = args.rubric;
  if (!file) {
    if (!Object.hasOwn(OUTPUTS, args.output || '')) fail(2, `unknown output '${args.output || ''}' - one of ${Object.keys(OUTPUTS).join(', ')}`);
    file = path.join(__dirname, '..', 'references', OUTPUTS[args.output].rubric);
  }
  try { return parseRubric(fs.readFileSync(file, 'utf8')); } catch (e) { return fail(2, `rubric ${file}: ${e.message}`); }
}

function runGrade(args) {
  const file = args._[1];
  if (!file) fail(2, 'grade needs a score file');
  const rubric = rubricFrom(args);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { fail(2, `cannot read ${file}`); }
  const r = grade({ scoreText: text, rubric, level: levelOf(args.level, process.env, projectRoot(args.root)), self: !!args.self });
  if (r.exit >= 2) fail(r.exit, r.why);
  process.stdout.write(`${gradeLines(r).join('\n')}\n`);
  return r.exit;
}

// A session id as a folder name - hook-prelude.js's safeSession, copied (R31): a separator, a space or any other
// character outside [\w.-] becomes `_`, and a whole `.` or `..` is `_`, so no id names a path outside scorer/.
function safeSession(id) {
  const s = String(id === undefined || id === null ? '' : id).replace(/[^\w.-]/g, '_');
  return /^\.*$/.test(s) ? '_' : s;
}
// --session, else CLAUDE_CODE_SESSION_ID when the flag is empty or a literal the harness left unsubstituted (R29).
function sessionOf(flag, env = process.env) {
  const s = String(flag || '').trim();
  if (s && !s.includes('${')) return s;
  return env.CLAUDE_CODE_SESSION_ID || null;
}
const hex = () => crypto.randomBytes(4).toString('hex');
const slash = (p) => p.split(path.sep).join('/');

// The slug folder, the project root it sits under and its files; only `start` turns --session self into a new self-<hex>.
function slugContext(args, env = process.env, allocate = false) {
  const slug = args.slug || '';
  if (!SLUG_RE.test(slug)) fail(2, `slug '${slug}' is not [a-z0-9-]{1,40}`);
  const session = sessionOf(args.session, env);
  if (!session) fail(4, 'no session id - rerun with --session self and grade with --self');
  const root = projectRoot(args.root, env);
  const dataRel = dataRoot({ ALFRED_CODE_DATA_PATH: setting('DATA_PATH', env, root) });
  const self = allocate && session === 'self';
  const sessionId = self ? `self-${hex()}` : session;
  const folder = path.resolve(root, dataRel, 'state', 'sessions', 'scorer', safeSession(sessionId), slug);
  return { root, slug, session: sessionId, self, folder, logFile: path.join(folder, 'rounds.log'), dataRel };
}

// rounds.log: the header lines, one grade line per grade (`<attempt> <round> <id>[ regrade-of|retry-of <id>]`), and the
// loop's marks - `released`, `asked`, `bought`, `final`.
function readLog(file) {
  const log = { output: null, target: null, grades: [], released: null, accepted: false, final: null, bought: [], newest: '' };
  const gradeRe = new RegExp(`^(\\d+) (\\d+) (${ID_RE})(?: (regrade-of|retry-of) (${ID_RE}))?$`);
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    log.newest = line;
    let m;
    if ((m = /^output: (\S+)$/.exec(line))) log.output = log.output || m[1];
    else if ((m = /^target: (.+)$/.exec(line))) log.target = log.target || m[1];
    else if ((m = gradeRe.exec(line))) log.grades.push({ attempt: Number(m[1]), round: Number(m[2]), id: m[3], kind: m[4] || null, of: m[5] || null });
    else if ((m = new RegExp(`^released (${ID_RE})( accepted below the level)?$`).exec(line))) { log.released = log.released || m[1]; log.accepted = log.accepted || !!m[2]; }
    else if ((m = new RegExp(`^final (${ID_RE})$`).exec(line))) log.final = log.final || m[1];
    else if ((m = new RegExp(`^bought (${ID_RE})$`).exec(line))) log.bought.push(m[1]);
  }
  return log;
}
// A grade's draft: its own id, or for a regrade or a retry the draft of the grade it names.
function draftOf(log, id, seen = new Set()) {
  const g = log.grades.find((x) => x.id === id);
  if (!g || !g.of || seen.has(id)) return id;
  seen.add(id);
  return draftOf(log, g.of, seen);
}
const newestAttempt = (log) => (log.grades.length ? Math.max(...log.grades.map((g) => g.attempt)) : 1);
const unique = (items) => [...new Set(items)];

// inputs.md (R26): each doc of the output's row that exists, a folder entry when the folder exists, the --target file,
// a skill: entry beside this skill's folder; shown relative to the root when it sits inside it.
function inputsOf(ctx, output, target, env = process.env) {
  const docsAbs = path.resolve(ctx.root, setting('DOCS_PATH', env, ctx.root) || `${ctx.dataRel}/docs`);
  const shown = (abs) => { const rel = path.relative(ctx.root, abs); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? slash(rel) : slash(abs); };
  const lines = [];
  for (const entry of OUTPUTS[output].docs) {
    if (entry === 'target') {
      const abs = target ? path.resolve(ctx.root, target.replace(/\\/g, '/')) : null;
      if (abs && isFile(abs)) lines.push(shown(abs));
    } else if (entry.startsWith('skill:')) {
      const abs = path.join(__dirname, '..', '..', ...entry.slice('skill:'.length).split('/'));
      if (isFile(abs)) lines.push(shown(abs));
    } else if (entry.endsWith('/')) {
      const abs = path.join(docsAbs, entry);
      if (isDir(abs)) lines.push(`${shown(abs)}/`);
    } else {
      const abs = path.join(docsAbs, entry);
      if (isFile(abs)) lines.push(shown(abs));
    }
  }
  return lines.length ? lines : ['none present'];
}

function runStart(args) {
  const ctx = slugContext(args, process.env, true);
  const output = args.output || '';
  if (!Object.hasOwn(OUTPUTS, output)) fail(2, `unknown output '${output}' - one of ${Object.keys(OUTPUTS).join(', ')}`);
  if (args['regrade-of'] && args['retry-of']) fail(2, 'one of --regrade-of and --retry-of, never both');
  const log = fs.existsSync(ctx.logFile) ? readLog(ctx.logFile) : null;
  if (log && log.output && log.output !== output) fail(2, `slug ${ctx.slug} grades ${log.output} - take a new slug for ${output}`);
  if (log && (log.released || log.final)) fail(2, `slug ${ctx.slug} is closed (${log.released ? `released ${log.released}` : `final ${log.final}`}) - take a new slug`);
  const answersFile = path.join(ctx.folder, 'answers.md');
  const taskFile = path.join(ctx.folder, 'task.md');
  const newest = log ? newestAttempt(log) : 1;
  const of = args['regrade-of'] || args['retry-of'] || null;
  let attempt;
  let round;
  let draftId;
  const id = (() => { let x = hex(); while (log && log.grades.some((g) => g.id === x)) x = hex(); return x; })();
  if (of) {
    const g = log && log.grades.find((x) => x.id === of && x.attempt === newest);
    if (!g) fail(2, `${of} is no grade of the newest attempt`);
    attempt = newest;
    round = g.round;
    draftId = draftOf(log, of);
  } else {
    attempt = newest === 1 && log && log.grades.length && isFile(answersFile) ? 2 : newest;
    const rounds = log ? log.grades.filter((g) => g.attempt === attempt).map((g) => g.round) : [];
    round = rounds.length ? Math.max(...rounds) + 1 : 0;
    draftId = id;
  }
  fs.mkdirSync(ctx.folder, { recursive: true });
  if (!log) {
    fs.writeFileSync(path.join(ctx.folder, 'inputs.md'), `${inputsOf(ctx, output, args.target).join('\n')}\n`);
    fs.writeFileSync(ctx.logFile, `output: ${output}\n${args.target ? `target: ${args.target}\n` : ''}`);
  }
  // attempt 2's TASK carries the user's answers, joined once (R27)
  if (attempt === 2) {
    const task = isFile(taskFile) ? fs.readFileSync(taskFile, 'utf8') : '';
    if (!task.includes('## Answers (attempt 2)')) fs.appendFileSync(taskFile, `\n## Answers (attempt 2)\n\n${fs.readFileSync(answersFile, 'utf8')}`);
  }
  fs.appendFileSync(ctx.logFile, `${attempt} ${round} ${id}${of ? ` ${args['regrade-of'] ? 'regrade-of' : 'retry-of'} ${of}` : ''}\n`);
  const out = ctx.self ? [`session: ${ctx.session}`] : [];
  out.push(`id: ${id}`, `draft: ${path.join(ctx.folder, `${draftId}.draft.md`)}`, `score-file: ${path.join(ctx.folder, `${id}.score.md`)}`,
    `task: ${taskFile}`, `inputs: ${path.join(ctx.folder, 'inputs.md')}`, `rubric: ${path.join(__dirname, '..', 'references', OUTPUTS[output].rubric)}`,
    `attempt: ${attempt}`, `round: ${round}`);
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

// The rounds of one attempt, in round order. A round is named by its first grade's id; a grade that fails `grade` with
// exit 2 or 3, or has no score file, is skipped (R9); the round's value is the rounded mean of its valid grades.
function roundsIn(ctx, log, attempt, rubric, level) {
  const byRound = new Map();
  for (const g of log.grades.filter((x) => x.attempt === attempt)) {
    if (!byRound.has(g.round)) byRound.set(g.round, []);
    byRound.get(g.round).push(g);
  }
  const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, grades]) => {
    const valid = [];
    let self = false;
    for (const g of grades) {
      let text;
      try { text = fs.readFileSync(path.join(ctx.folder, `${g.id}.score.md`), 'utf8'); } catch { continue; }
      const isSelf = /^self:/.test(text);
      const r = grade({ scoreText: text, rubric, level, self: isSelf });
      if (r.exit > 1) continue;
      valid.push(r);
      self = self || isSelf;
    }
    const first = grades[0];
    return {
      round, id: first.id, grades, valid, self,
      regraded: grades.some((g) => g.kind === 'regrade-of'),
      draft: path.join(ctx.folder, `${draftOf(log, first.id)}.draft.md`),
      value: valid.length ? mean(valid.map((r) => r.total)) : null,
      ceiling: valid.length ? mean(valid.map((r) => r.ceiling)) : null,
      needs: unique(valid.flatMap((r) => r.needs)),
      blocker: valid.some((r) => r.blockers > 0),
      blocked: unique(valid.flatMap((r) => r.blocked)),
      open: unique(valid.flatMap((r) => r.open)),
      discarded: unique(valid.flatMap((r) => r.discarded.map((d) => `${d.id} ${d.severity} (no ${d.missing.join(', ')})`))),
    };
  });
}
// The best of the rounds by value, a tie taking the later round.
const bestOf = (rounds) => rounds.reduce((best, r) => (best === null || r.value >= best.value ? r : best), null);

function runNext(args) {
  const ctx = slugContext(args);
  if (!isFile(ctx.logFile)) fail(2, `no rounds.log for slug ${ctx.slug} - run start first`);
  const log = readLog(ctx.logFile);
  if (!Object.hasOwn(OUTPUTS, log.output || '')) fail(2, `rounds.log names no known output (${log.output || 'none'})`);
  if (!log.grades.length) fail(2, `slug ${ctx.slug} has no grade line yet - run start first`);
  const rubric = rubricFrom({ rubric: args.rubric, output: log.output });
  const level = levelOf(args.level, process.env, ctx.root);
  const cap0 = OUTPUTS[log.output].runs === 1 ? 1 : roundsOf(args.rounds, process.env, ctx.root);
  const runs = log.grades.length;
  const attemptOf = (id) => (log.grades.find((g) => g.id === id) || { attempt: newestAttempt(log) }).attempt;
  const roundNamed = (id) => roundsIn(ctx, log, attemptOf(id), rubric, level).find((r) => r.id === id) || null;
  const scored = (r, mark) => `Scored: ${r.value}/100 (level ${level}) - ${mark ? `${mark} - ` : ''}${runs} run(s) - ${r.self ? 'SELF' : 'independent'} - ${log.output}`;
  const released = (r) => [scored(r, log.accepted ? 'accepted below the level' : ''), ...(r.open.length ? [`Open: ${r.open.join('; ')}`] : [])];
  const withheld = (r) => [
    `Ceiling: ${r.ceiling}/100 (level ${level}) - ${r.needs.length ? r.needs.join('; ') : 'nothing closable left'}`,
    `Findings: ${r.blocked.length} BLOCKER, ${r.open.length} MATERIAL`,
    `Scored: ${r.value}/100 (level ${level}) - NOT PASSED after ${runs} run(s) - withheld at ${r.draft}`,
  ];
  const out = [];
  let named = null;
  if (log.final) {
    named = roundNamed(log.final);
    out.push(`final ${log.final}`, ...(named && named.valid.length ? withheld(named) : []));
  } else if (log.released) {
    named = roundNamed(log.released);
    out.push(`release ${log.released}`, ...(named && named.valid.length ? released(named) : []));
  } else {
    const attempt = newestAttempt(log);
    const rounds = roundsIn(ctx, log, attempt, rubric, level);
    const graded = rounds.filter((r) => r.valid.length);
    const passing = bestOf(graded.filter((r) => r.value >= level && !r.blocker));
    const last = rounds[rounds.length - 1];
    const ids = new Set(log.grades.filter((g) => g.attempt === attempt).map((g) => g.id));
    const bought = log.bought.filter((id) => ids.has(id)).length;
    const used = ids.size;
    const cap = cap0 + bought;
    if (passing) {
      named = passing;
      fs.appendFileSync(ctx.logFile, `released ${passing.id}\n`);
      out.push(`release ${passing.id}`, ...released(passing));
    } else if (!last.valid.length) {
      out.push(`incomplete ${last.id}`);
    } else if (new RegExp(`^bought ${ID_RE}$`).test(log.newest)) {
      named = last;
      out.push('revise');
    } else {
      named = last;
      const before = graded.filter((r) => r.round < last.round).pop();
      const gained = !before || last.value - before.value >= STALL;
      if (!last.regraded && OUTPUTS[log.output].runs !== 1 && !last.blocker && last.value >= level - NOISE_BAND && last.value < level && used < cap) {
        out.push(`regrade ${last.id}`);
      } else if (used < cap && gained && last.ceiling >= level && last.ceiling >= last.value + STALL) {
        out.push('revise');
      } else {
        const best = bestOf(graded);
        named = best;
        const action = attempt === 1 ? 'ask-continue' : 'withhold-final';
        // the recommendation is the script's, never the model's (R19)
        let choice;
        if (action === 'withhold-final') choice = best.blocker ? 'keep' : 'accept';
        else if (best.needs.length && !args.auto) choice = 'answer';
        else if (!best.blocker) choice = 'accept';
        else choice = bought ? 'keep' : 'revise';
        const mark = `asked ${best.id} ${action}`;
        if (log.newest !== mark) fs.appendFileSync(ctx.logFile, `${mark}\n`);
        out.push(`${action} ${best.id} recommend ${choice}`, ...withheld(best));
      }
    }
  }
  if (named && named.discarded.length) out.push(`Discarded: ${named.discarded.join('; ')}`);
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

// The user's answer to the newest `asked` line (R28): accept releases below the level, marked; revise buys one run;
// keep is final; answer writes nothing and leaves attempt 2 to `start` once answers.md exists.
function runDecide(args) {
  const ctx = slugContext(args);
  if (!isFile(ctx.logFile)) fail(2, `no rounds.log for slug ${ctx.slug} - run start first`);
  const log = readLog(ctx.logFile);
  const m = new RegExp(`^asked (${ID_RE}) (ask-continue|withhold-final)$`).exec(log.newest);
  if (!m) fail(2, 'nothing is asked - run next first');
  const [, id, action] = m;
  const choice = args.choice || '';
  if (!['accept', 'revise', 'answer', 'keep'].includes(choice)) fail(2, `--choice '${choice}' is not accept, revise, answer or keep`);
  if (action === 'withhold-final' && (choice === 'revise' || choice === 'answer')) fail(2, `withhold-final takes accept or keep, not ${choice}`);
  const attempt = (log.grades.find((g) => g.id === id) || { attempt: newestAttempt(log) }).attempt;
  if (choice === 'answer' && attempt !== 1) fail(2, 'answer opens attempt 2 and there is no third attempt');
  if (choice === 'answer') {
    process.stdout.write(`answer ${id} - write ${path.join(ctx.folder, 'answers.md')}, then start\n`);
    return 0;
  }
  const line = choice === 'accept' ? `released ${id} accepted below the level` : choice === 'revise' ? `bought ${id}` : `final ${id}`;
  fs.appendFileSync(ctx.logFile, `${line}\n`);
  process.stdout.write(`${line}\n`);
  return 0;
}

const MODES = { start: runStart, grade: runGrade, next: runNext, decide: runDecide };

function main(argv) {
  const args = parseArgs(argv);
  try {
    if (!Object.hasOwn(MODES, args._[0] || '')) fail(2, `unknown mode: ${args._[0] || '(none)'} - start, grade, next or decide`);
    return MODES[args._[0]](args);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    process.stderr.write(`scorecard: ${e.message}\n`);
    return e.code;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { OUTPUTS, NOISE_BAND, BLOCKER_CAP, SELF_CAP, parseRubric, sealOf, readScoreFile, grade, gradeLines, levelOf, roundsOf, projectRoot, setting, dataRoot, safeSession, sessionOf, readLog };
