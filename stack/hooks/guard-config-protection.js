#!/usr/bin/env node
// guard-config-protection.js - PreToolUse (Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Monitor).
// The cheapest way to 'pass' a lint or a build is to weaken the check, so a change to an EXISTING
// check config is blocked and the model is sent back to the code. Creating one is allowed - there
// is nothing to weaken yet. Two kinds of file: a WHOLE-FILE config (the file IS the check - an
// eslint / prettier / stylelint / biome config, .editorconfig, a .ruleset) and a KEYED one, ordinary
// project config whose strictness lines alone are the check (tsconfig strict flags, the MSBuild
// warning and nullable properties) - there a change that leaves those lines as they were passes.
// 'Allow' is honoured through <docs-path>/flow/CONFIG-EDIT-ALLOW (one path per line as the project
// spells it, a bare file name, or `*`; this session's own, under 8h).
// ALFRED_CODE_CONFIG_PROTECT=0 switches the gate off. The shell route reads the writes through shell-writes.js's
// scanShell (wrappers, carried scripts, a cd's anchor), then its own segment parser for the PowerShell verbs.
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

// The docs root env value, ALFRED_CODE_DOCS_PATH (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';

// Git Bash / MSYS spell a Windows path in POSIX mount form; translate before any resolution.
// The translation is shell-writes.js's one home (2.1.5 M8); without the module a path is taken as written.
let nativePath = (p) => String(p);
try { ({ nativePath } = require(path.join(__dirname, 'shell-writes.js'))); } catch { /* an install without it */ }

// Whole-file protection: the file IS the check - and so is a linter's or formatter's ignore file, whose one new line
// takes a path out of the check (audit 2026-10-08).
const WHOLE_FILE = [
  /^\.editorconfig$/, /^\.globalconfig$/, /\.ruleset$/, /^stylecop\.json$/,
  /^\.eslintrc(\.(js|cjs|mjs|json|ya?ml))?$/, /^eslint\.config\.[cm]?[jt]s$/,
  /^\.prettierrc(\.(js|cjs|mjs|json|ya?ml|toml))?$/, /^prettier\.config\.[cm]?[jt]s$/,
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
    pair: /"(strict\w*|alwaysStrict|noImplicit\w+|noUnused\w+|noUncheckedIndexedAccess|noFallthroughCasesInSwitch|noPropertyAccessFromIndexSignature|exactOptionalPropertyTypes|useUnknownInCatchVariables|allowUnreachableCode|allowUnusedLabels|skipLibCheck)"\s*:\s*("[^"]*"|[^,}\s]+)/g,
    key: (m) => `${m[1]}=${m[2].trim()}` },
  { file: /^(Directory\.Build\.(props|targets)|.+\.(cs|fs|vb)proj)$/, strip: (s) => s.replace(/<!--[\s\S]*?(?:-->|$)/g, ' '),
    pair: /<(TreatWarningsAsErrors|WarningsAsErrors|WarningsNotAsErrors|WarningLevel|NoWarn|Nullable|AnalysisLevel|AnalysisMode|EnforceCodeStyleInBuild)\b([^>]*)>([^<]*)<\/\1\s*>/g,
    key: (m) => `${m[1]}${m[2].trim() ? `[${m[2].trim().replace(/\s+/g, ' ')}]` : ''}=${m[3].trim()}` },
];
const KEY_WORDS = /strict|noImplicit|noUnused|noUnchecked|noFallthrough|noPropertyAccess|allowUnreachable|allowUnused|useUnknownInCatch|exactOptional|skipLibCheck|NoWarn|WarningsAsErrors|WarningsNotAsErrors|WarningLevel|Nullable|AnalysisLevel|AnalysisMode|EnforceCodeStyle/;
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
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                        ts: new Date().toISOString(),
                        hook: path.basename(__filename),
                        event: payload.hook_event_name || payload.tool_name || '',
                        tool: payload.tool_name || '',
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
  if (!fs.existsSync(abs)) return null; // creation - there is nothing to weaken yet
  const base = path.basename(abs);
  if (WHOLE_FILE.some((re) => re.test(base))) return { abs, why: WHOLE_WHY };
  const keyed = KEYED.find((k) => k.file.test(base));
  if (!keyed) return null;
  const edits = Array.isArray(ti.edits) ? ti.edits : [{ old_string: ti.old_string, new_string: ti.new_string, replace_all: ti.replace_all }];
  const whole = typeof ti.content === 'string';
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  // An edit is judged on the WHOLE file it leaves: a fragment can cut a setting in half (`<TreatWarningsAsErrors>` ->
  // `<TreatWarningsAsErrors Condition="false">` names no closing tag, so neither side read a pair - audit 2026-10-08).
  // An old_string the file does not hold falls back to the fragments, the edit Claude Code will refuse anyway.
  let applied = whole ? ti.content : text;
  for (const e of whole ? [] : edits) {
    const o = e && typeof e.old_string === 'string' ? e.old_string : '';
    if (!o || !applied.includes(o)) { applied = null; break; }
    const n = e && typeof e.new_string === 'string' ? e.new_string : '';
    applied = e.replace_all ? applied.split(o).join(n) : applied.replace(o, () => n);
  }
  const before = applied !== null ? text : edits.map((e) => (e && e.old_string) || '').join('\n');
  const after = applied !== null ? applied : edits.map((e) => (e && e.new_string) || '').join('\n');
  return keyPairs(before, keyed) === keyPairs(after, keyed) ? null : { abs, why: 'the change touches a strictness / warning setting' };
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
  for (const t of scan.targets) {
    const raw = scan.expandVars(String(t.raw || ''));
    if (!raw || shell.isVar(raw)) continue;
    const base = path.basename(raw);
    const whole = WHOLE_FILE.some((re) => re.test(base));
    const keyed = KEYED.find((k) => k.file.test(base));
    if (!whole && !keyed) continue;
    const anchor = shell.anchorAt(scan.cds, t.index, CWD, norm);
    if (anchor === null && !path.isAbsolute(nativePath(raw))) continue; // relative from an unknown anchor
    const abs = path.resolve(anchor || CWD, nativePath(raw));
    if (!fs.existsSync(abs)) continue;
    if (whole) return { abs, why: WHOLE_WHY };
    if (t.what === 'an in-place edit' || t.verb === 'interpreter') {
      if (KEY_WORDS.test(command)) return { abs, why: 'the command names a strictness / warning setting' };
      continue;
    }
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { text = ''; }
    if (keyPairs(text, keyed)) return { abs, why: 'the command replaces or removes a file holding strictness / warning settings' };
  }
  return null;
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
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const rel = path.relative(real(ROOT), real(hit.abs)).split(path.sep).join('/');
if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0); // outside the project - the cross-project guard owns it

