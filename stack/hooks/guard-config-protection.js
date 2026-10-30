#!/usr/bin/env node
// guard-config-protection.js - PreToolUse (Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Monitor).
// The cheapest way to 'pass' a lint or a build is to weaken the check, so a change to an EXISTING
// check config is blocked and the model is sent back to the code. Creating one is allowed - there
// is nothing to weaken yet. Two kinds of file: a WHOLE-FILE config (the file IS the check - an
// eslint / prettier / stylelint / biome config, .editorconfig, a .ruleset) and a KEYED one, ordinary
// project config whose strictness lines alone are the check (tsconfig strict flags, the MSBuild
// warning and nullable properties) - there a change that leaves those lines as they were passes.
// 'Allow' is honoured through <data root>/state/approvals/CONFIG-EDIT-ALLOW (one path per line as the project
// spells it, a bare file name, or `*`; this session's own, under 8h).
// The hooks off-list switches the gate off (the old ALFRED_CODE_CONFIG_PROTECT=0, read for the 2.x line, folds into it). The shell route reads the writes through shell-writes.js's
// scanShell (wrappers, carried scripts, a cd's anchor), then its own segment parser for the PowerShell verbs.
// Audit 2026-10-30 HK-18: a runtime's write replaces the file like a redirect; `git checkout <rev> -- <config>` and
// `git restore --source` are judged on the version they restore, `git rm` / `git mv` as a removal, `dd of=` as a
// replace, `patch` and `git apply` on the lines their diff changes; and - the user's ruling - a NEW config that shadows
// an existing one (a higher-ranked file in its folder, any config in a folder below one, a new ignore file, a new
// package.json config key that outranks one) is judged as an edit of the config it shadows, the same ask.
// Ceilings: a runtime's read-modify-write of a keyed file is a replace (asked even when it leaves the keys), `npm pkg
// set`, a `sed -i` inside package.json's config keys, a patch fed through a pipe, and `git stash` / `reset --hard`.
// Declined (2.1.5 M13), on the record so the gap is a choice: a lockfile (package-lock.json, yarn.lock,
// packages.lock.json), a migration, the central package file (Directory.Packages.props) and a solution file
// (.sln). None is a CHECK a change weakens, and legitimate work edits each - a dependency bump, a new project, a
// migration still in review; whether a migration was APPLIED lives in a database no hook reads. A block there
// would fire on honest work far more than on a weakened check. Revisit when the block-rate ledger shows a
// hand edit of one of them costing a run.
'use strict';
const fs = require('fs');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running - envOf falls back to the bare ALFRED_CODE_ read (pre-2.0.0 behaviour) the same
// way.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-config-protection');
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}
if (envOf(process.env, 'CONFIG_PROTECT') === '0') process.exit(0);

// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;

// Git Bash / MSYS spell a Windows path in POSIX mount form; translate before any resolution.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
try { ({ nativePath } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }

// Whole-file protection: the file IS the check - and so is a linter's or formatter's ignore file, whose one new line
// takes a path out of the check (audit 2026-10-08).
const WHOLE_FILE = [
  /^\.editorconfig$/, /^\.globalconfig$/, /\.ruleset$/, /^stylecop\.json$/,
  /^\.eslintrc(\.(js|cjs|mjs|json|ya?ml))?$/, /^eslint\.config\.[cm]?[jt]s$/,
  /^\.prettierrc(\.([cm]?[jt]s|json5?|ya?ml|toml))?$/, /^prettier\.config\.[cm]?[jt]s$/,
  /^biome\.jsonc?$/, /^\.stylelintrc(\.(js|cjs|json|ya?ml))?$/, /^stylelint\.config\.[cm]?js$/,
  /^\.(eslint|prettier|stylelint)ignore$/,
];
// A JSONC comment ends where the text says, never inside a string: a `"https://..."` value is no `//` comment.
function stripJsonComments(s) {
  let out = '';
  for (let i = 0, n = s.length; i < n;) {
    if (s[i] === '"') { let j = i + 1; while (j < n && s[j] !== '"') j += s[j] === '\\' ? 2 : 1; out += s.slice(i, j + 1); i = j + 1; }
    else if (s[i] === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i += 1; }
    else if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; }
    else { out += s[i]; i += 1; }
  }
  return out;
}
// Keyed protection: the file is ordinary project config, only its strictness SETTINGS are the check.
// Compared as key=value pairs, never as lines: a one-line tsconfig puts every key on the line an
// unrelated `paths` edit rewrites. A COMMENTED-OUT setting is no setting (`// "strict": true` and an XML-commented
// `TreatWarningsAsErrors` passed), and an MSBuild property's attributes are part of it (`Condition="false"` switched
// it off and passed) - audit 2026-10-08. An unterminated comment start comments out the rest of the text.
const KEYED = [
  { file: /^tsconfig(\..+)?\.json$/, strip: stripJsonComments,
    // `extends` names the base the strictness comes from and `exclude` the files no check reads (audit 2026-10-20, the
    // hooks track's minor list): a change to either is judged like a key, an array compared without its whitespace.
    pair: /"(strict\w*|alwaysStrict|noImplicit\w+|noUnused\w+|noUncheckedIndexedAccess|noFallthroughCasesInSwitch|noPropertyAccessFromIndexSignature|exactOptionalPropertyTypes|useUnknownInCatchVariables|allowUnreachableCode|allowUnusedLabels|skipLibCheck|extends|exclude)"\s*:\s*("[^"]*"|\[[^\]]*\]|[^,}\s]+)/g,
    key: (m) => `${m[1]}=${tsValue(m[2])}` },
  { file: /^(Directory\.Build\.(props|targets)|.+\.(cs|fs|vb)proj)$/, strip: (s) => s.replace(/<!--[\s\S]*?(?:-->|$)/g, ' '),
    pair: /<(TreatWarningsAsErrors|WarningsAsErrors|WarningsNotAsErrors|WarningLevel|NoWarn|Nullable|AnalysisLevel|AnalysisMode|EnforceCodeStyleInBuild|RunAnalyzers|RunAnalyzersDuringBuild|EnableNETAnalyzers)\b([^>]*)>([^<]*)<\/\1\s*>/g,
    key: (m) => `${m[1]}${m[2].trim() ? `[${m[2].trim().replace(/\s+/g, ' ')}]` : ''}=${m[3].trim()}` },
];
const KEY_WORDS = /strict|noImplicit|noUnused|noUnchecked|noFallthrough|noPropertyAccess|allowUnreachable|allowUnused|useUnknownInCatch|exactOptional|skipLibCheck|NoWarn|WarningsAsErrors|WarningsNotAsErrors|WarningLevel|Nullable|AnalysisLevel|AnalysisMode|EnforceCodeStyle|RunAnalyzers|EnableNETAnalyzers/;
function tsValue(v) { const t = String(v || '').trim(); return t.startsWith('[') ? t.replace(/\s+/g, '') : t; }
const WHOLE_WHY = 'it is a lint / format / analyzer config';
const keyPairs = (text, keyed) => [...keyed.strip(String(text || '')).matchAll(keyed.pair)].map(keyed.key).sort().join('\n');
const unq = (s) => String(s).replace(/^["']|["']$/g, '');

let payload;
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (!payload || typeof payload !== 'object') process.exit(0);
// GATE 6 (hook-prelude.js): a Cursor payload runs only the protective guards - outside the try, a caller's exit must not be swallowed.
let cursorOff = false;
try { cursorOff = require('./hook-prelude.js').cursorStandDown(payload, __filename); } catch { /* no prelude: run */ }
if (cursorOff) process.exit(0);

    // --- block telemetry (shared by every guard hook; keep the copies identical) ------------
    // A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
    // FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
    // the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
    // nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
    // scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
    // telemetry never changes the verdict and never throws.
    (() => {
        let last = '';
        const w = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
        const exit = process.exit.bind(process);
        process.exit = (code) =>
        {
            if (code === 2)
            {
                try
                {
                    // `path` is required at module scope above.
                    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
                    // resolve, NOT join: an ABSOLUTE ALFRED_CODE_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = (() => { try { return require('./layout.js').statsPath(root, ['hook-blocks']); } catch { return path.resolve(root, docsRootEnv(), 'hook-blocks'); } })();
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                        ts: new Date().toISOString(),
                        hook: path.basename(__filename),
                        event: payload.hook_event_name || payload.tool_name || '',
                        tool: payload.tool_name || '',
                        // WHO was blocked and on which call: a seat's block is its own row (audit 2026-10-10 C07, 0498718d - seat
                        // blocks read as the main session's), and the call id joins the row to the transcript without a clock.
                        agent: payload.agent_id || null,
                        tool_use_id: payload.tool_use_id || null,
                        reason: last.split('\n')[0].slice(0, 200),
          // A hook may name the BRANCH that fired and what matched, when it has more than one
          // (`global.BLOCK_DETAIL`, dropped by JSON.stringify when nothing set it). A block whose
          // cause cannot be reconstructed cannot be tuned - this is the field that reconstructs it.
          detail: global.BLOCK_DETAIL || undefined,
                    }) + '\n');
                }
                catch { /* telemetry is never allowed to break the gate */ }
            }
            exit(code);
        };
    })();

