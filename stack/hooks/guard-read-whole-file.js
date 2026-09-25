#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate (matchers: Read + Bash): enforce baseline-navigation.md's hard rule - "Read
// is for code you've ALREADY located, never to find a symbol." Blocks a whole-file Read of a
// large source file so navigation goes through serena (get_symbols_overview -> find_symbol)
// first; on Bash it blocks the same dump routed around the Read tool (a bare `cat file.ts` -
// measured: one session cat-ed the exact file the Read matcher had blocked, unblocked, and a
// 47-file grep loop dumped ~19.8k tokens the guard never saw). It also caps CUMULATIVE ranged
// reads per file per session: 2-3 half-splits that reconstruct the whole file satisfied the
// per-call check in 7 files across one run with zero counter-examples, so past ~60% coverage
// the remainder goes through serena. A cat whose output is redirected into a file is a copy,
// not a dump, and passes. exit 2 = block (stderr fed back); exit 0 = allow.
const fs = require('fs');
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.claude/docs';
const os = require('os');
const pathMod = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('guard-read-whole-file')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // unparseable stdin - don't block
}
if (!payload || typeof payload !== 'object') process.exit(0); // a JSON scalar/null - nothing to judge

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
  process.exit = (code) => {
    if (code === 2) {
      try {
        const fs = require('fs');
        const path = require('path');
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
      } catch { /* telemetry is never allowed to break the gate */ }
    }
    exit(code);
  };
})();
const GATED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)$/;
// Same extensions, unanchored - a sweep command names its files inside a glob or a loop body,
// never as the string's own tail, so the anchored form above can never match a command line.
const GATED_EXT_ANY = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html)\b/i;
// The SWEEP branch adds `md`. A loop over every SKILL.md in an install is the single most measured
// dump shape in the collection - 84.1KB from 35 files in one call, 120KB from 46 in another, and
// the only thing that stopped either was the harness's own persisted-output cap. Markdown is not
// symbol-navigable, so the single-file size check below deliberately still ignores it: one named
// `.md` file is a fine read, thirty-five of them in a loop is not.
const SWEEP_EXT_ANY = /\.(ts|tsx|js|jsx|mjs|cjs|cs|go|razor|cshtml|xaml|html|md)\b/i;
// Small files are cheap to read whole. 200, not 100: measured across four real
// sessions (315 blocks), ~71% of blocks hit 100-200-line files where the forced
// serena detour costs about what the whole-file read would - the guard only pays above 200.
const THRESHOLD = 200;
const lineCountOf = (p) => {
  // Lines, not newline-split pieces: a final newline ends the last line, it does not start another -
  // counted as one, a 200-line file sat one over the threshold it is on.
  try { const t = fs.readFileSync(p, 'utf8'); return t ? t.replace(/\n$/, '').split('\n').length : 0; } catch { return 0; }
};
// Resolve a possibly-relative path the way the session sees it. The hook subprocess's own
// cwd is NOT the Bash tool's persisted cwd (a prior `cd` in another call moves it), so a bare
// relative path must be anchored - same anchor the sibling hooks use (measured: 10 relative
// `cat -n` dumps after a `cd` all resolved ENOENT -> lineCount 0 -> the guard silently passed
// ~20k tokens of whole-file dumps; reproduced: the same payload blocks from the project root).
const anchorDirs = [process.env.CLAUDE_PROJECT_DIR, payload.cwd, process.cwd()].filter(Boolean);
// A `cd <dir> &&` at the head of the command moves the anchor for everything after it, and a
// relative target then resolves nowhere - which failed CLOSED and denied the call. Add every
// literal `cd` target as one more candidate anchor; a variable or `-` target is unfollowable and
// simply contributes nothing. The sibling cross-project guard tracks the same thing positionally.
const CD_VERB = 'set-location|push-location|chdir|pushd|cd|sl';
const CD_RE = new RegExp(`(?:^|&&|\\|\\||;|\\n|\\(|\\|)\\s*(?:${CD_VERB})\\s+(?:-(?:literal)?path\\s+)?("[^"]+"|'[^']+'|[^\\s;|&()]+)`, 'gi');
// `$VAR` / `${VAR}` that this hook cannot see through. The sibling guard's rule, applied here for
// the same reason: 6 of 12 measured denials in one project named a `$R/...` target, and judging a
// path whose value is unknown is guessing, not gating.
const isVar = (s) => /\$\{?[A-Za-z_]/.test(s);
// A `VAR=value` set in the SAME command is knowable - expand those before giving up on a target.
const assignsOf = (cmd) => {
  const m = new Map();
  for (const a of String(cmd).matchAll(/(?:^|&&|\|\||;|\n|\s)([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]+)/g))
    m.set(a[1], a[2].replace(/^["']|["']$/g, ''));
  return m;
};
const expandWith = (assigns, s) => String(s).replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g,
  (m, br, bare) => (assigns.has(br || bare) ? assigns.get(br || bare) : m));
// Git Bash / MSYS spell a Windows path in POSIX MOUNT form (`/c/Users/...`, `/cygdrive/c/...`),
// which node on win32 resolves against the CURRENT drive instead - the same falsehood that made
// the cross-project guard block a session's own temp cleanup. Translate before resolving; off
// Windows the spelling is a real POSIX path and is never touched.
const MOUNT_RE = /^(?:\/cygdrive)?\/([A-Za-z])(?=\/|$)/;
const nativePath = (p) => (process.platform === 'win32'
  ? String(p).replace(MOUNT_RE, (m, d) => `${d.toUpperCase()}:\\`)
  : String(p));
const resolveLineCount = (raw) => {
  const p = nativePath(raw);
  if (pathMod.isAbsolute(p)) return { lc: lineCountOf(p), resolved: true };
  for (const d of anchorDirs) {
    const abs = pathMod.join(d, p);
    if (fs.existsSync(abs)) return { lc: lineCountOf(abs), resolved: true };
  }
  return { lc: 0, resolved: false };
};
// The three trees the installers seed into serena's OWN `ignored_paths` (.serena/project.yml):
// serena cannot index them, so naming its tools for a path under one of them hands the model a
// remedy that errors. Measured twice - the denial named serena for a `.claude/...` path and the
// redirect the model made from it failed. The ranged read is the remedy there.
const SERENA_IGNORED = /(?:^|[\\/])\.(?:claude|serena|playwright)(?:[\\/]|$)/;
// The hint must be EXECUTABLE, not just correct. serena's tools are deferred behind tool search in
// this harness, so naming them is not having them: measured, two sessions carried the rule text
// saying exactly that and still made 100 Bash calls and 0 serena calls. The loading call goes in
// the denial itself, where the model is already looking for what to do instead.
const LOAD_SERENA = `  ToolSearch select:mcp__plugin_serena_serena__get_symbols_overview,mcp__plugin_serena_serena__find_symbol,mcp__plugin_serena_serena__find_referencing_symbols\n`;
const serenaHint = (p) => (SERENA_IGNORED.test(String(p))
  ? `serena cannot locate anything here: the installers seed \`.claude\` / \`.serena\` / \`.playwright\` into\n`
    + `its own ignored_paths, so this tree is not indexed. Locate inside the file instead:\n`
    + `  grep -n '<pattern>' '${p}'   ->  then Read with offset+limit on the lines it names.`
  : `Locate first with serena. If those tools are not loaded in this session, load them first:\n` +
  LOAD_SERENA +
  `then get_symbols_overview('${p}') and find_symbol(...),\n` +
  `then Read with offset+limit on the returned range (find_symbol with include_body=true only for a SMALL symbol;\n` +
  `for a large body fetch it without the body first, then Read the range you need).`);

const input = payload.tool_input || {};

// A heredoc body is DATA, not shell: a plan or checklist that merely DESCRIBES a dangerous command
// is inert text, and matching it blocks a document write for its own prose (reproduced). Blank the
// payload spans, keeping the character count so any index into the command still holds.
const stripHeredocsOf = (c) => c.replace(
  /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
  (m) => m.replace(/[^\n]/g, ' '),
);
// One per-session state file, shared by the cumulative read cap and the convention-rule announcer.
const sessionStateFile = () => pathMod.join(os.tmpdir(), `guard-read-${(payload.session_id || 'nosession').replace(/[^\w-]/g, '')}.json`);

// The nine path-scoped convention rules attach on a FILE-TOOL touch and on nothing else. Under a
// Bash-first working mode they therefore never attach at all: measured with a control for the first
// time, 19 Bash calls naming `.cs` files produced 0 attachments, while the session's single
// Read-tool call on a `.cs` file attached BOTH `.cs`-scoped rules 0.94 s later - so the C# rule was
// absent for the whole DESIGN, PLAN and GATE phase of a C# build. Corroborated at 0 attaches over
// 123 `.md` write targets and 54 authored docs. This hook already runs on every Bash call and
// already parses the extension, so it is the one place that can close the gap: it names the rule
// that governs the file, ONCE per rule per session, as non-blocking additionalContext.
const CONVENTION_RULES = [
  [/\.Designer\.cs\b|\w*Form(\.[^\s\/]+)?\.cs\b/, 'winforms-conventions.md'], // twin of the rule's paths (Designer + *Form.cs + *Form.*.cs); case-SENSITIVE so Platform.cs / Transform.cs stay plain C#
  [/\.cs\b/i, 'csharp-conventions.md'],
  [/\.xaml\b/i, 'wpf-conventions.md'],
  // Twin of the rule's own `paths:`. The suffixes are the pre-v20 spelling; the directory shapes are
  // the current one - the Angular style guide now recommends suffix-less names, and the rule matches
  // `**/src/app/**/*.ts` for exactly that reason, so a write to `src/app/user-profile.ts` was being
  // announced as typescript-conventions.md alone.
  [/\.(component|service|directive|pipe|guard|resolver|module|routes)\.ts\b|(?:^|[\s"'=\/])src\/(?:app|lib)\/[^\s"';|&]*\.tsx?\b/i, 'angular-conventions.md'],
  [/\.(component|global)\.(scss|css)\b|\bstyles\.(scss|css)\b/i, 'angular-styling-conventions.md'],
  [/\.tsx?\b/i, 'typescript-conventions.md'],
  [/\.(jsx?|mjs|cjs)\b/i, 'javascript-conventions.md'],
  [/\.sql\b/i, 'sql-conventions.md'],
  [/\bDockerfile\b|\b(docker-)?compose[^\s]*\.ya?ml\b|\.github\/workflows\/[^\s]+\.ya?ml\b/i, 'devops-conventions.md'],
  [/(?:^|\/)SKILL\.md$|(?:^|\/)skills\/\S*\.md$/, 'skill-authoring.md'], // twin of the rule's paths: **/SKILL.md + **/skills/**/*.md, case-sensitive, no .bak
  [/\.md\b/i, 'markdown-docs.md'],
];
// The announcement is HELD until the call is allowed, and only then marked as said: a denial and an
// injection are two different answers to the same tool call, and a rule announced into a turn that
// was blocked would be spent on a command that never ran.
// A command that only READS governed files does not need the rule - and worse, announcing there
// SPENDS it: the announcement is once per rule per session, so an inventory `sed -n '1,20p'` over
// every SKILL.md marked markdown-docs said, and the authoring Write minutes later got nothing.
// Measured twice, on an `awk | head -c 900` and on a `sed -n '1,20p'` loop, each re-paid across
// the following messages. So: a write verb or a redirection into a file, or no announcement.
// And the extension is read off the write TARGET, never off the command line: matching anywhere in
// the text named javascript-conventions.md for `node <installer>/stamp-compare.js > out.txt` - the
// EXECUTED script, not a write - in 3 of 5 measured bundles, and `2>/dev/null` on a read-only `find`
// tested TRUE as 'a redirection into a path' and spent the once-per-session announcement.
const shellWordsOf = (s) => {
  const out = [];
  let cur = ''; let q = null; let started = false;
  for (let i = 0; i < String(s).length; i++) {
    const c = String(s)[i];
    if (q) { if (c === q) q = null; else cur += c; started = true; continue; }
    if (c === '"' || c === '\'') { q = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    cur += c; started = true;
  }
  if (started) out.push(cur);
  return out;
};
// A sed/perl SCRIPT is an argument, not a path - `sed -i '' 's/a/b/' f.cs` names ONE target.
const SED_SCRIPT_ARG = /^(?:[sy]\/|\/.*\/[a-z]*$|\d*,?\$?[dpq=]$)/;
const RUN = '[^|;&\\n]*';
function writeTargets(text) {
  const out = [];
  const add = (t) => {
    const v = String(t).replace(/^["']|["']$/g, '');
    if (v && !v.startsWith('-') && !SED_SCRIPT_ARG.test(v) && !out.includes(v)) out.push(v);
  };
  const words = (s) => shellWordsOf(s).forEach(add);
  // stdout into a path. A leading fd (`2>`, `&>`) and an fd target (`>&2`) are not a file write.
  for (const m of text.matchAll(/(?:^|[^>&\d])1?>>?\s*(?!&)("[^"]*"|'[^']*'|[^\s;|&()<>]+)/g)) add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\btee\\b(${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:sed|perl)\\b((?=${RUN}\\s-[A-Za-z]*i\\b)${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:cp|mv|install|rsync)\\b(${RUN})`, 'g'))) {
    const w = shellWordsOf(m[1]).filter((x) => x && !x.startsWith('-'));
    if (w.length) add(w[w.length - 1]); // the DESTINATION is the write; the source is a read
  }
  for (const m of text.matchAll(new RegExp(`\\b(?:touch|patch)\\b(${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(new RegExp(`\\bgit\\s+(?:apply|checkout|restore|mv)\\b(${RUN})`, 'g'))) words(m[1]);
  for (const m of text.matchAll(/(?:writeFileSync|appendFileSync)\s*\(\s*(["'][^"']*["'])/g)) add(m[1]);
  for (const m of text.matchAll(/\bopen\s*\(\s*(["'][^"']*["'])\s*,\s*["'][wax]/g)) add(m[1]);
  return out;
}
// A rule that is not INSTALLED cannot be read: one measured bundle was told to read
// `javascript-conventions.md` in a project that has no JS and never installed that rule. The hook's
// own sibling directory is the install's rules dir (`.claude/hooks/` -> `.claude/rules/`); with no
// rules directory anywhere this cannot be told, and the announcement is made rather than dropped.
const ruleInstalled = (rule) => {
  let known = false;
  for (const d of [pathMod.join(__dirname, '..', 'rules'), ...anchorDirs.map((a) => pathMod.join(a, '.claude', 'rules'))]) {
    if (!fs.existsSync(d)) continue;
    known = true;
    if (fs.existsSync(pathMod.join(d, rule))) return true;
  }
  return !known;
};
// The generated docs root is not governed by markdown-docs.md - the rule's own body says so - and
// neither is the install's own `.claude/` tree, so a `.md` target there names no rule - not even one
// whose pattern its NAME happens to carry (`next.js-upgrade.md`, `Dockerfile.md`): that would spend the
// rule's once-per-session announcement on a docs note. The one exception is skill-authoring.md -
// `.claude/skills/` is where a project keeps its own skills, and a skill file is governed wherever it lives.
// The docs root is RESOLVED, not assumed: hard-coding `.claude/` meant that with
// ALFRED_CODE_DOCS_PATH=docs - the committed-root case the docs-root rule itself describes - a write
// to `docs/architecture/ARCHITECTURE.md` still drew the announcement the rule says does not apply.
const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UNGOVERNED_MD = new RegExp(
  `(?:^|[\\s"'=])(?:\\./)?(?:\\.claude|${escapeRe(docsRootEnv().replace(/^\.\//, '').replace(/\/+$/, ''))})/`);
function announceRules(text) {
  const docsRel = docsRootEnv().replace(/^\.\//, '').replace(/\/+$/, '');
  const ungoverned = (t) => UNGOVERNED_MD.test(` ${t}`) || t.includes('.claude/') || t.includes(`${docsRel}/`);
  const targets = writeTargets(String(text));
  if (!targets.length) return;
  const hit = [];
  for (const t of targets) for (const [re, rule] of CONVENTION_RULES)
    if (re.test(t) && !hit.includes(rule) && !(rule !== 'skill-authoring.md' && /\.md\b/i.test(t) && ungoverned(t))) hit.push(rule);
  if (!hit.length) return;
  let state = {};
  const f = sessionStateFile();
  try { state = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* fresh state */ }
  const said = state.__rules || [];
  const fresh = hit.filter((r) => !said.includes(r) && ruleInstalled(r));
  if (!fresh.length) return;
  const flush = () => {
    try {
      let cur = {};
      try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* fresh state */ }
      cur.__rules = (cur.__rules || []).concat(fresh);
      fs.writeFileSync(f, JSON.stringify(cur));
    } catch { /* best-effort */ }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `This command touches files governed by ${fresh.map((r) => `\`.claude/rules/${r}\``).join(' and ')}. `
          + `A path-scoped rule attaches on a FILE-TOOL touch only, so working through the shell never loads it - `
          + `read the rule and load the house-style skill it names before the next edit to those files.`,
      },
    }));
  };
  const exit = process.exit.bind(process);
  process.exit = (code) => { if (code === 0) flush(); exit(code); };
}

// ---- Shell matcher: a whole-file dump via cat/sed is the Read block routed around ----
// SHELL ROUTE: the PowerShell tool is the same route under a second name - its payload carries
// `tool_input.command` exactly as Bash does, `scripts/analyze-usage.js` has read it as a shell call
// since 34 of 38 test runs in one collection arrived that way, and the hooks docs name the matcher
// `Bash|PowerShell` for it. Judging only `Bash` left this gate open on every Windows session
// (measured: 122 PowerShell calls in a 115-session corpus against six guards matching Bash alone).
const isShellTool = (n) => n === 'Bash' || n === 'PowerShell';
if (isShellTool(payload.tool_name)) {
  // Runs FIRST and on EVERY Bash call, not just the dump verbs: a grep, a build and a test run all
  // name the files whose conventions the session needs, and none of them reaches the checks below.
  try { announceRules(stripHeredocsOf(String((payload.tool_input || {}).command || ''))); } catch { /* an injection never breaks the gate */ }
  // A heredoc body is DATA, not shell: a plan or checklist that merely DESCRIBES a dangerous
  // command is inert text, and matching it blocks a document write for its own prose (reproduced).
  // Blank the payload spans, keeping the character count so any index into the command still holds.
  const command = stripHeredocsOf(String(input.command || ''));
  // Anchors and same-command assignments, computed once for every check below.
  const assigns = assignsOf(command);
  for (const c of command.matchAll(CD_RE)) {
    const target = expandWith(assigns, c[1].replace(/^["']|["']$/g, ''));
    if (target === '-' || isVar(target)) continue;
    const abs = pathMod.isAbsolute(nativePath(target)) ? nativePath(target) : pathMod.join(anchorDirs[0] || process.cwd(), target);
    if (!anchorDirs.includes(abs)) anchorDirs.push(abs);
  }
  // Only `cat`/`sed` were gated, so the same whole-file dump walked through under any other verb:
  // `head -n 100000`, `tail -n +1`, `less`, `awk '1'`, `python3 -c "print(open(f).read())"` all
  // passed (reproduced x5 against a 1371-line file).
  // This pre-filter must name every verb the branches below look for: `readFileSync` / `File.read`
  // were in the runtime-dump pattern but not here, so `node -e "...readFileSync(f)..."` exited on
  // this line and that branch never ran (reproduced against the same 1371-line file).
  // Get-Content / gc / type are the PowerShell route's cat - wired on that tool, and unjudged until now.
  if (!/\bcat\b|\bsed\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\bawk\b|\bopen\(|\breadFileSync\b|File\.read|\bget-content\b|\bgc\b|\btype\b/i.test(command)) process.exit(0);
  // EVERY test below is PER SEGMENT, and the extension is tested against the PATH the verb names -
  // never against the whole command. Testing `GATED_EXT_ANY` against the whole compound command
  // denied a command for an unrelated `*.js` glob sitting in a SIBLING segment (replayed: exit 2;
  // the same command minus that segment exit 0), and the sweep test running above the loop denied
  // an exact-filename `find -name` because a co-located bounded `grep | head -20` shared the line.
  // A path this guard cannot resolve is judged by its own segment, which is the old behaviour
  // narrowed to one segment rather than the whole line.
  const gatedIn = (text) => GATED_EXT_ANY.test(text);

  // Three shapes dumped whole source trees straight past the single-file check below (measured in
  // 5 sessions, 16-23 .cs files each, ~20k tokens a sweep): a shell loop whose cat argument is the
  // loop VARIABLE, a find -exec whose argument is the literal {}, and a multi-file `cat a.cs b.cs`
  // where only the first argument was ever size-checked. None can be size-checked per file.
  // A loop SPANS `;` boundaries by nature, so this one test stays above the segment loop - but the
  // extension is tested against the CONSTRUCT's own text, not the whole line, which is what denied
  // a command for an unrelated glob in a sibling segment. And a `find -name '<literal filename>'`
  // is exempt: no glob metacharacter means it names ONE file - the 'I know the name, not the path'
  // idiom, which falls through to the size check below like any other named target (its own denial
  // text used to advise doing exactly that).
  // The loop's own text ENDS at `done`: `[^\n]*?` ran straight past it, so an unrelated `cat` in a
  // later statement was read as the loop's body. Measured twice at ~88k tokens a block - the
  // capabilities skill's own grep-only loop followed by `; cat .mcp.json` was denied as a sweep.
  const NOT_DONE = '(?:(?!\\bdone\\b)[^\\n])';
  const sweepM = command.match(new RegExp(`\\bfor\\s+\\w+\\s+in\\b${NOT_DONE}*?\\bdo\\b${NOT_DONE}*?\\bcat\\b${NOT_DONE}*`, 'i'))
    || command.match(/\bfind\b[^\n]*?-exec\s+cat\b[^\n]*/i)
    || command.match(/[^\n]*?\|\s*xargs\s+(?:-\w+\s+)*cat\b[^\n]*/i);
  if (sweepM) {
    const sweep = /\bfor\b/i.test(sweepM[0]) ? 'a shell loop over a file list'
      : /-exec/i.test(sweepM[0]) ? 'find -exec cat' : 'xargs cat';
    const namedFind = sweepM[0].match(/-name\s+(["']?)([^"'\s*?\[\]]+)\1(?=\s|$)/);
    // The literal-name exemption rests on 'no glob metacharacter means it names ONE file'. That
    // holds for a source file and fails completely for `-name SKILL.md`, which names one file per
    // skill directory - 35 of them in the measured dump, 46 in the next. So the exemption does not
    // cover markdown: a repeated literal `.md` name across a tree is the sweep, not the idiom.
    const namedOne = namedFind && !/\.md\b/i.test(namedFind[2] || '');
    if (!namedOne && SWEEP_EXT_ANY.test(sweepM[0])) {
      process.stderr.write(
        `Blocked: whole-file sweep of source files via ${sweep}.\n` +
        `Every file in the sweep is dumped unchecked - the per-file size gate cannot see a loop\n` +
        `variable or a find placeholder. Per baseline-navigation.md, locate what you need first\n` +
        `(serena find_symbol / get_symbols_overview, or grep -n for a pattern), then read only the\n` +
        `ranges that matter. If you genuinely need one whole small file, cat it by name. The serena\n` +
        `tools are DEFERRED - load them first:\n` + LOAD_SERENA,
      );
      process.exit(2);
    }
  }
  for (const seg of command.split(/&&|\|\||;|\n/)) {
    if (/\|\s*(head|tail|sed|grep|rg|wc|awk|cut|select-object|select|select-string|sls|measure-object|measure|findstr)\b/i.test(seg)) continue;
    // Output redirected INTO a file never reaches the context - `cat a.ts > copy.ts` is a copy,
    // not a dump (an fd form like `2>&1` / `>&2` still prints, so only a path target is exempt).
    if (/\s>>?\s*[^&\s>]/.test(seg)) continue;

    // A whole-file read through a language runtime is the same dump with a different spelling.
    const rtCall = seg.match(/\b(?:python3?|node|perl|ruby)\b[^\n]*?\b(?:open\(\s*(["'][^"']*["'])[^)]*\)\s*\.read\(|(?:readFileSync|File\.read)\(\s*(["'][^"']*["']))/);
    if (rtCall && gatedIn(rtCall[1] || rtCall[2] || seg)) {
      // This branch used to block on the extension ALONE - it never reached the line count the
      // `cat` path below is judged by, and it could not tell a dump from a COUNT. Measured: a
      // `node -e` whose entire output was `.match(...).length` on a 198-line file (under the
      // guard's own threshold) was denied, killing a five-probe compound command and costing a
      // 107k-token retry. Two exemptions, in order:
      //   - the expression REDUCES: the read feeds a count/search/test and the content itself is
      //     never printed, so nothing large can reach the context;
      //   - the file is knowable and under THRESHOLD, exactly as for `cat`.
      const lit = String(rtCall[1] || rtCall[2] || '').replace(/^["']|["']$/g, '');
      const reduces = /\)\s*\.\s*(?:match|split|indexOf|lastIndexOf|includes|search|test|length|filter|reduce|count|find|index|scan)\b/.test(seg)
        && !/\bconsole\.log\(\s*(?:[A-Za-z_$][\w$]*\s*\)|(?:fs\.)?readFileSync|open\()/.test(seg)
        && !/\bprint\(\s*open\(/.test(seg);
      let oversized = true;
      if (lit && !isVar(lit)) {
        const { lc, resolved } = resolveLineCount(expandWith(assigns, lit));
        if (resolved) oversized = lc > THRESHOLD;
      }
      if (!reduces && oversized) {
        process.stderr.write(
          'Blocked: whole-file read of a source file through a language runtime.\n' +
          'Per baseline-navigation.md this is the same whole-file read the Read gate blocks, spelled\n' +
          'differently. Locate the symbol first (serena find_symbol / get_symbols_overview), then read\n' +
          'only the range you need. An expression that only COUNTS or SEARCHES - the read feeding\n' +
          '.match/.split/.length with no print of the content - is not a dump and is not blocked.\n' +
          'The serena tools are DEFERRED - load them first:\n' + LOAD_SERENA,
        );
        process.exit(2);
      }
    }

    // A dump verb whose output is unbounded is a dump: `head -n <huge>` and `tail -n +1` both print
    // the whole file, while a bounded `head -40` is the targeted read this gate exists to encourage.
    const unb = seg.match(/\bhead\s+-n\s*\d{5,}\s+((?:-\S+\s+)*\S+)/)
      || seg.match(/\btail\s+-n\s*\+\s*1\s+((?:-\S+\s+)*\S+)/)
      || seg.match(/\b(?:less|more)\s+((?:-\S+\s+)*\S+)/)
      || seg.match(/\bawk\s+(?:['"])1(?:['"])\s+((?:-\S+\s+)*\S+)/);
    if (unb && gatedIn(unb[1])) {
      process.stderr.write(
        'Blocked: unbounded whole-file dump (head -n <huge> / tail -n +1 / less / awk \'1\').\n' +
        'Per baseline-navigation.md, read the located range - serena find_symbol, or a bounded\n' +
        'sed -n \'<start>,<end>p\' once you know where to look. The serena tools are DEFERRED - load them first:\n' + LOAD_SERENA,
      );
      process.exit(2);
    }

    // Per pipeline segment: a bare `cat <gated file>` (or sed -n '1,$p') with no limiting
    // filter after it is a whole-file dump; `cat f | head -40` / grep / wc are targeted.
    const catAll = seg.match(/\bcat\s+((?:(?:-\w+|"[^"]+"|'[^']+'|[^\s;&|<>]+)\s*)+)/);
    const files = catAll
      ? catAll[1].trim().split(/\s+/).filter((t) => !t.startsWith('-')).map((t) => t.replace(/^["']|["']$/g, ''))
      : [];
    const sedM = seg.match(/\bsed\s+-n\s+["']1,\$p["']\s+("[^"]+"|'[^']+'|[^\s;&|<>]+)/);
    if (sedM) files.push(sedM[1].replace(/^["']|["']$/g, ''));
    // PowerShell's reader: bounded by -TotalCount / -Head / -First / -Tail / -Last; its path is the
    // positional argument or -Path / -LiteralPath, and the values of its other parameters are not paths.
    // The verb must be the segment's COMMAND (its start, or after a pipe or a paren) - `grep type a.ts`
    // and `git gc` name the word as an argument.
    const gcM = seg.match(/(?:^\s*|[|(]\s*)(?:get-content|gc|type)\s+((?:(?:-\w+|"[^"]+"|'[^']+'|[^\s;&|<>]+)\s*)+)/i);
    if (gcM) {
      const words = gcM[1].trim().match(/"[^"]+"|'[^']+'|\S+/g) || [];
      if (!words.some((w) => /^-(?:totalcount|head|first|tail|last)$/i.test(w))) {
        for (let k = 0; k < words.length; k++) {
          const w = words[k];
          if (/^-(?:path|literalpath|lp|pspath)$/i.test(w)) continue;
          if (/^-/.test(w)) { if (/^-(?:encoding|delimiter|readcount|filter|include|exclude|stream|credential)$/i.test(w)) k++; continue; }
          files.push(w.replace(/\)+$/, '').replace(/^["']|["']$/g, ''));
        }
      }
    }
    for (const rawF of files) {
    const f = expandWith(assigns, rawF);
    if (!GATED_EXT.test(f)) continue;
    // A target still carrying an unexpanded variable is unknowable - the sibling guard's rule:
    // judge nothing rather than deny on a guess. This failed CLOSED before, and half the denials
    // in one measured project were `$R/...` paths the session had every right to read.
    if (isVar(f)) continue;
    const { lc, resolved } = resolveLineCount(f);
    if (!resolved) {
      // A dump-shaped command on a gated file whose size we cannot check fails CLOSED -
      // an unresolvable relative path was exactly how whole-file dumps slipped past this
      // matcher. Re-run with an absolute path (or read the located range via serena).
      process.stderr.write(
        `Blocked: cannot size ${f} (relative path did not resolve against the project root or session cwd).\n` +
        `A whole-file cat/sed of a source file must be size-checked - use an absolute path,\n` +
        `or locate the symbol first:\n` + serenaHint(f),
      );
      process.exit(2);
    }
    if (lc > THRESHOLD) {
      process.stderr.write(
        `Blocked: whole-file dump of ${f} (${lc} lines) via ${payload.tool_name}.\n` +
        `Per baseline-navigation.md, a bare cat/sed of a large source file is the same\n` +
        `whole-file read the Read gate blocks - routed through the shell.\n` + serenaHint(f),
      );
      process.exit(2);
    }
    }
  }
  process.exit(0);
}

// ---- Read matcher ----
const path = input.file_path || '';
// Only gate source / markup files we navigate by symbol or read by range:
// the symbol-navigable languages the stack's LSP plugins cover (TS/JS family,
// C#, Go), plus large templates (Angular .html, Razor .razor/.cshtml, WPF
// .xaml) where you should read the range. SQL/SCSS/markdown aren't symbol-nav.
// A file too big to fit a tool result is the most predictable whole-read in the system, whatever
// its extension: the harness spills the oversized output to disk, and the recovery Read pulls the
// whole thing straight back into context. Measured: a 93KB spill read WHOLE, twice, for 99,277
// chars and no hook-block row, because the extension was not on the gated list. This branch judges
// SIZE, not language, and it only ever objects to the whole-file SHAPE - a ranged read of the same
// file passes untouched, which is the entire remedy.
const BIG_BYTES = 60 * 1024;
if (!GATED_EXT.test(path)) {
  let size = 0;
  try { size = fs.statSync(path).size; } catch { /* missing - let Read surface its own error */ }
  const whole = (input.offset ?? 0) <= 1 && input.limit == null;
  if (size > BIG_BYTES && whole) {
    // A grep remedy needs LINES. This branch judges size, not language, so it also catches the 93KB
    // PNG and the one-line minified bundle, where `grep -n` and an offset+limit Read both answer
    // nothing (measured: 2 wasted calls on an image). Sniff the first bytes and prescribe PAGING there.
    let head = null;
    try {
      const fd = fs.openSync(path, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n);
    } catch { /* unreadable - fall back to the line-based remedy */ }
    const unlined = !!head && (head.includes(0) || head.toString('latin1').split('\n').some((l) => l.length > 1000));
    process.stderr.write(
      `Blocked: whole-file Read of ${path} (${Math.round(size / 1024)}KB).\n` +
      `A file this large does not fit a tool result - reading it whole spends its entire size on\n` +
      `context, and every message after it re-sends that. Take what you came for instead:\n` +
      (unlined
        ? `This file is binary or minified - it has no lines to grep or to Read by range. Page it:\n`
          + `  head -c 2000 '${path}'      ->  the first bytes, capped\n`
          + `  sed -n '1,40p' '${path}'    ->  a page, if it has lines at all\n`
          + `  file '${path}'              ->  what it is, when the bytes say nothing`
        : `  grep -n '<pattern>' '${path}'   ->  then Read with offset+limit on the lines it names\n`
          + `A persisted/spilled output is the common case here: grep or tail it, never Read it whole.`),
    );
    process.exit(2);
  }
  process.exit(0);
}
const lineCount = lineCountOf(path);
if (lineCount === 0) process.exit(0); // missing/unreadable - let Read surface its own error
if (lineCount <= THRESHOLD) process.exit(0);

const offset = Math.max(1, input.offset ?? 1);
const wholeShape = (input.offset ?? 0) <= 1 && (input.limit == null || input.limit >= lineCount);
// A head window genuinely smaller than the file is targeted; a limit that spans
// the whole file (limit: 2000 from the top) is a whole-file Read wearing a range.
if (wholeShape) {
  process.stderr.write(
    `Blocked: whole-file Read of ${path} (${lineCount} lines).\n` +
      `Per baseline-navigation.md, Read is for code you've ALREADY located - never to find a symbol.\n` +
      `A limit that covers the whole file is still a whole-file Read - and so is\n` +
      `offset 1 with limit = the file's line count (measured: that exact retry got\n` +
      `blocked twice in a row). Read HALF the file or less per range.\n` + serenaHint(path),
  );
  process.exit(2);
}

// Cumulative cap: merge this range into the per-session interval set for the file; if the
// merged coverage would exceed ~60% of the file, the remainder goes through serena - two
// half-splits reconstructing the file are the whole-file read in two calls (measured).
const CAP = 0.6;
const end = Math.min(lineCount, offset + (input.limit != null ? input.limit : lineCount) - 1);
const stateFile = sessionStateFile();
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* fresh state */ }
const intervals = (state[path] || []).concat([[offset, end]]).sort((a, b) => a[0] - b[0]);
const merged = [];
for (const iv of intervals) {
  const last = merged[merged.length - 1];
  if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1]);
  else merged.push([iv[0], iv[1]]);
}
const covered = merged.reduce((n, [a, b]) => n + (b - a + 1), 0);
if (covered > lineCount * CAP) {
  process.stderr.write(
    `Blocked: ranged Reads of ${path} now cover ${Math.round((100 * covered) / lineCount)}% of its ${lineCount} lines this session -\n` +
      `reconstructing a large file from half-splits is the whole-file read the guard exists to stop\n` +
      `(measured: 2-3-call splits rebuilt 7 blocked files in one run). For the remainder:\n` + serenaHint(path),
  );
  process.exit(2);
}
state[path] = merged;
try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* state is best-effort */ }
process.exit(0);