const receipt = path.resolve(ROOT, docsRootEnv(), 'flow', 'CONFIG-EDIT-ALLOW');
const allowed = (() => {
  try {
    const st = fs.statSync(receipt);
    let sessionStartMs = 0;
    try {
      const tr = fs.statSync(String(payload.transcript_path || ''));
      sessionStartMs = tr.birthtimeMs && tr.birthtimeMs !== tr.ctimeMs ? tr.birthtimeMs : 0;
    } catch { sessionStartMs = 0; }
    if (Date.now() - st.mtimeMs > 8 * 60 * 60 * 1000 || (sessionStartMs && st.mtimeMs < sessionStartMs)) return false;
    const lines = fs.readFileSync(receipt, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return lines.includes('*') || lines.some((l) => l === rel || l === path.basename(rel));
  } catch { return false; }
})();
if (allowed) process.exit(0);

global.BLOCK_DETAIL = { file: rel, why: hit.why };
const receiptRel = path.relative(ROOT, receipt).split(path.sep).join('/');
process.stderr.write(
  `Blocked: ${rel} already exists and ${hit.why}. Weakening a check to get a green result is not a fix -\n` +
  `go back to the code the check flagged (habits-done-gate, step 4: 'Fix the cause - never suppress\n` +
  `a warning, weaken a test, or stub code to go green').\n\n` +
  `If the TASK is this config (the user asked for the rule change), do not decide for them: end this turn\n` +
  `with ONE AskUserQuestion carrying, in this order -\n` +
  `  'Fix the code instead (Recommended)' - leave the check as it is\n` +
  `  'Allow this config change' - the user wants the check itself changed\n` +
  `On 'Allow', write the receipt ${receiptRel} with the line \`${rel}\` and retry the SAME call. It is\n` +
  `honoured for this session only, under 8h. Creating a config that does not exist yet passes untouched.\n`,
);
process.exit(2);