const ROOT = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const CWD = payload.cwd || ROOT;
const resolveIn = (p) => path.resolve(CWD, nativePath(p));

function judgeFileTool() {
  const ti = payload.tool_input || {};
  const target = ti.file_path || ti.notebook_path || '';
  if (!target) return null;
  const abs = resolveIn(target);
  // creation - there is nothing to weaken yet, unless the new file shadows a config that exists (HK-18, below)
  if (!fs.existsSync(abs)) return shadowHit(abs);
  const base = path.basename(abs);
  if (base === 'package.json') {
    const change = appliedChange(ti, abs);
    return change && change.applied ? pkgChange(change.before, change.after, abs) : null;
  }
  if (WHOLE_FILE.some((re) => re.test(base))) {
    // An eslint config edit that only RAISES rule severities is no weakening (audit 2026-10-14 HK19, below).
    const change = ESLINT_FILE.test(base) ? appliedChange(ti, abs) : null;
    return change && change.applied && severitiesOnlyRise(change.before, change.after, base) ? null : { abs, why: WHOLE_WHY };
  }
  const keyed = KEYED.find((k) => k.file.test(base));
  if (!keyed) return null;
  const change = appliedChange(ti, abs);
  if (!change) return null;
  const { before, after, applied } = change;
  if (keyPairs(before, keyed) === keyPairs(after, keyed)) return null;
  const tightens = applied && (keyed === KEYED[1] ? onlyTightens(before, after, keyed) : tsOnlyTightens(before, after, keyed));
  return tightens ? null : { abs, why: 'the change touches a strictness / warning setting' };
}
// The text the call leaves. An edit is judged on the WHOLE file it leaves: a fragment can cut a setting in half
// (`<TreatWarningsAsErrors>` -> `<TreatWarningsAsErrors Condition="false">` names no closing tag, so neither side read a
// pair - audit 2026-10-08). An old_string the file does not hold falls back to the fragments (`applied: false`), the edit
// Claude Code will refuse anyway. null when the file cannot be read.
function appliedChange(ti, abs) {
  const edits = Array.isArray(ti.edits) ? ti.edits : [{ old_string: ti.old_string, new_string: ti.new_string, replace_all: ti.replace_all }];
  const whole = typeof ti.content === 'string';
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  let applied = whole ? ti.content : text;
  for (const e of whole ? [] : edits) {
    const o = e && typeof e.old_string === 'string' ? e.old_string : '';
    if (!o || !applied.includes(o)) { applied = null; break; }
    const n = e && typeof e.new_string === 'string' ? e.new_string : '';
    applied = e.replace_all ? applied.split(o).join(n) : applied.replace(o, () => n);
  }
  if (applied !== null) return { before: text, after: applied, applied: true };
  return { before: edits.map((e) => (e && e.old_string) || '').join('\n'), after: edits.map((e) => (e && e.new_string) || '').join('\n'), applied: false };
}
// A change that only makes a tsconfig check STRICTER passes too (audit 2026-10-14 HK19: `strict: false` -> `true` was
// blocked as a weakening). Every changed key moves to its strict value: true for the strict / noImplicit / noUnused
// family, false for the three that loosen when true (allowUnreachableCode, allowUnusedLabels, skipLibCheck). A key
// removed, a key named twice or any other value keeps the block.
const TS_LOOSE_WHEN_TRUE = new Set(['allowUnreachableCode', 'allowUnusedLabels', 'skipLibCheck']);
function tsOnlyTightens(before, after, keyed) {
  const props = (t) => {
    const m = new Map();
    for (const x of keyed.strip(String(t || '')).matchAll(keyed.pair)) {
      if (m.has(x[1])) return null;
      m.set(x[1], tsValue(x[2]));
    }
    return m;
  };
  const b = props(before);
  const a = props(after);
  if (!b || !a) return false;
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    if (b.get(k) === a.get(k)) continue;
    if (!a.has(k)) return false;
    const strict = TS_LOOSE_WHEN_TRUE.has(k) ? 'false' : 'true';
    if (a.get(k) !== strict || (b.has(k) && b.get(k) === strict)) return false;
  }
  return true;
}
// ESLINT SEVERITIES (audit 2026-10-14 HK19: `"warn"` -> `"error"` was blocked as a weakening). An eslint config is a
// whole-file check, so the edit passes only when the file it leaves differs from the one it found in rule SEVERITIES
// alone, each one RAISED (off / 0 -> warn / 1 -> error / 2). JSON and JS are compared token by token - the same tokens, the
// same brackets - and a severity counts only as a rule's value straight inside a `rules` object (`"no-console": "warn"`,
// `"no-console": ["warn", ...]`), never an option deeper down (`{ "max": 1 }`). YAML is compared line by line, a
// `<rule>: <severity>` line (or its `[<severity>, ...]` flow form) whose nearest parent line is `rules:`. Anything else -
// a comment, a new rule, an option, whitespace alone - keeps the block.
const ESLINT_FILE = /^\.eslintrc(\.(js|cjs|mjs|json|ya?ml))?$|^eslint\.config\.[cm]?[jt]s$/;
const SEVERITY = { off: 0, warn: 1, error: 2, 0: 0, 1: 1, 2: 2 };
const severityOf = (tok) => { const m = String(tok).match(/^(["'`]?)(off|warn|error|[012])\1$/); return m && (m[1] || /^\d$/.test(m[2])) ? SEVERITY[m[2]] : undefined; };
function severitiesOnlyRise(before, after, base) {
  if (/\.ya?ml$/.test(base)) return yamlSeveritiesOnlyRise(before, after);
  const tokens = (s) => String(s).match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|\S/g) || [];
  const tb = tokens(before);
  const ta = tokens(after);
  if (tb.length !== ta.length) return false;
  const stack = [];
  const keyAt = (i) => (i >= 2 && ta[i - 1] === ':' ? unq(ta[i - 2]) : null);
  let raised = 0;
  for (let i = 0; i < ta.length; i++) {
    const tok = ta[i];
    if (tb[i] !== tok) {
      const was = severityOf(tb[i]);
      const now = severityOf(tok);
      const top = stack[stack.length - 1];
      const parent = stack[stack.length - 2];
      const inRules = (top && top.open === '{' && top.key === 'rules' && ta[i - 1] === ':')
        || (top && top.open === '[' && ta[i - 1] === '[' && ta[i - 2] === ':' && parent && parent.open === '{' && parent.key === 'rules');
      if (was === undefined || now === undefined || !inRules || !(now > was)) return false;
      raised++;
      continue;
    }
    if (tok === '{' || tok === '[') stack.push({ open: tok, key: keyAt(i) });
    else if (tok === '}' || tok === ']') stack.pop();
  }
  return raised > 0;
}
function yamlSeveritiesOnlyRise(before, after) {
  const lb = String(before).split(/\r?\n/);
  const la = String(after).split(/\r?\n/);
  if (lb.length !== la.length) return false;
  const RULE_LINE = /^(\s+)((?:"[^"]+"|'[^']+'|[^\s:#'"][^:#]*?)):\s*(\[\s*)?(["']?)(off|warn|error|[012])\4(\s*(?:,[^\]#]*)?\])?\s*(#.*)?$/;
  const indent = (l) => l.match(/^\s*/)[0].length;
  const parentOf = (i) => { const n = indent(la[i]); for (let j = i - 1; j >= 0; j--) if (/\S/.test(la[j]) && !/^\s*#/.test(la[j]) && indent(la[j]) < n) return la[j]; return ''; };
  let raised = 0;
  for (let i = 0; i < la.length; i++) {
    if (lb[i] === la[i]) continue;
    const b = lb[i].match(RULE_LINE);
    const a = la[i].match(RULE_LINE);
    if (!a || !b || a[1] !== b[1] || a[2] !== b[2] || !!a[3] !== !!b[3] || (a[6] || '') !== (b[6] || '') || (a[7] || '') !== (b[7] || '')) return false;
    if (!/^\s*rules:\s*(#.*)?$/.test(parentOf(i))) return false;
    if (!(SEVERITY[a[5]] > SEVERITY[b[5]])) return false;
    raised++;
  }
  return raised > 0;
}
// A change that only makes an MSBuild check STRICTER is no weakening (audit 2026-10-11 SD16, session 2ca8e8ee: removing
// `CS9057` from a `NoWarn` re-enables the warning and was blocked as weakening a check, an ask and a receipt for the
// right fix). Every changed property must move one way: a NoWarn / WarningsNotAsErrors list only loses entries, a
// WarningsAsErrors list only gains them, TreatWarningsAsErrors / EnforceCodeStyleInBuild go to true, WarningLevel up,
// Nullable toward enable. A property named twice, an attribute change or any other key keeps the block.
function onlyTightens(before, after, keyed) {
  const props = (t) => {
    const m = new Map();
    for (const x of keyed.strip(String(t || '')).matchAll(keyed.pair)) {
      const k = `${x[1]}[${x[2].trim().replace(/\s+/g, ' ')}]`;
      if (m.has(k)) return null;
      m.set(k, { name: x[1], value: x[3].trim() });
    }
    return m;
  };
  const b = props(before);
  const a = props(after);
  if (!b || !a) return false;
  const list = (v) => new Set(String(v || '').split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  const subset = (x, y) => [...x].every((e) => y.has(e));
  const bool = (v) => String(v || '').trim().toLowerCase() === 'true';
  const NULLABLE = { disable: 0, annotations: 1, warnings: 1, enable: 2 };
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const was = b.get(k);
    const now = a.get(k);
    if (was && now && was.value === now.value) continue;
    const name = (was || now).name;
    if (name === 'NoWarn' || name === 'WarningsNotAsErrors') { if (!subset(list(now && now.value), list(was && was.value))) return false; continue; }
    if (name === 'WarningsAsErrors') { if (!now || !subset(list(was && was.value), list(now.value))) return false; continue; }
    if (name === 'TreatWarningsAsErrors' || name === 'EnforceCodeStyleInBuild' || name === 'RunAnalyzers' || name === 'RunAnalyzersDuringBuild' || name === 'EnableNETAnalyzers') { if (!now || !bool(now.value) || (was && bool(was.value))) return false; continue; }
    if (name === 'WarningLevel') { if (!now || !(Number(now.value) > (was ? Number(was.value) : -1))) return false; continue; }
    if (name === 'Nullable') {
      const r = (v) => NULLABLE[String(v || 'disable').trim().toLowerCase()];
      if (!now || r(now.value) === undefined || !(r(now.value) > (was ? r(was.value) : 0))) return false;
      continue;
    }
    return false;
  }
  return true;
}

const WRITE_VERB = new Set(['tee', 'rm', 'mv', 'truncate', 'set-content', 'add-content', 'out-file', 'clear-content', 'remove-item', 'move-item']);
const COPY_VERB = new Set(['cp', 'copy-item']);
// A heredoc body and a quoted span are text the command CARRIES (a runbook describing the rm, a commit
// message naming the file), never a step of its own - the siblings mask both for the same reason. The
// segments are cut at separators OUTSIDE quotes, over a copy with heredoc bodies blanked, using the
// shared parser beside this hook.
let shell = null;
try { shell = require(path.join(__dirname, 'shell-writes.js')); } catch { shell = null; }
function segments(command) {
  const text = shell.blankHeredocs(command);
  const chars = text.split('');
  for (const [a, b] of shell.quotedSpans(text)) for (let i = a; i < b; i += 1) chars[i] = 'x';
  const masked = chars.join('');
  const out = [];
  let from = 0;
  for (const m of masked.matchAll(/&&|\|\||[;\n|]/g)) { out.push(text.slice(from, m.index)); from = m.index + m[0].length; }
  out.push(text.slice(from));
  return out;
}
// The shared reader first (audit 2026-10-08): the segment parser below missed a write behind a wrapper (`echo x |
// sudo tee .eslintrc.json`), in a carried script (`bash -c 'rm .eslintrc.json'`) and after a `cd` (`cd sub && rm
// ../.eslintrc.json`); scanShell reads all three the way the cross-project guard does. A keyed file written any way
// but an in-place edit is REPLACED or removed whole (`echo '{}' > tsconfig.json`), which weakens the check whenever
// the file holds a strictness setting - it passed unless the command named a key.
function judgeScan(command) {
  let scan;
  try { scan = shell.scanShell(command, { cwd: CWD }); } catch { return null; }
  const norm = (t) => nativePath(shell.unquote(t));
  const anchorFor = (at) => shell.anchorAt(scan.cds, at, CWD, norm);
  for (const t of scan.targets) {
    if (t.verb === 'patch') continue; // judged on the diff it applies (judgePatches)
    const raw = scan.expandVars(String(t.raw || ''), t.index);
    if (!raw || shell.isVar(raw)) continue;
    const base = path.basename(raw);
    const whole = WHOLE_FILE.some((re) => re.test(base));
    const keyed = KEYED.find((k) => k.file.test(base));
    if (!whole && !keyed && base !== 'package.json') continue;
    const anchor = anchorFor(t.index);
    if (anchor === null && !path.isAbsolute(nativePath(raw))) continue; // relative from an unknown anchor
    const abs = path.resolve(anchor || CWD, nativePath(raw));
    if (!fs.existsSync(abs)) {
      const shadow = t.verb === 'rm' ? null : shadowHit(abs);
      if (shadow) return shadow;
      continue;
    }
    if (whole) return { abs, why: WHOLE_WHY };
    if (base === 'package.json') {
      const pkg = jsonOf(abs);
      const key = pkg && Object.keys(PKG_KEYS).find((k) => pkg[k] !== undefined);
      if (key && t.what !== 'an in-place edit') return { abs, why: `the command replaces or removes package.json, which holds the \`${key}\` config` };
      continue;
    }
    // A runtime's write REPLACES the file with what its script computes, like a redirect (audit 2026-10-30 HK-18: `node -e
    // "writeFileSync('tsconfig.json', '{}')"` passed unless it named a key) - only sed / perl -i edit it in place.
    if (t.what === 'an in-place edit') {
      if (KEY_WORDS.test(command)) return { abs, why: 'the command names a strictness / warning setting' };
      if (inPlaceWeakens(command, abs, keyed)) return { abs, why: 'the in-place edit changes a strictness / warning setting' };
      continue;
    }
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { text = ''; }
    if (keyPairs(text, keyed)) return { abs, why: 'the command replaces or removes a file holding strictness / warning settings' };
  }
  return judgePatches(command, anchorFor) || judgeGitVerbs(command);
}

// ---- shadowing (audit 2026-10-30 HK-18; the user's ruling: a new config that shadows a protected one is a weakening) --
// A linter or formatter reads the config NEAREST the file it checks - ESLint searches up from the file's folder for an
// `eslint.config.*` (eslint.org/docs/latest/use/configure/configuration-files), Prettier stops at the first config it meets
// on the way up (prettier.io/docs/configuration) - and in one folder the higher-ranked file wins. So a NEW config that
// outranks one in its own folder, or sits in a folder below one, changes the check for every file it covers: it is judged
// as an edit of the config it shadows, the same ask. A new ignore file narrows the config at or above it the same way.
// Stylelint and Biome state no order among their files (stylelint.io/user-guide/configure), so a second one in the same
// folder is read as winning; MSBuild imports the nearest Directory.Build.props / .targets only, so a new one below a
// keyed one shadows it. Ranks: lower wins; null is unknown.
const RANKS = {
  eslint: [/^eslint\.config\.js$/, /^eslint\.config\.mjs$/, /^eslint\.config\.cjs$/, /^eslint\.config\.ts$/, /^eslint\.config\.mts$/, /^eslint\.config\.cts$/,
    /^\.eslintrc\.js$/, /^\.eslintrc\.cjs$/, /^\.eslintrc\.yaml$/, /^\.eslintrc\.yml$/, /^\.eslintrc\.json$/, /^\.eslintrc$/],
  prettier: [/^\.prettierrc$/, /^\.prettierrc\.(?:json5?|ya?ml)$/, /^(?:\.prettierrc|prettier\.config)\.[jt]s$/, /^(?:\.prettierrc|prettier\.config)\.m[jt]s$/,
    /^(?:\.prettierrc|prettier\.config)\.c[jt]s$/, /^\.prettierrc\.toml$/],
  stylelint: [/^(?:\.stylelintrc(?:\.(?:[cm]?js|json|ya?ml))?|stylelint\.config\.[cm]?[jt]s)$/],
  biome: [/^biome\.jsonc?$/],
  editorconfig: [/^\.editorconfig$/],
};
const UNORDERED = new Set(['stylelint', 'biome']);
const IGNORES = { '.eslintignore': 'eslint', '.prettierignore': 'prettier', '.stylelintignore': 'stylelint' };
// package.json's own config keys: [family, rank among that family's files] - Prettier reads the key first, ESLint's legacy
// lookup last; `eslintIgnore` is an ignore list.
const PKG_KEYS = { eslintConfig: ['eslint', 12], prettier: ['prettier', -1], stylelint: ['stylelint', null], eslintIgnore: ['eslint', 'ignore'] };
const MSBUILD_SHADOW = /^Directory\.Build\.(?:props|targets)$/;
const jsonOf = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
function familyOf(base) {
  if (IGNORES[base]) return { family: IGNORES[base], ignore: true };
  for (const [family, list] of Object.entries(RANKS)) {
    const k = list.findIndex((re) => re.test(base));
    if (k >= 0) return { family, rank: UNORDERED.has(family) ? null : k };
  }
  return null;
}
// The configs of one family a folder holds (never an ignore file): { abs, rank }.
function configsIn(dir, family) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = familyOf(n);
    if (f && f.family === family && !f.ignore) out.push({ abs: path.join(dir, n), rank: f.rank });
  }
  if (names.includes('package.json')) {
    const pkg = jsonOf(path.join(dir, 'package.json'));
    for (const [k, [fam, rank]] of Object.entries(PKG_KEYS)) {
      if (fam === family && rank !== 'ignore' && pkg && pkg[k] !== undefined) out.push({ abs: path.join(dir, 'package.json'), key: k, rank: UNORDERED.has(fam) ? null : rank });
    }
  }
  return out;
}
const ROOT_ABS = path.resolve(ROOT);
const underRoot = (d) => { const r = path.relative(ROOT_ABS, d); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
// The existing config a new one at `abs` (family `f`) would shadow, or null.
function shadowed(abs, f) {
  const home = path.dirname(abs);
  let d = home;
  for (let i = 0; i < 64 && underRoot(d); i++) {
    for (const e of configsIn(d, f.family)) {
      if (e.abs === abs && !e.key) continue;
      if (d !== home || f.ignore) return e;
      if (f.rank === null || e.rank === null || f.rank < e.rank) return e;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function msbuildShadowed(abs) {
  const base = path.basename(abs);
  const keyed = KEYED[1];
  let d = path.dirname(path.dirname(abs));
  for (let i = 0; i < 64 && underRoot(d); i++) {
    const p = path.join(d, base);
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch { text = ''; }
    if (text && keyPairs(text, keyed)) return { abs: p };
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
const shownOf = (e) => `${path.relative(ROOT_ABS, e.abs).split(path.sep).join('/') || path.basename(e.abs)}${e.key ? `'s \`${e.key}\` key` : ''}`;
function shadowHit(abs) {
  const base = path.basename(abs);
  const f = familyOf(base);
  const over = f ? shadowed(abs, f) : MSBUILD_SHADOW.test(base) ? msbuildShadowed(abs) : null;
  return over ? { abs, why: `it would take precedence over ${shownOf(over)}`, shadow: shownOf(over) } : null;
}
// package.json: a change to an existing config key is an edit of that config; a new key is a new config, judged for
// shadowing at its rank.
function pkgChange(beforeText, afterText, abs) {
  let b;
  let a;
  try { b = JSON.parse(beforeText); a = JSON.parse(afterText); } catch { return null; }
  if (!b || !a || typeof b !== 'object' || typeof a !== 'object') return null;
  for (const [k, [family, rank]] of Object.entries(PKG_KEYS)) {
    if (JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
    if (b[k] !== undefined) return { abs, why: `the change rewrites its \`${k}\` config` };
    const over = shadowed(abs, rank === 'ignore' ? { family, ignore: true } : { family, rank: UNORDERED.has(family) ? null : rank });
    if (over) return { abs, why: `a new \`${k}\` key would take precedence over ${shownOf(over)}`, shadow: shownOf(over) };
  }
  return null;
}

// ---- patch / git apply: the files a diff changes, each judged on its changed lines (audit 2026-10-30 HK-18) ----------
// A whole-file config the diff touches blocks; a keyed one when a changed line names a strictness key (or the file is
// deleted); package.json when a changed line names one of its config keys. A patch whose text cannot be read (a pipe)
// is judged only by the file it names.
const KEYED_LINE = new RegExp(`${KEY_WORDS.source}|"(?:extends|exclude)"`);
const PKG_LINE = /"(?:eslintConfig|prettier|stylelint|eslintIgnore)"/;
function diffFiles(text, strip) {
  const files = new Map();
  const cut = (p) => {
    const parts = p.replace(/^"|"$/g, '').split('/');
    return strip === null ? parts[parts.length - 1] : parts.slice(Math.min(strip, parts.length - 1)).join('/');
  };
  let old = null;
  let cur = null;
  for (const line of String(text).split('\n')) {
    let m;
    if ((m = /^--- (\S+)/.exec(line))) { old = m[1]; continue; }
    if ((m = /^\+\+\+ (\S+)/.exec(line))) {
      const removed = m[1] === '/dev/null';
      const name = removed ? old : m[1];
      cur = name && name !== '/dev/null' ? cut(name) : null;
      if (cur && !files.has(cur)) files.set(cur, []);
      if (cur && removed) files.get(cur).push(null);
      continue;
    }
    if (cur && /^[+-]/.test(line)) files.get(cur).push(line.slice(1));
  }
  return files;
}
function changeHits(abs, lines) {
  if (!fs.existsSync(abs)) return null;
  const base = path.basename(abs);
  if (WHOLE_FILE.some((re) => re.test(base))) return { abs, why: `the patch changes it - ${WHOLE_WHY}` };
  const keyed = KEYED.find((k) => k.file.test(base));
  const removed = lines.includes(null);
  if (keyed && (removed || lines.some((l) => l !== null && KEYED_LINE.test(l)))) return { abs, why: 'the patch changes a strictness / warning setting' };
  if (base === 'package.json' && (removed || lines.some((l) => l !== null && PKG_LINE.test(l)))) return { abs, why: 'the patch changes a config key in package.json' };
  return null;
}
const PATCH_VALUE = 'pFDBYzVgrodi';
function patchArgs(argv) {
  const o = { strip: null, input: null, dir: null, output: null, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.pos.push(...argv.slice(i + 1)); break; }
    const long = /^--(strip|input|directory|output)(?:=(.*))?$/.exec(a);
    if (long) {
      const v = long[2] !== undefined ? long[2] : argv[++i];
      if (long[1] === 'strip') o.strip = Number(v); else if (long[1] === 'input') o.input = v; else if (long[1] === 'directory') o.dir = v; else o.output = v;
      continue;
    }
    if (a.startsWith('--')) { if (/^--(?:fuzz|ifdef|prefix|basename-prefix|suffix|version-control|reject-file|get)$/.test(a)) i++; continue; }
    if (a.length > 1 && a[0] === '-') {
      for (let k = 1; k < a.length; k++) {
        if (!PATCH_VALUE.includes(a[k])) continue;
        const v = k === a.length - 1 ? argv[++i] : a.slice(k + 1);
        if (a[k] === 'p') o.strip = Number(v); else if (a[k] === 'i') o.input = v; else if (a[k] === 'd') o.dir = v; else if (a[k] === 'o') o.output = v;
        break;
      }
      continue;
    }
    o.pos.push(a);
  }
  return o;
}
function applyArgs(argv) {
  const o = { strip: 1, write: true, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^--(?:check|stat|numstat|summary)$/.test(a) && !argv.includes('--apply')) o.write = false;
    else if (/^-p\d+$/.test(a)) o.strip = Number(a.slice(2));
    else if (a === '-p') o.strip = Number(argv[++i]);
    else if (/^--(?:directory|include|exclude|whitespace|build-fake-ancestor)$/.test(a) || a === '-C') i++;
    else if (!a.startsWith('-')) o.files.push(a);
  }
  return o;
}
function judgePatches(command, anchorFor) {
  if (!/\b(?:patch|apply)\b/.test(command)) return null;
  const heredocs = shell.heredocsOf(command);
  let words;
  try { words = shell.commandWords(command); } catch { return null; }
  for (const w of words) {
    const isPatch = w.name === 'patch';
    const isApply = w.name === 'git' && w.argv[0] === 'apply';
    if (!isPatch && !isApply) continue;
    const base = anchorFor(w.at) || CWD;
    // the diff's text: a named file, else the command's `<` file or heredoc
    const readText = (file) => { try { return fs.readFileSync(path.resolve(base, nativePath(file)), 'utf8'); } catch { return null; } };
    let text = null;
    const stdin = () => {
      for (const r of w.cmd.redirs || []) {
        if (r.op === '<' && r.target) return readText(shell.unquote(r.target.raw));
        if (r.op === '<<' || r.op === '<<-') { const h = heredocs.find((x) => x.index === r.at); if (h) return shell.heredocBody(command, h); }
      }
      return null;
    };
    if (isPatch) {
      const o = patchArgs(w.argv);
      const file = o.input || o.pos[1] || null;
      text = file ? readText(file) : stdin();
      const at = o.dir ? path.resolve(base, nativePath(o.dir)) : base;
      if (o.pos[0]) {
        const abs = path.resolve(at, nativePath(o.pos[0]));
        const all = text === null ? [null] : [...diffFiles(text, o.strip).values()].flat();
        const hit = changeHits(abs, all.length ? all : [null]);
        if (hit) return hit;
        continue;
      }
      if (text === null) continue;
      for (const [rel, lines] of diffFiles(text, o.strip)) { const hit = changeHits(path.resolve(at, nativePath(rel)), lines); if (hit) return hit; }
    } else {
      const o = applyArgs(w.argv.slice(1));
      if (!o.write) continue;
      const texts = o.files.length ? o.files.map(readText) : [stdin()];
      for (const t of texts) {
        if (t === null) continue;
        for (const [rel, lines] of diffFiles(t, o.strip)) { const hit = changeHits(path.resolve(base, nativePath(rel)), lines); if (hit) return hit; }
      }
    }
  }
  return null;
}

// ---- git's path-restoring and removing verbs (audit 2026-10-30 HK-18) ------------------------------------------------
// `git checkout <rev> -- <config>` / `git restore --source <rev> <config>` replace the file with another version - judged
// on that version against the file as it stands, the file tool's rule - and `git rm` / `git mv` remove it (a `mv` onto a
// config replaces it). A folder pathspec reaches the configs directly inside it. A version git cannot show passes: the
// checkout fails the same way.
let gitSafe = null;
try { ({ gitSafe } = require('./hook-prelude.js')); } catch { gitSafe = null; }
if (!gitSafe) gitSafe = (argv, opts = {}) => ['git', ['-c', 'core.fsmonitor=false', ...argv], { ...opts, env: { ...(opts.env || process.env), GIT_OPTIONAL_LOCKS: '0' } }];
const isConfigBase = (base) => WHOLE_FILE.some((re) => re.test(base)) || KEYED.some((k) => k.file.test(base)) || base === 'package.json';
function configsAt(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { return []; }
  if (!st.isDirectory()) return isConfigBase(path.basename(abs)) ? [abs] : [];
  let names = [];
  try { names = fs.readdirSync(abs); } catch { names = []; }
  return names.filter(isConfigBase).map((n) => path.join(abs, n));
}
function removedHit(abs) {
  const base = path.basename(abs);
  if (WHOLE_FILE.some((re) => re.test(base))) return { abs, why: `the command removes it - ${WHOLE_WHY}` };
  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch { text = ''; }
  const keyed = KEYED.find((k) => k.file.test(base));
  if (keyed && keyPairs(text, keyed)) return { abs, why: 'the command removes a file holding strictness / warning settings' };
  const pkg = base === 'package.json' ? jsonOf(abs) : null;
  if (pkg && Object.keys(PKG_KEYS).some((k) => pkg[k] !== undefined)) return { abs, why: 'the command removes package.json, which holds a config key' };
  return null;
}
function restoredHit(abs, dir, rev) {
  let before = '';
  try { before = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const rel = path.relative(dir, abs).split(path.sep).join('/');
  let after;
  try {
    after = require('child_process').execFileSync(...gitSafe(['-C', dir, 'show', `${rev || ''}:./${rel}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }));
  } catch { return null; }
  if (after === before) return null;
  const base = path.basename(abs);
  if (WHOLE_FILE.some((re) => re.test(base))) {
    return ESLINT_FILE.test(base) && severitiesOnlyRise(before, after, base) ? null : { abs, why: `the command restores another version of it - ${WHOLE_WHY}` };
  }
  if (base === 'package.json') return pkgChange(before, after, abs);
  const keyed = KEYED.find((k) => k.file.test(base));
  if (!keyed || keyPairs(before, keyed) === keyPairs(after, keyed)) return null;
  const tightens = keyed === KEYED[1] ? onlyTightens(before, after, keyed) : tsOnlyTightens(before, after, keyed);
  return tightens ? null : { abs, why: 'the version it restores changes a strictness / warning setting' };
}
const GIT_PATH_VERBS = new Set(['checkout', 'restore', 'rm', 'mv']);
function judgeGitVerbs(command) {
  if (!/\bgit\b/.test(command) || !/\b(?:checkout|restore|rm|mv)\b/.test(command)) return null;
  let read;
  try { read = shell.gitText(command, CWD); } catch { return null; }
  for (const call of read.calls) {
    if (!GIT_PATH_VERBS.has(call.sub)) continue;
    const dir = read.callDir(call);
    const at = (p) => path.resolve(dir, nativePath(p));
    const argv = call.argv;
    const dashes = argv.indexOf('--');
    const pos = (arr) => arr.filter((a) => !a.startsWith('-'));
    if (call.sub === 'rm' || call.sub === 'mv') {
      if (argv.some((a) => a === '-n' || a === '--dry-run')) continue;
      const words = dashes >= 0 ? [...pos(argv.slice(0, dashes)), ...argv.slice(dashes + 1)] : pos(argv);
      const sources = call.sub === 'mv' ? words.slice(0, -1) : words;
      for (const s of sources) for (const abs of configsAt(at(s))) { const hit = removedHit(abs); if (hit) return hit; }
      if (call.sub === 'mv' && words.length >= 2) {
        const dest = at(words[words.length - 1]);
        if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory() && isConfigBase(path.basename(dest))) { const hit = removedHit(dest); if (hit) return hit; }
      }
      continue;
    }
    let rev = null;
    let paths = [];
    if (call.sub === 'restore') {
      const staged = argv.some((a) => a === '--staged' || a === '-S');
      if (staged && !argv.some((a) => a === '--worktree' || a === '-W')) continue; // the index only
      for (let i = 0; i < argv.length && (dashes < 0 || i < dashes); i++) {
        const m = /^(?:--source=|-s)(.+)$/.exec(argv[i]);
        if (argv[i] === '-s' || argv[i] === '--source') rev = argv[++i]; else if (m) rev = m[1];
      }
      const valued = new Set(['-s', '--source']);
      const before = [];
      for (let i = 0; i < (dashes >= 0 ? dashes : argv.length); i++) { if (valued.has(argv[i])) { i++; continue; } if (!argv[i].startsWith('-')) before.push(argv[i]); }
      paths = dashes >= 0 ? [...before, ...argv.slice(dashes + 1)] : before;
    } else {
      if (argv.some((a) => /^-[bB]$|^--orphan$|^-p$|^--patch$/.test(a))) continue;
      const before = pos(dashes >= 0 ? argv.slice(0, dashes) : argv);
      if (dashes >= 0) { rev = before[0] || null; paths = argv.slice(dashes + 1); }
      else if (before.length >= 2) { rev = before[0]; paths = before.slice(1); }
      else if (before.length === 1 && configsAt(at(before[0])).length && !fs.statSync(at(before[0])).isDirectory()) paths = before;
    }
    for (const p of paths) for (const abs of configsAt(at(p))) { const hit = restoredHit(abs, dir, rev); if (hit) return hit; }
  }
  return null;
}
// A keyword-less in-place edit names no key, yet `sed -i '3s/true/false/' tsconfig.json` flips one (audit 2026-10-20, the
// hooks track's minor list). Each `s` script the command carries - a line or /regex/ address (a range of either) and a
// substitution, sed's basic syntax unless -E / -r - is applied to the file in memory, and the edit is judged on the
// pairs it leaves, the file tool's rule. A script this reader cannot apply is left to the keyword rule, as before.
function inPlaceWeakens(command, abs, keyed) {
  let before = '';
  try { before = fs.readFileSync(abs, 'utf8'); } catch { return false; }
  if (!keyPairs(before, keyed)) return false;
  const ere = /(?:^|\s)-(?:[a-zA-Z]*[Er][a-zA-Z]*)\b/.test(command) || /\bperl\b/.test(command);
  const toJs = (re) => (ere ? re : re.replace(/\\([(){}+?|])|([(){}+?|])/g, (m, esc, bare) => (esc ? esc : `\\${bare}`)));
  const repl = (r) => r.replace(/\\(\d)|\\&|&|\$/g, (m, d) => (d ? `$${d}` : m === '\\&' ? '&' : m === '&' ? '$&' : '$$'));
  const addr = '(\\d+|\\$|\\/(?:[^/\\\\]|\\\\.)*\\/)';
  const SCRIPT = new RegExp(`^${addr}?(?:,${addr})?\\s*s([/|#,:@!])((?:(?!\\3)[^\\\\]|\\\\.)*)\\3((?:(?!\\3)[^\\\\]|\\\\.)*)\\3([gip0-9]*)$`);
  const words = (command.match(/'[^']*'|"(?:[^"\\]|\\.)*"|\S+/g) || []).map((w) => w.replace(/^['"]|['"]$/g, ''));
  let text = before;
  let applied = 0;
  for (const w of words) {
    for (const part of w.split(/;\s*/)) {
      const m = SCRIPT.exec(part.trim());
      if (!m) continue;
      let pat; let from = null; let to = null;
      try {
        pat = new RegExp(toJs(m[4]), `${m[6].includes('g') ? 'g' : ''}${/[iI]/.test(m[6]) ? 'i' : ''}`);
        const at = (a) => (a === undefined ? null : /^\d+$/.test(a) ? Number(a) : a === '$' ? Infinity : new RegExp(toJs(a.slice(1, -1))));
        from = at(m[1]); to = at(m[2]);
      } catch { return false; }
      const lines = text.split('\n');
      let inRange = false;
      const hit = (spec, i, line) => (typeof spec === 'number' ? (spec === Infinity ? i === lines.length - 1 : i + 1 === spec) : spec.test(line));
      text = lines.map((line, i) => {
        let on;
        if (from === null) on = true;
        else if (to === null) on = hit(from, i, line);
        else { if (!inRange && hit(from, i, line)) { inRange = true; on = true; } else if (inRange) { on = true; if (hit(to, i, line)) inRange = false; } else on = false; }
        return on ? line.replace(pat, repl(m[5])) : line;
      }).join('\n');
      applied += 1;
    }
  }
  if (!applied || keyPairs(before, keyed) === keyPairs(text, keyed)) return false;
  return !(keyed === KEYED[1] ? onlyTightens(before, text, keyed) : tsOnlyTightens(before, text, keyed));
}
function judgeShell() {
  let command = String((payload.tool_input || {}).command || '');
  // PowerShell's path separator is the backslash (its escape is the backtick): `.\.eslintrc.json` kept it and named
  // no config on a POSIX host (audit 2026-10-08).
  if (/^PowerShell$/i.test(String(payload.tool_name || ''))) command = command.replace(/\\/g, '/');
  return judgeScan(command) || judgeSegments(command);
}
function judgeSegments(command) {
  for (const seg of segments(command)) {
    const toks = (seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) || []);
    const verb = unq(toks[0] || '').toLowerCase();
    const inPlace = (verb === 'sed' && toks.some((t) => /^-i/.test(t))) || (verb === 'perl' && toks.some((t) => /^-\w*i/.test(t)));
    for (let i = 1; i < toks.length; i++) {
      const redirected = /^\d?>>?$/.test(toks[i - 1]) || /^\d?>>?[^>&]/.test(toks[i]);
      const name = unq(toks[i].replace(/^\d?>>?/, ''));
      const base = path.basename(name);
      const whole = WHOLE_FILE.some((re) => re.test(base));
      const keyed = KEYED.find((k) => k.file.test(base));
      if (!whole && !keyed) continue;
      // a copy writes only its LAST operand; every other verb here writes what it names
      const written = redirected || inPlace || WRITE_VERB.has(verb) || (COPY_VERB.has(verb) && i === toks.length - 1);
      if (!written) continue;
      if (!whole && !KEY_WORDS.test(command)) continue;
      const abs = resolveIn(name);
      if (fs.existsSync(abs)) return { abs, why: whole ? WHOLE_WHY : 'the command names a strictness / warning setting' };
    }
  }
  return null;
}

// SHELL ROUTE: which tools carry a shell command (Bash, PowerShell, Monitor) is shell-writes.js's one list; a
// copy that runs before that module lands judges the file tools alone.
const hit = shell && shell.isShellTool(payload.tool_name) ? judgeShell() : judgeFileTool();
if (!hit) process.exit(0);

// Both sides as REAL paths: the same file spelled through a symlinked root read as outside and passed (audit 2026-10-08).
// A file not created yet resolves through its deepest existing folder, the rest re-attached: left as spelled, a short 8.3
// parent (RUNNER~1) or a symlinked one read as outside a root that resolved long, and a new shadowing config passed (3.6.0 CI).
const real = (p) => {
  const abs = path.resolve(p);
  const rest = [];
  for (let dir = abs; ;) {
    try { return path.join(fs.realpathSync.native(dir), ...rest); } catch { /* keep climbing */ }
    const up = path.dirname(dir);
    if (up === dir) return abs;
    rest.unshift(path.basename(dir));
    dir = up;
  }
};
const rel = path.relative(real(ROOT), real(hit.abs)).split(path.sep).join('/');
if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0); // outside the project - the cross-project guard owns it

// 2.8.0: an ALLOW receipt lives in <data root>/state/approvals/ (layout.js); the pre-2.8.0 flow/ one is still read for the
// 2.x line, and is the only path when layout.js is not beside this file.
let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the pre-2.8.0 flow/ */ }
const receipt = layout ? layout.findState(ROOT, 'approvals', 'CONFIG-EDIT-ALLOW') : path.resolve(ROOT, docsRootEnv(), 'flow', 'CONFIG-EDIT-ALLOW');
// A workflow receipt, not a security one (the plan's HK-03 ruling): no answer binding, but this session's own (HK-16,
// hook-prelude.js readReceiptFile) - a `session:` line naming the call's session, under 8h, not older than the transcript.
// No prelude, no reader: shut.
let receipts = null;
try { receipts = require('./hook-prelude.js'); } catch { receipts = null; }
const held = receipts && receipts.readReceiptFile ? receipts.readReceiptFile(receipt, payload) : null;
const allowed = Boolean(held && held.live) && (held.lines.includes('*') || held.lines.some((l) => l === rel || l === path.basename(rel)));
if (allowed) process.exit(0);

global.BLOCK_DETAIL = { file: rel, why: hit.why };
const receiptRel = path.relative(ROOT, layout ? layout.statePath(ROOT, 'approvals', 'CONFIG-EDIT-ALLOW') : receipt).split(path.sep).join('/');
const writeLines = (lines) => (receipts && receipts.receiptLinesText ? receipts.receiptLinesText(payload, lines) : lines.map((l) => `  ${l}\n`).join(''));
const shut = held && !held.live ? `The receipt at ${receiptRel} is not honoured: ${held.why}. Rewrite it only on a fresh answer.\n` : '';
process.stderr.write(
  (hit.shadow
    ? `Blocked: a new ${rel} counts as an edit of ${hit.shadow} - ${hit.why}, so it changes that check.\nWeakening a check to get a green result is not a fix -\n`
    : `Blocked: ${rel} already exists and ${hit.why}. Weakening a check to get a green result is not a fix -\n`) +
  `go back to the code the check flagged (habits-done-gate, step 4: 'Fix the cause - never suppress\n` +
  `a warning, weaken a test, or stub code to go green').\n\n` +
  `If the TASK is this config (the user asked for the rule change), do not decide for them: end this turn\n` +
  `with ONE AskUserQuestion carrying, in this order -\n` +
  `  'Fix the code instead (Recommended)' - leave the check as it is\n` +
  `  'Allow this config change' - the user wants the check itself changed\n` +
  `On 'Allow', write the receipt ${receiptRel} with exactly these lines and retry the SAME call:\n` +
  writeLines([rel]) +
  `It is honoured for this session only, under 8h. Creating a config passes untouched unless it shadows one that exists.\n` +
  shut,
);
process.exit(2);
