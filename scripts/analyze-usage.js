#!/usr/bin/env node
'use strict';

// analyze-usage.js - offline token/tool consumption report for a Claude Code session.
//
// Why: hooks see WHO fired (instrument-tool-usage.js) but can never see tokens - token
// accounting lives per API message in the transcript JSONL Claude Code already writes.
// This script mines that transcript (plus the session's subagents/ directory) and emits
// the consumption report an agent-flow tuning pass needs: tokens by scope and model,
// exact per-dispatch subagent cost, skill/MCP/tool call+result volume, context-growth
// spikes, and an optional join against an instrument-tool-usage.js hook log.
//
// Usage:
//   node scripts/analyze-usage.js <session.jsonl>                  # full report for one session
//   node scripts/analyze-usage.js <projects-dir>                   # one-line rollup per session
//   node scripts/analyze-usage.js <session.jsonl> --hook-log <f>   # join a <docs-path>/tools-usage/<sid>.jsonl ledger
//   node scripts/analyze-usage.js <session.jsonl> --hook-blocks <d> # per-HOOK block counts from <docs-path>/hook-blocks/
//   node scripts/analyze-usage.js <session.jsonl> --json           # machine-readable dump
//   node scripts/analyze-usage.js <session.jsonl> --report-md      # markdown report skeleton (machine tables + FILL IN sections)
//   node scripts/analyze-usage.js <s.jsonl> --from <ISO> --to <ISO> # window one run inside a long session
//   node scripts/analyze-usage.js <s.jsonl> --docs-root <path>     # extra docs prefix when ALFRED_CODE_DOCS_PATH is non-default
//   node scripts/analyze-usage.js <s.jsonl> --inventory <.claude>  # the installed set the INVENTORY vs USE block scores
//   node scripts/analyze-usage.js <s.jsonl> --plugins <installed_plugins.json>  # the plugin inventory, when not this machine's
//   node scripts/analyze-usage.js <projects-dir> --exclude-session <id>  # leave a session out (the live one is left out already)
//   node scripts/analyze-usage.js <projects-dir> --turn-check-advice <root>  # ONE row when unchecked done claims pass 3 per 10 sessions
//   node scripts/analyze-usage.js --turn-check-advice .           # no folder: this project's own, derived from the cwd
//   node scripts/analyze-usage.js <s.jsonl> --report-md --out <file>  # write it, no shell redirect (the classifier denies those)
//   node scripts/analyze-usage.js --check-report <report-usage.md>  # every judgment number against this report's own machine tables
//   node scripts/analyze-usage.js <s.jsonl> --prices <file>        # price the cost row from another table than meta/model-prices.json
//
// INVENTORY vs USE answers the complement of every consumption table: which installed skill,
// agent, rule, plugin and MCP server the session (or, in directory mode, the corpus) never
// touched. The installed set is read off disk - `--inventory`, else the transcript's own cwd's
// `.claude` when this machine has it, else the stack catalog beside this script, labeled as such.
//
// The headline health signal is ctx/msg (avg context re-sent per API call = input +
// cache-write + cache-read over msgs): high tool-result volume means noisy tools, but a
// high ctx/msg means carried-forward conversation - the cost driver windowing isolates.
//
// Transcripts live under ~/.claude/projects/<encoded-project-path>/: the main session is
// <session-id>.jsonl, its dispatched subagents under <session-id>/subagents/agent-*.jsonl
// (+ .meta.json with agentType/description/toolUseId). Facts this parser relies on,
// verified against real transcripts: one API response is split across several assistant
// lines that each repeat the same message.id with usage that is IDENTICAL (main session)
// or a PROGRESSIVE streaming snapshot (subagent files: output_tokens grows 4 -> 9579
// across lines) - so usage is folded as an elementwise max per message.id, never summed
// per line and never first-wins; tool_use ids are globally unique; assistant lines carry
// attributionSkill/attributionPlugin while a skill is active; result sizes are measured
// in chars and reported as ~tokens (chars/4) - approximate, oversized results may be
// offloaded to tool-results/ and undercount.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { loadManifest } = require('./install/manifest.js');
const { parseJson } = require('./install/json-file.js');

// ---------- small helpers ----------

const fmt = (n) => {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
};
const approxTok = (chars) => Math.round(chars / 4);
const dur = (ms) => {
  if (!ms || ms < 0) return '-';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const pad = (s, w) => String(s).length >= w ? String(s) : String(s) + ' '.repeat(w - String(s).length);
const rpad = (s, w) => String(s).length >= w ? String(s) : ' '.repeat(w - String(s).length) + String(s);

// ---------- credential masking on every printed ARGUMENT ----------
// The report prints what a call ASKED FOR - the Bash command, a Grep pattern, a query - and a
// pattern that was a live token therefore reached the report, and through it the bundle written
// under the project's docs path (measured: one Grep pattern, one token). The shapes are the ones
// guard-secret-value.js judges by (kept identical), plus `glpat-`: the value is never printed,
// only its length, so a masked row still says a credential was in the argument.
const SECRET_SHAPE_G = /(sntryu_[0-9a-f]{16,}|ctx7sk-[0-9a-f-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
const PEM_PRIVATE_G = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;
const maskSecrets = (s) => String(s == null ? '' : s)
  .replace(SECRET_SHAPE_G, (m) => `<redacted credential (${m.length} chars)>`)
  .replace(PEM_PRIVATE_G, '<redacted PEM private key>');

// ---------- the efficiency scorecard's classifiers ----------
// The scorecard measures each session against the practices the official Claude Code guidance and
// the stack's own audits agree on, as NUMBERS with denominators - the report judges them. Every
// classifier here is a measurement, never a gate: a hook grows a class only after these rows have
// shown its rate for a week.
// Prose as guard-answer-length.js defines it (fences, tables, quotes, inline code stripped), so
// the analyzer counts what the hook would see.
// A PLUGIN server's tools are `mcp__plugin_<plugin>_<server>__<tool>`, so the segment between the
// double underscores is `plugin_<plugin>_<server>`. Server names carry no underscore, so dropping
// `plugin_<plugin>_` is one split; a bare `mcp__<server>__` row from a pre-1.0.0 transcript reads
// the same way, which is what keeps an old session comparable with a new one.
function mcpServerOf(toolName)
{
    const seg = String(toolName).split('__')[1] || '?';
    return seg.startsWith('plugin_') ? (seg.slice(7).split('_').slice(1).join('_') || seg) : seg;
}

function proseOf(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\]\([^)\s]*\)/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}
const LONG_ANSWER = 1800;   // guard-answer-length's HARD_CAP
const STREAK_TURNS = 3, STREAK_SHORT = 200, STREAK_LONG = 1500;   // its correction-streak detector
// Its single-turn correction test, copied verbatim (shared-rules.json `correction-turn-test`): a
// short typed turn that follows an answer of any length and carries a correction marker - the
// turns the corrections-saved row counts.
// --- correction-turn test
const CORRECTION_STRONG_RE = /^\W*(?:no|nope|nah|wrong|incorrect|not (?:that|this|what|quite|like that|right|correct)|undo|revert|roll ?back)\b|(?:^|[.,;:!?]\s*|\b(?:but|and|please|pls|so|then|also|just)\s+)(?:do not|don'?t|dont|never|stop \w+ing)\b|\byou (?:did not|didn'?t|didnt|have not|haven'?t|havent|should not|shouldn'?t|forgot|missed|ignored|broke|skipped|removed|deleted|dropped|lost|said|told)\b|\bwhy (?:did |do |are |have |haven'?t |didn'?t |would |were )?you\b(?! (?:cannot|can'?t|can not|couldn'?t)\b)|\bi (?:said|asked|told you|meant|wanted|did not ask|didn'?t ask|never asked|already (?:said|told|asked))\b|\b(?:still|again) (?:there|broken|fail\w*|wrong|the same|red|happen\w*|error\w*|doesn'?t|does not|isn'?t|is not|not)\b|\bsame (?:error|issue|problem|bug)\b|\b(?:that'?s|that is|this is|it'?s|it is) (?:wrong|incorrect|not (?:right|correct|what|how|it))\b|\bnot what i\b|\bi (?:do not|don'?t|dont|did not|didn'?t) (?:want|need|like)\b|\b(?:does not|doesn'?t|did not|didn'?t) (?:fit|work|help|make sense)\b|\bnot working\b|\b(?:too (?:long|much text|verbose|many words|complicated|complex)|a lot of text|less text|shorter|simpler|more concise)\b/i;
const CORRECTION_WEAK_RE = /^\W*but\b|^\W*(?:ok(?:ay)?|yes|yeah|fine|sure|good|right)\b\W*but\b|^\W*stop\b|\binstead\b|\b(?:it|this|that|they|these|those|there) should(?:n'?t| not| have| be| stay| use| go)\b/i;
const CORRECTION_CYR_RE = /(?<![\p{L}])(?:ні(?=[\s,.!]|$)|нет(?=[\s,.!]|$)|не (?:так|те|то)(?![\p{L}])|не ?правильн|не (?:треба|потрібно|надо|нужно|роби|делай)(?![\p{L}])|я (?:ж )?(?:казав|просив|говорив|сказав|говорил|просил|сказал)|(?:чому ти|почему ты)(?! не мож)|навіщо ти|зачем ты|коротше|покороче|простіше|проще|забагато|слишком|(?:та сама|та ж|та же|та самая) (?:помилк|ошибк|проблем)|не (?:працює|работает)|(?:досі|все ще|всё ещё|все еще) не(?![\p{L}]))/iu;
function correctionMarker(text) {
  const t = String(text || '').replace(/[‘’]/g, "'").trim();
  const m = t.match(CORRECTION_STRONG_RE) || t.match(CORRECTION_CYR_RE) || (!t.includes('?') && t.match(CORRECTION_WEAK_RE));
  return m ? m[0].trim().slice(0, 40) : null;
}
// --- end correction-turn test
// A correction counts as saved when a memory store follows within this many replies - the plugin
// route's name or a registration's (history plan, Gate G2).
const SAVE_WINDOW = 3;
const MEMORY_STORE_RE = /^mcp__(?:plugin_(?:alfred-)?memory_)?(?:alfred-)?memory__memory_store$/;
const CHECK_WINDOW = 40;    // tool calls a check may sit before a commit and still count as its check
// Build output, package trees, caches and lockfiles - a read there is a read of nothing the session
// wrote. `bin/` catches a script dir too, so the report prints the paths and the reader judges. The data
// root's server folders count (the default `.alfred`: serena's index and language servers, the browser
// profiles, a project memory database) - its docs do not.
const BUILD_DIR_RE = /(?:^|[\/\\])(?:node_modules|bin|obj|dist|coverage|TestResults|target|__pycache__|\.venv|venv|vendor|\.git|\.angular|\.nuget|\.serena|\.playwright|\.alfred-memory|\.alfred[\/\\](?:serena|browser)|\.next|\.nuxt|\.gradle|\.idea|\.vs)(?:[\/\\]|$)|(?:^|[\/\\])(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|Cargo\.lock|poetry\.lock|composer\.lock)$|\.(?:log|min\.js|min\.css|map)$/;
// The first file a dump verb names - the same read routed through the shell.
// The shell route: Bash, PowerShell and Monitor (shell-writes.js SHELL_TOOLS - Monitor runs its command under Bash's rules; 2.1.5 final review R8).
const isShellTool = (name) => name === 'Bash' || name === 'PowerShell' || name === 'Monitor';
function shellReadTarget(cmd) {
  const m = /(?:^|[;&|(]\s*)(?:cat|head|tail|less|more|bat)\s+(?:-[\w-]+(?:\s+\d+)?\s+)*["']?([^\s"'|;&<>)]+)/.exec(cmd)
    || /(?:^|[;&|(]\s*)sed\s+-n\s+(?:-e\s+)?["']?[\d,$p;]+["']?\s+["']?([^\s"'|;&<>)]+)/.exec(cmd);
  if (!m) return null;
  const p = m[1];
  if (p.includes('$') || /[*?\[]/.test(p) || p === '-') return null;
  return p;
}
// A CHECK is something that returns a pass/fail the session can read: a test run, a build, a lint,
// a CI status read. A test run is SCOPED when it names one project, one file, one filter.
const CHECK_RES = {
  // The runner is matched ANYWHERE in the segment, never only at its start: `./node_modules/.bin/jest`
  // and `CI=1 npx jest` are test runs, and the segment-start anchor scored both as no check at all -
  // which then reads as a session that committed without testing. A path prefix is allowed and the
  // trailing boundary keeps a FILE NAME out (`jest.config.js`, `pytest.ini`, `vitest-setup.ts`): a
  // config file named on a command line is not a run.
  test: /(?:^|[\s;&|(<>])(?:[\w.@/\\-]*[/\\])?(?:dotnet\s+test|npm\s+(?:run\s+)?test\S*|pnpm\s+(?:run\s+)?test\S*|yarn\s+(?:run\s+)?test\S*|npx\s+(?:jest|vitest|mocha|playwright\s+test)|jest|vitest|mocha|ng\s+test|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test|node\s+--test|mvn\s+test|gradle\s+test|phpunit)(?![\w.-])/,
  build: /(?:^|[;&|(]\s*)(?:dotnet\s+(?:build|publish)|npm\s+run\s+build\S*|pnpm\s+(?:run\s+)?build|yarn\s+(?:run\s+)?build|ng\s+build|npx\s+tsc|tsc|msbuild|cargo\s+build|go\s+build|mvn\s+(?:package|compile|install)|gradle\s+(?:build|assemble))\b/,
  lint: /(?:^|[;&|(]\s*)(?:npm\s+run\s+lint\S*|pnpm\s+(?:run\s+)?lint|yarn\s+(?:run\s+)?lint|npx\s+eslint|eslint|ng\s+lint|dotnet\s+format|ruff|flake8|golangci-lint|cargo\s+clippy)\b/,
  ci: /(?:^|[;&|(]\s*)gh\s+(?:run\s+(?:view|watch|list)|pr\s+checks)\b/,
};
const SCOPED_RE = /--filter[= ]|--test-name-pattern|--testNamePattern|--testPathPattern|\s-t\s|\s-k\s|--grep[= ]|--include[= ]|--run\s+\S|[\w./-]+\.(?:spec|test)\.[cm]?[jt]sx?\b|[\w./-]+_test\.go\b|\btest_\w+\.py\b|::\w|[\w./-]+\.csproj\b|node\s+--test\s+[\w./-]+\.[cm]?js\b|cargo\s+test\s+[\w:]+|go\s+test\s+(?!\.\/\.\.\.)[\w./-]+/;
// A removal's own VERIFICATION tail: `rm -rf "$TMP" && ls "$TMP"`, `rm x; test -f x` - the tail
// exits non-zero BECAUSE the removal worked, and the whole call's result then arrives as
// `is_error`. Counting that as a tool error put a clean cleanup step in the errors column, where a
// report then had to explain a failure that never happened (measured in 2 bundles). The tail must
// name something the `rm` named: an unrelated trailing `ls` is a real failure.
function rmVerifyTail(cmd) {
  const segs = String(cmd).split(/&&|\|\||;|\n/).map((x) => x.trim()).filter(Boolean);
  if (segs.length < 2) return false;
  const tail = segs[segs.length - 1];
  if (!/^!?\s*(?:ls|test|\[)\s/.test(tail)) return false;
  const targets = [];
  for (const seg of segs.slice(0, -1)) {
    const m = /^rm\s+((?:-[\w-]+\s+)*)(.+)$/.exec(seg);
    if (!m) continue;
    for (const tok of m[2].split(/\s+/)) {
      const t = tok.replace(/^["']|["']$/g, '').replace(/[;&|)]+$/, '');
      if (t && !t.startsWith('-')) targets.push(t);
    }
  }
  return targets.some((t) => tail.includes(t));
}

// NAVIGATION, as alfred-navigation words it: locate with the navigation server or the LSP, then read the range. A
// read of a SOURCE file is LOCATED when a locate step sits in the NAV_WINDOW tool calls before it, or
// in the same call (`rg -n x src && sed -n '10,40p' src/a.ts`). A symbol step in the window wins
// over a grep, so 'grep-then-read' is a read that only a name-match located. Glob and find locate a
// FILE, not a place in it, and a grep that FILTERS a pipe (`git log | grep x`) locates nothing - so
// a shell grep counts only when it opens a command segment. Doc and config reads carry no symbol to
// locate and stay out of the denominator; build-dir reads have their own row.
const NAV_WINDOW = 3;
const WHOLE_FILE_HOOK = 'guard-read-whole-file.js';
const SOURCE_EXT_RE = /\.(?:cs|fs|vb|ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|scala|rb|php|swift|dart|c|h|cc|cpp|cxx|hpp|hh|m|mm|lua)$/i;
// serena 1.7.0's locate tools: the three symbol tools plus find_declaration and find_implementations (M36).
const SERENA_SYMBOL_TOOLS = new Set(['find_symbol', 'find_referencing_symbols', 'get_symbols_overview', 'find_declaration', 'find_implementations']);
// The navigation server's name, and the one it went by before 2.0.0 - an older transcript still says serena.
const NAVIGATION_SERVERS = new Set(['alfred-navigation', 'navigation', 'serena']);
const SHELL_GREP_RE = /^\s*(?:\w+=\S*\s+)*(?:grep|egrep|fgrep|rg|ag|ack|git\s+grep)\b/;
function locateClass(name, input) {
  if (name === 'LSP') return 'symbol';
  if (name === 'Grep') return 'grep';
  if (String(name).startsWith('mcp__') && NAVIGATION_SERVERS.has(mcpServerOf(name))) {
    const tool = String(name).split('__').slice(2).join('__');
    if (SERENA_SYMBOL_TOOLS.has(tool)) return 'symbol';
    return tool === 'search_for_pattern' ? 'grep' : null;
  }
  if (isShellTool(name) && input && typeof input.command === 'string') {
    const code = maskQuoted(maskHeredocs(input.command));
    if (code.split(/&&|\|\||;|\n/).some((seg) => SHELL_GREP_RE.test(seg))) return 'grep';
  }
  return null;
}

function classifyCheck(cmdCode, cmdShell) {
  for (const kind of ['test', 'build', 'lint', 'ci']) {
    if (CHECK_RES[kind].test(cmdCode)) return { kind, scoped: kind === 'test' ? SCOPED_RE.test(cmdShell) : undefined };
  }
  return null;
}
// A GREEN CLAIM: prose saying a check passed. The turn it lands in either ran a check or it did not.
const GREEN_RE = /\b(?:all\s+(?:\d[\d,]*\s+)?tests?|tests?|test\s+suite|suite|build|lint|linter|typecheck|type-check|checks?|ci)\b[^.!?\n]{0,60}?\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|clean|ok)\b|\b\d[\d,]*\s*\/\s*\d[\d,]*\s+(?:tests?\s+)?pass(?:ed|ing)?\b/gi;
function claimsGreen(prose) {
  GREEN_RE.lastIndex = 0;
  let m;
  while ((m = GREEN_RE.exec(prose))) {
    const before = prose.slice(Math.max(0, m.index - 24), m.index);
    if (/\b(?:not|no|never|n't|until|if|when|once|should|will|would|must|before|fail\w*)\b[^.]{0,20}$/i.test(before)) continue;
    if (/\b(?:not|n't|never|fail)/i.test(m[0])) continue;
    return true;
  }
  return false;
}

function newTally() { return { input: 0, cacheCreate: 0, cacheRead: 0, output: 0, msgs: 0 }; }
const ctxOf = (t) => (t.msgs ? Math.round((t.input + t.cacheCreate + t.cacheRead) / t.msgs) : 0);
function addUsage(t, u) {
  t.input += u.input_tokens || 0;
  t.cacheCreate += u.cache_creation_input_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0;
  t.output += u.output_tokens || 0;
  t.msgs += 1;
}
function mergeTally(a, b) {
  a.input += b.input; a.cacheCreate += b.cacheCreate; a.cacheRead += b.cacheRead;
  a.output += b.output; a.msgs += b.msgs;
}

// ---------- list prices ----------
// The cost row prices every API message at LIST price from one dated table - meta/model-prices.json,
// which names its source page and fetch date - so a dollar figure always says what it was priced
// against. Priced from the FOLDED usage per message.id: one response arrives as several rows (1.99
// rows per id across 842 local transcripts, 12,526 ids with output growing row to row), and a
// per-row sum would have billed cache-read 1.92x and output 1.80x (measured 2026-09-23; the folded
// totals sit at a median 1.000 (cache-read) and 0.999 (output) of cost-state's own, 177 sessions).
let priceFile = path.join(__dirname, '..', 'meta', 'model-prices.json');
let priceCache = null;
function priceTable() {
  if (priceCache) return priceCache;
  try {
    const t = JSON.parse(fs.readFileSync(priceFile, 'utf8'));
    if (!Array.isArray(t.models)) throw new Error('no models array');
    priceCache = { table: t, byId: new Map(t.models.map((m) => [m.id, m])) };
  } catch (e) {
    priceCache = { error: e.code === 'ENOENT' ? 'not found' : e.message };
  }
  return priceCache;
}
// The dated IDs of models before the 4.6 generation carry a snapshot date, and the harness can add a
// window suffix (`[1m]`); the table keys the dateless id.
const priceId = (model) => String(model || '').toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
// usage.cache_creation splits a write by TTL, and the two bill differently (1.25x and 2x input) -
// measured locally at 56% 5-minute and 44% 1-hour writes by tokens, so one rate would misprice both.
// Fast mode scales every input column by the row's fast/standard input ratio and bills its own output.
function messageUsd(p, r) {
  const fast = r.fast && p.fast;
  const f = fast ? p.fast.input / p.input : 1;
  const w1h = r.split ? Math.min(r.c1h, r.u.cc) : 0;
  const w5 = r.u.cc - w1h;
  return (r.u.in * p.input * f + w5 * p.cache_write_5m * f + w1h * p.cache_write_1h * f
    + r.u.cr * p.cache_read * f + r.u.out * (fast ? p.fast.output : p.output)) / 1e6;
}
const fmtUsd = (n) => {
  if (n == null) return '-';
  if (n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
};

function readJsonl(file, onObj) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    rl.on('line', (l) => { try { onObj(JSON.parse(l), l); } catch { /* skip broken line */ } });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

// ---------- generated-docs consumption ----------
// The capture skills' whole value claim is that seats READ these docs instead of
// re-deriving the project - so consumption is a first-class signal, not a grep afterthought.
// Style delivery is counted via stable marker phrases: the generated project-code-style
// rule's heading (current mechanism - see the skill's code-style-rule template) and the
// retired inject-code-style hook's injected preamble (legacy sessions).

// A rule or preamble written before the capture was renamed carries its old name, read from the
// manifest's `renamed` map rather than spelled here.
const STYLE_SKILL = 'capture-code-style';
const STYLE_SKILL_NAMES = [STYLE_SKILL, ...Object.entries(loadManifest(path.join(__dirname, '..')).renamed.skills)
  .filter(([, now]) => now === STYLE_SKILL).map(([old]) => old)];
const STYLE_RULE_MARKERS = STYLE_SKILL_NAMES.map((n) => `the ${n} skill owns this rule`);
const STYLE_INJECT_MARKERS = STYLE_SKILL_NAMES.map((n) => `maintained by the ${n}`);
// The default root, then the one it replaced (2.0.0): a session recorded before the move wrote there.
const docsPrefixes = ['/.alfred/docs/', '/.claude/docs/'];
// The same roots, spelled for the BASH route: no leading separator, because a command names the
// path relative or absolute and the match anchors on a shell boundary instead. `--docs-root` used
// to reach only the Read/Write route, so a project with a remapped docs root had its heredocs,
// redirects and `rm`s invisible in the same table that showed its Read/Write touches - one table
// answering two ways.
const bashDocRoots = () => docsPrefixes.map((p) => p.replace(/^\//, ''));

// The prefix is spelled with forward slashes while a Windows session writes a backslash path,
// so the generated-docs table scored 0 writes for every document a Windows run demonstrably wrote
// (measured: five Write calls, three docs, all reported as untouched). Normalize the separator
// before matching - the prefix list stays in one spelling.
function docRelPath(filePath) {
  const norm = String(filePath).replace(/\\/g, '/');
  for (const p of docsPrefixes) {
    const i = norm.indexOf(p);
    if (i >= 0) return norm.slice(i + p.length);
  }
  return null;
}

// ---------- installed inventory: what the project HAS, against what a session USED ----------
// The report measured consumption and never its complement: a 79-skill install could show three
// skills used and say nothing at all about the other 76, so 'unused in this corpus' was an ad-hoc
// script every time it was asked. The inventory side is read off DISK - the project's own
// `.claude` directory when this machine has it, the stack's own catalog otherwise, and a catalog
// row is labeled as such because it proves the stack SHIPS the artifact, never that this project
// installed it.

// `paths:` takes globs and brace expansion only - no negation form, and an invalid pattern matches
// nothing (the maintainer note in markdown-docs.md records the same reading of the Claude Code
// memory docs). This is that subset, so the proxy matches what the harness would have attached.
function globToRe(glob) {
  const g = String(glob).replace(/\\/g, '/');
  let re = '';
  let depth = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i += 1;
        if (g[i + 1] === '/') { i += 1; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { depth += 1; re += '(?:'; }
    else if (c === '}' && depth) { depth -= 1; re += ')'; }
    else if (c === ',' && depth) re += '|';
    else re += c.replace(/[.+^$()|[\]\\/{},]/g, '\\$&');
  }
  while (depth > 0) { re += ')'; depth -= 1; }   // a malformed pattern must not kill the run
  try { return new RegExp(`^${re}$`); } catch { return /$^/; }
}

// A frontmatter subset - `key: value`, an inline `["a", "b"]` array, and the indented `- item`
// block list the agent seats write their `skills:` preload as. Enough for `paths:`, `skills:` and
// `name:`; a full YAML parser is a dependency this repo does not carry for three keys.
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, '');
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const val = kv[2].trim();
    if (val === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) { items.push(unquote(lines[i + 1].replace(/^\s+-\s+/, ''))); i += 1; }
      out[kv[1]] = items;
    } else if (val.startsWith('[')) {
      // Quoted items first: `paths: ["**/*.{ts,tsx}"]` carries a comma INSIDE a brace group, and
      // a plain split on commas tore that glob in half (which then threw on the RegExp).
      const inner = val.replace(/^\[|\]$/g, '');
      const quoted = [...inner.matchAll(/'([^']*)'|"([^"]*)"/g)].map((q) => (q[1] !== undefined ? q[1] : q[2]));
      out[kv[1]] = quoted.length ? quoted : inner.split(',').map(unquote).filter(Boolean);
    } else {
      out[kv[1]] = unquote(val);
    }
  }
  return out;
}

// A skill BODY as the two sides spell it: the transcript's copy opens with the harness's own
// `Base directory` line and carries no frontmatter, the file on disk carries frontmatter and no
// such line. The HEADING sequence is the part that survives both - the loaded copy has its
// `${CLAUDE_PROJECT_DIR}`-style placeholders already expanded, so a byte compare reports a
// difference that is only the expansion (measured: 22 chars over 12k against the same file).
const skillBodyOf = (text) => String(text || '')
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  .replace(/^Base directory for this skill:.*\r?\n/, '')
  .trim();
const headingFingerprint = (text) => String(text || '').split('\n')
  .filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.trim().replace(/\s+/g, ' ')).join(' | ');

function dirEntries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
function readHead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

// A skill is a DIRECTORY carrying SKILL.md (both the catalog and an installed `.claude/skills`
// use that shape); a loose `.md` beside them is read too, so a hand-rolled install still lists.
function loadSkillsDir(dir) {
  const out = [];
  for (const e of dirEntries(dir)) {
    if (e.isDirectory()) {
      const f = path.join(dir, e.name, 'SKILL.md');
      if (fs.existsSync(f)) out.push({ name: e.name, file: f });
    } else if (e.isFile() && /\.md$/.test(e.name) && e.name !== 'README.md') {
      out.push({ name: e.name.replace(/\.md$/, ''), file: path.join(dir, e.name) });
    }
  }
  return out.sort(byName);
}

// An agent's `skills:` frontmatter is the PRELOAD list - those skills enter the seat's context on
// dispatch without a Skill call of their own, so a skill can be paid for in full and show zero
// calls. That is a different column, never the same one.
function loadAgentsDir(dir) {
  const out = [];
  for (const e of dirEntries(dir)) {
    if (!e.isFile() || !/\.md$/.test(e.name)) continue;
    const file = path.join(dir, e.name);
    const fm = parseFrontmatter(readHead(file));
    out.push({ name: fm.name || e.name.replace(/\.md$/, ''), file, skills: Array.isArray(fm.skills) ? fm.skills : [] });
  }
  return out.sort(byName);
}

// A rule with no `paths:` is always-on: it is in every prompt of every session, so 'used' is not a
// question a transcript can answer. Say that rather than scoring it 0.
function loadRulesDir(dir) {
  const out = [];
  for (const e of dirEntries(dir)) {
    if (!e.isFile() || !/\.md$/.test(e.name)) continue;
    const file = path.join(dir, e.name);
    const fm = parseFrontmatter(readHead(file));
    const globs = Array.isArray(fm.paths) ? fm.paths : (fm.paths ? [String(fm.paths)] : []);
    out.push({ name: e.name, file, globs, alwaysOn: globs.length === 0 });
  }
  return out.sort(byName);
}

// Directory mode used to read only the `.jsonl` files sitting directly inside the folder it was
// given, so the collected-bundle layout - `<corpus>/<project>/<session-id>/<session-id>.jsonl`
// with `subagents/` beside it - printed an empty TOTAL and no inventory at all, and the corpus
// answer needed a throwaway script. The walk is recursive, and it excludes what is NOT a session:
// a dispatched seat's own transcript (its cost is already counted under its parent, and counting
// it again as a session would double the corpus), and the two ledger families, which are JSONL of
// the same shape and would otherwise open a row per file with a '?' start - measured on the local
// corpus: 313 real transcripts against 198 ledger files under `tools-usage/` and `hook-blocks/`
// plus 147 more named `tool-usage-<sid>` / `hook-blocks-<sid>` inside the bundles.
const NON_SESSION_DIRS = new Set(['subagents', 'tools-usage', 'tool-usage', 'hook-blocks']);
const LEDGER_FILE_RE = /^(?:tools?-usage|hook-blocks)-/;
function findSessionFiles(root, depth = 0, out = []) {
  for (const e of dirEntries(root)) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (NON_SESSION_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (depth < 6) findSessionFiles(full, depth + 1, out);
    } else if (e.isFile() && e.name.endsWith('.jsonl') && !LEDGER_FILE_RE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const CATALOG_DIR = path.join(__dirname, '..', 'stack');

// The transcript's `cwd` is the path on the machine that RAN the session - usually not this one,
// which is exactly why the catalog fallback exists and why it says so in its own label.
// The install's own vintage, from the stamp every installer run writes. A directory whose stamp
// POSTDATES the session is not the set that session had: measured, a session that ran with NO
// `.claude` at all (`test -d .claude` -> no, in its own transcript) was reported as 44 skills /
// 22 agents / 15 rules installed, because a later install on the same path was read back as if it
// had been there. Two more bundles carried a rule and an MCP name the session's own listing did
// not have.
// A 1.x install's stamp keeps its old name until an update rewrites it; the new one wins when both exist.
function readInstallStamp(claudeDir) {
  const file = require('./install/brand.js').stampFile(claudeDir).read;
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const val = (k) => { const m = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(txt); return m ? m[1].trim() : null; };
  return { version: val('version'), sha: val('sha'), installed: val('installed'), file };
}

// The install's skills and agents have TWO homes: copied under `.claude/`, or served by the
// enabled plugins. Reading only the directory reported a plugin-native install as '1 skill, 1
// agent installed' and scored every unused-but-paid-for row against a set the session never had.
// The cache is the same layout every Claude Code install uses; when it is not readable (a bundle
// analysed on another machine) the directory stands alone and the `why` line says so.
// The entry's OWN item lists, from the marketplace manifest shipped in the plugin root. Null when
// the root carries no entry of that name (a plugin with a root of its own), so the caller scans.
function pluginEntryItems(root, plugin) {
  let entry;
  try {
    const mk = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    entry = (mk.plugins || []).find((x) => x && x.name === plugin);
  } catch { return null; }
  if (!entry) return null;
  const abs = (rel) => path.join(root, String(rel).replace(/^\.\//, ''));
  const skills = [];
  for (const rel of entry.skills || []) {
    const file = path.join(abs(rel), 'SKILL.md');
    if (fs.existsSync(file)) skills.push({ name: path.basename(abs(rel)), file });
  }
  const agents = [];
  for (const rel of entry.agents || []) {
    const file = abs(rel);
    const fm = parseFrontmatter(readHead(file));
    agents.push({ name: fm.name || path.basename(file).replace(/\.md$/, ''), file, skills: Array.isArray(fm.skills) ? fm.skills : [] });
  }
  return { skills: skills.sort(byName), agents: agents.sort(byName) };
}

function loadPluginLayers(claudeDir) {
  const out = { skills: [], agents: [], from: [] };
  let enabled = [];
  try
  {
    const s = parseJson(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    enabled = Object.keys(s.enabledPlugins || {}).filter((k) => (s.enabledPlugins || {})[k] !== false);
  }
  catch { return out; }
  const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude');
  for (const id of enabled) {
    const [plugin, market] = String(id).split('@');
    if (!plugin || !market) continue;
    const base = path.join(cfg, 'plugins', 'cache', market, plugin);
    for (const e of dirEntries(base)) {
      if (!e.isDirectory()) continue;
      const root = path.join(base, e.name);
      // A plugin that SHARES a repo root with its siblings has the whole repo in its cache, so a
      // directory scan credits it with every sibling's items - and a hooks-only entry with all of
      // them. The marketplace manifest in that root lists what the entry actually ships, so it
      // wins; the scan is the fallback for a plugin with a root of its own.
      const listed = pluginEntryItems(root, plugin);
      const sk = listed ? listed.skills : [...loadSkillsDir(path.join(root, 'stack', 'skills')), ...loadSkillsDir(path.join(root, 'skills'))];
      const ag = listed ? listed.agents : [...loadAgentsDir(path.join(root, 'stack', 'agents')), ...loadAgentsDir(path.join(root, 'agents'))];
      if (!sk.length && !ag.length) continue;
      out.skills.push(...sk);
      out.agents.push(...ag);
      out.from.push(id);
    }
  }
  const dedupe = (rows) => [...new Map(rows.map((r) => [r.name, r])).values()].sort(byName);
  out.skills = dedupe(out.skills);
  out.agents = dedupe(out.agents);
  out.from = [...new Set(out.from)].sort();
  return out;
}

function resolveInventory(explicitDir, cwd, sessionLastTs) {
  const tryDir = (d, kind, why) => {
    if (!d) return null;
    const plug = loadPluginLayers(d);
    const merge = (dirRows, plugRows) => [...new Map([...plugRows, ...dirRows].map((r) => [r.name, r])).values()].sort(byName);
    const skills = merge(loadSkillsDir(path.join(d, 'skills')), plug.skills);
    const agents = merge(loadAgentsDir(path.join(d, 'agents')), plug.agents);
    const rules = loadRulesDir(path.join(d, 'rules'));
    if (!skills.length && !agents.length && !rules.length) return null;
    const note = plug.from.length ? ` (${plug.skills.length} skill(s) and ${plug.agents.length} agent(s) served by ${plug.from.join(', ')})` : '';
    // The cwd branch below REWRITES `why` from the stamp, so the note travels as its own field and
    // is appended at the end - an earlier draft put it in `why` and the stamp line silently ate it.
    return { dir: d, kind, why, skills, agents, rules, plugins: plug.from, pluginNote: note };
  };
  const withNote = (inv) => { if (inv && inv.pluginNote) inv.why += inv.pluginNote; return inv; };
  if (explicitDir) {
    // Named by the caller: they said which install this bundle belongs to, so it is not guessed at.
    const inv = tryDir(explicitDir, 'project', `project ${explicitDir}`);
    if (inv) inv.stamp = readInstallStamp(explicitDir);
    return withNote(inv)
      || { dir: explicitDir, kind: 'project', why: `project ${explicitDir} (no skills/, agents/ or rules/ under it)`, skills: [], agents: [], rules: [] };
  }
  if (cwd) {
    const d = path.join(String(cwd).replace(/\\/g, '/'), '.claude');
    const inv = fs.existsSync(d) ? tryDir(d, 'project', `project ${d} (the transcript's own cwd)`) : null;
    if (inv) {
      const stamp = readInstallStamp(d);
      inv.stamp = stamp;
      // Only a stamp that PREDATES the session makes the directory the session's own set.
      if (stamp && stamp.installed && sessionLastTs && stamp.installed > sessionLastTs) {
        inv.drifted = true;
        inv.why = `project ${d} - INSTALLED ${stamp.installed} (v${stamp.version || '?'}), AFTER this session's last row ${sessionLastTs}: read at analysis time, not the set the session had`;
      } else if (!stamp) {
        inv.why = `project ${d} (the transcript's own cwd; no alfred-code.stamp - install vintage unknown, the directory is read at ANALYSIS time)`;
      } else {
        inv.why = `project ${d} (the transcript's own cwd; installed ${stamp.installed || '?'} v${stamp.version || '?'}, before this session ran)`;
      }
      return withNote(inv);
    }
  }
  return withNote(tryDir(CATALOG_DIR, 'catalog', 'catalog (installed set unknown)'))
    || { dir: null, kind: 'none', why: 'none reachable on this machine', skills: [], agents: [], rules: [] };
}

// The session's OWN roster wins over any directory for skills and agents: the harness told this
// session what it had (`skill_listing.names`, `agent_listing_delta.addedTypes`) and that record is
// in the transcript, dated. A name the roster lists and the disk does not is installed all the
// same - only the name is needed to score use; a name on disk the roster never listed was not
// there at the time, and reporting it 'installed and never used' is exactly the drift.
function applySessionRoster(inv, main) {
  const skills = main.availableSkills, agents = main.availableAgents;
  if ((!skills || !skills.length) && (!agents || !agents.length)) return inv;
  const out = { ...inv };
  const from = [];
  if (skills && skills.length) {
    const onDisk = new Map(inv.skills.map((x) => [x.name, x]));
    out.skills = skills.map((n) => onDisk.get(n) || { name: n, file: null }).sort(byName);
    from.push(`${skills.length} skills`);
  }
  if (agents && agents.length) {
    const onDisk = new Map(inv.agents.map((x) => [x.name, x]));
    out.agents = agents.map((n) => onDisk.get(n) || { name: n, file: null, skills: [] }).sort(byName);
    from.push(`${agents.length} agent types`);
  }
  out.why = `${from.join(' and ')} from the session's own roster (the harness's skill / agent listing in this transcript), the rest from ${inv.why}`;
  return out;
}

const readJsonOr = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };

// A plugin hook's transcript row names it by its `command` - or by its `statusMessage`, which the
// harness writes into the same field when the hook has one (measured: `command: "Loading ponytail
// mode..."`). The spelling drifts between a release and the transcript (`node "${CLAUDE_PLUGIN_ROOT}
// /x.js"` declared, `${CLAUDE_PLUGIN_ROOT}/x.js` recorded by an older one), so both sides are
// compared without quotes, without a leading interpreter, and with `${VAR}` read as `$VAR`.
const HOOK_INTERPRETER_RE = /^(?:node|bash|sh|zsh|python3?|pwsh|powershell)(?:\.exe)?\s+/i;
function hookCommandKey(cmd) {
  return String(cmd || '').replace(/["']/g, '').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, '$$$1')
    .replace(/\s+/g, ' ').trim().replace(HOOK_INTERPRETER_RE, '');
}

// What one install of a plugin declares, read the three ways Claude Code reads it: the plugin's own
// `plugin.json`, its entry in a marketplace manifest (the one its root ships - every stack entry
// shares the repo root - and the one its marketplace was cloned to, where the official `*-lsp`
// entries keep their `lspServers`), and the default files in its root. `hooks` and `lspServers`
// are each an inline object, a path, or a list of either
// (https://code.claude.com/docs/en/plugins-reference, 'Component path fields'). MCP servers are not
// read here at all: a plugin server's tools carry the plugin's name (`mcp__plugin_<p>_<s>__*`), which
// is the whole attribution - matching DECLARED server names instead read only `<root>/.mcp.json`,
// so every inline server (navigation, documentation, memory, the browser engines) scored never used, and
// it credited a bare registration of the same server name to the plugin.
function pluginDeclarations(root, name, marketDir) {
  const out = { hookKeys: new Set(), exts: new Set() };
  const entryIn = (mkFile) => ((readJsonOr(mkFile, {}) || {}).plugins || []).find((x) => x && x.name === name) || null;
  const manifests = [readJsonOr(path.join(root, '.claude-plugin', 'plugin.json'), null), entryIn(path.join(root, '.claude-plugin', 'marketplace.json'))];
  if (marketDir) manifests.push(entryIn(path.join(marketDir, '.claude-plugin', 'marketplace.json')));
  // A file config may wrap its map (`{ "hooks": {...} }`, `{ "mcpServers": {...} }`); inline, it is the map.
  const configs = (v, key) => {
    if (Array.isArray(v)) return v.flatMap((x) => configs(x, key));
    const o = typeof v === 'string' ? readJsonOr(path.join(root, v), null) : v;
    if (!o || typeof o !== 'object') return [];
    return [o[key] && typeof o[key] === 'object' ? o[key] : o];
  };
  const of = (key, dflt) => [...manifests.filter(Boolean).flatMap((m) => configs(m[key], key)), ...configs(dflt, key)];
  for (const map of of('hooks', 'hooks/hooks.json')) {
    for (const groups of Object.values(map)) for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g && Array.isArray(g.hooks) ? g.hooks : []) {
        if (h && h.command) out.hookKeys.add(hookCommandKey(h.command));
        if (h && h.statusMessage) out.hookKeys.add(hookCommandKey(h.statusMessage));
      }
    }
  }
  for (const map of of('lspServers', '.lsp.json')) {
    for (const srv of Object.values(map)) for (const ext of Object.keys((srv && srv.extensionToLanguage) || {})) out.exts.add(ext);
  }
  return out;
}

// installed_plugins.json keys are `<plugin>@<marketplace>`; each value is the per-scope install
// records - `scope`, a `projectPath` for a project- or local-scope one, `installedAt`, and the
// `installPath` its agents, hooks and language servers are read from. The records are
// KEPT, because a plugin is installed in a session only where one of them reaches it: counting
// every registry plugin in every session reported `installed in 532/532` for a plugin one project
// had. The config dir (the registry's grandparent, when it sits in `plugins/`) gives the user
// settings and the marketplace list beside it.
function loadPlugins(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  else {
    if (process.env.CLAUDE_CONFIG_DIR) cands.push(path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'));
    cands.push(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'));
  }
  for (const f of cands) {
    const j = readJsonOr(f, null);
    if (!j) continue;
    const markets = readJsonOr(path.join(path.dirname(f), 'known_marketplaces.json'), {}) || {};
    const byPlugin = new Map();
    for (const [key, recs] of Object.entries(j.plugins || {})) {
      const [name, market] = key.split('@');
      const e = byPlugin.get(name) || { name, agents: [], hookKeys: [], exts: [], records: [] };
      const marketDir = market && markets[market] && markets[market].installLocation;
      for (const r of Array.isArray(recs) ? recs : []) {
        if (!r || typeof r !== 'object') continue;
        e.records.push({ key, scope: r.scope || null, projectPath: r.projectPath || null, installedAt: r.installedAt || null });
        const root = r.installPath;
        if (!root) continue;
        for (const a of loadAgentsDir(path.join(root, 'agents'))) if (!e.agents.includes(a.name)) e.agents.push(a.name);
        const d = pluginDeclarations(root, name, marketDir);
        for (const [list, set] of [[e.hookKeys, d.hookKeys], [e.exts, d.exts]]) for (const x of set) if (!list.includes(x)) list.push(x);
      }
      byPlugin.set(name, e);
    }
    const configDir = path.basename(path.dirname(f)) === 'plugins' ? path.dirname(path.dirname(f)) : null;
    return { list: [...byPlugin.values()].sort(byName), source: f, configDir, settings: new Map() };
  }
  return { list: null, source: 'unknown', configDir: null, settings: new Map() };
}

// One spelling per path, so a registry and a transcript written on the same machine compare equal.
function samePath(a, b) {
  const norm = (p) => {
    const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[A-Za-z]:\//.test(s) ? s.toLowerCase() : s;
  };
  return !!a && !!b && norm(a) === norm(b);
}

// The enable a session saw: `enabledPlugins` in the project's `settings.local.json`, then its
// `settings.json`, then the user settings - the first file that names the plugin decides. Read NOW,
// not as it stood when the session ran; a plugin no reachable file names counts as enabled, because
// a registry copied off another machine travels without the settings that would say otherwise.
function pluginEnabled(reg, key, cwd) {
  const files = cwd ? [path.join(cwd, '.claude', 'settings.local.json'), path.join(cwd, '.claude', 'settings.json')] : [];
  if (reg.configDir) files.push(path.join(reg.configDir, 'settings.json'));
  for (const f of files) {
    if (!reg.settings.has(f)) {
      const s = readJsonOr(f, null);
      reg.settings.set(f, s && s.enabledPlugins && typeof s.enabledPlugins === 'object' ? s.enabledPlugins : null);
    }
    const on = reg.settings.get(f);
    if (on && Object.prototype.hasOwnProperty.call(on, key)) return on[key] !== false;
  }
  return true;
}

// A record reaches a session when its scope covers the session's cwd (user scope covers every one,
// a project or local one only its own `projectPath` - exact, since that is the directory the
// install ran in and the one whose settings file enables it), it existed before the session ended,
// and the settings chain does not switch it off.
function pluginReaches(reg, p, session) {
  return (p.records || []).some((r) => {
    if (r.installedAt && session.lastTs && session.lastTs < r.installedAt) return false;
    const projectScoped = !!r.projectPath || r.scope === 'project' || r.scope === 'local';
    if (projectScoped && !samePath(r.projectPath, session.cwd)) return false;
    return pluginEnabled(reg, r.key, session.cwd);
  });
}

// `.mcp.json` sits beside `.claude` at the project root. Only a PROJECT inventory has one that
// means anything - the catalog fallback would read this repo's own file and call it the install.
function loadMcpInventory(inv) {
  if (!inv || inv.kind !== 'project' || !inv.dir) return { names: null, source: 'the servers seen in tool names' };
  const f = path.join(path.dirname(inv.dir), '.mcp.json');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { names: Object.keys(j.mcpServers || {}).sort(), source: f };
  } catch { return { names: null, source: 'the servers seen in tool names' }; }
}

// One accumulator, fed one session at a time, so the rollup over a whole corpus never holds every
// session's stats in memory at once - `used in N of M sessions` is the corpus answer, and the
// never-used set per layer is the question that filed this block.
//
// The installed set is resolved PER SESSION, from that session's own cwd: a corpus spans projects
// that installed different things, and seeding one project's inventory over all of them reports a
// name as unused in projects that never had it. Every name therefore carries `installedIn` beside
// `sessionsUsed`, the unused line names only what was installed somewhere, and the resolution is
// cached by cwd - so the single-project folder, where every session shares one cwd, still resolves
// exactly once.
function newInventoryUse(plugins) {
  return {
    plugins, sessions: 0, invCache: new Map(), sources: new Set(), mcpSources: new Set(), vintage: null,
    skills: new Map(), agents: new Map(), rules: new Map(), plugins_: new Map(), mcps: new Map(),
  };
}

// ---------- session VINTAGE: what this session actually loaded ----------
// A report is written days or weeks after the session it grades, and it graded that session
// against TODAY's skill text - 136 of 154 audited reports were built after the rule they cite had
// landed. Two facts settle it, both machine-readable: the install stamp (the version on disk and
// WHEN it was installed, against the session's own window) and the skill BODY the transcript
// carries (`invoked_skills`), compared with the source that same body would be read from now.
// The heading sequence is the comparison, with the char delta beside it: the loaded copy has its
// placeholders expanded, so bytes differ where the document does not.
function buildVintage(inv, main) {
  const bySkill = new Map((inv.skills || []).map((s) => [s.name, s]));
  const rows = [];
  const loaded = main.loadedSkillBodies || {};
  for (const [name, l] of Object.entries(loaded)) {
    const entry = bySkill.get(name) || bySkill.get(String(name).split(':').pop());
    const file = entry && entry.file ? entry.file : null;
    const body = file ? skillBodyOf(readHead(file)) : '';
    const cur = body ? { chars: body.length, headings: headingFingerprint(body) } : null;
    const delta = cur ? cur.chars - l.chars : null;
    const verdict = !cur ? 'current source unreachable - the loaded body is the only copy'
      : cur.headings !== l.headings ? 'DIFFERS - the current source has different sections'
        : Math.abs(delta) > Math.max(64, Math.round(0.01 * l.chars)) ? `DIFFERS - same sections, ${delta > 0 ? '+' : ''}${delta} chars in the current source`
          : 'same';
    rows.push({ name, how: l.via === 'slash' ? 'slash command' : 'Skill call', loadedChars: l.chars, currentChars: cur ? cur.chars : null, file, verdict, ts: l.ts });
  }
  // A run whose body never reached the transcript is NOT a match - say so rather than comparing
  // against a source nothing proves the session saw.
  const ran = new Set([...Object.keys(main.skillInvocations || {}), ...Object.keys(main.commandInvocations || {})]);
  for (const name of ran) {
    if (loaded[name]) continue;
    const how = main.skillInvocations && main.skillInvocations[name] ? 'Skill call' : 'slash command';
    // `/clear`, `/model`, `/exit` are the harness's own commands, not a skill body anything could
    // be graded against - the same discriminator the SKILLS rows use.
    if (how === 'slash command' && !bySkill.has(name) && !name.includes(':')) continue;
    rows.push({ name, how, loadedChars: null, currentChars: null, file: (bySkill.get(name) || {}).file || null, verdict: 'body not captured - this transcript carries no loaded copy, so no comparison is possible', ts: null });
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { stamp: inv.stamp || null, drifted: !!inv.drifted, inventoryWhy: inv.why, rows };
}

// The DISK side is cached per cwd and per session vintage (the stamp comparison depends on the
// session's own last timestamp); the session roster is layered on top per session, never cached -
// two sessions sharing a cwd can have been offered different sets.
function inventoryFor(acc, inventoryDir, main) {
  const cwd = main.cwd;
  const key = `${inventoryDir || ''}|${cwd || ''}|${main.lastTs || ''}`;
  let hit = acc.invCache.get(key);
  if (!hit) {
    const inv = resolveInventory(inventoryDir, cwd, main.lastTs);
    hit = { inv, mcp: loadMcpInventory(inv) };
    acc.invCache.set(key, hit);
  }
  return { inv: applySessionRoster(hit.inv, main), mcp: hit.mcp };
}

// A stack item's name as the inventory keys it: the house plugin scope stripped (`alfred-code:task-solve`, a 1.x
// `claude-stack-wpf:wpf-implementer`), and an old name a release renamed read as its new one (manifest `renamed`). // legacy-name
let houseRenamed = null;
function houseBare(name) {
  const { BRAND, LEGACY } = require('./install/brand.js');
  if (!houseRenamed) { const { renamed } = loadManifest(path.join(__dirname, '..')); houseRenamed = { ...renamed.skills, ...renamed.agents }; }
  const bare = String(name || '').replace(new RegExp(`^(?:${BRAND.core}|${LEGACY.core})(?:-[a-z0-9-]+)?:`), '');
  return Object.hasOwn(houseRenamed, bare) ? houseRenamed[bare] : bare;
}

function addSessionUse(acc, main, agents, inventoryDir) {
  acc.sessions += 1;
  const { inv, mcp } = inventoryFor(acc, inventoryDir, main);
  acc.sources.add(inv.why);
  acc.mcpSources.add(mcp.source);
  if (!acc.vintage) acc.vintage = buildVintage(inv, main);
  const invSource = inv.kind === 'catalog' ? 'catalog' : 'installed';
  const install = (map, name, source, extra) => {
    let r = map.get(name);
    if (!r) { r = { name, source, used: 'no', how: {}, firstTs: null, sessionsUsed: 0, installedIn: 0 }; map.set(name, r); }
    r.installedIn += 1;
    // a real project inventory outranks a catalog label, and both outrank 'observed'
    if (source === 'installed' || r.source === 'observed') r.source = source;
    Object.assign(r, extra || {});
    return r;
  };
  // A roster-sourced name is INSTALLED by the session's own record, whatever the disk side is.
  const rostered = (list) => (list && list.length ? 'installed' : invSource);
  for (const s of inv.skills) install(acc.skills, s.name, rostered(main.availableSkills));
  for (const a of inv.agents) install(acc.agents, a.name, rostered(main.availableAgents));
  for (const r of inv.rules) {
    const row = install(acc.rules, r.name, invSource);
    // A rule path-scoped in ANY install is observable; only one that is always-on everywhere is not.
    if (!r.alwaysOn) row.alwaysOn = false;
    else if (row.alwaysOn !== false) row.alwaysOn = true;
    if (row.used === 'no' && row.alwaysOn) row.used = 'not observable';
    if (row.used === 'not observable' && row.alwaysOn === false) row.used = 'no';
  }
  for (const m of mcp.names || []) install(acc.mcps, m, 'installed');

  const srcs = [main, ...agents.map((a) => a.stats)];
  const seen = new Set();
  const ensure = (map, name, extra) => {
    let r = map.get(name);
    if (!r) { r = { name, source: 'observed', used: 'no', how: {}, firstTs: null, sessionsUsed: 0, installedIn: 0, ...(extra || {}) }; map.set(name, r); }
    return r;
  };
  const mark = (row, how, count, ts) => {
    if (!count) return;
    row.used = 'yes';
    row.how[how] = (row.how[how] || 0) + count;
    if (ts && (!row.firstTs || ts < row.firstTs)) row.firstTs = ts;
    seen.add(row);
  };

  // The stack's own skills and agents ship as plugins, so a call or a dispatch arrives under the
  // plugin-scoped name (`alfred-code:task-solve-cross`, `claude-stack-wpf:wpf-implementer`)
  // while the INVENTORY keys everything bare. Joining the two without this strips nothing and the
  // row silently splits in two - one 'installed, never used' and one 'used, not installed'. A
  // FOREIGN namespace (`superpowers:...`) is left whole: it is not this stack's item. A session
  // recorded before 2.0.0 names the same items under the 1.x plugin names, and one recorded before a rename
  // (2.2.0 dropped the `alfred-` prefix) under the old item name - read under the new one (houseBare).

  // --- skills: the Skill tool, the slash route, and the seats' frontmatter preload
  const namespaced = new Map();   // `<plugin>:<x>` called or typed - the plugin layer's evidence
  const nsPreload = new Map();    // `<plugin>:<x>` named in a dispatched seat's `skills:` list
  const noteNs = (map, name, n, ts) => {
    if (!name.includes(':')) return;
    const ns = name.split(':')[0];
    const e = map.get(ns) || { n: 0, firstTs: null };
    e.n += n;
    if (ts && (!e.firstTs || ts < e.firstTs)) e.firstTs = ts;
    map.set(ns, e);
  };
  for (const src of srcs) {
    for (const [name, v] of Object.entries(src.skillInvocations || {})) {
      mark(ensure(acc.skills, houseBare(name)), 'Skill call', v.calls, v.firstTs);
      noteNs(namespaced, name, v.calls, v.firstTs);
    }
    for (const [name, n] of Object.entries(src.commandInvocations || {})) {
      const ts = (src.commandFirstTs || {})[name] || null;
      noteNs(namespaced, name, n, ts);
      // `/clear`, `/model`, `/effort` are the harness's own commands, not skills - a slash turn
      // only counts against the skills layer when a skill of that name is installed, or when its
      // expansion carried a skill body (a manual-only skill is in no roster).
      const isSkill = (src.slashSkillRuns || {})[name];
      if (!acc.skills.has(houseBare(name)) && !isSkill) continue;
      mark(ensure(acc.skills, houseBare(name)), 'slash command', n, ts);
    }
  }

  // --- agents: every dispatch, main session and nested
  const dispatched = new Map();
  for (const src of srcs) for (const d of src.agentDispatches || []) {
    if (!d.subagentType) continue;
    const e = dispatched.get(d.subagentType) || { n: 0, firstTs: null };
    e.n += 1;
    if (d.ts && (!e.firstTs || d.ts < e.firstTs)) e.firstTs = d.ts;
    dispatched.set(d.subagentType, e);
  }
  for (const [type, e] of dispatched) mark(ensure(acc.agents, houseBare(type)), 'dispatched', e.n, e.firstTs);
  // A seat transcript whose dispatch row sits outside the window (or in another file) is still
  // proof the seat ran - counted apart so the two numbers never merge into a wrong dispatch count.
  for (const a of agents) {
    const t = a.meta && a.meta.agentType;
    if (!t || dispatched.has(t)) continue;
    mark(ensure(acc.agents, houseBare(t)), 'seat transcript', 1, a.stats.firstTs);
  }
  for (const [type, e] of dispatched) {
    const meta = inv.agents.find((x) => x.name === houseBare(type));
    if (!meta) continue;
    for (const sk of meta.skills) {
      mark(ensure(acc.skills, houseBare(sk)), `preloaded via ${type}`, e.n, e.firstTs);
      // A PLUGIN skill named in a seat's preload list is that plugin's body entering the seat's
      // context - plugin use, on a different evidence line from a call the session made itself.
      noteNs(nsPreload, sk, e.n, e.firstTs);
    }
  }

  // --- rules: two direct records, then the glob proxy as the floor under them
  for (const src of srcs) for (const [file, e] of Object.entries(src.ruleAttachments || {})) {
    const row = ensure(acc.rules, file, { alwaysOn: false, globs: [] });
    mark(row, 'attached (transcript record)', e.records || 0, e.firstTs);
    mark(row, 'shell-route notice', e.shellNotices || 0, e.firstTs);
  }
  for (const r of inv.rules) {
    if (r.alwaysOn || !r.globs.length) continue;
    const res = r.globs.map(globToRe);
    let n = 0;
    let first = null;
    for (const src of srcs) for (const [p, t] of Object.entries(src.fileTouches || {})) {
      if (!res.some((re) => re.test(String(p).replace(/\\/g, '/')))) continue;
      n += t.n;
      if (t.firstTs && (!first || t.firstTs < first)) first = t.firstTs;
    }
    mark(acc.rules.get(r.name), 'glob proxy', n, first);
  }

  // --- MCP servers
  for (const src of srcs) for (const [server, m] of Object.entries(src.mcp || {})) mark(ensure(acc.mcps, server), 'calls', m.calls, m.firstTs);

  // --- plugins: which ones this session HAD, then what it did with them. Had = a registry record
  // reaches the session (`pluginReaches`), or the session's own roster lists a skill or agent under
  // the plugin's namespace. Used = a namespaced skill or command, one of its agents dispatched, a
  // `mcp__plugin_<p>_...` call, one of its hooks on record, or, for a language server, a
  // diagnostics attachment for an extension it maps (else an `LSP` call, which names no file).
  // A use the registry never placed there still proves the plugin was loaded, so it counts as
  // installed in that session too - `used` can never outrun `installed`.
  const plugins = acc.plugins.list || [];
  const rosterNs = new Set([...(main.availableSkills || []), ...(main.availableAgents || [])]
    .filter((n) => String(n).includes(':')).map((n) => String(n).split(':')[0]));
  const loadedHere = new Set(plugins.filter((p) => rosterNs.has(p.name) || pluginReaches(acc.plugins, p, main)).map((p) => p.name));
  // One hook command or file extension several plugins declare goes to the ones this session had,
  // and to every claimant only when it had none of them.
  const owners = (cands) => {
    const here = cands.filter((p) => loadedHere.has(p.name));
    return here.length ? here : cands;
  };
  const tally = (key) => {
    const m = new Map();
    for (const src of srcs) for (const [k, e] of Object.entries(src[key] || {})) {
      const t = m.get(k) || { n: 0, firstTs: null };
      t.n += e.n;
      if (e.firstTs && (!t.firstTs || e.firstTs < t.firstTs)) t.firstTs = e.firstTs;
      m.set(k, t);
    }
    return m;
  };
  const lsp = { n: 0, firstTs: null };
  for (const src of srcs) {
    const t = (src.toolCalls || {}).LSP;
    if (!t) continue;
    lsp.n += t.calls;
    if (t.firstTs && (!lsp.firstTs || t.firstTs < lsp.firstTs)) lsp.firstTs = t.firstTs;
  }
  const pluginRow = (p) => ensure(acc.plugins_, p.name);
  for (const p of plugins) {
    const ns = namespaced.get(p.name);
    if (ns) mark(pluginRow(p), 'namespaced skill/command', ns.n, ns.firstTs);
    const pre = nsPreload.get(p.name);
    if (pre) mark(pluginRow(p), 'preloaded skill', pre.n, pre.firstTs);
    for (const ag of p.agents) if (dispatched.has(ag)) mark(pluginRow(p), `agent ${ag}`, dispatched.get(ag).n, dispatched.get(ag).firstTs);
    for (const src of srcs) {
      const pm = (src.pluginMcp || {})[p.name];
      if (pm) for (const [sv, n] of Object.entries(pm.servers)) mark(pluginRow(p), `mcp ${sv}`, n, pm.firstTs);
    }
    if (/-lsp$/.test(p.name) && lsp.n) mark(pluginRow(p), 'LSP call', lsp.n, lsp.firstTs);
  }
  for (const [k, e] of tally('hookCommands')) {
    for (const p of owners(plugins.filter((x) => (x.hookKeys || []).includes(k)))) mark(pluginRow(p), 'hook', e.n, e.firstTs);
  }
  for (const [ext, e] of tally('diagnostics')) {
    // A language server whose extension map could not be read claims only what no known map does.
    let cands = plugins.filter((x) => (x.exts || []).includes(ext));
    if (!cands.length) cands = plugins.filter((x) => /-lsp$/.test(x.name) && !(x.exts || []).length);
    for (const p of owners(cands)) mark(pluginRow(p), `diagnostics ${ext}`, e.n, e.firstTs);
  }
  for (const p of plugins) {
    const row = acc.plugins_.get(p.name);
    if (loadedHere.has(p.name) || (row && seen.has(row))) install(acc.plugins_, p.name, 'installed');
  }
  // A namespace no registry lists is scored here - in EVERY session that used it. Skipping a name
  // whose row already existed scored it only in the first session, so it never read above 1.
  const registered = new Set(plugins.map((p) => p.name));
  for (const [ns, e] of namespaced) if (!registered.has(ns)) mark(ensure(acc.plugins_, ns), 'namespaced skill/command', e.n, e.firstTs);
  for (const [ns, e] of nsPreload) if (!registered.has(ns)) mark(ensure(acc.plugins_, ns), 'preloaded skill', e.n, e.firstTs);

  for (const row of seen) row.sessionsUsed += 1;
}

const LAYER_LABEL = { skills: 'skills', agents: 'agents', rules: 'rules', plugins: 'plugins', mcps: 'MCP servers' };

function finishInventoryUse(acc) {
  const shape = (row) => ({
    name: row.name,
    source: row.source,
    used: row.used,
    how: Object.entries(row.how).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`),
    firstUse: row.firstTs,
    installedIn: row.installedIn,
    sessionsUsed: row.sessionsUsed,
    ofSessions: acc.sessions,
  });
  const layer = (map) => [...map.values()].sort(byName).map(shape);
  // A run spanning several projects has several inventories; name them all when they are few and
  // say how many when they are not - the label is what tells a reader whether a denominator is
  // this project's or the stack catalog's.
  const srcLine = (set) => {
    const list = [...set];
    if (!list.length) return 'none reachable on this machine';
    return list.length <= 3 ? list.join('; ') : `${list.length} inventories across the run: ${list.slice(0, 3).join('; ')}, …`;
  };
  return {
    source: {
      skills_agents_rules: srcLine(acc.sources),
      plugins: acc.plugins.source,
      mcps: srcLine(acc.mcpSources),
      sessions: acc.sessions,
      inventories: acc.sources.size,
    },
    vintage: acc.vintage,
    skills: layer(acc.skills),
    agents: layer(acc.agents),
    rules: layer(acc.rules),
    plugins: layer(acc.plugins_),
    mcps: layer(acc.mcps),
  };
}

// One split, two renderers - the text block and the markdown section can never disagree.
// A name is UNUSED only when something installed it: a skill this corpus never installed anywhere
// cannot be a non-use finding, and listing it as one is the exact mistake the per-session
// inventory exists to prevent.
function inventoryLayers(invUse) {
  const label = (r) => (r.installedIn && r.installedIn < r.ofSessions ? `${r.name} (installed in ${r.installedIn}/${r.ofSessions})` : r.name);
  return ['skills', 'agents', 'rules', 'plugins', 'mcps'].map((key) => {
    const rows = invUse[key] || [];
    const installed = rows.filter((r) => r.installedIn > 0);
    return {
      key,
      label: LAYER_LABEL[key],
      used: rows.filter((r) => r.used === 'yes'),
      usedInstalled: rows.filter((r) => r.used === 'yes' && r.installedIn > 0).length,
      unused: rows.filter((r) => r.used === 'no' && r.installedIn > 0).map(label),
      notObservable: rows.filter((r) => r.used === 'not observable').map(label),
      observedOnly: rows.filter((r) => r.installedIn === 0 && r.used === 'yes').length,
      total: installed.length,
      rows: rows.length,
    };
  });
}

const usedCell = (r) => (r.ofSessions > 1 ? `yes (${r.sessionsUsed}/${r.ofSessions})` : 'yes');
const installedCell = (r) => (r.installedIn ? `${r.installedIn}/${r.ofSessions}` : '-');

// ---------- transcript analysis (main session or one subagent) ----------

// ---------- one quoted-span-and-heredoc discipline, four consumers ----------
// The same root defect appeared in the commit guard, the publish guard, this script's commit
// counter and this script's doc matcher: a literal sitting inside PROSE - a heredoc body, a quoted
// string - read as an invocation. Here it manufactured `git commits 12` for a session that made
// ZERO, and phantom `flow/COMMIT-GATE` writes, which is the exact fact a protocol check turns on
// (patched replay of the doc table: 61 rows -> 24).
//
// A heredoc body is DATA when it goes to `cat > file` and CODE when it is fed to an interpreter,
// so only the first kind is masked - blanking both would erase the python doc writes that reach a
// file from inside a heredoc, which is how this script sees batched doc I/O at all.
const INTERP_RE = /\b(?:python[\d.]*|node|nodejs|ruby|perl|php|deno|bun|osascript|pwsh|powershell)\b/;
function maskHeredocs(cmd) {
  return String(cmd).replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^[ \t]*\2[ \t\r]*$/gm,
    (m, _q, _tag, off, whole) => {
      const header = whole.slice(whole.lastIndexOf('\n', off) + 1, off);
      if (INTERP_RE.test(header)) return m;               // an inline script - real code
      const nl = m.indexOf('\n');
      return nl === -1 ? m : m.slice(0, nl) + m.slice(nl).replace(/[^\n]/g, ' ');
    },
  );
}
// Length-preserving and NON-space, so a masked span stays one opaque argument token rather than
// dissolving the command around it (that is what un-gated `git -C "<dir>" commit` in the guard).
const maskQuoted = (cmd) => String(cmd)
  .replace(/'[^'\n]*'/g, (m) => m.replace(/[^\n]/g, 'x'))
  .replace(/"[^"\n]*"/g, (m) => m.replace(/[^\n]/g, 'x'));

// ---------- is this file a FORK, and of which parent? ----------
// A FORK's transcript opens as a copy of its parent's rows, each copied row keeping the parent's
// snake-case `session_id` while `sessionId` is rewritten to the fork's own id - two forks of one
// conversation shared 90-92 assistant ids with their parent and the rollup counted that run three
// times. But a `/clear` does the same thing to the id and is NOT a fork: it starts a new session
// whose rows keep the previous id (verified against the current Claude Code docs - `/clear` starts
// a new session, a fork is `--fork-session` / `/fork`; and measured on 9 local transcripts, 51 to
// 2,300 foreign rows apiece, every one opening on `/clear`, ZERO assistant message ids shared with
// the named parent). Reading the id alone as 'already billed elsewhere' labelled 21 of 115 audited
// sessions that way - 329.4M tokens - and blanked their efficiency scorecards.
//
// So the id only NAMES a candidate parent; the proof is the MESSAGE. A row is prefix when its
// assistant `message.id` is in that parent's own transcript, and a file whose first `/clear`
// marker precedes its first assistant row is never a fork at all.
const ORIGIN_ID_RE = /"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/;
const CLEAR_MARKER_RE = /<command-name>\s*\/?\s*clear\s*<\/command-name>/;
async function forkParents(file, ownId, isSessionId) {
  const out = { ids: new Set(), origins: new Set() };
  if (!isSessionId(ownId)) return out;
  // Pass 1, regex only - no JSON.parse, so naming the candidate parents costs one cheap scan.
  const candidates = new Set();
  let sawAssistant = false;
  let clearOpened = false;
  await new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    rl.on('line', (l) => {
      if (!sawAssistant) {
        if (CLEAR_MARKER_RE.test(l)) clearOpened = true;
        if (/"type"\s*:\s*"assistant"/.test(l)) sawAssistant = true;
      }
      const m = ORIGIN_ID_RE.exec(l);
      if (m && m[1] !== ownId) candidates.add(m[1]);
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
  if (clearOpened || !candidates.size) return out;
  // Pass 2: the named parent's own assistant message ids. A parent this machine cannot reach
  // proves nothing, so its rows stay this file's own - an undercount of the prefix is recoverable,
  // a whole session billed to someone else is not.
  const parentIds = new Map();
  for (const origin of candidates) {
    const parent = path.join(path.dirname(file), `${origin}.jsonl`);
    if (!fs.existsSync(parent)) continue;
    const ids = new Set();
    await readJsonl(parent, (o) => { if (o.type === 'assistant' && o.message && o.message.id) ids.add(o.message.id); });
    if (ids.size) parentIds.set(origin, ids);
  }
  if (!parentIds.size) return out;
  // Pass 3: confirm the copy. Only foreign assistant rows are parsed, and the scan stops at the
  // first shared message id per parent - in a real fork that lands within the first rows.
  await new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    rl.on('line', (l) => {
      if (parentIds.size === out.origins.size) return;
      const m = ORIGIN_ID_RE.exec(l);
      if (!m || m[1] === ownId || out.origins.has(m[1]) || !parentIds.has(m[1])) return;
      if (!/"type"\s*:\s*"assistant"/.test(l)) return;
      let o;
      try { o = JSON.parse(l); } catch { return; }
      const id = o.type === 'assistant' && o.message ? o.message.id : null;
      if (id && parentIds.get(m[1]).has(id)) out.origins.add(m[1]);
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
  for (const origin of out.origins) for (const id of parentIds.get(origin)) out.ids.add(id);
  return out;
}

async function analyzeTranscript(file, window) {
  // Rows proven to be a copied prefix are counted apart, and the ledger join runs over the tail.
  const ownId = path.basename(file, '.jsonl');
  const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
  const ownIsSession = SESSION_ID.test(ownId);
  const fork = await forkParents(file, ownId, (x) => SESSION_ID.test(x));
  const s = {
    file,
    cwd: null,                   // the project path on the machine that RAN this session
    fileTouches: {},             // path as the call named it -> { n, firstTs } - the rule glob proxy
    ruleAttachments: {},         // rule file name -> { records, shellNotices, firstTs }
    commandFirstTs: {},          // slash-command name -> first invocation ts
    availableSkills: null,       // the roster the harness gave THIS session (Set) - the installed set at the time
    availableAgents: null,       // the agent types it registered (Set)
    loadedSkillBodies: {},       // skill -> { chars, headings, path, ts, via } - the body the session really loaded
    slashSkillRuns: {},          // slash command -> true when its expansion carried a skill body: a skill run, roster or not
    forkPrefix: { rows: 0, msgs: 0, cacheRead: 0, cacheCreate: 0, output: 0, toolCalls: 0, sessionIds: [] },
    costState: null,             // the cost-state record's own totals - the only side that sees the harness's recap calls
    toolCallIdx: [],             // { ts, tool } per tool_use outside the fork prefix - the per-side ledger join
    total: newTally(),
    byModel: {},                 // model -> tally
    toolCalls: {},               // tool name -> { calls, resultChars, errors }
    skillInvocations: {},        // skill slug -> { calls, injectedChars }
    skillAttribution: {},        // skill slug -> { msgs, output }
    mcp: {},                     // server -> { calls, resultChars, errors, tools: {tool: n} }
    pluginMcp: {},               // plugin -> { calls, servers: {server: n}, firstTs } - `mcp__plugin_<p>_<s>__*` only
    hookCommands: {},            // hookCommandKey of a hook row's command -> { n, firstTs }
    diagnostics: {},             // file extension -> { n, firstTs } - one per diagnostics attachment naming it
    agentDispatches: [],      // Agent/Task tool_use in THIS transcript: {id, desc, subagentType}
    docTouches: {},              // <docs-root>-relative path -> { reads, writes }
    styleRuleAttaches: 0,        // generated project-code-style rule attachments seen in this transcript
    styleInjections: 0,          // legacy inject-code-style hook firings seen in this transcript
    userPrompts: 0,
    compactions: 0,
    compactionEvents: [],        // { ts, pre, post, dropped, durationMs } - one row per compaction
    stopHookBlocks: 0,           // Stop-hook denials: an isMeta user STRING, invisible to is_error
    harnessDenials: 0,           // denials that are the HARNESS's, not a stack hook's - kept out of hook-blk
    denialsByHook: {},           // hook file name (or '(unattributed)') -> denials attributed to it
    topResults: [],              // the N biggest tool results, each with the call's own label
    peakCtx: 0,                  // largest per-message context carried, and where
    peakCtxAt: null,
    floorCtx: 0,                 // smallest per-message context = the standing inventory
    modelIdsFull: [],            // model ids WITH their window suffix, from cost-state
    modelIdReminder: null,       // the id the SESSION was told it is running, from its own reminder
    userInterrupts: 0,           // '[Request interrupted by user]' markers - a stop, never an error
    lastInterruptTs: null,
    totalCostUSD: null,
    thinkingTokens: 0,           // from cost-state.modelUsage - unattributable to any one message
    commandInvocations: {},      // slash-command name -> count (from <command-name> markers)
    apiErrors: 0,
    apiErrorEvents: [],          // { ts, ctx } - the context level each API error fired at
    firstTs: null,
    lastTs: null,
    spikes: [],                  // top context jumps: {ts, delta, ctx, causes}
    toolCallTs: [],              // one timestamp per tool_use - lets the hook-log join count only in-window calls
    skillTimeline: [],           // { ts, skill|null } - stamp changes in THIS transcript; lets
                                 // the report suggest (never charge) a skill for seats whose
                                 // own transcripts carry no stamp, from their dispatch window
    efficiency: {                // the practice scorecard - measured here, judged in the report
      cacheMisses: 0, cacheMissTokens: 0, expectedRebuilds: 0, expectedRebuildTokens: 0, cacheMissAt: [],
      compactionRereads: [],     // one per compaction: { ts, candidates, files, chars }
      buildDirReads: { calls: 0, chars: 0, paths: {} },
      checks: { test: { calls: 0, chars: 0, scoped: 0, whole: 0 }, build: { calls: 0, chars: 0 }, lint: { calls: 0, chars: 0 }, ci: { calls: 0, chars: 0 } },
      commitsChecked: 0, commitsUnchecked: [],
      greenClaims: 0, unverifiedGreenClaims: [],
      correctionStreaks: [],     // the hook's strict detector: timestamps where it would fire
      correctionTurns: 0,        // short user turns right after a 1,500+ char answer (assistant rows merged)
      correctionsSaved: 0,       // correction turns (the hook's marker test) followed by a memory store within SAVE_WINDOW replies
      correctionsUnsaved: [],    // timestamps of the ones that were not
      longAnswered: 0,           // 1,500+ char answers a user turn followed
      finalAnswers: 0, longAnswers: 0,
      navigation: { reads: 0, located: 0, symbolLocated: 0, grepLocated: 0, symbolCalls: 0, grepCalls: 0 },
    },
  };
  const msgReg = new Map();       // message.id -> {model, skill, carried, u:{in,cc,cr,out}} folded max per field
  const seenToolUse = new Set();  // tool_use id dedup across duplicated assistant lines
  const toolById = new Map();
  // doc writes seen in a Bash command, tallied only once the result shows it executed
  const pendingDocTouch = new Map();     // tool_use id -> { name, skill }
  const pendingGitActs = new Map();      // tool_use id -> { commits, merges } - released on a non-error result
  const promptParents = new Set();       // parentUuid of a counted user turn - siblings are the same turn
  // The ["…/hooks/<file>.js"] bracket is an ATTRIBUTION signal, never the test for a denial: the
  // JSON permission-decision route carries no bracket at all. An unattributable denial still counts,
  // it just lands in its own bucket - the transcript alone records which TOOL was denied, never
  // which hook, and that is the whole reason the hook-block ledger exists.
  const attributeDenial = (text, ts) => {
    // The bracket the harness prints is `[node "<path>/hooks/<file>.js"]` - the interpreter, a
    // SPACE, then the quoted path. The first shape of this pattern allowed no space before the
    // quote and required the quote to sit right after `[`, so it matched none of the 90 real stack
    // denials in the audit corpus and every one of them landed in `(unattributed)` - the bucket
    // meant for the JSON permission-decision route, which made a working attribution look absent.
    // Windows paths arrive backslashed, so both separators are accepted.
    const m = /\[[^\]]*[\/\\]hooks[\/\\]([A-Za-z0-9._-]+\.js)/.exec(text);
    const key = m ? m[1] : '(unattributed)';
    s.denialsByHook = s.denialsByHook || {};
    s.denialsByHook[key] = (s.denialsByHook[key] || 0) + 1;
    // A denial the bracket cannot name is still attributable from the OUTSIDE: every guard writes
    // its own block-ledger row within milliseconds of denying (measured: 0.3s on the case that
    // filed this). Keep the timestamp so the report can join it instead of naming a phantom guard.
    if (!m && ts) (s.unattributedDenials = s.unattributedDenials || []).push(ts);
  };
  let prevCtx = null;
  let pending = [];               // tool results since the previous counted assistant msg
  // One real compaction emits TWO lines (a system compactMetadata + a user isCompactSummary,
  // ms apart) - counting both doubled the number in four audited bundles. Count boundaries;
  // fall back to summaries only for a transcript that carries no boundary lines at all.
  let compactMeta = 0, compactSummary = 0;
  // attributionSkill drops to undefined at an async task-notification and never recovers for
  // the rest of a run (measured: ~2h of one skill's session unattributed). Carry the last
  // stamp forward - reset at a compaction or a new slash command - and count carried msgs
  // separately so the report can say how much attribution is inferred vs stamped.
  let lastSkill = null;
  // A skill invoked within a few messages of another skill's own invocation is that skill's
  // in-protocol reference load (a reviewer loading the house style skill), not a new phase.
  // Without this the stamp switches to the companion and the parent's whole run is
  // misattributed (measured: a review that caught 2 MATERIAL findings shipped in a report
  // as '1 msg - not a review pass of substance').
  const companionOf = {};          // skill -> the parent skill it was loaded in service of
  let activeInvoke = null;         // { skill, msgs } - last non-companion Skill call + msgs since
  let askSinceInvoke = false;      // an AskUserQuestion between the parent invoke and a Skill
  // --- the scorecard's per-transcript trackers ---
  let prevCache = null;            // { cr, cc } of the previous first-sighted API message
  let afterCompaction = false;     // the next API message is an EXPECTED rebuild, not a miss
  const readPaths = new Set();     // every file read so far, by the path the call named
  let toolSeq = 0;                 // tool_use ordinal in this transcript
  const navRecent = [];            // locate class of the last NAV_WINDOW own tool calls
  let lastCheckSeq = -1;           // ordinal of the last test / build / lint / ci-status call
  let turnHadCheck = false;        // a check ran, or a seat was dispatched, since the last human turn
  const msgText = new Map();       // message.id -> text so far (one message arrives as several rows)
  const turns = [];                // { role, len } - the correction-streak view, as the hook builds it
  let pendingSaves = [];           // corrections still inside their save window: { ts, left }
  let lastAsstId = null;
  // A carried stamp ends at the next HUMAN turn that does not CONTINUE the run, not only at the
  // next Skill call: a new request is a new phase, and the carry otherwise charged that phase to
  // whatever skill was last active (measured: one run's later phases billed to a skill that had
  // stopped). A continuation says only 'keep going' - it opens nothing, so the stamp survives it.
  const CONTINUATION_RE = /^(?:y|yes|yep|yeah|ok|okay|k|sure|go|go on|go ahead|continue|proceed|next|do it|carry on|again|да|так|ок|давай|продовжуй|продолжай)\b[\s.!,]*$/i;
  const continuesRun = (t) => t.length <= 60 && CONTINUATION_RE.test(t);
  const onHumanTurn = (typed, ts) => {
    turnHadCheck = false;
    const t = String(typed || '').trim();
    if (!t || /^</.test(t)) return;
    // A human turn closes one reply for every correction still waiting on a memory store.
    pendingSaves = pendingSaves.filter((p) => {
      p.left -= 1;
      if (p.left > 0) return true;
      s.efficiency.correctionsUnsaved.push(p.ts);
      return false;
    });
    if (!continuesRun(t)) {
      if (lastSkill) s.skillTimeline.push({ ts: ts || null, skill: null });
      lastSkill = null;
    }
    const interrupt = /^\[Request interrupted by user/.test(t);
    turns.push({ role: 'user', len: t.length, interrupt });
    // the loose pair first: the answer before this turn, consecutive assistant rows merged
    {
      let j = turns.length - 2, alen = 0;
      while (j >= 0 && turns[j].role === 'assistant') { alen += turns[j].len; j -= 1; }
      if (alen >= STREAK_LONG) {
        s.efficiency.longAnswered += 1;
        if (t.length <= STREAK_SHORT) s.efficiency.correctionTurns += 1;
      }
    }
    // A correction waiting on a save: the hook's single-turn test - an answer before it (an
    // interruption row between them does not count), at most STREAK_SHORT chars, a marker.
    if (!interrupt && t.length <= STREAK_SHORT && correctionMarker(t)) {
      let k = turns.length - 2;
      while (k >= 0 && turns[k].role === 'user' && turns[k].interrupt) k -= 1;
      if (k >= 0 && turns[k].role === 'assistant') pendingSaves.push({ ts: ts || null, left: SAVE_WINDOW });
    }
    let streak = 0;
    for (let i = turns.length - 1; i >= 1; i -= 2) {
      const u = turns[i], a = turns[i - 1];
      if (u.role !== 'user' || a.role !== 'assistant' || u.len === 0 || u.len > STREAK_SHORT || a.len < STREAK_LONG) break;
      streak += 1;
    }
    if (streak === STREAK_TURNS) s.efficiency.correctionStreaks.push(ts || null);
  };
  const openCompactionTracker = (ts) => {
    afterCompaction = true;
    s.efficiency.compactionRereads.push({ ts: ts || null, before: new Set(readPaths), seen: new Set(), files: 0, chars: 0 });
  };
                                   // call means the user gated a NEW phase - never fold it as
                                   // a companion (measured: a post-gate flow folded into the
                                   // ask-side skill and reported as its cost)
  let lastToolName = null;         // attributes isMeta skill-body injections to spike causes
  let slashPending = null;         // { name } - a slash command whose expansion row has not arrived yet
  let prevAssistantNoTool = null;  // ts of an end_turn assistant msg with no tool_use
  s.gitCommits = 0; s.prMerges = 0; s.clearTs = null; s.ccVersion = null;
  s.unheldStopCandidates = [];     // { stopTs, userTs } - free-text user turn right after a
                                   // no-tool end_turn: candidate unheld gate for the report's
                                   // protocol sweep (measured: 5 reports stamped PASS over these)

  await readJsonl(file, (o, raw) => {
    const origin = typeof o.session_id === 'string' ? o.session_id : typeof o.sessionId === 'string' ? o.sessionId : null;
    // The id alone is a candidate, never the verdict: an assistant row is prefix only when the
    // parent's transcript holds its message id, and the other row types only inside a file some
    // assistant row already proved to be a copy of that parent.
    const foreignOrigin = ownIsSession && !!origin && origin !== ownId && fork.origins.has(origin);
    const rowMsgId = o.type === 'assistant' && o.message && typeof o.message.id === 'string' ? o.message.id : null;
    const foreign = foreignOrigin && (rowMsgId ? fork.ids.has(rowMsgId) : true);
    if (foreign) {
      s.forkPrefix.rows += 1;
      if (!s.forkPrefix.sessionIds.includes(origin)) s.forkPrefix.sessionIds.push(origin);
    }
    if (window && o.timestamp) {
      const ts = Date.parse(o.timestamp);
      if ((window.from != null && ts < window.from) || (window.to != null && ts > window.to)) return;
    }
    // An ATTACHMENT is context the session paid for and the accumulator never saw: the largest
    // spike in one bundle printed as '(prompt/attachment only)' with no cause at all, because
    // attachment records never entered `pending`. A file the session itself edited comes back as
    // an attachment too (`edited_text_file`), which an install RUN generates by the dozen.
    if (o.type === 'user' && Array.isArray(o.attachments)) {
      for (const at of o.attachments) {
        const body = typeof at === 'string' ? at : JSON.stringify(at || '');
        pending.push({ name: `attachment:${(at && at.type) || 'text'}`, chars: body.length });
      }
    }
    if (!s.cwd && typeof o.cwd === 'string' && o.cwd) s.cwd = o.cwd;
    // A path-scoped rule ATTACH is observable after all, on two records, both measured in the
    // audit corpus: the harness writes a row whose `attachment.type` is `nested_memory` naming the
    // rule file it just loaded (190 rows across the collection, 11 distinct rules), and
    // guard-read-whole-file's shell-route reminder arrives as a `hook_additional_context`
    // attachment naming the governing rule (157 rows, 10 distinct rules). Neither is inferred, so
    // the glob proxy the report also prints is a FLOOR under them, never the only signal.
    {
      const ats = [];
      if (o.attachment && typeof o.attachment === 'object') ats.push(o.attachment);
      if (Array.isArray(o.attachments)) for (const a of o.attachments) if (a && typeof a === 'object') ats.push(a);
      for (const at of ats) {
        const bump = (ruleFile, key) => {
          const e = s.ruleAttachments[ruleFile] || (s.ruleAttachments[ruleFile] = { records: 0, shellNotices: 0, firstTs: null });
          e[key] += 1;
          if (o.timestamp && (!e.firstTs || o.timestamp < e.firstTs)) e.firstTs = o.timestamp;
        };
        // The session's OWN statement of what it had: the harness writes the skill roster it gave
        // the model (`skill_listing`, carrying `names`) and the agent types it registered
        // (`agent_listing_delta`). That is the installed set AT THE TIME, which the project
        // directory on disk stops being the moment the install moves - the drift that had reports
        // scoring a session against skills it never had.
        if (at.type === 'skill_listing') {
          const names = Array.isArray(at.names) && at.names.length ? at.names
            : [...String(at.content || '').matchAll(/^- ([A-Za-z0-9_:.-]+):/gm)].map((m) => m[1]);
          if (names.length) { s.availableSkills = s.availableSkills || new Set(); for (const n of names) s.availableSkills.add(n); }
        } else if (at.type === 'agent_listing_delta') {
          if (Array.isArray(at.addedTypes) && at.addedTypes.length) {
            s.availableAgents = s.availableAgents || new Set();
            for (const n of at.addedTypes) s.availableAgents.add(n);
          }
          if (Array.isArray(at.removedTypes) && s.availableAgents) for (const n of at.removedTypes) s.availableAgents.delete(n);
        } else if (at.type === 'invoked_skills') {
          // The BODY the session actually loaded, verbatim. It is the only reference a 'the session
          // broke rule X' claim can be checked against - today's SKILL.md is a different document.
          for (const sk of Array.isArray(at.skills) ? at.skills : []) {
            if (!sk || !sk.name) continue;
            const body = skillBodyOf(sk.content);
            if (!body) continue;
            s.loadedSkillBodies[sk.name] = { chars: body.length, headings: headingFingerprint(body), path: sk.path || null, ts: o.timestamp || null };
          }
        }
        // A hook's run is on record when the row names its command: `hook_success`, the error and
        // cancel rows, and a blocking error's inner object. A `hook_additional_context` row names
        // none (measured: 3,470 UserPromptSubmit rows, no command on any), so it proves no owner.
        if (typeof at.type === 'string' && at.type.startsWith('hook_')) {
          const cmd = at.command || (at.blockingError && typeof at.blockingError === 'object' ? at.blockingError.command : null);
          if (cmd) {
            const k = hookCommandKey(cmd);
            const e = s.hookCommands[k] || (s.hookCommands[k] = { n: 0, firstTs: o.timestamp || null });
            e.n += 1;
          }
        } else if (at.type === 'diagnostics' && Array.isArray(at.files)) {
          // A language server's findings for the files it watched - the `*-lsp` plugins' use, which
          // no tool call shows. One count per attachment per extension it names.
          const exts = new Set();
          for (const fl of at.files) {
            const m = /(\.[A-Za-z0-9]+)$/.exec(String((fl && fl.uri) || ''));
            if (m) exts.add(m[1]);
          }
          for (const x of exts) {
            const e = s.diagnostics[x] || (s.diagnostics[x] = { n: 0, firstTs: o.timestamp || null });
            e.n += 1;
          }
        }
        if (at.type === 'nested_memory') {
          const p = String(at.displayPath || at.path || '').replace(/\\/g, '/');
          const m = /(?:^|\/)\.claude\/rules\/([^/]+\.md)$/.exec(p);
          if (m) bump(m[1], 'records');
        } else if (at.type === 'hook_additional_context') {
          const txt = Array.isArray(at.content) ? at.content.join('\n') : String(at.content || '');
          // one notice can name its rule twice - the notice is the event, not each mention
          const named = new Set([...txt.matchAll(/\.claude[\\/]rules[\\/]([A-Za-z0-9._-]+\.md)/g)].map((x) => x[1]));
          for (const r of named) bump(r, 'shellNotices');
        }
      }
    }
    if (STYLE_RULE_MARKERS.some((m) => raw.includes(m))) s.styleRuleAttaches++;
    if (STYLE_INJECT_MARKERS.some((m) => raw.includes(m))) s.styleInjections++;
    if (o.timestamp) { if (!s.firstTs) s.firstTs = o.timestamp; s.lastTs = o.timestamp; }
    if (!s.ccVersion && o.version) s.ccVersion = o.version;
    // TWO records name the model, and they can DISAGREE: `cost-state.modelUsage` keys off the id
    // the billing rows carry, while the session's own reminder names the id it was STARTED on
    // (measured: a bundle whose cost-state said one tier and whose reminder said another - the
    // report picked the wrong window and judged the fresh-session gate against the wrong number).
    // Keep both and say which answered; the reminder is the session's own statement about itself.
    if (!s.modelIdReminder) {
      const mid = raw.match(/exact model ID is ([A-Za-z0-9._:@[\]-]+)/);
      if (mid) s.modelIdReminder = mid[1].replace(/[.,'"`]+$/, '');
    }
    // An interrupt is the USER stopping the turn - it is not a tool error and not a hook block,
    // and a session that ENDS on one ended by hand. Neither fact had a home in the report, so an
    // abandoned run read as a completed one (measured: two rejected approvals, then the marker,
    // then nothing - reported as a clean close).
    // Counted on the PARSED row's own text, never on the raw line: the same marker travels inside
    // a tool_result payload (a grep of a transcript prints it), a queued-command attachment and a
    // queue-operation record, and those outnumbered the real thing - measured across one project's
    // transcripts: 6 genuine interrupts against 7 raw-line hits, none of the 7 an interrupt.
    if (o.type === 'user' && o.message) {
      const c = o.message.content;
      const ownText = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
      if (ownText.includes('[Request interrupted by user')) {
        s.userInterrupts += 1;
        if (o.timestamp) s.lastInterruptTs = o.timestamp;
      }
    }
    // `cost-state` is a record in this same file, and it is the ONLY place two facts survive:
    // the THINKING tokens (billed, attributable to no single message - 86,346 in one session, with
    // all 116 thinking blocks empty, so spike residuals could never be closed), and the model id
    // WITH its window suffix (`claude-opus-5[1m]`) - every assistant message strips it, and the
    // fresh-session threshold is chosen by exactly that suffix.
    if (o.type === 'cost-state' && o.modelUsage) {
      // the record is CUMULATIVE and written more than once per session - take the largest,
      // so a resume that restarts the counter cannot shrink the total
      const think = Object.values(o.modelUsage).reduce((n, v) => n + ((v && v.thinkingTokens) || 0), 0);
      if (think > s.thinkingTokens) s.thinkingTokens = think;
      for (const id of Object.keys(o.modelUsage)) if (!s.modelIdsFull.includes(id)) s.modelIdsFull.push(id);
      if (o.totalCostUSD != null && (s.totalCostUSD == null || o.totalCostUSD > s.totalCostUSD)) s.totalCostUSD = o.totalCostUSD;
      // The bill's own totals: the harness's post-turn recap call (`away_summary`) is billed and
      // written to no transcript row, so this is the only side that sees it.
      const sum = (k) => Object.values(o.modelUsage).reduce((n, v) => n + ((v && v[k]) || 0), 0);
      const cr = sum('cacheReadInputTokens');
      if (!s.costState || cr > s.costState.cacheRead) s.costState = { cacheRead: cr, cacheCreate: sum('cacheCreationInputTokens'), input: sum('inputTokens'), output: sum('outputTokens') };
    }
    if (o.compactMetadata) {
      compactMeta++;
      // The metadata was read and only a COUNT was printed - 738,247 dropped tokens and 4m02s of
      // wall clock discarded across one session's compactions, the single largest unexplained
      // number in several reports.
      const cm = o.compactMetadata;
      const pre = cm.preTokens ?? cm.preCompactTokens ?? null;
      const post = cm.postTokens ?? cm.postCompactTokens ?? null;
      s.compactionEvents.push({
        ts: o.timestamp || null,
        pre,
        post,
        dropped: pre != null && post != null ? pre - post : null,
        durationMs: cm.durationMs ?? cm.duration ?? null,
        trigger: cm.trigger || null,
      });
      if (lastSkill) s.skillTimeline.push({ ts: o.timestamp || null, skill: null });
      lastSkill = null;
      openCompactionTracker(o.timestamp);
    }
    if (o.isCompactSummary) {
      compactSummary++;
      // a transcript generation with no boundary line: the summary is the only marker
      if (compactMeta === 0) openCompactionTracker(o.timestamp);
    }
    // Record the context level each API error fired at - reports guessed at causes when
    // errors clustered at high ctx (measured: 22 errors at ~200k ctx read as flakiness).
    if (o.isApiErrorMessage) { s.apiErrors++; s.apiErrorEvents.push({ ts: o.timestamp || null, ctx: prevCtx }); }
    // Count slash commands only from the session's OWN user turns - the old whole-line scan
    // also matched markers quoted inside tool_result payloads (measured: a foreign session's
    // /exit surfaced as this session's own invocation in two bundles), and a non-global
    // match dropped every marker after the first on a line.
    // A slash run's body is the isMeta row the expansion writes right after the command (`Base directory for this
    // skill: ...`), never an `invoked_skills` attachment - and a manual-only skill is in no roster, so without it the
    // run read as a harness command (11b595da: 'No skill or slash-command run', 'used 0 of 72').
    if (slashPending && o.type === 'user' && o.message) {
      const c = o.message.content;
      const txt = Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('\n') : '';
      if (o.isMeta && /^Base directory for this skill:/.test(txt)) {
        const body = skillBodyOf(txt);
        const dir = (/^Base directory for this skill:\s*(.*)/.exec(txt) || [])[1] || null;
        if (body) {
          s.loadedSkillBodies[slashPending.name] = { chars: body.length, headings: headingFingerprint(body), path: dir && dir.trim(), ts: o.timestamp || null, via: 'slash' };
          s.slashSkillRuns[slashPending.name] = true;
        }
        slashPending = null;
      } else if (!o.isMeta && !raw.includes('<command-name>')) slashPending = null;
    } else if (o.type === 'assistant') slashPending = null;
    if (o.type === 'user' && o.message && raw.includes('<command-name>')) {
      const own = typeof o.message.content === 'string' ? o.message.content
        : Array.isArray(o.message.content) ? o.message.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n') : '';
      // A LEADING SPACE inside the tag suppressed the match, and a whole guided-command run then
      // charged its ~2.75M to the previous command's window instead of appearing in the SKILLS
      // table at all.
      for (const m of own.matchAll(/<command-name>\s*\/?\s*([A-Za-z0-9_:-]+)\s*<\/command-name>/g)) {
        s.commandInvocations[m[1]] = (s.commandInvocations[m[1]] || 0) + 1;
        slashPending = { name: m[1] };
        if (!s.commandFirstTs[m[1]]) s.commandFirstTs[m[1]] = o.timestamp || null;
        if (lastSkill) s.skillTimeline.push({ ts: o.timestamp || null, skill: null });
        lastSkill = null; // a new slash command ends the previous skill's carry-forward
        // A slash command opens a companion window too: a reference skill loaded in its
        // first messages serves the command, not a phase of its own (measured: a style
        // skill loaded by a command's step charged as a standalone run).
        // `/clear` is a harness reset, not a skill: opening a window for it parks the whole
        // session's real work under a phantom `clear` row and glues the genuine skills onto it
        // as companions (measured: 4 sessions, one with 62 of 71 messages mis-bucketed).
        activeInvoke = m[1] === 'clear' ? null : { skill: m[1], msgs: 0 };
        askSinceInvoke = false;
        // A mid-file /clear starts a new working window: raw first->last spans across it
        // read as a multi-day session at ~6% ledger coverage when the real work window was
        // ~89 min at ~96% (measured) - record the boundary so printers can show both.
        if (m[1] === 'clear' && o.timestamp) s.clearTs = o.timestamp;
      }
    }

    if (o.type === 'assistant' && o.message) {
      const m = o.message;
      // usage: fold as max per field per message.id (duplicate lines repeat identical
      // usage in main sessions but progressive streaming snapshots in subagent files)
      if (m.usage && m.id && m.model !== '<synthetic>') {
        if (o.attributionSkill) {
          if (o.attributionSkill !== lastSkill) s.skillTimeline.push({ ts: o.timestamp || null, skill: o.attributionSkill });
          lastSkill = o.attributionSkill;
        }
        let r = msgReg.get(m.id);
        if (!r) {
          r = { model: m.model, skill: o.attributionSkill || lastSkill || null, carried: !o.attributionSkill && !!lastSkill, foreign, u: { in: 0, cc: 0, cr: 0, out: 0 }, split: false, c1h: 0, fast: false };
          msgReg.set(m.id, r);
          if (activeInvoke) activeInvoke.msgs += 1;
          // context size is fixed at message start, so first sighting is exact for spikes
          const ctx = (m.usage.input_tokens || 0) + (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0);
          // PEAK context, not just the last one: every threshold in the stack keys off the largest
          // per-message context a session carried, and reports that quoted the final message
          // understated it by 17-43% (10 confirmations).
          if (ctx > s.peakCtx) { s.peakCtx = ctx; s.peakCtxAt = o.timestamp || null; }
          // The COLD FLOOR: the smallest context any message carried is the standing inventory -
          // system prompt, tool schemas, CLAUDE.md, the always-on rules - paid on every single
          // message and re-paid in full after every compaction. Measured at 3.7%-86.8% of a
          // session's cache-read and 23-48% of its own floor, and no report had a row for it.
          if (ctx > 0 && (s.floorCtx === 0 || ctx < s.floorCtx)) s.floorCtx = ctx;
          // Cache continuity, by Claude Code's OWN definition (its `Prompt cache (main)` status
          // line): a request is a MISS when it re-processed more than 5% and at least 2,000 tokens
          // of what the previous request had cached; the first request after a compaction is an
          // EXPECTED rebuild, counted apart. What a miss cost is the tokens it wrote back.
          if (ctx > 0) {
            const cc = m.usage.cache_creation_input_tokens || 0;
            const cr = m.usage.cache_read_input_tokens || 0;
            if (prevCache && !foreign) {
              const couldRead = prevCache.cr + prevCache.cc;
              const reprocessed = Math.max(0, couldRead - cr);
              if (couldRead > 0 && reprocessed > 0.05 * couldRead && reprocessed >= 2000) {
                const e = s.efficiency;
                if (afterCompaction) { e.expectedRebuilds += 1; e.expectedRebuildTokens += cc; }
                else {
                  e.cacheMisses += 1; e.cacheMissTokens += cc;
                  if (e.cacheMissAt.length < 10) e.cacheMissAt.push({ ts: o.timestamp || null, reprocessed, recached: cc });
                }
              }
            }
            prevCache = { cr, cc };
            afterCompaction = false;
          }
          if (prevCtx != null && ctx - prevCtx > 0) {
            s.spikes.push({ ts: o.timestamp, delta: ctx - prevCtx, ctx, causes: summarizeCauses(pending) });
          } else if (prevCtx != null && (m.usage.cache_creation_input_tokens || 0) > 20000) {
            // Right after a compaction the context DROPS, so a re-cache of the rebuilt prompt has a
            // negative delta and never entered the accumulator - 279,885 tokens, 17.2% of one
            // session's whole cache-write, invisible. Keyed on the write itself, not the delta.
            s.spikes.push({
              ts: o.timestamp,
              delta: m.usage.cache_creation_input_tokens || 0,
              ctx,
              kind: 'cache-write',
              causes: summarizeCauses(pending) || 'prompt re-cached after a context reset',
            });
          }
          s.spikes.sort((a, b) => b.delta - a.delta);
          if (s.spikes.length > 5) s.spikes.length = 5;
          prevCtx = ctx; pending = [];
        }
        r.u.in = Math.max(r.u.in, m.usage.input_tokens || 0);
        r.u.cc = Math.max(r.u.cc, m.usage.cache_creation_input_tokens || 0);
        r.u.cr = Math.max(r.u.cr, m.usage.cache_read_input_tokens || 0);
        r.u.out = Math.max(r.u.out, m.usage.output_tokens || 0);
        // what the price depends on beyond the four counts: the write's TTL split and fast mode
        const ccs = m.usage.cache_creation;
        if (ccs && typeof ccs === 'object') { r.split = true; r.c1h = Math.max(r.c1h, ccs.ephemeral_1h_input_tokens || 0); }
        if (m.usage.speed === 'fast') r.fast = true;
        if (o.attributionSkill && (!r.skill || r.carried)) { r.skill = o.attributionSkill; r.carried = false; }
      }
      if (Array.isArray(m.content)) for (const c of m.content) {
        if (c.type !== 'tool_use' || seenToolUse.has(c.id)) continue;
        seenToolUse.add(c.id);
        if (foreign) s.forkPrefix.toolCalls += 1;
        else if (o.timestamp) { s.toolCallTs.push(o.timestamp); s.toolCallIdx.push({ ts: o.timestamp, tool: c.name }); }
        const t = s.toolCalls[c.name] || (s.toolCalls[c.name] = { calls: 0, resultChars: 0, errors: 0, firstTs: o.timestamp || null });
        t.calls += 1;
        if (c.input && typeof c.input.file_path === 'string') {
          const rel = docRelPath(c.input.file_path);
          if (rel) {
            const d = s.docTouches[rel] || (s.docTouches[rel] = { reads: 0, writes: 0 });
            if (c.name === 'Read') d.reads += 1;
            else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) d.writes += 1;
          }
        }
        const info = { name: c.name };
        toolSeq += 1;
        if (MEMORY_STORE_RE.test(c.name)) {
          s.efficiency.correctionsSaved += pendingSaves.length;
          pendingSaves = [];
        }
        {
          // What the call READS, on both routes - the scorecard's build-dir and re-read rows.
          const i = c.input || {};
          let readTarget = null;
          if (c.name === 'Read' && typeof i.file_path === 'string') readTarget = i.file_path;
          else if (isShellTool(c.name) && typeof i.command === 'string') readTarget = shellReadTarget(maskHeredocs(i.command));
          if (readTarget) {
            info.readTarget = readTarget;
            if (BUILD_DIR_RE.test(readTarget)) info.buildDir = true;
            const cur = s.efficiency.compactionRereads[s.efficiency.compactionRereads.length - 1];
            if (cur && cur.before.has(readTarget) && !cur.seen.has(readTarget)) { cur.seen.add(readTarget); info.reread = true; }
            readPaths.add(readTarget);
          }
          // A copied fork prefix is the parent's navigation, counted in the parent's transcript.
          if (!foreign) {
            const nav = s.efficiency.navigation;
            const cls = locateClass(c.name, i);
            if (cls === 'symbol') nav.symbolCalls += 1;
            else if (cls === 'grep') nav.grepCalls += 1;
            if (readTarget && !info.buildDir && SOURCE_EXT_RE.test(readTarget)) {
              nav.reads += 1;
              const win = cls ? navRecent.concat(cls) : navRecent;
              if (win.includes('symbol')) { nav.located += 1; nav.symbolLocated += 1; }
              else if (win.includes('grep')) { nav.located += 1; nav.grepLocated += 1; }
            }
            navRecent.push(cls);
            if (navRecent.length > NAV_WINDOW) navRecent.shift();
          }
          // a dispatched seat may have run the check in its own transcript - the turn is covered
          if (c.name === 'Agent' || c.name === 'Task') turnHadCheck = true;
          // Every file the session TOUCHED, on both routes - the deterministic proxy for a
          // path-scoped rule attach. A Read is both a file tool and a read target, so the two
          // spellings are deduped before counting.
          const touched = new Set();
          if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name) && (i.file_path || i.notebook_path)) touched.add(String(i.file_path || i.notebook_path));
          if (readTarget) touched.add(readTarget);
          for (const p of touched) {
            const e = s.fileTouches[p] || (s.fileTouches[p] = { n: 0, firstTs: o.timestamp || null });
            e.n += 1;
          }
        }
        if (c.name === 'Skill' && c.input && c.input.skill) {
          info.skill = c.input.skill;
          const sk = s.skillInvocations[c.input.skill] || (s.skillInvocations[c.input.skill] = { calls: 0, injectedChars: 0, firstTs: o.timestamp || null });
          sk.calls += 1;
          if (activeInvoke && activeInvoke.skill !== c.input.skill && activeInvoke.msgs <= 5 && !askSinceInvoke) {
            if (!companionOf[c.input.skill]) companionOf[c.input.skill] = activeInvoke.skill;
          } else {
            activeInvoke = { skill: c.input.skill, msgs: 0 };
            askSinceInvoke = false;
          }
        } else if (c.name.startsWith('mcp__')) {
          const server = mcpServerOf(c.name);
          const mc = s.mcp[server] || (s.mcp[server] = { calls: 0, resultChars: 0, errors: 0, tools: {}, firstTs: o.timestamp || null });
          mc.calls += 1;
          const tool = c.name.split('__').slice(2).join('__') || '?';
          mc.tools[tool] = (mc.tools[tool] || 0) + 1;
          // The plugin a server came from is in the name itself; a bare registration of the same
          // server name is a different server, never the plugin's use.
          const seg = c.name.split('__')[1] || '';
          if (seg.startsWith('plugin_')) {
            const plugin = seg.slice(7).split('_')[0];
            const pm = s.pluginMcp[plugin] || (s.pluginMcp[plugin] = { calls: 0, servers: {}, firstTs: o.timestamp || null });
            pm.calls += 1;
            pm.servers[server] = (pm.servers[server] || 0) + 1;
          }
        } else if ((c.name === 'Agent' || c.name === 'Task') && c.input) {
          s.agentDispatches.push({ id: c.id, desc: c.input.description ? maskSecrets(c.input.description) : null, subagentType: c.input.subagent_type || null, ts: o.timestamp || null });
        }
        if (isShellTool(c.name) && c.input && typeof c.input.command === 'string') {
          const cmdStr = c.input.command;
          // Deterministic counters the report's protocol sweeps previously had no number for
          // (measured: '0 git commits' shipped against 3 commits + a PR merge; occurrence
          // counting, not per-call, since one Bash call can carry two commits).
          // A heredoc body is DATA: a plan file or receipt that merely describes `git commit`
          // is not an invocation. Counting it reported 13 commits where 8 ran, 4 where 1 ran,
          // and 4 where NONE ran (measured across 3 bundles) - blank the payload before counting.
          const cmdShell = maskHeredocs(cmdStr);
          // The COUNTERS need the quoted spans gone too, and the match has to OPEN a segment: every
          // phantom commit in the corpus was a quoted string, one of them inside a command the
          // harness had DENIED (worst case: 12 commits reported against 0 real). Held until the
          // paired tool_result proves the call ran, the same way the doc touches are.
          const cmdCode = maskQuoted(cmdShell);
          info.rmVerifyTail = rmVerifyTail(cmdCode);
          const check = classifyCheck(cmdCode, cmdShell);
          if (check) {
            info.check = check.kind; info.scoped = check.scoped;
            lastCheckSeq = toolSeq; turnHadCheck = true;
            const k = s.efficiency.checks[check.kind];
            k.calls += 1;
            if (check.kind === 'test') { if (check.scoped) k.scoped += 1; else k.whole += 1; }
          }
          const commits = (cmdCode.match(/(?:^|[;&|(]\s*)git\s+(?:-[\w-]+(?:[= ]\S+)?\s+)*commit\b/g) || []).length;
          const merges = (cmdCode.match(/(?:^|[;&|(]\s*)gh\s+pr\s+merge\b/g) || []).length;
          if (commits || merges) pendingGitActs.set(c.id, { commits, merges, checked: lastCheckSeq >= 0 && toolSeq - lastCheckSeq <= CHECK_WINDOW, ts: o.timestamp || null });
          // Doc traffic routed through Bash (heredocs, printf >, rm -f) is real doc I/O the
          // Write/Edit-only counter missed - a receipt written+cleared via Bash showed
          // writes:0, and batched python doc writes showed writes:0 across 3 rewrites (measured).
          // Classified PER OCCURRENCE against its own command segment, write only when the
          // redirect/rm/tee TARGETS that path, once per call per doc - the whole-command
          // check stamped every doc in a `cat A && rm B` as written, counted a `2>/dev/null`
          // as the write signal, and re-counted one doc per prose mention (measured: a
          // single receipt write reported as 5 writes across 2 docs).
          {
            // A write the harness DENIED never happened: the classifier-blocked attempts still
            // counted, reporting 3 writes where 1 executed (measured). The result for this call
            // decides - an is_error result means nothing was written.
            const touched = new Map();
            const roots = bashDocRoots();
            const rootAlt = roots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            const docPathRe = new RegExp(`(?:^|[\\s"'\`=(])((?:[^\\s"'\`;|&)]*/)?(?:${rootAlt})[^\\s"'\`;|&)]+)`, 'g');
            for (const seg of cmdShell.split(/&&|\|\||;|\n/)) {
              for (const pm of seg.matchAll(docPathRe)) {
                const p = pm[1].replace(/[/:,.]+$/, ''); // a trailing separator is punctuation, not the name
                if (p.includes('$')) continue; // unexpanded variable - not a literal doc path
                if (/[*?\[]/.test(p)) continue; // a GLOB names no one document
                const hit = roots.find((r) => p.includes(r));
                if (!hit) continue;
                const rel = p.slice(p.indexOf(hit) + hit.length);
                // Only a DOCUMENT: keying on every token under the docs root produced 79 rows for
                // ~6 real documents - directories, globs and trailing punctuation each got a row.
                if (!rel || !/\.md$/i.test(rel)) continue;
                // An ASSIGNMENT is neither a read nor a write; it was counted as a read in 35 of 72
                // occurrences. Only the varWrite check below can turn a binding into a write.
                const assigned = pm[0][0] === '=';
                const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // A python write reaches the file three ways and only one names the path inside
                // open(): `open("<path>","w")`, `p = "<path>" ... open(p,"w")`, and
                // `Path("<path>").write_text(...)`. Counting only the first read a real write as a
                // READ in 3 audited bundles (a doc reported 0 writes against 6 real edits), so the
                // variable binding and the pathlib form are matched too.
                // The binding and its use sit on DIFFERENT lines of a python heredoc, so both
                // checks run against the whole command, not the segment the path appeared in.
                const varBound = new RegExp(`(\\w+)\\s*=\\s*(?:pathlib\\.)?(?:Path\\()?["'\`][^"'\`]*${esc}`).exec(cmdStr);
                const varWrite = varBound
                  ? new RegExp(`open\\(\\s*${varBound[1]}\\s*,[^)]*["']w["']|\\b${varBound[1]}\\.write_(text|bytes)\\(|\\bio\\.open\\(\\s*${varBound[1]}\\s*,[^)]*["']w["']`).test(cmdStr)
                  : false;
                // `rm` CLEARS a receipt - counting it as a write reported a written document that
                // was in fact deleted; and `mkdir -p <dir>` is neither read nor write of a document.
                const cleared = new RegExp(`\\brm\\s+(?:-\\w+\\s+)*["']?${esc}`).test(seg);
                const made = new RegExp(`\\bmkdir\\s+(?:-\\w+\\s+)*["']?${esc}`).test(seg);
                const isWrite = varWrite || new RegExp(`(>>?\\s*["']?${esc})|(\\btee\\s+(?:-a\\s+)?["']?${esc})|(open\\([^)]*${esc}[^)]*["']w["'])|(${esc}["'\`]?\\s*\\)?\\.write_(text|bytes)\\()`).test(seg);
                const e = touched.get(rel) || { r: false, w: false, c: false };
                if (isWrite) e.w = true;
                else if (cleared) e.c = true;
                else if (!made && !assigned) e.r = true;
                touched.set(rel, e);
              }
            }
            // Held until the paired tool_result proves the command actually ran (below).
            if (touched.size) pendingDocTouch.set(c.id, [...touched.entries()]);
          }
        }
        if (c.name === 'AskUserQuestion') askSinceInvoke = true;
        // What the call was FOR, in the call's own words - the Bash description the model wrote,
        // the file a Read named, the seat a dispatch went to. The report used to print result
        // SIZES with no call beside them, so whoever wrote it hand-mapped char counts back onto
        // calls by eye (measured: eight results re-derived by hand for one bundle's report).
        // Masked before it is stored, so all three renderers print the same redacted argument -
        // and masked BEFORE the cut, because a slice through a token leaves a prefix the shape
        // regex can no longer see.
        info.label = (() => {
          const i = c.input || {};
          const cut = (v, n) => maskSecrets(v).slice(0, n);
          if (isShellTool(c.name)) return cut(String(i.description || i.command || '').replace(/\s+/g, ' '), 70);
          if (i.file_path || i.notebook_path) return cut(String(i.file_path || i.notebook_path).split(/[/\\]/).pop(), 120);
          if (c.name === 'Agent' || c.name === 'Task') return cut([i.subagent_type, i.description].filter(Boolean).join(': '), 70);
          if (c.name === 'Skill') return cut(String(i.skill || ''), 120);
          if (i.pattern) return cut(String(i.pattern), 70);
          if (i.query) return cut(String(i.query), 70);
          if (c.name.startsWith('mcp__')) return c.name.split('__').slice(2).join('__');
          return '';
        })();
        toolById.set(c.id, info);
        lastToolName = c.name;
      }
      // The ANSWER side of the scorecard: green claims, long answers, and the assistant half of the
      // correction-streak view. One API message arrives as several rows; they merge by message.id.
      if (!foreign && m.model !== '<synthetic>' && Array.isArray(m.content)) {
        const txt = m.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
        if (txt) msgText.set(m.id, (msgText.get(m.id) || '') + '\n' + txt);
        const len = proseOf(txt).length;
        const prev = turns[turns.length - 1];
        if (m.id && m.id === lastAsstId && prev && prev.role === 'assistant') prev.len += len;
        else turns.push({ role: 'assistant', len });
        lastAsstId = m.id || null;
        if (m.stop_reason === 'end_turn') {
          const prose = proseOf(msgText.get(m.id) || '');
          if (prose) {
            const e = s.efficiency;
            e.finalAnswers += 1;
            if (prose.length > LONG_ANSWER) e.longAnswers += 1;
            if (claimsGreen(prose)) { e.greenClaims += 1; if (!turnHadCheck) e.unverifiedGreenClaims.push(o.timestamp || null); }
          }
          msgText.delete(m.id);
        }
      }
      const hasToolUse = Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_use');
      if (hasToolUse) prevAssistantNoTool = null;
      else if (m.stop_reason === 'end_turn') prevAssistantNoTool = o.timestamp || prevAssistantNoTool;
    }

    if (o.type === 'user' && o.message) {
      const content = o.message.content;
      // Harness-injected user turns (task notifications, system reminders) are not the
      // person typing: counting them inflated userPrompts and manufactured unheld-stop
      // candidates out of background-task completions (measured: a clean session reported
      // 1 candidate whose 'user turn' was a task-notification landing after the close).
      // The harness's own UserPromptSubmit hook already implements the right discriminator, and it
      // is a POSITIVE one: origin.kind === 'human'. Counting by exclusion list inflated the prompt
      // count by up to 500% across 12 bundles - it missed <command-name>, <local-command-stdout>,
      // isCompactSummary, and the sibling records one typed turn produces. The list stays as the
      // fallback for a transcript generation that carries no origin, and it is only as good as its
      // enumeration: <local-command-caveat> (117 occurrences in the 489-transcript audit corpus)
      // and <fork-boilerplate> were still missing, each one manufacturing a free-text user turn -
      // which is what an unheld-stop candidate is built from (285 candidates across that corpus).
      const isInjectedText = (txt) => (o.origin
        ? o.origin.kind !== 'human'
        : /^\s*<(task-notification|system-reminder|teammate-message|background-task|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|fork-boilerplate)\b/.test(txt))
        || o.isCompactSummary === true;
      // One typed turn can emit several user records sharing a parentUuid (the command marker, its
      // message, its stdout). The first one counts; the rest are the same turn.
      const firstOfTurn = () => {
        if (!o.parentUuid) return true;
        if (promptParents.has(o.parentUuid)) return false;
        promptParents.add(o.parentUuid);
        return true;
      };
      if (typeof content === 'string') {
        // A Stop-hook denial arrives as an isMeta user STRING with no tool_result, so it is
        // structurally invisible to the is_error path below: one report printed 'Hook blocks - 4'
        // against 6 and then named both Stop blocks two paragraphs later.
        if (/^\s*Stop hook feedback:/.test(content)) {
          s.stopHookBlocks = (s.stopHookBlocks || 0) + 1;
          attributeDenial(content, o.timestamp);
        }
        if (!o.isMeta && !isInjectedText(content) && firstOfTurn()) {
          s.userPrompts++;
          onHumanTurn(content, o.timestamp);
          if (prevAssistantNoTool) { s.unheldStopCandidates.push({ stopTs: prevAssistantNoTool, userTs: o.timestamp || null }); prevAssistantNoTool = null; }
        }
        return;
      }
      if (!Array.isArray(content)) return;
      // A Skill call's tool_result is a tiny stub; the skill BODY lands as an isMeta text
      // injection right after it. Without this a spike's cause line credited the ~18-token
      // stub while the ~4k-token body drove the jump (measured: cause off by 2 orders).
      if (o.isMeta && lastToolName === 'Skill') {
        const bodyChars = content.filter((c) => c.type === 'text').reduce((n, c) => n + (c.text || '').length, 0);
        if (bodyChars > 500) pending.push({ name: 'skill-body', chars: bodyChars });
      }
      let hasResult = false;
      for (const c of content) {
        if (c.type !== 'tool_result') continue;
        hasResult = true;
        // An image block is base64: measuring it as text put a shipped report's headline cost
        // 46x over the truth (353.2k claimed vs 7,756 actually billed, read off the next turn's
        // cache_creation). Images are counted separately and never enter the chars/4 estimate.
        const parts = Array.isArray(c.content) ? c.content : null;
        const imgs = parts ? parts.filter((b) => b && b.type === 'image').length : 0;
        const textParts = parts ? parts.filter((b) => !b || b.type !== 'image') : c.content;
        const text = typeof textParts === 'string' ? textParts : JSON.stringify(textParts || '');
        const chars = text.length;
        if (imgs) s.imageResults = (s.imageResults || 0) + imgs;
        const info = toolById.get(c.tool_use_id);
        pending.push({ name: info ? info.name : '?', chars });
        if (!info) continue;
        // The biggest individual results, joined to what the call asked for. Kept sorted and
        // capped, so this costs nothing on a long session.
        s.topResults.push({ name: info.name, label: info.label || '', chars, ts: o.timestamp || null, error: !!c.is_error && !info.rmVerifyTail });
        s.topResults.sort((a, b) => b.chars - a.chars);
        if (s.topResults.length > 12) s.topResults.length = 12;
        const t = s.toolCalls[info.name];
        // A PreToolUse guard denial is the gate WORKING, not a tool failure - bucketing them
        // as errors made reports call a working gate 'the session's weak point' (measured in
        // three bundles: 124/132, 14/14 and 15/15 'Read errors' were all guard blocks).
        // Match the whole guard family by its shared 'Blocked' word - enumerating two messages
        // missed the commit/rm/force-push variants and split one session's denials into 22
        // 'errors' + 12 blocks when all 34 were gate denials (measured). The COLON is not part of
        // the contract, and the ["…/hooks/*.js"] bracket is attribution, not the test.
        //
        // But 'Blocked' and 'Do NOT retry' are the HARNESS's words too, and matching them bare
        // charged three classes of non-stack denial to the guards. Measured over the 489-transcript
        // audit corpus: 90 real stack blocks (all carrying the PreToolUse guard bracket), against
        // 11 auto-mode-classifier denials ('Blocked by classifier', `toolDenialKind:
        // "automode-blocked"`), 3 harness foreground-`sleep` blocks (no stack hook blocks sleep)
        // and 2 AskUserQuestion schema failures whose own text says 'Do not retry this call' -
        // 16 events filed against guards that never ran, one of them as a phantom
        // `denialsByHook: {"(unattributed)": 1}`. Excluded by their own signatures, and COUNTED as
        // harness denials so the separation is visible rather than a silent drop.
        const harnessDenial =
          o.toolDenialKind === 'automode-blocked' ||        // the auto-mode classifier
          o.toolDenialKind === 'user-rejected' ||           // the user's own no (also caught below as a decline)
          /denied by the Claude Code auto mode classifier/i.test(text) ||
          /\bInputValidationError\b/.test(text) ||          // a tool-schema failure, never a PreToolUse event
          /Blocked: sleep\b/.test(text);                    // the Bash tool's own foreground-sleep block
        const readsAsBlock = c.is_error && (/\bBlocked\b/.test(text) || /\bDo NOT retry\b/i.test(text));
        const isHookBlock = readsAsBlock && !harnessDenial;
        if (isHookBlock) attributeDenial(text, o.timestamp);
        else if (readsAsBlock) s.harnessDenials = (s.harnessDenials || 0) + 1;  // reads as a block, is the harness's
        const held = pendingDocTouch.get(c.tool_use_id);
        if (held) {
          pendingDocTouch.delete(c.tool_use_id);
          for (const [rel, e] of held) {
            // An occurrence that classified as NOTHING - a bare `VAR=<path>` binding, a `mkdir` of
            // its directory - must not open a row: an all-zero row is one of the 79 the report
            // printed for ~6 real documents.
            if (!e.w && !e.c && !e.r) continue;
            const d = s.docTouches[rel] || (s.docTouches[rel] = { reads: 0, writes: 0 });
            if (e.w && !c.is_error) d.bashWrites = (d.bashWrites || 0) + 1;
            else if (e.w && c.is_error) d.bashWritesDenied = (d.bashWritesDenied || 0) + 1;
            if (e.c && !c.is_error) d.cleared = (d.cleared || 0) + 1;
            if (e.r && !e.w && !e.c) d.bashReads = (d.bashReads || 0) + 1;
          }
        }
        const acts = pendingGitActs.get(c.tool_use_id);
        if (acts) {
          pendingGitActs.delete(c.tool_use_id);
          if (!c.is_error) {
            s.gitCommits += acts.commits; s.prMerges += acts.merges;
            // A commit is CHECKED when a test / build / lint / ci-status call sat within the window
            // before it (ran - not necessarily green; the report opens the run). One Bash call
            // carrying the check and the commit counts as checked.
            if (acts.commits) {
              if (acts.checked) s.efficiency.commitsChecked += acts.commits;
              else s.efficiency.commitsUnchecked.push(acts.ts || o.timestamp || null);
            }
          }
        }
        {
          const e = s.efficiency;
          if (info.buildDir && info.readTarget) {
            e.buildDirReads.calls += 1; e.buildDirReads.chars += chars;
            e.buildDirReads.paths[info.readTarget] = (e.buildDirReads.paths[info.readTarget] || 0) + chars;
          }
          if (info.reread) { const cur = e.compactionRereads[e.compactionRereads.length - 1]; if (cur) { cur.files += 1; cur.chars += chars; } }
          if (info.check) e.checks[info.check].chars += chars;
        }
        // A DECLINE is the user answering the question, not a tool failure: reports read
        // "The user doesn't want to proceed" as an error and called a working ask a weak point.
        const isDecline = c.is_error && /\buser (?:doesn'?t want to proceed|declined|chose not)\b/i.test(text);
        if (t) {
          t.resultChars += chars;
          if (isHookBlock) t.hookBlocks = (t.hookBlocks || 0) + 1;
          else if (isDecline) t.declines = (t.declines || 0) + 1;
          // The non-zero exit of a removal's own `ls`/`test` tail is the removal CONFIRMED.
          else if (c.is_error && info.rmVerifyTail) t.rmVerifyTails = (t.rmVerifyTails || 0) + 1;
          else if (c.is_error) {
            t.errors += 1;
            // WHEN each error happened, so the report attributes it to the phase that actually ran
            // then. Measured: two errors at 06:57 were reported as the browser phase's, and the
            // browser work did not start until ~07:2x - a whole phase blamed for someone else's.
            if (o.timestamp) (t.errorTs = t.errorTs || []).push(o.timestamp);
          }
        }
        if (info.skill) s.skillInvocations[info.skill].injectedChars += chars;
        if (info.name.startsWith('mcp__')) {
          const mc = s.mcp[mcpServerOf(info.name)];
          // The same carve-out the tool tally makes above: a user declining an MCP-driven ask is an
          // answer, not a server failure, and counting it inflated the error rate of a working server.
          // A guard denial or a harness rejection (a schema failure, the auto-mode classifier) never
          // reached the server either, so it is counted apart: `errors` is what the SERVER answered
          // with an error - the one number a server health check is opened on. `is_error` is the
          // whole signal: over 3,242 local MCP calls no result opened on an error string without it.
          if (mc) {
            mc.resultChars += chars;
            if (c.is_error && (isHookBlock || harnessDenial)) mc.rejected = (mc.rejected || 0) + 1;
            else if (c.is_error && !isDecline) mc.errors += 1;
          }
        }
      }
      const textJoined = content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
      if (/^\s*Stop hook feedback:/.test(textJoined)) {
        s.stopHookBlocks = (s.stopHookBlocks || 0) + 1;
        attributeDenial(textJoined, o.timestamp);
      }
      if (!hasResult && !o.isMeta && textJoined.trim() && !isInjectedText(textJoined) && firstOfTurn()) {
        s.userPrompts++;
        onHumanTurn(textJoined, o.timestamp);
        if (prevAssistantNoTool) { s.unheldStopCandidates.push({ stopTs: prevAssistantNoTool, userTs: o.timestamp || null }); prevAssistantNoTool = null; }
      }
    }
  });

  // finalize the folded per-message usage into the tallies; companion skills fold into
  // their parent (resolved transitively) so a nested reference load never steals the run
  const resolveParent = (k) => { const seen = new Set(); while (companionOf[k] && !seen.has(k)) { seen.add(k); k = companionOf[k]; } return k; };
  const carryRun = {};
  const pt = priceTable();
  // A copied fork prefix was billed in the parent session, so its dollars are named apart and
  // never added to this session's cost - the rollup would otherwise bill that run twice.
  s.cost = pt.error ? { error: pt.error } : { usd: 0, prefixUsd: 0, byModel: {}, unpriced: {}, noSplitMsgs: 0, fastMsgs: 0 };
  for (const r of msgReg.values()) {
    if (!pt.error) {
      const p = pt.byId.get(priceId(r.model));
      const usd = p ? messageUsd(p, r) : 0;
      if (r.foreign) s.cost.prefixUsd += usd;
      else if (!p) s.cost.unpriced[r.model] = (s.cost.unpriced[r.model] || 0) + 1;
      else {
        s.cost.usd += usd;
        s.cost.byModel[r.model] = (s.cost.byModel[r.model] || 0) + usd;
        if (r.u.cc && !r.split) s.cost.noSplitMsgs += 1;
        if (r.fast) s.cost.fastMsgs += 1;
      }
    }
    const u = { input_tokens: r.u.in, cache_creation_input_tokens: r.u.cc, cache_read_input_tokens: r.u.cr, output_tokens: r.u.out };
    addUsage(s.total, u);
    if (r.foreign) { s.forkPrefix.msgs += 1; s.forkPrefix.cacheRead += r.u.cr; s.forkPrefix.cacheCreate += r.u.cc; s.forkPrefix.output += r.u.out; }
    addUsage(s.byModel[r.model] || (s.byModel[r.model] = newTally()), u);
    if (r.skill) {
      const eff = resolveParent(r.skill);
      const a = s.skillAttribution[eff] || (s.skillAttribution[eff] = { msgs: 0, output: 0, cacheRead: 0, carriedMsgs: 0 });
      a.msgs += 1; a.output += r.u.out; a.cacheRead += r.u.cr;
      if (eff !== r.skill) { a.companionMsgs = (a.companionMsgs || 0) + 1; a.companionOut = (a.companionOut || 0) + r.u.out; }
      if (r.carried) {
        a.carriedMsgs = (a.carriedMsgs || 0) + 1;
        carryRun[eff] = (carryRun[eff] || 0) + 1;
        // A long unbroken carry is a stale stamp absorbing later phases, not the named
        // skill's cost (measured: one stamp froze across 2 full cycles / 1h42m) - surface
        // it so reports flag instead of charging it.
        if (carryRun[eff] > (a.maxCarryRun || 0)) a.maxCarryRun = carryRun[eff];
      } else carryRun[eff] = 0;
    }
  }
  s.companionOf = companionOf;
  // A correction the session ended on, with no store after it, was never saved.
  for (const p of pendingSaves) s.efficiency.correctionsUnsaved.push(p.ts);
  // The roster omits a manual-only skill (`disable-model-invocation`), and a slash run that loaded its body proves it
  // was installed all the same.
  if (s.availableSkills) for (const n of Object.keys(s.slashSkillRuns)) s.availableSkills.add(n);
  // Sets do not survive JSON.stringify - the --json dump is the report's own input.
  s.availableSkills = s.availableSkills ? [...s.availableSkills].sort() : null;
  s.availableAgents = s.availableAgents ? [...s.availableAgents].sort() : null;
  s.compactions = compactMeta > 0 ? compactMeta : compactSummary;
  s.efficiency.compactionRereads = s.efficiency.compactionRereads.map((c) => ({ ts: c.ts, candidates: c.before.size, files: c.files, chars: c.chars }));
  // The bill sees calls the transcript never records - the harness's post-turn recap is one - so
  // cost-state cache-read exceeds the transcript's by whole contexts (measured: 694,773 vs 590,045,
  // a gap of exactly one peak context). Say so, or the bundle never reconciles to its bill and the
  // gap gets blamed on the tools.
  if (s.costState && s.costState.cacheRead > s.total.cacheRead) {
    const gap = s.costState.cacheRead - s.total.cacheRead;
    s.untranscribed = { cacheRead: gap, contexts: s.peakCtx ? Math.round((10 * gap) / s.peakCtx) / 10 : null };
  }
  return s;
}

function summarizeCauses(pending) {
  const by = {};
  for (const p of pending) {
    const e = by[p.name] || (by[p.name] = { n: 0, chars: 0 });
    e.n += 1; e.chars += p.chars;
  }
  return Object.entries(by).sort((a, b) => b[1].chars - a[1].chars).slice(0, 3)
    .map(([name, e]) => `${name}×${e.n} (~${fmt(approxTok(e.chars))} tok)`).join(', ');
}

// ---------- subagents (the session's <id>/subagents/ directory) ----------

async function analyzeSubagents(sessionFile, window) {
  // Native layout: <sid>.jsonl + <sid>/subagents/. Audit bundles (what the
  // capture-usage-report skill archives) put subagents/ as a SIBLING of the
  // transcript - without the fallback a bundle re-analysis silently drops every seat.
  // Workflow-tool fan-outs nest under subagents/workflows/<wf-id>/agent-*.jsonl - a flat
  // scan silently dropped 703 transcripts (~35% of output) across two audited bundles,
  // so recurse (bounded) and tag each nested entry with its group.
  let dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
  if (!fs.existsSync(dir)) dir = path.join(path.dirname(sessionFile), 'subagents');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = async (d, group, depth) => {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (depth < 2) await walk(full, group ? `${group}/${f}` : f, depth + 1);
        continue;
      }
      if (!f.endsWith('.jsonl')) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(d, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch { /* meta optional */ }
      if (group && !meta.agentType) meta.agentType = 'workflow-subagent';
      const t = await analyzeTranscript(full, window);
      if (window && t.total.msgs === 0) continue; // dispatched entirely outside the window
      out.push({ id: f.replace(/^agent-|\.jsonl$/g, ''), group: group || null, meta, stats: t });
    }
  };
  await walk(dir, null, 0);
  return out;
}

// ---------- hook-log join ----------

async function analyzeHookLog(file) {
  const byTool = {}; let rows = 0; let firstTs = null; let lastTs = null;
  const rowsIdx = [];   // { ts, tool } per row - the per-side join needs the rows, not their count
  await readJsonl(file, (o) => {
    if (!o.tool) return;
    rows++;
    if (o.ts) { if (!firstTs || o.ts < firstTs) firstTs = o.ts; if (!lastTs || o.ts > lastTs) lastTs = o.ts; rowsIdx.push({ ts: o.ts, tool: o.tool }); }
    const t = byTool[o.tool] || (byTool[o.tool] = { calls: 0, details: {} });
    t.calls += 1;
    if (o.detail) t.details[o.detail] = (t.details[o.detail] || 0) + 1;
  });
  return { rows, byTool, firstTs, lastTs, rowsIdx };
}

// ---------- report ----------

function tallyRow(label, t) {
  return `  ${pad(label, 22)} ${rpad(fmt(t.input), 8)} ${rpad(fmt(t.cacheCreate), 11)} ${rpad(fmt(t.cacheRead), 11)} ${rpad(fmt(t.output), 8)} ${rpad(t.msgs, 6)} ${rpad(fmt(ctxOf(t)), 8)}`;
}

const CTX_WARN = 120000; // avg ctx/msg above this = the conversation, not the tools, is the cost

// One aggregation, two renderers (text + markdown) - the numbers can never diverge by printer.
function computeAggregates(main, agents) {
  const agentTotal = newTally();
  const byType = {};
  for (const a of agents) {
    mergeTally(agentTotal, a.stats.total);
    const type = a.meta.agentType || '(unknown)';
    const g = byType[type] || (byType[type] = { n: 0, tally: newTally(), tools: {}, descs: [], wall: 0, span: 0, seatMs: 0, intervals: [], firstTs: null, lastTs: null, cost: 0 });
    g.n += 1; mergeTally(g.tally, a.stats.total);
    g.cost += (a.stats.cost && a.stats.cost.usd) || 0;
    for (const [name, t] of Object.entries(a.stats.toolCalls)) g.tools[name] = (g.tools[name] || 0) + t.calls;
    if (a.meta.description && g.descs.length < 2) g.descs.push(maskSecrets(a.meta.description));
    if (a.stats.firstTs && a.stats.lastTs) {
      g.seatMs += new Date(a.stats.lastTs) - new Date(a.stats.firstTs);
      g.intervals.push([Date.parse(a.stats.firstTs), Date.parse(a.stats.lastTs)]);
      if (!g.firstTs || a.stats.firstTs < g.firstTs) g.firstTs = a.stats.firstTs;
      if (!g.lastTs || a.stats.lastTs > g.lastTs) g.lastTs = a.stats.lastTs;
    }
  }
  // wall = the union of the group's seat intervals, NOT the outer span and NOT summed seat
  // durations - the summed form overstated a 10-seat parallel fan-out 3x, and the outer
  // span read two 10-minute waves dispatched 4h apart as a 4h11m wall (both measured).
  // span (outer first -> last) is kept so the printer can flag multi-wave groups.
  for (const g of Object.values(byType)) {
    if (!g.intervals.length) continue;
    g.intervals.sort((x, y) => x[0] - y[0]);
    let wall = 0; let [cs, ce] = g.intervals[0];
    for (const [st, en] of g.intervals.slice(1)) {
      if (st <= ce) ce = Math.max(ce, en);
      else { wall += ce - cs; cs = st; ce = en; }
    }
    g.wall = wall + (ce - cs);
    g.span = Date.parse(g.lastTs) - Date.parse(g.firstTs);
  }
  const grand = newTally(); mergeTally(grand, main.total); mergeTally(grand, agentTotal);

  const skillSet = new Set([...Object.keys(main.skillInvocations), ...Object.keys(main.skillAttribution)]);
  for (const a of agents) for (const k of [...Object.keys(a.stats.skillInvocations), ...Object.keys(a.stats.skillAttribution)]) skillSet.add(k);
  const skillRows = [...skillSet].sort().map((k) => {
    const inv = { calls: 0, injectedChars: 0 };
    for (const src of [main, ...agents.map((a) => a.stats)]) {
      if (src.skillInvocations[k]) { inv.calls += src.skillInvocations[k].calls; inv.injectedChars += src.skillInvocations[k].injectedChars; }
    }
    const mAttr = main.skillAttribution[k] || { msgs: 0, output: 0, cacheRead: 0, carriedMsgs: 0 };
    const sub = { msgs: 0, output: 0, cacheRead: 0, types: {} };
    for (const a of agents) {
      const sa = a.stats.skillAttribution[k];
      if (!sa) continue;
      sub.msgs += sa.msgs; sub.output += sa.output; sub.cacheRead += sa.cacheRead || 0;
      const ty = a.meta.agentType || '(unknown)';
      sub.types[ty] = (sub.types[ty] || 0) + 1;
    }
    // A companion's own cost is folded into the skill that loaded it, so its row would read
    // `0 msgs / 0 output` for a run that provably happened - measured, and read by an audit as
    // 'the skill did not run'. Name the row it was folded into instead of printing the zero.
    const folded = (() => {
      const map = main.companionOf || {};
      const seen = new Set();
      let cur = map[k] || null;
      while (cur && map[cur] && !seen.has(cur)) { seen.add(cur); cur = map[cur]; }
      return cur;
    })();
    return { skill: k, cmd: main.commandInvocations[k] || 0, inv, mAttr, sub, folded };
  });
  // Seats whose transcripts carry no skill stamp are real dispatch cost the SKILLS rows
  // cannot show - name them so an undercount reads as coverage, never as fewer dispatches.
  // A seat with its OWN Skill invocations is not stampless (its calls show in the rows) -
  // counted separately; for the truly stampless, the main session's stamp timeline at the
  // seat's dispatch moment gives a suggestion the report may cite as inferred, never charge.
  const unattributed = { n: 0, types: {}, selfInvoked: 0, guesses: {} };
  const tl = main.skillTimeline || [];
  for (const a of agents) {
    if (Object.keys(a.stats.skillAttribution).length) continue;
    if (Object.keys(a.stats.skillInvocations).length) { unattributed.selfInvoked += 1; continue; }
    unattributed.n += 1;
    const ty = a.meta.agentType || '(unknown)';
    unattributed.types[ty] = (unattributed.types[ty] || 0) + 1;
    if (a.stats.firstTs) {
      let guess = null;
      for (const e of tl) {
        if (!e.ts || e.ts > a.stats.firstTs) break;
        guess = e.skill;
      }
      if (guess) unattributed.guesses[guess] = (unattributed.guesses[guess] || 0) + 1;
    }
  }

  const docRows = {};
  let inject = main.styleInjections;
  let attach = main.styleRuleAttaches;
  for (const [rel, d] of Object.entries(main.docTouches)) {
    const r = docRows[rel] || (docRows[rel] = { main: 0, agents: 0, writes: 0, bashReads: 0, bashWrites: 0 });
    r.main += d.reads; r.writes += d.writes; r.bashReads += d.bashReads || 0; r.bashWrites += d.bashWrites || 0;
  }
  for (const a of agents) {
    inject += a.stats.styleInjections;
    attach += a.stats.styleRuleAttaches;
    for (const [rel, d] of Object.entries(a.stats.docTouches)) {
      const r = docRows[rel] || (docRows[rel] = { main: 0, agents: 0, writes: 0, bashReads: 0, bashWrites: 0 });
      r.agents += d.reads; r.writes += d.writes; r.bashReads += d.bashReads || 0; r.bashWrites += d.bashWrites || 0;
    }
  }

  const mcpServers = {};
  for (const src of [main, ...agents.map((a) => a.stats)]) {
    for (const [server, m] of Object.entries(src.mcp)) {
      const e = mcpServers[server] || (mcpServers[server] = { calls: 0, resultChars: 0, errors: 0, rejected: 0, tools: {} });
      e.calls += m.calls; e.resultChars += m.resultChars; e.errors += m.errors; e.rejected += m.rejected || 0;
      for (const [t, n] of Object.entries(m.tools)) e.tools[t] = (e.tools[t] || 0) + n;
    }
  }

  const tools = {};
  for (const src of [main, ...agents.map((a) => a.stats)]) {
    for (const [name, t] of Object.entries(src.toolCalls)) {
      const e = tools[name] || (tools[name] = { calls: 0, resultChars: 0, errors: 0, hookBlocks: 0, declines: 0, rmVerifyTails: 0, errorTs: [] });
      e.calls += t.calls; e.resultChars += t.resultChars; e.errors += t.errors; e.hookBlocks += t.hookBlocks || 0;
      e.declines += t.declines || 0; e.rmVerifyTails += t.rmVerifyTails || 0;
      if (t.errorTs) e.errorTs = e.errorTs.concat(t.errorTs).sort();
    }
  }

  // Dispatch overhead: how much of each seat's input was re-sending its OWN first-message context
  // (CLAUDE.md, the rules, the skills its frontmatter preloads - measured 26k-70k chars of skills
  // alone per designer / implementer / verifier seat) rather than the work. A seat over 60% bought
  // little per dispatch; a one-message seat is 100% by construction and says so.
  const dispatchOverhead = { seats: 0, heavy: 0, preloadTokens: 0, seatInputTokens: 0, heavySeats: [] };
  for (const a of agents) {
    const st = a.stats;
    const inTok = st.total.cacheRead + st.total.input + st.total.cacheCreate;
    if (!st.total.msgs || !inTok || !st.floorCtx) continue;
    const preload = st.floorCtx * st.total.msgs;
    dispatchOverhead.seats += 1; dispatchOverhead.preloadTokens += preload; dispatchOverhead.seatInputTokens += inTok;
    if (preload / inTok > 0.6) {
      dispatchOverhead.heavy += 1;
      if (dispatchOverhead.heavySeats.length < 8) dispatchOverhead.heavySeats.push({ type: a.meta.agentType || '(unknown)', msgs: st.total.msgs, floor: st.floorCtx, share: Math.round((100 * preload) / inTok) });
    }
  }
  // Navigation is counted per transcript - a seat's locate window never reaches into the main
  // session's calls - and summed here, because the seats do most of the code reading.
  const navigation = { reads: 0, located: 0, symbolLocated: 0, grepLocated: 0, symbolCalls: 0, grepCalls: 0 };
  let wholeFileBracket = 0;
  for (const src of [main, ...agents.map((a) => a.stats)]) {
    const n = (src.efficiency && src.efficiency.navigation) || {};
    for (const k of Object.keys(navigation)) navigation[k] += n[k] || 0;
    wholeFileBracket += (src.denialsByHook && src.denialsByHook[WHOLE_FILE_HOOK]) || 0;
  }
  // Dollars: the session is its main transcript plus every seat, each priced from its own folded
  // messages; the seat types are the table's per-seat rows.
  const cost = { usd: 0, main: 0, subagents: 0, seats: agents.length, byType: {}, unpriced: {}, noSplitMsgs: 0, fastMsgs: 0, prefixUsd: 0, error: null };
  for (const src of [main, ...agents.map((a) => a.stats)]) {
    const c = src.cost || {};
    if (c.error) { cost.error = c.error; continue; }
    cost.usd += c.usd || 0; cost.prefixUsd += c.prefixUsd || 0;
    cost.noSplitMsgs += c.noSplitMsgs || 0; cost.fastMsgs += c.fastMsgs || 0;
    for (const [m, n] of Object.entries(c.unpriced || {})) cost.unpriced[m] = (cost.unpriced[m] || 0) + n;
  }
  cost.main = (main.cost && main.cost.usd) || 0;
  for (const [type, g] of Object.entries(byType)) { cost.byType[type] = g.cost; cost.subagents += g.cost; }
  return { agentTotal, grand, byType, skillRows, unattributed, docRows, inject, attach, mcpServers, tools, dispatchOverhead, navigation, wholeFileBracket, cost };
}

// ---------- hook-block ledger (which GUARD fired, not just which tool was denied) ----------
// The transcript shows a denied tool call, never WHICH hook denied it, so the per-hook block rate -
// the number that says whether a gate is earning its keep or misfiring - was unmeasurable. The
// guard hooks now append one row per block to <docs-path>/hook-blocks/<session>.jsonl; this reads
// them. A block costs the denial text plus the retried turn, so the count IS the cost signal.
// A DIRECTORY is the project's shared collection - one file per session - so reading all of it
// attributes every other session's blocks to the one being analyzed (measured: a bundle's report
// carried a sibling session's denial). The session being analyzed names its own file, so a
// directory is narrowed to `<session-id>.jsonl` and, when that is absent, to nothing at all: an
// empty tally is the truth, a neighbour's rows are not. Pass the file directly to bypass this.
function readBlockLedger(target, sessionId) {
  // `given` separates 'no ledger passed' from 'a ledger with no row for this session' - the second
  // is a measured zero, the first is no measurement at all.
  const out = { rows: 0, byHook: {}, firstTs: null, lastTs: null, rowTs: [], given: !!target };
  if (!target) return out;
  let files = [];
  try {
    if (fs.statSync(target).isDirectory()) {
      const own = sessionId ? path.join(target, `${sessionId}.jsonl`) : null;
      files = own && fs.existsSync(own) ? [own] : [];
    } else {
      files = [target];
    }
  } catch { return out; }
  // Read these SYNCHRONOUSLY - readJsonl above is stream-based and resolves a Promise, so a
  // sync caller would return an empty tally before the first line arrived. These ledgers are one
  // short row per block, so a plain readFileSync is both correct and cheap.
  for (const f of files) {
    let lines = [];
    try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || !o.hook) continue;
      // A row carrying a `mode` is a MEASUREMENT, not a block: the fork-liveness probe and the stop
      // hook's tool-ended skip both log and deny nothing.
      if (o.mode) {
        out.probes = (out.probes || 0) + 1; out.probeKinds = out.probeKinds || {}; out.probeKinds[o.kind || o.mode] = (out.probeKinds[o.kind || o.mode] || 0) + 1;
        if (o.mode === 'probe' && o.kind === 'done-gate' && o.detail) (out.doneGateRows || (out.doneGateRows = [])).push({ ...o.detail, ts: o.ts || null });
        if (o.mode === 'probe' && o.kind === 'root-cause' && o.detail) (out.rootCauseRows || (out.rootCauseRows = [])).push(o.detail);
        if (o.mode === 'probe' && o.kind === 'correction') { const c = out.correction || (out.correction = newCorrection()); c.turns += 1; if (o.injected === true) c.injected += 1; }
        if (o.mode === 'probe' && o.kind === 'rationalization') tallyRationalization(out.rationalization || (out.rationalization = newRationalization()), o.detail || {});
        continue;
      }
      out.rows += 1;
      if (o.ts) out.rowTs.push({ ts: Date.parse(o.ts), hook: o.hook });
      const e = out.byHook[o.hook] || (out.byHook[o.hook] = { blocks: 0, reasons: new Map(), events: new Set(), tools: new Set() });
      e.blocks += 1;
      if (o.event) e.events.add(o.event);
      if (o.tool) e.tools.add(o.tool);   // rows from before the column exist without it - the cell stays empty
      // Keyed by REASON, which carries the file the denial named - two blocks on two different
      // files are two causes, and a table showing only the top one invited exactly that conflation
      // (measured: a report asserted one shared cause across three rows, one of which named a
      // different file and a real credential). The guard's own branch tag rides along when it set
      // one, so a hook with several branches says which fired.
      const r = String(o.reason || '').slice(0, 90);
      const branch = o.detail && o.detail.branch ? String(o.detail.branch) : '';
      const key = branch ? `[${branch}] ${r}` : r;
      e.reasons.set(key, (e.reasons.get(key) || 0) + 1);
      if (o.ts) {
        if (!out.firstTs || o.ts < out.firstTs) out.firstTs = o.ts;
        if (!out.lastTs || o.ts > out.lastTs) out.lastTs = o.ts;
      }
    }
  }

  return out;
}

// ---------- the two method-skill probes (log-only since 2026-09-25) ----------
// guard-stop-contract.js writes where `habits-done-gate` and `habits-root-cause` were
// NEEDED, and never holds or injects: the misses are counted here instead. A done-gate row is a claim
// over a turn's source edit; its unrun rows split EXCLUSIVELY by the user's two named exceptions
// first - a rule against running tests, a project with no tests found - then by whether the skill was
// loaded that turn, then by whether the session loaded it in an EARLIER turn (the main transcript's
// successful Skill calls, before the row). The rest are the misses.
const newDoneGate = () => ({ claims: 0, ran: 0, unrun: 0, byRule: 0, noTests: 0, skillLoaded: 0, inContext: 0, missed: 0 });
function tallyDoneGate(t, d, loadedBefore) {
  t.claims += 1;
  if (d.outcome === 'ran') { t.ran += 1; return; }
  t.unrun += 1;
  if (d.rule) t.byRule += 1;
  else if (d.tests === 'none-found') t.noTests += 1;
  else if (d.skill) t.skillLoaded += 1;
  else if (loadedBefore(d.ts)) t.inContext += 1;
  else t.missed += 1;
}
const DONE_GATE_SKILL_RE = /(?:^|:)(?:alfred-)?habits-done-gate$/;
const doneGateLine = (t) => `DONE GATE (probe): ${t.claims} done claim(s) over an edit - ${t.ran} ran after the edit, ${t.unrun} unrun: `
  + `${t.byRule} excused by a rule, ${t.noTests} with no tests found, ${t.skillLoaded} with the skill loaded, ${t.inContext} with it loaded earlier, ${t.missed} MISSED`;

// The Stop build check (check-turn-build.js) ships off and turns on per project 'after a measured
// week'; the done-gate probe above is that measurement. An UNCHECKED claim is an unrun one the user's
// two named exceptions do not excuse (a rule against running tests, no tests found) - the split's
// skill-loaded, loaded-earlier and missed buckets. At TURN_CHECK_THRESHOLD of them in the newest
// TURN_CHECK_WINDOW sessions - one session in three - validate and status paste ONE advisory row. The
// switch is the user's: nothing here writes it, and a project that already set it, or runs the strict
// hook profile (which runs the check anyway) or the minimal one (which switches it off), gets no row.
const TURN_CHECK_WINDOW = 10;
const TURN_CHECK_THRESHOLD = 3;
function turnCheckAdvice(sessionsDir, projectRoot, exclude = new Map()) {
  const { envOf, hookProfile, CORE_PLUGIN } = require(path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js'));
  const root = path.resolve(projectRoot);
  const account = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const readSettings = (f) => { try { const d = parseJson(fs.readFileSync(f, 'utf8')); return d && typeof d === 'object' ? d : {}; } catch { return {}; } };
  // The hooks see local over project over account, so the same order answers here; junk is no setting.
  const envs = [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(account, 'settings.json')]
    .map((f) => { const env = readSettings(f).env; return env && typeof env === 'object' ? env : {}; });
  const setting = (suffix) => [...envs, process.env].map((env) => envOf(env, suffix)).find((v) => v !== undefined && v !== '');
  // Review finding 9: the strict hook profile runs the Stop build check whatever TURN_CHECK says, so it
  // is advised nothing. A hook reads the profile as CLAUDE_PLUGIN_OPTION_HOOK_PROFILE; the shell a command
  // body runs this from has no such variable, so the account settings' pluginConfigs - the one file
  // Claude Code reads it from (code.claude.com/docs/en/plugins-reference) - answers after it.
  const configs = readSettings(path.join(account, 'settings.json')).pluginConfigs;
  const stored = Object.entries(configs && typeof configs === 'object' ? configs : {})
    .filter(([id]) => id.split('@')[0] === CORE_PLUGIN).map(([, c]) => c && c.options && c.options.hook_profile).find((v) => typeof v === 'string' && v);
  const profile = hookProfile({ CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: process.env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE || stored || '' });
  const on = String(setting('TURN_CHECK') || '').trim() === '1' || profile === 'strict';
  const blockDir = path.resolve(root, String(setting('DOCS_PATH') || '.alfred/docs'), 'hook-blocks');
  const newest = findSessionFiles(sessionsDir).filter((f) => !exclude.has(path.basename(f, '.jsonl')))
    .map((f) => ({ f, at: fs.statSync(f).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, TURN_CHECK_WINDOW).map((x) => x.f);
  const doneGate = newDoneGate();
  for (const f of newest) for (const d of readBlockLedger(blockDir, path.basename(f, '.jsonl')).doneGateRows || []) tallyDoneGate(doneGate, d, () => false);
  const unchecked = doneGate.skillLoaded + doneGate.inContext + doneGate.missed;
  // minimal switches the build check off whatever TURN_CHECK says, so the key it would advise does nothing
  const advise = !on && profile !== 'minimal' && unchecked >= TURN_CHECK_THRESHOLD;
  const row = advise ? `turn-check: advise - ${unchecked} done claims over an edit had nothing run after it in the newest ${newest.length} sessions `
    + `(threshold ${TURN_CHECK_THRESHOLD} per ${TURN_CHECK_WINDOW}): set ALFRED_CODE_TURN_CHECK=1 to run the scoped build check at Stop` : null;
  return { sessions: newest.length, window: TURN_CHECK_WINDOW, threshold: TURN_CHECK_THRESHOLD, blockDir, doneGate, unchecked, on, profile, advise, row };
}

// A root-cause row is the first red build or test run of a streak. The ledger cannot know what came
// next, so the transcript answers it: the run's tool_use_id is found in the session's own transcripts
// (the main one and every subagent's), and what follows it in that actor's file decides - the skill
// loaded before the next fix, or already in context (loaded earlier in the same file, or preloaded by
// the seat's own definition), or loaded only after a fix, or a fix with no load at all (MISSED), or
// no fix after the red run. A fix is a file-tool edit or a shell write to a non-prose file inside the
// session's own cwd (the row's `cwd`; a relative path is inside it, resolved through the command's own
// `cd`s) - a write anywhere else is scratch, and a target behind a variable is not judged. A row with no
// cwd falls back to reading a temp-dir path as scratch. A call whose result is an error - a denied edit,
// a failed Skill load - changed nothing and loaded nothing.
const newRootCause = () => ({ streaks: 0, beforeFix: 0, inContext: 0, preloaded: 0, afterFix: 0, missed: 0, noFix: 0, unmatched: 0 });
const ROOT_CAUSE_SKILL_RE = /(?:^|:)(?:alfred-)?habits-root-cause$/;
const FIX_EDIT_TOOL_RE = /^(?:Edit|Write|MultiEdit|NotebookEdit)$/;
const FIX_SKIP_RE = /\.(?:md|mdx|markdown|txt|rst|adoc|log|out|err|tmp|bak)$|(?:^|[\\/])\.claude[\\/]/i;
const TEMP_PATH_RE = /^\/(?:tmp|dev|private\/tmp)\//;
function fixPath(f, cwd) {
  if (typeof f !== 'string' || !f || FIX_SKIP_RE.test(f) || f.startsWith('/dev/')) return false;
  if (!path.isAbsolute(f)) return true;
  if (!cwd) return !TEMP_PATH_RE.test(f);
  const rel = path.relative(cwd, f);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
const FIX_SHELL_WHAT_RE = /^(?:an in-place edit|an interpreter write|a shell redirection|a `tee` write|a copy\/move destination)$/;
let shellWritesLib;
function shellWrites() {
  if (shellWritesLib === undefined) {
    try { shellWritesLib = require(path.join(__dirname, '..', 'stack', 'hooks', 'shell-writes.js')); } catch { shellWritesLib = null; }
  }
  return shellWritesLib;
}
function isFix(name, input, cwd) {
  if (FIX_EDIT_TOOL_RE.test(name)) return fixPath(input.file_path || input.notebook_path, cwd);
  const sw = shellWrites();
  if (!isShellTool(name) || !sw) return false;
  try {
    const scan = sw.scanShell(String(input.command || ''));
    return scan.targets.some((t) => {
      if (!FIX_SHELL_WHAT_RE.test(t.what)) return false;
      const raw = scan.expandVars ? scan.expandVars(String(t.raw || '')) : String(t.raw || '');
      if (sw.isVar(raw) || /[$`]/.test(raw) || raw.startsWith('~')) return false;
      if (path.isAbsolute(raw)) return fixPath(raw, cwd);
      // With a known cwd, no anchor means a cd it cannot follow - never guess; with none, no cd at all.
      const base = sw.anchorAt(scan.cds, t.index, cwd || null);
      if (base) return fixPath(path.resolve(base, raw), cwd);
      return cwd ? false : fixPath(raw, cwd);
    });
  } catch { return false; }
}
// The main transcript and its subagents' - the layout analyzeSubagents reads.
function sessionTranscriptFiles(sessionFile) {
  const files = [sessionFile];
  let dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
  if (!fs.existsSync(dir)) dir = path.join(path.dirname(sessionFile), 'subagents');
  const walk = (d, depth) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.isDirectory()) { if (depth < 2) walk(path.join(d, e.name), depth + 1); } else if (e.name.endsWith('.jsonl')) files.push(path.join(d, e.name));
    }
  };
  walk(dir, 0);
  return files;
}
function toolSequence(file) {
  const seq = [];
  const failed = new Set();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return seq; }
  for (const l of text.split('\n')) {
    if (!l.includes('"tool_use"') && !l.includes('"tool_result"')) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const c = o && o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const b of c) {
      if (b && b.type === 'tool_use' && o.type === 'assistant')
        seq.push({ id: b.id, name: String(b.name || ''), input: b.input || {}, cwd: typeof o.cwd === 'string' ? o.cwd : null, ts: o.timestamp || null });
      else if (b && b.type === 'tool_result' && b.is_error === true) failed.add(b.tool_use_id);
    }
  }
  for (const st of seq) st.error = failed.has(st.id);
  return seq;
}
const preloadCache = new Map();
function seatPreloads(agentType) {
  const name = String(agentType || '').replace(/^.*:/, '');
  if (!name) return false;
  if (!preloadCache.has(name)) {
    let hit = false;
    for (const f of [path.join(__dirname, '..', 'stack', 'agents', `${name}.md`), path.join(process.cwd(), '.claude', 'agents', `${name}.md`)]) {
      try {
        const fm = (fs.readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
        const skills = (fm.match(/^skills:\s*\n((?:\s+-\s+.*\n?)+)/m) || [])[1] || '';
        if (skills.split('\n').some((l) => ROOT_CAUSE_SKILL_RE.test(l.replace(/^\s*-\s*/, '').trim()))) { hit = true; break; }
      } catch { /* not this home */ }
    }
    preloadCache.set(name, hit);
  }
  return preloadCache.get(name);
}
function resolveRootCause(details, files) {
  const t = newRootCause();
  if (!details || !details.length) return t;
  const seqs = files.map(toolSequence);
  const isLoad = (st) => !st.error && st.name === 'Skill' && ROOT_CAUSE_SKILL_RE.test(String(st.input.skill || ''));
  for (const d of details) {
    t.streaks += 1;
    let seq = null;
    let at = -1;
    for (const sq of seqs) { at = d.tool_use_id ? sq.findIndex((st) => st.id === d.tool_use_id) : -1; if (at >= 0) { seq = sq; break; } }
    if (!seq) { t.unmatched += 1; continue; }
    if (seq.slice(0, at).some(isLoad)) { t.inContext += 1; continue; }
    if (seatPreloads(d.agent_type)) { t.preloaded += 1; continue; }
    const rest = seq.slice(at + 1);
    const load = rest.findIndex(isLoad);
    const fix = rest.findIndex((st) => !st.error && isFix(st.name, st.input, st.cwd));
    if (load >= 0 && (fix < 0 || load < fix)) t.beforeFix += 1;
    else if (fix >= 0) { if (load >= 0) t.afterFix += 1; else t.missed += 1; }
    else t.noFix += 1;
  }
  return t;
}
const rootCauseLine = (t) => `ROOT CAUSE (probe): ${t.streaks} red streak(s) - ${t.beforeFix} loaded before the fix, ${t.inContext} already in context, `
  + `${t.preloaded} preloaded by the seat, ${t.afterFix} loaded after the fix, ${t.missed} MISSED, ${t.noFix} with no fix after, ${t.unmatched} unmatched`;
// The correction probe (guard-answer-length.js, log-only unless ALFRED_CODE_CORRECTION_NUDGE=inject):
// one row per correction turn. Whether it was then SAVED is the scorecard's corrections-saved row,
// read from the transcript with the same test.
const newCorrection = () => ({ turns: 0, injected: 0 });
const correctionLine = (t) => `CORRECTION NUDGE (probe): ${t.turns} correction turn(s) - ${t.injected} with the save line injected, ${t.turns - t.injected} logged only`;

// The rationalization probe (guard-stop-contract.js, log-only): a close dismissing a failure in a turn
// that had one to dismiss. Split two ways - by the evidence (a red run first, then a skipped test, then
// an added skip marker) and by what the phrase claims - so the rate of each is its own number.
const newRationalization = () => ({ closes: 0, red: 0, skipped: 0, skipEdit: 0, preExisting: 0, unrelated: 0, flaky: 0, deferred: 0 });
function tallyRationalization(t, d) {
  t.closes += 1;
  if (d.evidence === 'red') t.red += 1; else if (d.evidence === 'skipped') t.skipped += 1; else t.skipEdit += 1;
  const p = String(d.phrase || '');
  if (/pre[- ]?existing/i.test(p)) t.preExisting += 1;
  else if (/unrelated|caused by|related to|introduced by|\bfrom (?:my|this|the|our)\b/i.test(p)) t.unrelated += 1;
  else if (/flak|transient|intermittent/i.test(p)) t.flaky += 1;
  else t.deferred += 1;
}
const rationalizationLine = (t) => `RATIONALIZATION (probe): ${t.closes} close(s) dismissing a failure - ${t.red} after a red run, ${t.skipped} after a skipped test, ${t.skipEdit} after an added skip marker; `
  + `${t.preExisting} pre-existing, ${t.unrelated} unrelated to the change, ${t.flaky} flaky or transient, ${t.deferred} deferred`;

// Resolves a session's probe rows in place; the raw rows never reach a report.
function finishProbes(ledger, sessionFile) {
  if (ledger && ledger.doneGateRows) {
    // The done-gate probe is a main-session Stop row, so the main transcript holds any earlier load.
    const loads = toolSequence(sessionFile).filter((st) => !st.error && st.name === 'Skill' && DONE_GATE_SKILL_RE.test(String(st.input.skill || '')))
      .map((st) => Date.parse(st.ts)).filter((n) => !Number.isNaN(n));
    const loadedBefore = (ts) => { const at = Date.parse(ts); return !Number.isNaN(at) && loads.some((n) => n < at); };
    ledger.doneGate = newDoneGate();
    for (const d of ledger.doneGateRows) tallyDoneGate(ledger.doneGate, d, loadedBefore);
    delete ledger.doneGateRows;
  }
  if (ledger && ledger.rootCauseRows) {
    ledger.rootCause = resolveRootCause(ledger.rootCauseRows, sessionTranscriptFiles(sessionFile));
    delete ledger.rootCauseRows;
  }
  return ledger;
}

// The transcript names the TOOL a denial hit and, when the harness prints the bracket, the hook
// file. The JSON permission-decision route prints no bracket at all, so those land in
// '(unattributed)' - and a reader then goes looking for a guard that was never missing. Every guard
// writes a block-ledger row at the moment it denies, so the two join by TIME: nearest row inside
// the window, each row consumed once. Measured on the case that filed this: 0.3s apart.
const DENIAL_JOIN_MS = 5000;
function joinUnattributedDenials(main, blockLedger) {
  const stamps = (main.unattributedDenials || []).map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  const rows = ((blockLedger && blockLedger.rowTs) || []).slice().sort((a, b) => a.ts - b.ts);
  const used = new Set();
  const joined = {};
  let matched = 0;
  let worst = 0;
  for (const at of stamps) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < rows.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(rows[i].ts - at);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD > DENIAL_JOIN_MS) continue;
    used.add(best);
    matched += 1;
    if (bestD > worst) worst = bestD;
    joined[rows[best].hook] = (joined[rows[best].hook] || 0) + 1;
  }
  return { total: stamps.length, matched, joined, worstMs: worst };
}

function hookJoinStats(main, agents, hookLog, tools) {
  const trTools = Object.values(tools).reduce((n, t) => n + t.calls, 0);
  if (!hookLog.firstTs || !hookLog.lastTs) return { trTools, coverage: null };
  // Compare only calls inside the ledger's own window: a ledger wired mid-session
  // (instrumentation installed during the run) legitimately misses everything before
  // its first row - measured at 67 of an 80-row "gap" in a real install session.
  // A 35-58ms hook latency is NOT a coverage gap: comparing raw timestamps put the ledger row a
  // few ms outside the transcript's own window and printed '1 call outside the window' plus a FALSE
  // 'wired mid-session' line over 62/62 and 194/194 real coverage, across 16 bundles. Widen the
  // window by the hook's own latency budget before comparing.
  // Both sides are ISO STRINGS. `firstTs - HOOK_LATENCY_MS` on a string is NaN and every `>=`
  // against NaN is false, so inWin was 0 for every session that had a ledger at all - the report
  // printed '0% of tool calls are inside the ledger window' plus the very 'wired mid-session' line
  // the latency budget above was added to remove. Re-derived by hand across the audited corpus, the
  // true coverage of those same sessions runs 8/8, 10/10, 12/12, 25/25, 50/51 and 65/66. Parse to
  // epoch milliseconds on BOTH sides before any arithmetic.
  // 250ms was the first guess and it was too tight: the hook latencies measured in the audit
  // corpus ran 183/190/213/259/300/331/333/497ms, so HALF of them fell outside the budget and the
  // call they belong to read as out-of-window - which prints the false 'ledger wired mid-session'
  // line this budget exists to remove. 750 clears the measured maximum with room; the window is a
  // tolerance for one hook's own spawn time, not a semantic boundary, so widening it cannot pull
  // in a call from a different phase of the session.
  // Do NOT widen it further. The ledger row carries no `tool_use_id`, so the join is tool name +
  // timestamp and nothing else; every extra millisecond buys matches that are guesses. A call this
  // budget cannot match is reported UNJOINED - a wrong join reads as evidence, an unjoined call
  // reads as what it is.
  const HOOK_LATENCY_MS = 750;
  const ms = (ts) => (typeof ts === 'number' ? ts : Date.parse(ts));
  const firstMs = ms(hookLog.firstTs);
  const lastMs = ms(hookLog.lastTs);
  const allTs = [main, ...agents.map((a) => a.stats)].flatMap((src) => src.toolCallTs || []);
  const inWin = allTs.filter((ts) => ms(ts) >= firstMs - HOOK_LATENCY_MS && ms(ts) <= lastMs + HOOK_LATENCY_MS).length;
  // Anchor coverage to the ACTIVE window (after a mid-file /clear) - the raw span counted a
  // dead 23h50m gap as uncovered session time, reporting ~6% coverage for a ~96%-covered
  // 89-minute work window (measured).
  const sessStart = main.clearTs && main.clearTs > main.firstTs ? main.clearTs : main.firstTs;
  const sessSpan = sessStart && main.lastTs ? Date.parse(main.lastTs) - Date.parse(sessStart) : 0;
  const covSpan = Math.max(0, Math.min(Date.parse(main.lastTs || hookLog.lastTs), Date.parse(hookLog.lastTs)) - Math.max(Date.parse(sessStart || hookLog.firstTs), Date.parse(hookLog.firstTs)));
  const pct = sessSpan > 0 ? Math.round((100 * covSpan) / sessSpan) : 100;
  // A quiet tail (zero calls after the ledger's last row) and a real coverage gap read the
  // same in percentages - count the tail's calls so the report can tell them apart
  // (measured: an idle 38%-of-session tail with 0 tool calls was reported as unlogged activity).
  // `lastTs + HOOK_LATENCY_MS` on a string CONCATENATES ('...Z' + 250 = '...Z250'), so this was
  // always false too and the quiet-tail line printed unconditionally.
  const tailCalls = allTs.filter((ts) => ms(ts) > lastMs + HOOK_LATENCY_MS).length;
  // CALL coverage leads, wall clock follows: a session whose last hour is one idle await_summary
  // reads as 38% time-covered and 100% call-covered, and the second number is the true one.
  const callPct = allTs.length ? Math.round((100 * inWin) / allTs.length) : 100;
  // Per-side join. A call the harness rejects before PreToolUse leaves no ledger row, and a ledger
  // row can have no transcript call (an ask the transcript never wrote) - a count-based 'unmatched'
  // cancels the two into a false 40 vs 40 (measured). Match each in-window call to the nearest
  // unused row of the same tool within the latency budget and list the leftovers on each side.
  const allCalls = [main, ...agents.map((a) => a.stats)].flatMap((src) => src.toolCallIdx || []);
  const rowsIdx = (hookLog.rowsIdx || []).map((r) => ({ ts: r.ts, tool: r.tool, ms: ms(r.ts), used: false }));
  const unmatchedCalls = [];
  let matchedCalls = 0;
  let ambiguousCalls = 0;
  for (const c of allCalls) {
    const t = ms(c.ts);
    if (!(t >= firstMs - HOOK_LATENCY_MS && t <= lastMs + HOOK_LATENCY_MS)) continue;
    let best = null;
    let runnerUp = null;
    for (const r of rowsIdx) {
      if (r.used || r.tool !== c.tool) continue;
      const d = Math.abs(r.ms - t);
      if (d > HOOK_LATENCY_MS) continue;
      if (!best || d < best.d) { runnerUp = best; best = { r, d }; }
      else if (!runnerUp || d < runnerUp.d) runnerUp = { r, d };
    }
    // Two rows of the same tool within 100ms of each other cannot be told apart by time, and the
    // ledger carries no tool_use_id to break the tie - so neither is joined.
    const ambiguous = best && runnerUp && Math.abs(runnerUp.d - best.d) <= 100;
    if (best && !ambiguous) { best.r.used = true; matchedCalls += 1; } else { unmatchedCalls.push({ ts: c.ts, tool: c.tool, ambiguous: !!ambiguous }); if (ambiguous) ambiguousCalls += 1; }
  }
  const unmatchedRows = rowsIdx.filter((r) => !r.used).map((r) => ({ ts: r.ts, tool: r.tool }));
  return { trTools, coverage: {
    inWin, callPct, pct, calls: allTs.length, outside: allTs.length - inWin, tailCalls, unmatched: Math.max(0, inWin - hookLog.rows),
    latencyMs: HOOK_LATENCY_MS, matchedCalls, ambiguousCalls,
    unmatchedCallCount: unmatchedCalls.length, unmatchedCalls: unmatchedCalls.slice(0, 8),
    unmatchedRowCount: unmatchedRows.length, unmatchedRows: unmatchedRows.slice(0, 8),
  } };
}

// The window tier comes from a model id, and the two records that carry one can disagree. The
// session's OWN reminder is the id it was started on; cost-state keys off the billing rows. Say
// which one answered, and say it once - both renderers call this.
function windowSource(main) {
  const rem = main.modelIdReminder || null;
  const cs = (main.modelIdsFull || []).join(', ') || null;
  if (!rem && !cs) return null;
  if (!rem) return `${cs} (from cost-state; the session's own model reminder is absent)`;
  if (!cs) return `${rem} (the session's own model reminder)`;
  const agree = main.modelIdsFull.includes(rem);
  return agree
    ? `${rem} (the session's own model reminder; cost-state agrees)`
    : `${rem} (the session's own model reminder) - cost-state says ${cs}: the reminder wins, it is what the session ran on`;
}

// The user stopping a turn is neither an error nor a hook block, and a session whose LAST row is
// the interrupt marker did not close, it was abandoned - both invisible before.
function interruptLine(main) {
  if (!main.userInterrupts) return null;
  const ended = main.lastInterruptTs && main.lastTs && main.lastInterruptTs >= main.lastTs;
  return `user interrupts ${main.userInterrupts}${ended ? ' - the session ENDS on one: it was abandoned by hand, not closed' : ''}`;
}

// ---------- the efficiency scorecard ----------
// One row per practice, each a measured number with its denominator and what the number tests.
// The report JUDGES the rows; the analyzer never scores a session - a rate is read against the
// practice, the turn is opened before a row becomes a finding.
function efficiencyRows(main, agg, blockLedger) {
  const e = main.efficiency || {};
  const rows = [];
  const tsList = (arr, n = 6) => arr.slice(0, n).map((t) => (t ? String(t).slice(11, 19) : '?')).join(', ') + (arr.length > n ? ` … +${arr.length - n}` : '');
  {
    const c = agg.cost || {};
    const pt = priceTable();
    if (c.error || pt.error) {
      rows.push({ practice: 'cost at list price', measured: `price table unreadable (${c.error || pt.error}) - no cost computed`, tests: 'meta/model-prices.json, or the file --prices names' });
    } else {
      const seats = Object.entries(c.byType || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, usd]) => `${t} ${fmtUsd(usd)}`).join(', ');
      // The table holds every row the page prices, so a model with no row is one the page did not list when it was
      // fetched - said with the date, never guessed at a sibling's price (2.1.6 K3).
      const unpriced = Object.entries(c.unpriced || {}).map(([m, n]) => `${m} x${n} msg${n === 1 ? '' : 's'} - not on the pricing page (fetched ${pt.table.fetched})`).join(', ');
      const parts = [`~${fmtUsd(c.usd)} - main ${fmtUsd(c.main)}${c.seats ? `, subagents ${fmtUsd(c.subagents)} over ${c.seats} seat(s) (${seats})` : ''}`];
      if (main.totalCostUSD != null) parts.push(`cost-state billed ${fmtUsd(Number(main.totalCostUSD))}`);
      if (unpriced) parts.push(`unpriced: ${unpriced}`);
      if (c.noSplitMsgs) parts.push(`${c.noSplitMsgs} msg(s) with no cache-write split, billed at the 5-minute rate`);
      if (c.fastMsgs) parts.push(`${c.fastMsgs} fast-mode msg(s)`);
      if (c.prefixUsd) parts.push(`fork prefix ${fmtUsd(c.prefixUsd)} left to the parent session's bill`);
      rows.push({ practice: 'cost at list price', measured: parts.join('; '), tests: `list price from ${pt.table.source}, fetched ${pt.table.fetched} - what the work costs at the API's list price, not what a subscription charges; a gap to cost-state's billed figure is the harness's untranscribed side calls; refresh the table from its page, never from memory` });
    }
  }
  if (main.floorCtx) {
    const share = main.total.cacheRead ? Math.round((100 * main.floorCtx * main.total.msgs) / main.total.cacheRead) : null;
    rows.push({ practice: 'standing floor', measured: `~${fmt(main.floorCtx)} tok/msg${share != null ? `, ~${share}% of cache-read` : ''}`, tests: 'the always-on set is the one lever on this number - lint check 33 caps it, /alfred-code:status reports it per install' });
  }
  rows.push({
    practice: 'cache continuity',
    measured: `${e.cacheMisses || 0} miss(es), ~${fmt(e.cacheMissTokens || 0)} tok re-cached; ${e.expectedRebuilds || 0} expected rebuild(s) after compaction, ~${fmt(e.expectedRebuildTokens || 0)} tok${(e.cacheMissAt || []).length ? ` - misses at: ${tsList(e.cacheMissAt.map((x) => x.ts))}` : ''}`,
    tests: "Claude Code's own miss rule (over 5% and at least 2,000 tok re-processed); a miss outside a compaction is a cache break - open the turn before it: a system-prompt change, a tool-set change, an idle past the TTL",
  });
  {
    const cr = e.compactionRereads || [];
    const files = cr.reduce((n, c) => n + c.files, 0), chars = cr.reduce((n, c) => n + c.chars, 0);
    rows.push({ practice: 'compaction re-reads', measured: cr.length ? `${cr.length} compaction(s): ${files} file(s) read before one and again after it, ~${fmt(approxTok(chars))} tok` : 'no compaction', tests: 'what a compaction instruction should keep (the modified files, the plan, the commands) - a re-read after the summary is the summary having dropped it' });
  }
  {
    const b = e.buildDirReads || { calls: 0, chars: 0, paths: {} };
    const top = Object.entries(b.paths).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([p, c]) => `${p.split(/[/\\]/).slice(-2).join('/')} ~${fmt(approxTok(c))}`).join(', ');
    rows.push({ practice: 'build-dir reads', measured: `${b.calls} call(s), ~${fmt(approxTok(b.chars))} tok${top ? ` - top: ${top}` : ''}`, tests: 'node_modules / bin / obj / dist / coverage / lockfiles / logs on either route - the read guard has no class for these; the rate decides whether it gets one' });
  }
  {
    const c = e.checks || {};
    const t = c.test || { calls: 0, chars: 0, scoped: 0, whole: 0 };
    const bashChars = ['Bash', 'PowerShell', 'Monitor'].reduce((n, k) => n + ((agg.tools[k] && agg.tools[k].resultChars) || 0), 0);
    const checkChars = ['test', 'build', 'lint', 'ci'].reduce((n, k) => n + ((c[k] && c[k].chars) || 0), 0);
    const share = bashChars ? Math.round((100 * checkChars) / bashChars) : null;
    rows.push({ practice: 'test and build runs', measured: `test ${t.calls} (${t.scoped} scoped, ${t.whole} whole-suite) ~${fmt(approxTok(t.chars))} tok; build ${(c.build || {}).calls || 0} ~${fmt(approxTok((c.build || {}).chars || 0))}; lint ${(c.lint || {}).calls || 0} ~${fmt(approxTok((c.lint || {}).chars || 0))}; ci ${(c.ci || {}).calls || 0}${share != null ? ` - ${share}% of shell result volume` : ''}`, tests: 'iterate on ONE test or project, run the whole suite once at the gate; the result chars are what lands in context - a green run needs its summary line, a red run earns its trace' });
  }
  {
    const n = main.gitCommits || 0, k = e.commitsChecked || 0;
    rows.push({ practice: 'checked commits', measured: n ? `${k} of ${n} commit(s) had a test, build, lint or ci-status call in the ${CHECK_WINDOW} tool calls before${(e.commitsUnchecked || []).length ? ` - unchecked at: ${tsList(e.commitsUnchecked)}` : ''}` : 'no commit', tests: 'a check the session can run, before the work is called done - ran, not necessarily green; open the run' });
  }
  rows.push({ practice: 'green claims', measured: `${(e.unverifiedGreenClaims || []).length} of ${e.greenClaims || 0} claim(s) that a check passed landed in a turn that ran no check${(e.unverifiedGreenClaims || []).length ? ` - at: ${tsList(e.unverifiedGreenClaims)}` : ''}`, tests: "evidence, not assertion - open each turn: a check run in an EARLIER turn, or in a dispatched seat's own transcript, is evidence the regex cannot see" });
  rows.push({ practice: 'correction streaks', measured: `${(e.correctionStreaks || []).length} streak(s) (${STREAK_TURNS} short user turns in a row, each after a ${fmt(STREAK_LONG)}+ char answer, as guard-answer-length counts them)${(e.correctionStreaks || []).length ? ` at: ${tsList(e.correctionStreaks)}` : ''}; ${e.correctionTurns || 0} of ${e.longAnswered || 0} answer(s) over ${fmt(STREAK_LONG)} chars drew a short (under ${STREAK_SHORT} char) user turn`, tests: 'after two corrections the context holds the failed drafts: the format ask, or /clear with a prompt that carries what was learned; the second number is what the strict walk did not chain' });
  {
    const total = (e.correctionsSaved || 0) + (e.correctionsUnsaved || []).length;
    const unsaved = (e.correctionsUnsaved || []).length;
    rows.push({ practice: 'corrections saved to memory', measured: `${e.correctionsSaved || 0} of ${total} correction(s) saved within ${SAVE_WINDOW} replies; ${unsaved} unsaved${total ? ` (${Math.round((100 * unsaved) / total)}%)` : ''}${unsaved ? ` at: ${tsList(e.correctionsUnsaved)}` : ''}`, tests: 'a correction the user had to make (a short turn carrying a correction marker, as guard-answer-length reads it) is a preference or a lesson; one never stored is made again next session' });
  }
  rows.push({ practice: 'long answers', measured: `${e.longAnswers || 0} of ${e.finalAnswers || 0} final answer(s) over ${fmt(LONG_ANSWER)} chars of prose`, tests: "the answer budget - the user's own ask may have lifted it, check the prompt before scoring" });
  {
    const n = agg.navigation || { reads: 0, located: 0, grepLocated: 0, symbolCalls: 0 };
    // The ledger names the guard for every denial; the transcript's bracket misses the JSON
    // permission route, so it is the fallback and says so.
    const denials = blockLedger && blockLedger.given
      ? `${(blockLedger.byHook[WHOLE_FILE_HOOK] || { blocks: 0 }).blocks} whole-file denial(s) (hook-block ledger)`
      : `${agg.wholeFileBracket || 0} whole-file denial(s) (transcript bracket - pass --hook-blocks for the ledger)`;
    rows.push({ practice: 'navigation', measured: `${n.located} of ${n.reads} source-file read(s) had a locate step in the ${NAV_WINDOW} calls before${n.reads ? ` (${Math.round((100 * n.located) / n.reads)}%)` : ''}; symbol tools ${n.symbolCalls} call(s) against ${n.grepLocated} grep-then-read sequence(s); ${denials}`, tests: 'alfred-navigation, main and seats: locate with serena or the LSP, then read the range - a read with no locate step before it reads to FIND something, a grep-then-read answers a symbol question by name-match, and every whole-file denial is a round trip lost' });
  }
  {
    const servers = Object.entries(agg.mcpServers || {});
    const calls = servers.reduce((n, [, m]) => n + m.calls, 0);
    const errs = servers.reduce((n, [, m]) => n + m.errors, 0);
    const rejected = servers.reduce((n, [, m]) => n + (m.rejected || 0), 0);
    const per = servers.filter(([, m]) => m.errors).sort((a, b) => b[1].errors - a[1].errors).map(([s, m]) => `${s} ${m.errors}/${m.calls}`).join(', ');
    rows.push({ practice: 'MCP failures', measured: calls ? `${errs} of ${calls} MCP call(s) returned an error${per ? `: ${per}` : ''}${rejected ? `; ${rejected} more rejected before the server ran (a guard or the harness)` : ''}` : 'no MCP call', tests: "main and seats: a server that errors on a material share of its calls is down or misconfigured, not misused - that count, never one error, is what opens a server health check; a guard denial, a harness rejection and a declined ask are not the server's" });
  }
  {
    const d = agg.dispatchOverhead || { seats: 0 };
    rows.push({ practice: 'dispatch overhead', measured: d.seats ? `${d.heavy} of ${d.seats} seat(s) spent over 60% of their input re-sending their own first-message context; ~${fmt(d.preloadTokens)} of ~${fmt(d.seatInputTokens)} seat input tok is that context${d.heavySeats.length ? ` - ${d.heavySeats.slice(0, 4).map((h) => `${h.type} (${h.msgs} msg, ${h.share}%)`).join(', ')}` : ''}` : 'no dispatch', tests: 'a dispatch pays its preload before any work - a brief that returns less than that preload is a trade lost; a one-message seat is 100% by construction' });
  }
  return rows;
}

// The complement of every consumption table above it: one row per INSTALLED artifact, and the
// unused names collapsed to one line per layer so a 79-skill install stays readable.
function printInventoryBlock(invUse) {
  if (!invUse) return;
  const many = invUse.source.sessions > 1;
  console.log(`\nINVENTORY vs USE (what the install HAS against what ${many ? `these ${invUse.source.sessions} sessions` : 'this session'} touched - a name listed and unused was installed and never reached)`);
  console.log(`  source: skills/agents/rules from ${invUse.source.skills_agents_rules}; plugins from ${invUse.source.plugins}; MCP from ${invUse.source.mcps}`);
  for (const L of inventoryLayers(invUse)) {
    if (!L.rows) continue;
    console.log(`  ${L.label.toUpperCase()} - used ${L.usedInstalled} of ${L.total} installed${L.observedOnly ? `, +${L.observedOnly} used but in no inventory the run could read` : ''}`);
    if (L.used.length) console.log(`    ${pad('name', 38)} ${pad('source', 10)} ${pad('installed', 9)} ${pad('used', 9)} ${pad('how', 42)} first use`);
    for (const r of L.used) console.log(`    ${pad(r.name, 38)} ${pad(r.source, 10)} ${pad(installedCell(r), 9)} ${pad(usedCell(r), 9)} ${pad(r.how.join(', '), 42)} ${r.firstUse || ''}`);
    if (L.notObservable.length) console.log(`    always-on - in every prompt, use not observable (${L.notObservable.length}): ${L.notObservable.join(', ')}`);
    if (L.unused.length) console.log(`    ${many ? 'never used' : 'unused'} (${L.unused.length}): ${L.unused.join(', ')}`);
  }
  console.log('  a plugin counts as installed only in the sessions a registry record reaches (its scope, project, install date and enable) or that loaded or used it; a hook scores from the rows naming its command, so one that only adds context is not observable; and a catalog-sourced row proves the stack ships the artifact, never that this project installed it');
}

function printReport(main, agents, hookLog, window, blockLedger, invUse) {
  const span = main.firstTs && main.lastTs ? new Date(main.lastTs) - new Date(main.firstTs) : null;
  console.log(`Session ${path.basename(main.file, '.jsonl')}  ${main.firstTs || '?'} → ${main.lastTs || '?'} (${dur(span)})${main.ccVersion ? `  Claude Code ${main.ccVersion}` : ''}`);
  if (main.clearTs && main.clearTs > main.firstTs) {
    console.log(`  active window since last /clear: ${main.clearTs} → ${main.lastTs} (${dur(new Date(main.lastTs) - new Date(main.clearTs))}) - use this, not the raw span, for duration claims`);
  }
  if (window) console.log(`windowed: ${window.fromStr || 'start'} → ${window.toStr || 'end'} (subagents dispatched outside the window are excluded)`);
  console.log(`user prompts ${main.userPrompts} · API messages ${main.total.msgs} · compactions ${main.compactions} · API errors ${main.apiErrors} · git commits ${main.gitCommits || 0}${main.prMerges ? ` (+${main.prMerges} pr-merge)` : ''}`);
  // The PEAK is what every threshold in the stack keys off; the average understated it by 17-43%.
  if (main.peakCtx) console.log(`peak ctx ${fmt(main.peakCtx)} per message${main.peakCtxAt ? ` (at ${main.peakCtxAt})` : ''} - the number every fresh-session threshold is measured against, not the average below`);
  if (main.thinkingTokens) console.log(`thinking ${fmt(main.thinkingTokens)} tok (cost-state.modelUsage) - billed, and attributable to no single message: spike residuals close against this, not against tool output`);
  if (main.floorCtx) {
    const share = main.total.cacheRead ? Math.round((100 * main.floorCtx * main.total.msgs) / main.total.cacheRead) : null;
    console.log(`standing inventory ~${fmt(main.floorCtx)} tok/msg (system prompt + tool schemas + CLAUDE.md + always-on rules) - paid on EVERY message${share != null ? `, ~${share}% of cache-read` : ''}, and re-paid in full after every compaction`);
  }
  {
    const src = windowSource(main);
    if (src) console.log(`model (with window suffix) ${src} - the assistant messages strip the suffix, and it is what picks the context tier`);
    const il = interruptLine(main);
    if (il) console.log(il);
  }
  if (main.totalCostUSD != null) console.log(`billed $${Number(main.totalCostUSD).toFixed(2)} (cost-state)`);
  if (main.untranscribed) console.log('untranscribed calls: cost-state cache-read ' + fmt(main.costState.cacheRead) + ' vs transcript ' + fmt(main.total.cacheRead) + ' - gap ' + fmt(main.untranscribed.cacheRead) + (main.untranscribed.contexts != null ? ' (~' + main.untranscribed.contexts + 'x the peak context)' : '') + ': the harness' + String.fromCharCode(39) + 's post-turn recap call(s) are billed and written to no transcript row - the bundle reconciles to its bill only with this line');
  if (main.forkPrefix && main.forkPrefix.msgs) console.log('fork prefix: ' + main.forkPrefix.msgs + ' msgs / ' + fmt(main.forkPrefix.cacheRead) + ' cache-read / ' + main.forkPrefix.toolCalls + ' tool calls carry another session' + String.fromCharCode(39) + 's id (' + main.forkPrefix.sessionIds.join(', ') + ') - a copied prefix of that transcript, counted there; this file' + String.fromCharCode(39) + 's own tail is ' + (main.total.msgs - main.forkPrefix.msgs) + ' msgs / ' + fmt(main.total.cacheRead - main.forkPrefix.cacheRead) + ' cache-read, and the ledger cross-check is judged over that tail only');
  if (main.stopHookBlocks) console.log(`Stop-hook denials ${main.stopHookBlocks} - these arrive as meta user TEXT, not tool results, so they are absent from the hook-blk column below`);
  if (main.harnessDenials) console.log(`Harness denials ${main.harnessDenials} - read as a block (auto-mode classifier, a foreground sleep, a tool-schema failure) but no stack hook ran: excluded from hook-blk, never charge a guard for them`);
  {
    const byHook = Object.entries(main.denialsByHook || {}).sort((a, b) => b[1] - a[1]);
    if (byHook.length) console.log(`denials by hook: ${byHook.map(([h, n]) => `${h}×${n}`).join(', ')} - the bracket is attribution only; '(unattributed)' is the JSON permission route, not a missing block`);
    const dj = joinUnattributedDenials(main, blockLedger);
    if (dj.matched) console.log(`  joined by ledger timestamp (within ${Math.round(dj.worstMs)}ms): ${Object.entries(dj.joined).map(([h, n]) => `${h}×${n}`).join(', ')}${dj.matched < dj.total ? ` - ${dj.total - dj.matched} still unattributed` : ''}`);
  }
  for (const c of main.compactionEvents || []) {
    console.log(`  compaction ${c.ts || '?'}: ${c.pre != null ? fmt(c.pre) : '?'} -> ${c.post != null ? fmt(c.post) : '?'} tok, dropped ${c.dropped != null ? fmt(c.dropped) : '?'}${c.durationMs ? `, ${dur(c.durationMs)}` : ''}${c.trigger ? ` (${c.trigger})` : ''}`);
  }
  {
    const evs = (main.apiErrorEvents || []).filter((e) => e.ctx != null);
    if (evs.length) console.log(`  API errors fired at ctx ${evs.slice(0, 5).map((e) => `~${fmt(e.ctx)}`).join(', ')}${evs.length > 5 ? ` … +${evs.length - 5} more` : ''} - a cluster at high ctx is context pressure, not provider flakiness`);
  }
  if (main.unheldStopCandidates && main.unheldStopCandidates.length) {
    const cands = main.unheldStopCandidates;
    console.log(`  ${cands.length} unheld-stop candidate${cands.length === 1 ? '' : 's'} (free-text user turn right after a no-tool end_turn - check each against the active skill's stop contract): ${cands.slice(0, 10).map((c) => `${c.stopTs}→${c.userTs || '?'}`).join(', ')}${cands.length > 10 ? ` … +${cands.length - 10} more` : ''}`);
  }
  const agg = computeAggregates(main, agents);

  console.log('\nTOKENS (deduped per API message; ctx/msg = avg context re-sent per call)');
  console.log(`  ${pad('scope / model', 22)} ${rpad('input', 8)} ${rpad('cache-write', 11)} ${rpad('cache-read', 11)} ${rpad('output', 8)} ${rpad('msgs', 6)} ${rpad('ctx/msg', 8)}`);
  console.log(tallyRow('main session', main.total));
  for (const [m, t] of Object.entries(main.byModel)) console.log(tallyRow('  ' + m, t));
  if (ctxOf(main.total) > CTX_WARN) {
    console.log(`  ! avg context/msg ${fmt(ctxOf(main.total))} - the cost driver is carried-forward conversation, not tool output:`);
    console.log(`    run pipeline steps in fresh sessions that resume from the plan file instead of one long chat.`);
  }
  if (agents.length) {
    console.log(tallyRow(`subagents (${agents.length})`, agg.agentTotal));
    console.log(tallyRow('TOTAL', agg.grand));
  }

  if (agents.length) {
    console.log('\nSUBAGENTS (exact per-dispatch cost, grouped by agent type)');
    console.log(`  ${pad('agent type', 28)} ${rpad('n', 3)} ${rpad('output', 8)} ${rpad('cache-read', 11)} ${rpad('msgs', 5)} ${rpad('cost', 8)} ${rpad('wall', 7)}  top tools`);
    for (const [type, g] of Object.entries(agg.byType).sort((a, b) => b[1].tally.output - a[1].tally.output)) {
      const top = Object.entries(g.tools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' ');
      // seat-time is printed for EVERY multi-dispatch group: when seats overlap it shows the
      // parallelism win, when they don't it stops the outer span being read as per-seat cost
      // (measured: a 1h17m span over ~22m of actual seat activity framed as 'most expensive pair').
      const waves = g.n > 1 && g.span > g.wall * 1.5 ? `, dispatched in waves over ${dur(g.span)}` : '';
      console.log(`  ${pad(type, 28)} ${rpad(g.n, 3)} ${rpad(fmt(g.tally.output), 8)} ${rpad(fmt(g.tally.cacheRead), 11)} ${rpad(g.tally.msgs, 5)} ${rpad(agg.cost.error ? '-' : fmtUsd(g.cost), 8)} ${rpad(dur(g.wall), 7)}  ${top}${g.n > 1 ? ` (seat-time ${dur(g.seatMs)}${waves})` : ''}`);
      if (g.descs.length) console.log(`  ${pad('', 28)} e.g. ${g.descs.map((d) => JSON.stringify(d.slice(0, 40))).join(', ')}`);
    }
  }

  if (agg.skillRows.length) {
    // Main and subagent attribution are printed SPLIT, never summed: a dispatched seat
    // inherits whatever skill stamp was last active in the main session, so a seat type
    // foreign to the skill (a verifier charged to an installer command) means the stamp
    // bled from an adjacent run - measured in a real session, where 223 verifier msgs
    // landed on a plugin-update command that dispatches nothing.
    console.log('\nSKILLS (cmd = slash invocations; calls = Skill tool invocations; attributed = API msgs stamped while the skill was active - the real cost signal)');
    console.log('  (sub rows list the seat types carrying the stamp - a seat type foreign to the skill = stamp bleed from an adjacent run, do not charge it)');
    console.log(`  ${pad('skill', 44)} ${rpad('cmd', 4)} ${rpad('calls', 5)} ${rpad('result', 9)} ${rpad('attr msgs', 9)} ${rpad('attr out', 9)} ${rpad('attr cache-rd', 13)}`);
    for (const r of agg.skillRows) {
      const carried = r.mAttr.carriedMsgs ? ` (${r.mAttr.carriedMsgs} carried${r.mAttr.maxCarryRun >= 30 ? ', carry likely stale - a frozen stamp absorbing later phases' : ''})` : '';
      const comp = r.mAttr.companionMsgs ? ` (+${r.mAttr.companionMsgs} via companion loads, ~${fmt(r.mAttr.companionOut || 0)} of the out)` : '';
      const folded = r.folded && !r.mAttr.msgs;
      const msgCell = folded ? `folded -> ${r.folded}` : r.mAttr.msgs + carried + comp;
      console.log(`  ${pad(r.skill, 44)} ${rpad(r.cmd || '', 4)} ${rpad(r.inv.calls, 5)} ${rpad('~' + fmt(approxTok(r.inv.injectedChars)), 9)} ${rpad(msgCell, 9)} ${rpad(folded ? '-' : fmt(r.mAttr.output), 9)} ${rpad(folded ? '-' : fmt(r.mAttr.cacheRead), 13)}`);
      if (r.sub.msgs) {
        const seats = Object.entries(r.sub.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(' ');
        console.log(`  ${pad(`    sub: ${seats}`, 44)} ${rpad('', 4)} ${rpad('', 5)} ${rpad('', 9)} ${rpad(r.sub.msgs, 9)} ${rpad(fmt(r.sub.output), 9)} ${rpad(fmt(r.sub.cacheRead), 13)}`);
      }
    }
    if (agg.unattributed.n || agg.unattributed.selfInvoked) {
      const types = Object.entries(agg.unattributed.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(' ');
      const guesses = Object.entries(agg.unattributed.guesses).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ');
      const self = agg.unattributed.selfInvoked ? ` (+${agg.unattributed.selfInvoked} more stamped only by their own Skill calls)` : '';
      if (agg.unattributed.n) console.log(`  (${agg.unattributed.n} dispatched seat${agg.unattributed.n === 1 ? '' : 's'} carry no skill stamp and are uncosted above: ${types}${guesses ? `; dispatch-window suggests ${guesses} - inferred, cite as such, never charge` : ''} - attribution coverage, not fewer dispatches)${self}`);
      else console.log(`  ${self.trim()}`);
    }
  }

  if (Object.keys(agg.docRows).length || agg.inject || agg.attach) {
    console.log('\nGENERATED DOCS (capture-doc consumption; reads = orientation happening, writes = capture/loop maintenance)');
    console.log(`  ${pad('doc', 44)} ${rpad('main-reads', 10)} ${rpad('agent-reads', 11)} ${rpad('writes', 6)}`);
    for (const [rel, r] of Object.entries(agg.docRows).sort((a, b) => (b[1].main + b[1].agents) - (a[1].main + a[1].agents))) {
      const bash = (r.bashReads || r.bashWrites) ? `  (+${r.bashReads || 0}r/${r.bashWrites || 0}w via Bash)` : '';
      console.log(`  ${pad(rel, 44)} ${rpad(r.main, 10)} ${rpad(r.agents, 11)} ${rpad(r.writes, 6)}${bash}`);
    }
    if (agg.attach) console.log(`  ${pad('(style rule attached on file touch)', 44)} ${rpad('-', 10)} ${rpad('-', 11)} ${rpad('-', 6)}  ×${agg.attach}`);
    if (agg.inject) console.log(`  ${pad('(style injected by legacy hook)', 44)} ${rpad('-', 10)} ${rpad('-', 11)} ${rpad('-', 6)}  ×${agg.inject}`);
  }

  if (Object.keys(agg.mcpServers).length) {
    console.log('\nMCP (main + subagents; results measured in chars, shown as ~tokens)');
    console.log(`  ${pad('server', 18)} ${rpad('calls', 5)} ${rpad('results', 9)} ${rpad('errors', 6)}  top tools`);
    for (const [server, m] of Object.entries(agg.mcpServers).sort((a, b) => b[1].calls - a[1].calls)) {
      const top = Object.entries(m.tools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' ');
      console.log(`  ${pad(server, 18)} ${rpad(m.calls, 5)} ${rpad('~' + fmt(approxTok(m.resultChars)), 9)} ${rpad(m.errors, 6)}  ${top}`);
    }
  }

  printInventoryBlock(invUse);

  console.log('\nTOOLS (main + subagents; result volume = what lands back in context; declines = the USER answering an ask, never a failure; hook-blk = PreToolUse denials - a denial may be a FALSE POSITIVE, so read the block before scoring it as the gate working)');
  console.log(`  ${pad('tool', 28)} ${rpad('calls', 5)} ${rpad('results', 9)} ${rpad('errors', 6)} ${rpad('declines', 9)} ${rpad('hook-blk', 8)}`);
  {
    // Top 15 by result volume, PLUS any dropped row carrying errors or hook blocks - a
    // 100%-error tool must never vanish on low volume (measured: 2/2-error browser_click did).
    const rows = Object.entries(agg.tools).sort((a, b) => b[1].resultChars - a[1].resultChars);
    const shown = rows.slice(0, 15).concat(rows.slice(15).filter(([, t]) => t.errors > 0 || t.hookBlocks > 0));
    for (const [name, t] of shown) {
      console.log(`  ${pad(name, 28)} ${rpad(t.calls, 5)} ${rpad('~' + fmt(approxTok(t.resultChars)), 9)} ${rpad(t.errors, 6)} ${rpad(t.declines || '', 9)} ${rpad(t.hookBlocks || '', 8)}`);
    }
    const rmv = Object.values(agg.tools).reduce((n, t) => n + (t.rmVerifyTails || 0), 0);
    if (rmv) console.log(`  ${rmv} shell call(s) ended on an ls/test verifying an rm - the non-zero exit there is the removal CONFIRMED, so they are not in the errors column`);
  }
  {
    const errs = Object.entries(agg.tools).filter(([, t]) => (t.errorTs || []).length);
    if (errs.length) {
      console.log('\n  errors, by WHEN they landed (attribute them to the phase running at that time, never to the loudest one):');
      for (const [name, t] of errs) {
        const ts = t.errorTs.slice(0, 6).map((x) => String(x).slice(11, 19)).join(', ');
        console.log(`  ${pad(name, 28)} ${rpad(t.errors, 5)} ${ts}${t.errorTs.length > 6 ? ` … +${t.errorTs.length - 6}` : ''}`);
      }
    }
  }
  if (main.topResults && main.topResults.length) {
    console.log('\n  biggest single results (the call is named, so nothing has to be mapped back by hand):');
    for (const r of main.topResults.slice(0, 8)) {
      console.log(`  ${pad(r.name + (r.label ? ` ${r.label}` : ''), 60)} ${rpad('~' + fmt(approxTok(r.chars)), 9)} ${r.error ? 'error' : ''}`);
    }
  }

  console.log('\nEFFICIENCY (the practice scorecard - measured numbers with their denominators; the rate is judged, never the presence)');
  for (const r of efficiencyRows(main, agg, blockLedger)) {
    console.log(`  ${pad(r.practice, 22)} ${r.measured}`);
    console.log(`  ${pad('', 22)} tests: ${r.tests}`);
  }

  if (blockLedger && blockLedger.rows) {
    console.log('\nHOOK BLOCKS (which guard fired; a block costs its denial text plus the retried turn)');
    console.log(`  ${pad('hook', 32)} ${rpad('blocks', 6)} ${rpad('event / tool', 22)} top reason`);
    for (const [h, e] of Object.entries(blockLedger.byHook).sort((a, b) => b[1].blocks - a[1].blocks)) {
      const reasons = [...e.reasons.entries()].sort((a, b) => b[1] - a[1]);
      const where = [...e.events].join(',') + (e.tools.size ? ' / ' + [...e.tools].join(',') : '');
      console.log(`  ${pad(h, 32)} ${rpad(e.blocks, 6)} ${rpad(where, 22)} ${(reasons[0] && reasons[0][0]) || ''}${reasons[0] && reasons[0][1] > 1 ? ` x${reasons[0][1]}` : ''}`);
      // Each further DISTINCT reason on its own line: they are different causes, and one line per
      // hook made a report assert a single shared cause across rows that named different files.
      for (const [r, n] of reasons.slice(1, 5)) console.log(`  ${pad('', 32)} ${rpad('', 6)} ${rpad('', 22)} ${r}${n > 1 ? ` x${n}` : ''}`);
      if (reasons.length > 5) console.log(`  ${pad('', 32)} ${rpad('', 6)} ${rpad('', 22)} … +${reasons.length - 5} more distinct reason(s)`);
    }
    console.log(`  ${blockLedger.rows} block(s) total - review each distinct reason on its own; two reasons naming two files are two causes.`);
  }
  if (blockLedger && blockLedger.doneGate) console.log('\n' + doneGateLine(blockLedger.doneGate));
  if (blockLedger && blockLedger.rootCause) console.log((blockLedger.doneGate ? '' : '\n') + rootCauseLine(blockLedger.rootCause));
  if (blockLedger && blockLedger.correction) console.log((blockLedger.doneGate || blockLedger.rootCause ? '' : '\n') + correctionLine(blockLedger.correction));
  if (blockLedger && blockLedger.rationalization) console.log((blockLedger.doneGate || blockLedger.rootCause || blockLedger.correction ? '' : '\n') + rationalizationLine(blockLedger.rationalization));
  if (blockLedger && blockLedger.probes) console.log('\nPROBES ' + blockLedger.probes + ' row(s), log-only - denied nothing: ' + Object.entries(blockLedger.probeKinds).map(([k, n]) => k + ' x' + n).join(', ') + ' (a probe row is a measurement of how often the gate WOULD fire; judge its rate before it becomes a denial)');

  if (main.spikes.length) {
    console.log('\nCONTEXT SPIKES (main session - biggest single-turn context jumps and what landed before them)');
    for (const sp of main.spikes) {
      console.log(`  +${rpad(fmt(sp.delta), 7)} → ${fmt(sp.ctx)} ctx  ${sp.ts || '?'}  after: ${sp.causes || '(prompt/attachment only)'}`);
    }
  }

  if (hookLog) {
    console.log(`\nHOOK LOG join (${hookLog.rows} rows - identity ledger only, tokens come from the transcript)`);
    for (const [tool, t] of Object.entries(hookLog.byTool).sort((a, b) => b[1].calls - a[1].calls).slice(0, 10)) {
      const top = Object.entries(t.details).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d}×${n}`).join(', ');
      console.log(`  ${pad(tool, 28)} ${rpad(t.calls, 5)}  ${top}`);
    }
    const j = hookJoinStats(main, agents, hookLog, agg.tools);
    if (j.coverage) {
      console.log(`  coverage: ledger window ${hookLog.firstTs} → ${hookLog.lastTs} spans ~${j.coverage.pct}% of the session`);
      console.log(`  cross-check: ${j.coverage.callPct}% of tool calls are inside the ledger window - ${j.coverage.inWin} of ${j.coverage.calls}${j.coverage.calls !== j.trTools ? ` (${j.trTools} in the file; the rest belong to the fork prefix)` : ''} - vs ${hookLog.rows} ledger rows`);
      if (j.coverage.outside > 0) console.log(`  ${j.coverage.outside} call${j.coverage.outside === 1 ? '' : 's'} outside the ledger window (${j.coverage.tailCalls} after its last row${j.coverage.tailCalls === 0 ? ' - a quiet tail, not lost coverage' : ''}) - two causes, both real: a ledger wired mid-session legitimately misses the head, and a call the HARNESS rejected before PreToolUse (a classifier denial, a schema failure) never reaches a hook at all and can have no row`);
      if (j.coverage.unmatchedCallCount) console.log('  ' + j.coverage.unmatchedCallCount + ' in-window call(s) UNJOINED - no ledger row of the same tool within ' + j.coverage.latencyMs + 'ms' + (j.coverage.ambiguousCalls ? ` (${j.coverage.ambiguousCalls} of them ambiguous: two rows of that tool sit equally close and the ledger carries no tool_use_id to tell them apart)` : '') + ': ' + j.coverage.unmatchedCalls.map((c) => c.tool + '@' + c.ts + (c.ambiguous ? ' (ambiguous)' : '')).join(', ') + ' - a call the harness rejected before PreToolUse leaves no row; the join is tool + timestamp only, so unjoined is reported rather than guessed');
      if (j.coverage.unmatchedRowCount) console.log('  ' + j.coverage.unmatchedRowCount + ' ledger row(s) with no transcript call: ' + j.coverage.unmatchedRows.map((c) => c.tool + '@' + c.ts).join(', ') + ' - an ask or a call the transcript never wrote');
      if (j.coverage.unmatched > 0) console.log(`  ${j.coverage.unmatched} in-window call${j.coverage.unmatched === 1 ? '' : 's'} with no ledger row - check each call's own tool_result for a Blocked:/error string (harness-level blocks and input-validation failures never reach PreToolUse) before calling it a gap`);
    } else {
      console.log(`  cross-check: transcript saw ${j.trTools} tool calls vs ${hookLog.rows} hook rows (ledger rows carry no timestamps, so window coverage is unavailable)`);
    }
  }
}

// ---------- markdown report skeleton ----------
// --report-md emits the per-session report SKELETON: every table is machine-written,
// so a report author cannot misquote the numbers (measured: 5 wrong claims across 4
// hand-written session reports, each a prose restatement of tool output). The FILL IN
// sections at the end are the only judgment surface.
// The vintage block: machine-written, so 'the session broke rule X' is checked against the text
// the session LOADED instead of the text on disk today.
function vintageMarkdown(invUse, main, out) {
  const v = invUse && invUse.vintage;
  out.push('## Session vintage', '');
  out.push('_The install this session ran on, not the one on disk today. Every claim that the session broke a rule, skipped a step or ignored a clause is checked against THESE rows: a `DIFFERS` row means the current source is not what the session read, and the claim must quote the loaded body instead._', '');
  out.push('| | |', '|---|---|');
  out.push(`| Session ran | ${main.firstTs || '?'} → ${main.lastTs || '?'}${main.ccVersion ? ` (Claude Code ${main.ccVersion}, the transcript's own \`version\`)` : ''} |`);
  const st = v && v.stamp;
  if (st) {
    const when = st.installed || '?';
    const rel = st.installed && main.lastTs ? (st.installed > main.lastTs ? 'INSTALLED AFTER this session - what is on disk was never what this session loaded' : 'installed before this session ran') : 'install date unknown';
    out.push(`| Stack install | v${st.version || '?'} (${st.sha ? st.sha.slice(0, 12) : 'sha unknown'}), stamped ${when} - ${rel} |`);
  } else {
    out.push('| Stack install | no `alfred-code.stamp` reachable - the install version this session loaded is UNKNOWN, do not assume today\'s |');
  }
  out.push(`| Inventory source | ${(v && v.inventoryWhy) || (invUse && invUse.source.skills_agents_rules) || '-'} |`, '');
  const rows = (v && v.rows) || [];
  if (!rows.length) {
    out.push('_No skill or slash-command run in this session, so there is no body to compare._', '');
    return;
  }
  out.push('| skill / command run | how | body the session loaded | current source | verdict |', '|---|---|---|---|---|');
  for (const r of rows) {
    out.push(`| ${r.name} | ${r.how} | ${r.loadedChars != null ? `${r.loadedChars} chars` : '-'} | ${r.currentChars != null ? `${r.currentChars} chars` : (r.file || '-')} | ${r.verdict} |`);
  }
  out.push('');
}

function inventoryMarkdown(invUse, out) {
  if (!invUse) return;
  const many = invUse.source.sessions > 1;
  out.push('## Inventory vs use', '');
  out.push(`_Inventory source: skills/agents/rules from ${invUse.source.skills_agents_rules}; plugins from ${invUse.source.plugins}; MCP from ${invUse.source.mcps}._`, '');
  out.push(`_The installed set is resolved PER SESSION from that session's own \`cwd\`, so \`installed\` reads K of the ${invUse.source.sessions} session(s) this run covered and a name nothing installed is never reported as unused._`, '');
  out.push('_Every row is an artifact an install HAS. A path-scoped rule is scored from the transcript records that name it (a `nested_memory` attach, guard-read-whole-file\'s shell-route notice) and by a glob proxy over the files the session touched; an always-on rule is in every prompt, so its use is not observable at all. A plugin counts as installed only in the sessions a registry record reaches (its scope, project, install date and enable) or that loaded or used it; a hook scores from the rows naming its command, so one that only adds context is not observable; and a catalog-sourced row proves the stack ships the artifact, never that this project installed it._', '');
  for (const L of inventoryLayers(invUse)) {
    if (!L.rows) continue;
    out.push(`### ${L.label.charAt(0).toUpperCase()}${L.label.slice(1)} (used ${L.usedInstalled} of ${L.total} installed${L.observedOnly ? `, +${L.observedOnly} used but in no inventory the run could read` : ''})`, '');
    if (L.used.length) {
      out.push('| name | source | installed | used | how | first use |', '|---|---|---|---|---|---|');
      for (const r of L.used) out.push(`| ${r.name} | ${r.source} | ${installedCell(r)} | ${usedCell(r)} | ${r.how.join(', ')} | ${r.firstUse || ''} |`);
      out.push('');
    }
    if (L.notObservable.length) out.push(`> always-on - in every prompt, use not observable (${L.notObservable.length}): ${L.notObservable.join(', ')}`, '');
    if (L.unused.length) out.push(`> ${many ? 'never used' : 'unused'} (${L.unused.length}): ${L.unused.join(', ')}`, '');
  }
}

function printMarkdown(main, agents, hookLog, window, blockLedger, invUse) {
  const extraFacts = [];
  if (main.peakCtx) extraFacts.push(`- **Peak context** ${fmt(main.peakCtx)} tokens per message${main.peakCtxAt ? ` (at ${main.peakCtxAt})` : ''} - every fresh-session threshold is measured against this, not the average.`);
  if (main.thinkingTokens) extraFacts.push(`- **Thinking** ${fmt(main.thinkingTokens)} tokens (\`cost-state.modelUsage\`) - billed, attributable to no single message.`);
  if (main.floorCtx) {
    const share = main.total.cacheRead ? Math.round((100 * main.floorCtx * main.total.msgs) / main.total.cacheRead) : null;
    extraFacts.push(`- **Standing inventory** ~${fmt(main.floorCtx)} tokens/message (system prompt + tool schemas + CLAUDE.md + always-on rules) - paid on EVERY message${share != null ? `, ~${share}% of cache-read` : ''}, and re-paid in full after every compaction.`);
  }
  {
    const src = windowSource(main);
    if (src) extraFacts.push(`- **Model (with window suffix)** ${src} - the assistant messages strip the suffix, and it is what picks the context tier.`);
    const il = interruptLine(main);
    if (il) extraFacts.push(`- **Interrupts** ${il.replace(/^user interrupts /, '')}`);
  }
  if (main.totalCostUSD != null) extraFacts.push(`- **Billed** $${Number(main.totalCostUSD).toFixed(2)} (\`cost-state\`).`);
  if (main.untranscribed) extraFacts.push('- **Untranscribed calls** cost-state cache-read ' + fmt(main.costState.cacheRead) + ' vs transcript ' + fmt(main.total.cacheRead) + ' - gap ' + fmt(main.untranscribed.cacheRead) + (main.untranscribed.contexts != null ? ' (~' + main.untranscribed.contexts + 'x the peak context)' : '') + ': the harness' + String.fromCharCode(39) + 's post-turn recap call(s) are billed and written to no transcript row.');
  if (main.forkPrefix && main.forkPrefix.msgs) extraFacts.push('- **Fork prefix** ' + main.forkPrefix.msgs + ' msgs / ' + fmt(main.forkPrefix.cacheRead) + ' cache-read / ' + main.forkPrefix.toolCalls + ' tool calls carry another session' + String.fromCharCode(39) + 's id (' + main.forkPrefix.sessionIds.join(', ') + ') - a copied prefix, counted under that transcript; this file' + String.fromCharCode(39) + 's own tail is ' + (main.total.msgs - main.forkPrefix.msgs) + ' msgs / ' + fmt(main.total.cacheRead - main.forkPrefix.cacheRead) + ' cache-read.');
  if (main.stopHookBlocks) extraFacts.push(`- **Stop-hook denials** ${main.stopHookBlocks} - meta user TEXT, not tool results, so absent from the \`hook-blk\` column.`);
  if (main.harnessDenials) extraFacts.push(`- **Harness denials** ${main.harnessDenials} - the auto-mode classifier, a foreground \`sleep\`, or a tool-schema failure. They read as a block and no stack hook ran: excluded from \`hook-blk\`, and never charged to a guard.`);
  {
    const byHook = Object.entries(main.denialsByHook || {}).sort((a, b) => b[1] - a[1]);
    if (byHook.length) extraFacts.push(`- **Denials by hook**: ${byHook.map(([h, n]) => `\`${h}\` x${n}`).join(', ')} - the bracket is attribution only; \`(unattributed)\` is the JSON permission route.`);
    const dj = joinUnattributedDenials(main, blockLedger);
    if (dj.matched) extraFacts.push(`- **Unattributed denials joined by ledger timestamp** (within ${Math.round(dj.worstMs)}ms): ${Object.entries(dj.joined).map(([h, n]) => `\`${h}\` x${n}`).join(', ')}${dj.matched < dj.total ? ` - ${dj.total - dj.matched} still unattributed.` : '.'}`);
  }
  for (const c of main.compactionEvents || []) {
    extraFacts.push(`- **Compaction** ${c.ts || '?'}: ${c.pre != null ? fmt(c.pre) : '?'} -> ${c.post != null ? fmt(c.post) : '?'} tokens, dropped ${c.dropped != null ? fmt(c.dropped) : '?'}${c.durationMs ? `, ${dur(c.durationMs)}` : ''}.`);
  }
  const agg = computeAggregates(main, agents);
  const out = [];
  const span = main.firstTs && main.lastTs ? new Date(main.lastTs) - new Date(main.firstTs) : null;
  const mdTally = (label, t) => `| ${label} | ${fmt(t.input)} | ${fmt(t.cacheCreate)} | ${fmt(t.cacheRead)} | ${fmt(t.output)} | ${t.msgs} | ${fmt(ctxOf(t))} |`;

  out.push(`# Stack usage report - session \`${path.basename(main.file, '.jsonl')}\``, '');
  out.push('Generated by `analyze-usage.js --report-md` - every number in the tables below is the');
  out.push("analyzer's own output. Fill ONLY the marked judgment sections; a claim there must cite a");
  out.push('table row above, or a transcript measurement labeled as such.', '');
  if (window) out.push(`> Windowed: ${window.fromStr || 'start'} → ${window.toStr || 'end'} (subagents dispatched outside the window are excluded)`, '');

  out.push('## Environment', '');
  out.push('| | |', '|---|---|');
  out.push(`| Session window | ${main.firstTs || '?'} → ${main.lastTs || '?'} (${dur(span)}) |`);
  if (main.clearTs && main.clearTs > main.firstTs) {
    out.push(`| Active window (since last /clear) | ${main.clearTs} → ${main.lastTs} (${dur(new Date(main.lastTs) - new Date(main.clearTs))}) - use this, not the raw span, for duration claims |`);
  }
  if (main.ccVersion) out.push(`| Claude Code (this session's transcript) | ${main.ccVersion} |`);
  out.push(`| Volume | ${main.userPrompts} user prompts · ${main.total.msgs} API messages · ${main.compactions} compactions · ${main.apiErrors} API errors |`);
  {
    const evs = (main.apiErrorEvents || []).filter((e) => e.ctx != null);
    if (evs.length) out.push(`| API errors fired at ctx | ${evs.slice(0, 5).map((e) => `~${fmt(e.ctx)}`).join(', ')}${evs.length > 5 ? ` … +${evs.length - 5} more` : ''} - a cluster at high ctx is context pressure, not provider flakiness |`);
  }
  out.push(`| Git commits (Bash occurrence count) | ${main.gitCommits || 0}${main.prMerges ? ` (+${main.prMerges} pr-merge)` : ''} |`);
  if (main.unheldStopCandidates && main.unheldStopCandidates.length) {
    const cands = main.unheldStopCandidates;
    out.push(`| Unheld-stop candidates | ${cands.length} (free-text user turn right after a no-tool end_turn; check each against the active skill's stop contract): ${cands.slice(0, 10).map((c) => `${c.stopTs}→${c.userTs || '?'}`).join(', ')}${cands.length > 10 ? ` … +${cands.length - 10} more` : ''} |`);
  }
  out.push(`| Models (main) | ${Object.entries(main.byModel).map(([m, t]) => `\`${m}\` ×${t.msgs}`).join(', ') || '-'} |`);
  out.push(`| Subagent transcripts | ${agents.length} |`);
  out.push(`| Hook ledger | ${hookLog ? `joined (${hookLog.rows} rows)` : 'absent - identity attribution unavailable, not inferred'} |`, '');
  if (extraFacts.length) out.push('', ...extraFacts, '');

  vintageMarkdown(invUse, main, out);

  out.push('## Tokens (deduped per API message; ctx/msg = avg context re-sent per call)', '');
  out.push('| scope | input | cache-write | cache-read | output | msgs | ctx/msg |', '|---|---|---|---|---|---|---|');
  out.push(mdTally('main session', main.total));
  for (const [m, t] of Object.entries(main.byModel)) out.push(mdTally(`- ${m}`, t));
  if (agents.length) { out.push(mdTally(`subagents (${agents.length})`, agg.agentTotal)); out.push(mdTally('**TOTAL**', agg.grand)); }
  out.push('');
  if (ctxOf(main.total) > CTX_WARN) {
    out.push(`> ! avg context/msg ${fmt(ctxOf(main.total))} - the cost driver is carried-forward conversation, not tool output: run pipeline steps in fresh sessions that resume from the plan file instead of one long chat.`, '');
  }

  if (agents.length) {
    out.push('## Subagent dispatches (exact per-dispatch cost, grouped by agent type)', '');
    out.push('| agent type | n | output | cache-read | msgs | cost | wall | top tools |', '|---|---|---|---|---|---|---|---|');
    for (const [type, g] of Object.entries(agg.byType).sort((a, b) => b[1].tally.output - a[1].tally.output)) {
      const top = Object.entries(g.tools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' ');
      const waves = g.n > 1 && g.span > g.wall * 1.5 ? `, dispatched in waves over ${dur(g.span)}` : '';
      out.push(`| ${type} | ${g.n} | ${fmt(g.tally.output)} | ${fmt(g.tally.cacheRead)} | ${g.tally.msgs} | ${agg.cost.error ? '-' : fmtUsd(g.cost)} | ${dur(g.wall)}${g.n > 1 ? ` (seat-time ${dur(g.seatMs)}${waves})` : ''} | ${top} |`);
    }
    out.push('');
  }

  if (agg.skillRows.length) {
    out.push('## Skills (attribution split main vs sub)', '');
    out.push('A `sub:` row names the seat types carrying the stamp - a seat type foreign to the skill is');
    out.push('stamp bleed from an adjacent run: report it as bleed, never charge it to the skill.');
    out.push('`cmd` = slash invocations counted from command markers; `(N carried)` = msgs attributed by');
    out.push('carry-forward after the stamp dropped at a task-notification - inferred, not stamped.');
    out.push('`(+N via companion loads)` = msgs a nested in-protocol reference load would have stolen,');
    out.push('folded back into the invoking skill, and `folded -> <skill>` on the companion row itself -');
    out.push('its cost is charged there, so the row is not a run that cost nothing; `carry likely stale` = an unbroken 30+-msg carry run -');
    out.push("a frozen stamp absorbing later phases, flag it, don't charge it.", '');
    out.push('| skill | cmd | calls | result | attr msgs | attr out | attr cache-rd |', '|---|---|---|---|---|---|---|');
    for (const r of agg.skillRows) {
      const carried = r.mAttr.carriedMsgs ? ` (${r.mAttr.carriedMsgs} carried${r.mAttr.maxCarryRun >= 30 ? ', carry likely stale' : ''})` : '';
      const comp = r.mAttr.companionMsgs ? ` (+${r.mAttr.companionMsgs} via companion loads, ~${fmt(r.mAttr.companionOut || 0)} of the out)` : '';
      const folded = r.folded && !r.mAttr.msgs;
      const msgCell = folded ? `folded -> ${r.folded}` : `${r.mAttr.msgs}${carried}${comp}`;
      out.push(`| ${r.skill} | ${r.cmd || ''} | ${r.inv.calls} | ~${fmt(approxTok(r.inv.injectedChars))} | ${msgCell} | ${folded ? '-' : fmt(r.mAttr.output)} | ${folded ? '-' : fmt(r.mAttr.cacheRead)} |`);
      if (r.sub.msgs) {
        const seats = Object.entries(r.sub.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(' ');
        out.push(`| - sub: ${seats} | | | | ${r.sub.msgs} | ${fmt(r.sub.output)} | ${fmt(r.sub.cacheRead)} |`);
      }
    }
    if (agg.unattributed.n || agg.unattributed.selfInvoked) {
      const types = Object.entries(agg.unattributed.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(' ');
      const guesses = Object.entries(agg.unattributed.guesses).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ');
      const self = agg.unattributed.selfInvoked ? ` +${agg.unattributed.selfInvoked} more stamped only by their own Skill calls.` : '';
      if (agg.unattributed.n) out.push('', `> ${agg.unattributed.n} dispatched seat${agg.unattributed.n === 1 ? '' : 's'} carry no skill stamp and are uncosted in the rows above: ${types}${guesses ? `; dispatch-window suggests ${guesses} - inferred, cite as such, never charge` : ''} - attribution coverage, not fewer dispatches (cross-check the Subagent dispatches table).${self}`);
      else out.push('', `>${self}`);
    }
    out.push('');
  }

  const docEntries = Object.entries(agg.docRows).sort((a, b) => (b[1].main + b[1].agents) - (a[1].main + a[1].agents));
  if (docEntries.length || agg.inject || agg.attach) {
    out.push('## Generated docs (reads = orientation happening, writes = capture/loop maintenance)', '');
    out.push('_A **lower bound**. This table reads the Bash command text, so doc I/O routed through a script the session WROTE and then ran is invisible to it - measured at 5 reported against >=53 real. When a session writes its own helper, name that script here and treat the counts as a floor._', '');
    out.push('| doc | main-reads | agent-reads | writes | via Bash (r/w) |', '|---|---|---|---|---|');
    for (const [rel, r] of docEntries) out.push(`| ${rel} | ${r.main} | ${r.agents} | ${r.writes} | ${(r.bashReads || r.bashWrites) ? `${r.bashReads || 0}/${r.bashWrites || 0}` : ''} |`);
    if (agg.attach) out.push(`| (style rule attached on file touch) | - | - | ×${agg.attach} | |`);
    if (agg.inject) out.push(`| (style injected by legacy hook) | - | - | ×${agg.inject} | |`);
    out.push('');
  }

  const mcpEntries = Object.entries(agg.mcpServers).sort((a, b) => b[1].calls - a[1].calls);
  if (mcpEntries.length) {
    out.push('## MCP (main + subagents)', '');
    out.push('| server | calls | results | errors | top tools |', '|---|---|---|---|---|');
    for (const [server, m] of mcpEntries) {
      const top = Object.entries(m.tools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join(' ');
      out.push(`| ${server} | ${m.calls} | ~${fmt(approxTok(m.resultChars))} | ${m.errors} | ${top} |`);
    }
    out.push('');
  }

  inventoryMarkdown(invUse, out);

  out.push('## Tools (main + subagents; result volume = what lands back in context)', '');
  out.push('`hook-blk` = PreToolUse denials. A denial is not automatically the gate working - it may be a FALSE POSITIVE, and a false positive costs the denial text plus the whole retried turn. Read the block before scoring it. (Shipped verbatim over sessions whose blocks were 2 of 2 and 3 of 3 false positives, across 11 bundles.)', '');
  out.push('| tool | calls | results | errors | declines | hook-blk |', '|---|---|---|---|---|---|');
  {
    const rows = Object.entries(agg.tools).sort((a, b) => b[1].resultChars - a[1].resultChars);
    const shown = rows.slice(0, 15).concat(rows.slice(15).filter(([, t]) => t.errors > 0 || t.hookBlocks > 0));
    for (const [name, t] of shown) {
      out.push(`| ${name} | ${t.calls} | ~${fmt(approxTok(t.resultChars))} | ${t.errors} | ${t.declines || ''} | ${t.hookBlocks || ''} |`);
    }
    const rmv = Object.values(agg.tools).reduce((n, t) => n + (t.rmVerifyTails || 0), 0);
    if (rmv) out.push('', `> ${rmv} shell call(s) ended on an \`ls\`/\`test\` verifying an \`rm\` - the non-zero exit there is the removal CONFIRMED, so they are not counted in the errors column.`);
  }
  out.push('');
  {
    const errs = Object.entries(agg.tools).filter(([, t]) => (t.errorTs || []).length);
    if (errs.length) {
      out.push('### Errors, by when they landed', '');
      out.push('Attribute each error to the phase that was RUNNING at that time. Measured: two errors at');
      out.push('06:57 were reported as the browser phase\'s, and the browser work started ~07:2x.', '');
      out.push('| tool | errors | timestamps |', '|---|---|---|');
      for (const [name, t] of errs) {
        out.push(`| ${name} | ${t.errors} | ${t.errorTs.slice(0, 6).map((x) => String(x).slice(11, 19)).join(', ')}${t.errorTs.length > 6 ? ` … +${t.errorTs.length - 6}` : ''} |`);
      }
      out.push('');
    }
  }
  if (main.topResults && main.topResults.length) {
    out.push('### Biggest single results', '');
    out.push('Each row is ONE call with its own label - the Bash description the model wrote, the file a');
    out.push('Read named, the seat a dispatch went to - so a result size never has to be mapped back onto');
    out.push('a call by hand (measured: one report re-derived eight of these by eye).', '');
    out.push('| tool | what the call asked for | result | when |', '|---|---|---|---|');
    for (const r of main.topResults.slice(0, 8)) {
      out.push(`| ${r.name}${r.error ? ' (error)' : ''} | ${r.label || ''} | ~${fmt(approxTok(r.chars))} | ${r.ts || ''} |`);
    }
    out.push('');
  }

  out.push('## Efficiency scorecard (machine-written; judge the rate, never the presence)', '');
  out.push('Each row measures the session against one practice - the official Claude Code guidance and the stack\'s own audits agree on all of them. A number here is not yet a finding: the row says what to open before it becomes one.', '');
  out.push('| practice | measured | what it tests |', '|---|---|---|');
  for (const r of efficiencyRows(main, agg, blockLedger)) out.push(`| ${r.practice} | ${r.measured.replace(/\|/g, '\\|')} | ${r.tests.replace(/\|/g, '\\|')} |`);
  out.push('');

  if (main.spikes.length) {
    out.push('## Context spikes (main session)', '');
    out.push('| Δ | to ctx | when | after |', '|---|---|---|---|');
    for (const sp of main.spikes) out.push(`| +${fmt(sp.delta)} | ${fmt(sp.ctx)} | ${sp.ts || '?'} | ${sp.causes || '(prompt/attachment only)'} |`);
    out.push('');
  }

  if (hookLog) {
    const j = hookJoinStats(main, agents, hookLog, agg.tools);
    out.push('## Hook-log join (identity ledger; tokens come from the transcript)', '');
    if (j.coverage) {
      out.push(`- Coverage: ledger window ${hookLog.firstTs} → ${hookLog.lastTs} spans ~${j.coverage.pct}% of the session.`);
      out.push(`- Cross-check: ${j.coverage.callPct}% of tool calls are inside the ledger window - ${j.coverage.inWin} of ${j.coverage.calls}${j.coverage.calls !== j.trTools ? ` (${j.trTools} in the file; the rest belong to the fork prefix)` : ''} - vs ${hookLog.rows} ledger rows.`);
      if (j.coverage.outside > 0) out.push(`- ${j.coverage.outside} call${j.coverage.outside === 1 ? '' : 's'} outside the ledger window (${j.coverage.tailCalls} after its last row${j.coverage.tailCalls === 0 ? ' - a quiet tail, not lost coverage' : ''}) - two causes, both real: a ledger wired mid-session legitimately misses the head, and a call the HARNESS rejected before PreToolUse (a classifier denial, a schema failure) never reaches a hook and can have no row.`);
      if (j.coverage.unmatchedCallCount) out.push('- ' + j.coverage.unmatchedCallCount + ' in-window call(s) UNJOINED - no ledger row of the same tool within ' + j.coverage.latencyMs + 'ms' + (j.coverage.ambiguousCalls ? ` (${j.coverage.ambiguousCalls} ambiguous: two rows of that tool sit equally close)` : '') + ': ' + j.coverage.unmatchedCalls.map((c) => c.tool + '@' + c.ts + (c.ambiguous ? ' (ambiguous)' : '')).join(', ') + ' - the ledger carries no `tool_use_id`, so the join is tool name + timestamp only: an unjoinable call is reported unjoined, never joined to a neighbouring row. A call the harness rejected before PreToolUse leaves no row at all.');
      if (j.coverage.unmatchedRowCount) out.push('- ' + j.coverage.unmatchedRowCount + ' ledger row(s) with no transcript call: ' + j.coverage.unmatchedRows.map((c) => c.tool + '@' + c.ts).join(', ') + ' - an ask or a call the transcript never wrote.');
      if (j.coverage.unmatched > 0) out.push(`- ${j.coverage.unmatched} in-window call${j.coverage.unmatched === 1 ? '' : 's'} with no ledger row - check each call's own tool_result for a Blocked:/error string (harness-level blocks and input-validation failures never reach PreToolUse) before calling it a gap.`);
    } else {
      out.push(`- ${j.trTools} transcript tool calls vs ${hookLog.rows} ledger rows (ledger rows carry no timestamps, so window coverage is unavailable).`);
    }
    out.push('');
  }

  // The markdown emitter never received the ledger at all, so the bundle reports the sweeps
  // actually read carried no guard-block section - 7 confirmations, while the terminal report
  // printed one from the same data.
  out.push('## Guard blocks - FILL IN (which guard fired; a block costs its denial text plus the retried turn)', '');
  if (blockLedger && blockLedger.rows) {
    out.push('_A block is not automatically the gate working. A FALSE positive is the most expensive event in this table - it costs the denial plus the whole retried turn - so read each top reason and say whether it stopped honest work._', '');
    out.push('_Answer that below the table: one line per ROW, saying whether that reason caught something or stopped honest work._', '');
    out.push('_ONE ROW PER DISTINCT REASON, not per hook: a reason carries the file the denial named, so two reasons under one hook are two causes and must be judged separately (measured: a report asserted one shared cause across three rows, one of which named a different file and a real credential)._', '');
    out.push('| hook | blocks | event / tool | reason |', '|---|---|---|---|');
    for (const [hook, e] of Object.entries(blockLedger.byHook).sort((a, b) => b[1].blocks - a[1].blocks)) {
      const where = [...e.events].join(',') + (e.tools.size ? ' / ' + [...e.tools].join(',') : '');
      for (const [r, n] of [...e.reasons.entries()].sort((x, y) => y[1] - x[1])) {
        out.push(`| \`${hook}\` | ${n} | ${where} | ${String(r).replace(/\|/g, '\\|')} |`);
      }
    }
    out.push('', `${blockLedger.rows} block(s) total.`, '');
  } else {
    out.push('_No ledger rows. That means EITHER no guard fired OR the ledger was never written - say which, do not infer. The transcript alone records which TOOL was denied, never which hook._', '');
    out.push('_This is a QUESTION to answer here, in one line, from the ledger test you ran: `no guard fired` (the ledger path was absent AND the Tools table shows no `hook-blk`), or `ledger absent` (there ARE hook-blk denials and the hook that fired is unavailable). Shipped unanswered, verbatim, in audited bundles._', '');
  }
  if (blockLedger && (blockLedger.doneGate || blockLedger.rootCause || blockLedger.correction || blockLedger.rationalization)) {
    out.push('## Probes - log-only (where a method skill or a habit was needed, and what the session did)', '');
    const dg = blockLedger.doneGate;
    if (dg) out.push('| probe | claims over an edit | ran after it | excused by a rule | no tests found | skill loaded, unrun | loaded earlier, unrun | MISSED |', '|---|---|---|---|---|---|---|---|',
      `| done gate | ${dg.claims} | ${dg.ran} | ${dg.byRule} | ${dg.noTests} | ${dg.skillLoaded} | ${dg.inContext} | ${dg.missed} |`, '');
    const rc = blockLedger.rootCause;
    if (rc) out.push('| probe | red streaks | loaded before the fix | in context | preloaded | loaded after the fix | MISSED | no fix after | unmatched |', '|---|---|---|---|---|---|---|---|---|',
      `| root cause | ${rc.streaks} | ${rc.beforeFix} | ${rc.inContext} | ${rc.preloaded} | ${rc.afterFix} | ${rc.missed} | ${rc.noFix} | ${rc.unmatched} |`, '');
    const co = blockLedger.correction;
    if (co) out.push('| probe | correction turns | save line injected | logged only |', '|---|---|---|---|',
      `| correction nudge | ${co.turns} | ${co.injected} | ${co.turns - co.injected} |`, '');
    const ra = blockLedger.rationalization;
    if (ra) out.push('| probe | dismissing closes | after a red run | after a skipped test | after a skip marker | pre-existing | unrelated | flaky or transient | deferred |', '|---|---|---|---|---|---|---|---|---|',
      `| rationalization | ${ra.closes} | ${ra.red} | ${ra.skipped} | ${ra.skipEdit} | ${ra.preExisting} | ${ra.unrelated} | ${ra.flaky} | ${ra.deferred} |`, '');
  }
  out.push('## Waste analysis - FILL IN', '', '_Ranked by tokens wasted. Every claim cites a table row above, or a transcript measurement labeled as such._', '');
  out.push('## Protocol check - FILL IN', '', "_One verdict per skill run, judged against that skill's own SKILL.md steps, citing the transcript turn that proves it. Mark unavailable rather than inferring._", '');
  out.push('## Efficiency verdict - FILL IN', '');
  out.push('_Two lines, both mandatory, each citing scorecard rows or table rows above:_', '');
  out.push('- **TOKEN VERDICT**: delivered <what the session left behind> / cost <total tokens from the Tokens table> / avoidable <N of M tok, P%> - the avoidable share is a measured number built from the rows above (re-reads, whole-suite output, build-dir reads, cache misses, dispatch overhead), never an adjective. A session that spent heavily and delivered is a PASS - say so.');
  out.push('- **EFFECTIVENESS**: did the work land (the artifact, the commits and whether each was checked), how many corrections it took (the correction-streak row plus every user redirect you read), how many green claims had no check behind them, how many stops were not held (the protocol check\'s sweep 1). One line, numbers with denominators.', '');
  out.push('## Verdict - FILL IN', '', '| skill | worked as intended | biggest strength | biggest waste source | one concrete suggestion |', '|---|---|---|---|---|', '');
  console.log(out.join('\n'));
}

// ---------- --check-report: the judgment sections against the machine tables ----------
// The judgment sections of a filled report carried numbers that contradicted the machine tables
// three lines above them - 49 findings across the audited set, the largest single cluster. Every
// number a judgment section states must come from a machine row of the SAME report, or carry its
// own locator (`L<n>`, a line of the transcript the bundle ships). This prints one row per number
// that has neither, and the run is not done while it prints a row.
const JUDGMENT_HEAD_RE = /FILL IN|per skill run|waste analysis|protocol check|efficiency verdict|^#+\s*verdict|guard blocks/i;
// The Guard blocks section is BOTH: the skeleton writes its per-hook TABLE and the author answers
// underneath it, so the table's own numbers are machine rows, not claims to be sourced.
const MACHINE_TABLE_SECTION_RE = /guard blocks/i;
// A locator in any spelling the skill's own sections prescribe: the protocol check cites `turn N`,
// the waste rows cite `L<n>`. Both are a row of the transcript the bundle ships, and both are
// range-checked against it below.
const LOCATOR_RE = /\b(?:L\d+|turns?\s+\d+|lines?\s+\d+|rows?\s+\d+)\b/i;
// The guard after the digits keeps a date or a clock time from reading as one ('row 2026-10-05T10:55' named row 2026);
// a range end ('L12-14') still reads its start.
const LOCATOR_G = /\b(?:L(\d+)|turns?\s+(\d+)|lines?\s+(\d+)|rows?\s+(\d+))\b(?!:\d|-\d{1,2}-\d)/gi;
// A number token, with the units the tables print: `8.0k`, `~12`, `1,204`, `53%`, `$0.42`. The
// magnitude suffix binds to the digits with no space - `1 block(s)` is the number 1, not '1 b'.
const NUMBER_TOKEN_RE = /\d[\d,]*(?:\.\d+)?(?:[kKmMbB](?![A-Za-z]))?%?/g;
const numValue = (tok) => {
  const m = /^(\d[\d,]*(?:\.\d+)?)([kKmMbB]?)%?$/.exec(String(tok).trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[m[2]] || 1;
  return n * mult;
};
// Dates, clock times and locators are not judgment numbers - strip them before tokenizing. The locator check strips
// the dates and times alone.
const stripDates = (line) => String(line)
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, ' ')
  .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
  .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
const stripNonClaims = (line) => stripDates(line)
  .replace(/\bL\d+(?:-L?\d+)?\b/g, ' ')
  .replace(/\b(?:turns?|lines?|rows?)\s+\d+(?:\s*-\s*\d+)?\b/gi, ' ');
const numbersIn = (line) => {
  const out = [];
  for (const m of stripNonClaims(line).matchAll(NUMBER_TOKEN_RE)) {
    const v = numValue(m[0]);
    if (v != null) out.push({ tok: m[0].trim(), value: v });
  }
  return out;
};

function checkReport(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  // The bundle's own transcript, when it sits beside the report: it is what makes an `L<n>`
  // locator RESOLVABLE rather than merely well-shaped.
  let transcriptLines = null;
  let transcript = null;
  try {
    const dir = path.dirname(path.resolve(file));
    const cand = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !LEDGER_FILE_RE.test(f))
      .map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    if (cand) { transcript = cand; transcriptLines = fs.readFileSync(cand, 'utf8').split('\n').filter((l) => l.trim()).length; }
  } catch { /* no transcript beside the report - locators stay unverified, and the footer says so */ }

  const machine = { values: new Set(), tokens: new Set() };
  const judgment = [];      // { section, line, n }
  const authored = [];      // the judgment lines an author wrote - the only ones whose locators are citations
  let section = '(preamble)';
  let isJudgment = false;
  let machineTables = false;
  lines.forEach((line, i) => {
    const h = /^#{2,6}\s+(.*)$/.exec(line);
    if (h) { section = h[1].trim(); isJudgment = JUDGMENT_HEAD_RE.test(line); machineTables = MACHINE_TABLE_SECTION_RE.test(line); return; }
    const t = line.trim();
    if (!t) return;
    if (!isJudgment || (machineTables && t.startsWith('|'))) {
      for (const n of numbersIn(line)) { machine.values.add(n.value); machine.tokens.add(n.tok.toLowerCase()); }
      return;
    }
    // Skeleton text is not an authored claim: the italic instruction lines and the blockquotes the
    // skeleton itself prints carry numbers of their own.
    if (/^[_>]/.test(t) || /^\|\s*-+/.test(t) || /^-{3,}$/.test(t)) return;
    authored.push(i);
    const hasLocator = LOCATOR_RE.test(stripDates(line));
    for (const n of numbersIn(line)) {
      if (hasLocator) continue;
      if (machine.values.has(n.value) || machine.tokens.has(n.tok.toLowerCase())) continue;
      // The tables print ROUNDED values (`8.0k`), so a claim restating one as `8,000` is the same
      // number and not a finding. 1% - wide enough for the printer's own rounding, far too narrow
      // for a total the author summed by hand (measured on a real report: a hand-summed 995k sits
      // 9% from every row it came from, and is exactly the kind of number that drifted).
      if ([...machine.values].some((m) => Math.abs(m - n.value) <= Math.max(0.5, 0.01 * m))) continue;
      judgment.push({ section, line: i + 1, tok: n.tok, text: t.replace(/\s+/g, ' ').slice(0, 120) });
    }
  });
  // An out-of-range locator is not a citation either. Only an authored judgment line cites: a machine section's own
  // text ('... AFTER this session's last row 2026-10-05T10:55:30.735Z') locates nothing.
  const badLocators = [];
  if (transcriptLines) {
    authored.forEach((i) => {
      const line = lines[i];
      for (const m of stripDates(line).matchAll(LOCATOR_G)) {
        const n = Number(m[1] || m[2] || m[3] || m[4]);
        if (n > transcriptLines) badLocators.push({ line: i + 1, locator: m[0].trim(), text: String(line).trim().replace(/\s+/g, ' ').slice(0, 120) });
      }
    });
  }
  return { file, rows: judgment, badLocators, transcript, transcriptLines };
}

function printCheckReport(res) {
  console.log(`CHECK-REPORT ${res.file}`);
  console.log(`  locators checked against ${res.transcript ? `${res.transcript} (${res.transcriptLines} rows)` : 'nothing - no transcript beside the report, so an L<n> is accepted on shape alone'}`);
  if (res.rows.length) {
    console.log(`  ${pad('section', 28)} ${pad('line', 6)} ${pad('number', 10)} the claim`);
    for (const r of res.rows) console.log(`  ${pad(r.section.slice(0, 28), 28)} ${pad(r.line, 6)} ${pad(r.tok, 10)} ${r.text}`);
  }
  for (const b of res.badLocators) console.log(`  locator out of range  line ${b.line}  ${b.locator} - the transcript has ${res.transcriptLines} rows: ${b.text}`);
  const n = res.rows.length + res.badLocators.length;
  if (!n) { console.log('  clean - every number in a judgment section traces to a machine row of this report or carries a resolvable L<n>'); return 0; }
  console.log(`  ${n} unsourced number(s) - each must quote a machine table row of THIS report or carry an L<n> locator that resolves. The run is not done while this prints a row.`);
  return 1;
}

// Exported for the tests: the join's arithmetic shipped broken (ISO string minus a number = NaN,
// so every ledger-joined session printed '0% of tool calls are inside the ledger window') and
// stayed broken because nothing could reach the function to pin it.
// Review finding 10: the project's own transcripts folder, `<config>/projects/<name>`. Claude Code names it
// from the NATIVE path, every non-alphanumeric character a '-' (memory-import.js slugify, the documented
// rule), so on Windows 'C:\\Users\\me\\repo' is 'C--Users-me-repo'. Derived here from the analyzer's own
// cwd, never in a command body: a shell's `pwd | sed` gets '-c-Users-me-repo' under Git Bash.
function sessionsDirOf(cwd, configDir) {
  return path.join(configDir, 'projects', require('./memory-import.js').slugify(cwd));
}

module.exports = { houseBare, loadPluginLayers, hookJoinStats, readBlockLedger, docRelPath, joinUnattributedDenials, windowSource, interruptLine, globToRe, parseFrontmatter, checkReport, forkParents, rmVerifyTail, maskSecrets, hookCommandKey, samePath, sessionsDirOf };

// ---------- entry ----------

// `--out <file>` instead of a shell redirect: the harness's auto-mode classifier denies
// `node analyze-usage.js <s.jsonl> --report-md > <dir>/report-usage.md` (measured: 6 Bash round
// trips and ~10.5 min lost per run to finding the rename-then-mv workaround), and a flag the tool
// owns cannot be read as a redirect at all.
async function main() {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const outFile = oi >= 0 ? args[oi + 1] : null;
  if (!outFile) return runAnalysis();
  const sink = [];
  const realLog = console.log;
  console.log = (...a) => sink.push(a.map(String).join(' '));
  try {
    await runAnalysis();
  } finally {
    console.log = realLog;
    const body = `${sink.join('\n')}\n`;
    fs.writeFileSync(outFile, body);
    console.log(`written: ${outFile} (${body.split('\n').length - 1} lines, ${body.length} chars)`);
  }
  return undefined;
}

async function runAnalysis() {
  const args = process.argv.slice(2);
  const flagVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  // Every occurrence of a value flag, so a repeated `--exclude-session <id>` is never read as the target.
  const VALUE_FLAGS = new Set(['--hook-log', '--hook-blocks', '--from', '--to', '--docs-root', '--inventory', '--plugins', '--out', '--check-report', '--prices', '--exclude-session', '--turn-check-advice']);
  const flagValIdx = new Set(args.map((a, i) => (VALUE_FLAGS.has(a) ? i + 1 : -1)).filter((i) => i > 0));
  // No folder or transcript named: the transcripts of the project this runs in (sessionsDirOf).
  const target = args.find((a, i) => !a.startsWith('--') && !flagValIdx.has(i))
    || sessionsDirOf(process.cwd(), process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  // The report CHECK is its own pass: it reads a filled report, not a transcript.
  const checkFile = flagVal('--check-report');
  if (checkFile) {
    process.exitCode = printCheckReport(checkReport(checkFile));
    return;
  }
  const asJson = args.includes('--json');
  const asMd = args.includes('--report-md');
  const hookFile = flagVal('--hook-log');
  const blockDir = flagVal('--hook-blocks');
  const docsRoot = flagVal('--docs-root');
  const inventoryDir = flagVal('--inventory');
  const pluginsFile = flagVal('--plugins');
  const pricesFile = flagVal('--prices');
  if (pricesFile) { priceFile = path.resolve(pricesFile); priceCache = null; }
  // one spelling for both routes: backslashes normalized, `./` dropped, one trailing slash
  if (docsRoot) {
    const r = String(docsRoot).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') + '/';
    if (!docsPrefixes.includes(r)) docsPrefixes.push(r);
  }
  const fromStr = flagVal('--from'), toStr = flagVal('--to');
  const window = fromStr || toStr
    ? { from: fromStr ? Date.parse(fromStr) : null, to: toStr ? Date.parse(toStr) : null, fromStr, toStr }
    : null;
  if (!target || (window && (Number.isNaN(window.from) || Number.isNaN(window.to)))) {
    console.error('usage: analyze-usage.js [<session.jsonl | sessions-dir>] [--from <ISO ts>] [--to <ISO ts>] [--hook-log <tool-usage.jsonl>] [--hook-blocks <dir|file>] [--docs-root <path>] [--inventory <.claude dir>] [--plugins <installed_plugins.json>] [--prices <model-prices.json>] [--exclude-session <id>] [--turn-check-advice <project-root>] [--json] [--report-md] [--out <file>]\n       analyze-usage.js --check-report <report-usage.md>');
    process.exit(1);
  }

  // The session RUNNING this analyzer is left out of a directory read: its transcript is half-written,
  // and a rollup over `~/.claude/projects` scored it beside the finished ones. Claude Code names it in
  // every tool shell (`CLAUDE_CODE_SESSION_ID` - exact, where a 'modified in the last N seconds' rule
  // would also drop a session that just closed and keep one idle past N); `--exclude-session`
  // (repeatable, comma-separated) names more, such as a second live session in another terminal.
  const excludeWhy = new Map();
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== '--exclude-session') continue;
    for (const id of String(args[i + 1]).split(',').map((x) => x.trim()).filter(Boolean)) excludeWhy.set(id, '--exclude-session');
  }
  const liveId = process.env.CLAUDE_CODE_SESSION_ID;
  if (liveId && !excludeWhy.has(liveId)) excludeWhy.set(liveId, 'CLAUDE_CODE_SESSION_ID');

  // The Stop build check advisory: ONE row or nothing, over the newest sessions' own ledgers - no
  // transcript is analysed, so it stays cheap on a long history, and a missing directory is no row.
  const adviceRoot = flagVal('--turn-check-advice');
  if (adviceRoot) {
    const advice = turnCheckAdvice(target, adviceRoot, excludeWhy);
    if (asJson) console.log(JSON.stringify(advice, null, 2));
    else if (advice.row) console.log(advice.row);
    return;
  }

  if (fs.statSync(target).isDirectory()) {
    // rollup mode: one line per session under the directory, newest first. RECURSIVE - a
    // collected corpus nests one folder per project and one per session, and the flat one-level
    // history folder is just the depth-0 case of the same walk.
    const excludedSessions = [];
    const files = findSessionFiles(target)
      .filter((f) => {
        const why = excludeWhy.get(path.basename(f, '.jsonl'));
        if (why) excludedSessions.push({ session: path.basename(f, '.jsonl'), why });
        return !why;
      })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!asJson) console.log(`  ${pad('session', 38)} ${pad('start', 12)} ${rpad('output', 8)} ${rpad('cache-read', 11)} ${rpad('msgs', 6)} ${rpad('ctx/msg', 8)} ${rpad('agents', 6)} ${rpad('agent-out', 9)} ${rpad('cost', 9)} ${rpad('mcp-err', 8)} ${rpad('corr-saved', 10)}`);
    const grand = newTally();
    let grandUsd = 0;
    // Corrections saved to memory, over the run: the number the S2.2 threshold (25% unsaved) reads.
    const grandCorr = { saved: 0, total: 0 };
    // Fed one session at a time and never held as a list: the corpus answer must not cost the
    // corpus. Each session's installed set is resolved from its OWN cwd (cached per cwd, so a
    // one-project folder resolves exactly once), because a corpus spans projects that installed
    // different things and one project's inventory would report the rest's names as unused.
    const acc = newInventoryUse(loadPlugins(pluginsFile));
    const rollupJson = { sessions: [] };
    // The probe tallies of the corpus's OWN sessions, each read from its own ledger file.
    const probeSum = blockDir ? { doneGate: newDoneGate(), rootCause: newRootCause(), correction: newCorrection(), rationalization: newRationalization() } : null;
    for (const f of files) {
      if (probeSum) {
        const led = finishProbes(readBlockLedger(blockDir, path.basename(f, '.jsonl')), f);
        for (const [k, sum] of Object.entries(probeSum)) if (led[k]) for (const n of Object.keys(sum)) sum[n] += led[k][n];
      }
      const s = await analyzeTranscript(f, window);
      const agents = await analyzeSubagents(f, window);
      addSessionUse(acc, s, agents, inventoryDir);
      const at = newTally();
      for (const a of agents) mergeTally(at, a.stats.total);
      mergeTally(grand, s.total); mergeTally(grand, at);
      // one cost per session - its own messages plus its seats, a fork prefix left to its parent
      const priced = !s.cost.error;
      const usd = priced ? [s, ...agents.map((a) => a.stats)].reduce((n, x) => n + ((x.cost && x.cost.usd) || 0), 0) : null;
      if (priced) grandUsd += usd;
      // MCP calls the server answered with an error, main and seats - the per-session number a
      // server health check is judged on across a corpus
      const mcp = { calls: 0, errors: 0 };
      for (const x of [s, ...agents.map((a) => a.stats)]) for (const m of Object.values(x.mcp || {})) { mcp.calls += m.calls; mcp.errors += m.errors; }
      const eff = s.efficiency || {};
      const corrections = { saved: eff.correctionsSaved || 0, total: (eff.correctionsSaved || 0) + (eff.correctionsUnsaved || []).length };
      grandCorr.saved += corrections.saved; grandCorr.total += corrections.total;
      const row = `  ${pad(path.basename(f, '.jsonl'), 38)} ${pad((s.firstTs || '?').slice(0, 10), 12)} ${rpad(fmt(s.total.output), 8)} ${rpad(fmt(s.total.cacheRead), 11)} ${rpad(s.total.msgs, 6)} ${rpad(fmt(ctxOf(s.total)), 8)} ${rpad(agents.length, 6)} ${rpad(fmt(at.output), 9)} ${rpad(fmtUsd(usd), 9)} ${rpad(mcp.calls ? `${mcp.errors}/${mcp.calls}` : '-', 8)} ${rpad(corrections.total ? `${corrections.saved}/${corrections.total}` : '-', 10)}`;
      if (asJson) rollupJson.sessions.push({ session: path.basename(f, '.jsonl'), start: s.firstTs, total: s.total, agents: agents.length, cost: usd, mcp, corrections });
      else console.log(row);
    }
    const invUse = acc.sessions ? finishInventoryUse(acc) : null;
    if (asJson) { console.log(JSON.stringify({ ...rollupJson, excludedSessions, total: grand, cost: priceTable().error ? null : grandUsd, corrections: grandCorr, inventory: invUse, ...(probeSum ? { probes: probeSum } : {}) }, null, 2)); return; }
    console.log(`  ${pad('TOTAL', 38)} ${pad('', 12)} ${rpad(fmt(grand.output), 8)} ${rpad(fmt(grand.cacheRead), 11)} ${rpad(grand.msgs, 6)} ${rpad('', 8)} ${rpad('', 6)} ${rpad('', 9)} ${rpad(priceTable().error ? '-' : fmtUsd(grandUsd), 9)} ${rpad('', 8)} ${rpad(grandCorr.total ? `${grandCorr.saved}/${grandCorr.total}` : '-', 10)}`);
    if (excludedSessions.length) {
      const label = (x) => `${x.session} (${x.why === 'CLAUDE_CODE_SESSION_ID' ? 'CLAUDE_CODE_SESSION_ID - the session running this analyzer' : x.why})`;
      console.log(`\nexcluded ${excludedSessions.length} session${excludedSessions.length === 1 ? '' : 's'}: ${excludedSessions.map(label).join(', ')}`);
    }
    const unsaved = grandCorr.total - grandCorr.saved;
    console.log(`\ncorrections saved to memory over ${files.length} session${files.length === 1 ? '' : 's'}: ${grandCorr.total ? `${grandCorr.saved} of ${grandCorr.total}; ${unsaved} unsaved (${Math.round((100 * unsaved) / grandCorr.total)}%)` : 'no correction turn'}`);
    if (probeSum && probeSum.doneGate.claims) console.log('\n' + doneGateLine(probeSum.doneGate));
    if (probeSum && probeSum.rootCause.streaks) console.log((probeSum.doneGate.claims ? '' : '\n') + rootCauseLine(probeSum.rootCause));
    if (probeSum && probeSum.correction.turns) console.log((probeSum.doneGate.claims || probeSum.rootCause.streaks ? '' : '\n') + correctionLine(probeSum.correction));
    if (probeSum && probeSum.rationalization.closes) console.log((probeSum.doneGate.claims || probeSum.rootCause.streaks || probeSum.correction.turns ? '' : '\n') + rationalizationLine(probeSum.rationalization));
    printInventoryBlock(invUse);
    console.log('\nRun again with one session file for the full skills/MCP/tools/spikes report.');
    return;
  }

  const mainStats = await analyzeTranscript(target, window);
  const agents = await analyzeSubagents(target, window);
  const hookLog = hookFile ? await analyzeHookLog(hookFile) : null;
  // ONE ledger read, handed to every emitter. --report-md and --json used to drop it entirely,
  // so the bundle reports that quote the markdown - the ones the sweeps actually read - carried no
  // guard-block section at all (7 confirmations), while the terminal report had it.
  const blockLedger = finishProbes(readBlockLedger(blockDir, path.basename(target, '.jsonl')), target);
  const invAcc = newInventoryUse(loadPlugins(pluginsFile));
  addSessionUse(invAcc, mainStats, agents, inventoryDir);
  const invUse = finishInventoryUse(invAcc);
  if (asJson) {
    // The join's own numbers were computed only at RENDER time, so `--json` could not see them and
    // nothing could test them - which is how the NaN cross-check above shipped and stayed shipped.
    // Fold them into the dump beside the ledger they describe.
    const agg = computeAggregates(mainStats, agents);
    const join = hookLog ? hookJoinStats(mainStats, agents, hookLog, agg.tools) : null;
    const hl = hookLog ? (({ rowsIdx, ...rest }) => rest)(hookLog) : hookLog;   // the row index is the join's input, not a report field
    const body = { main: mainStats, agents, hookLog: hl && join ? { ...hl, ...join.coverage ? { coverage: join.coverage } : {} } : hl, hookBlocks: blockLedger, dispatchOverhead: agg.dispatchOverhead, cost: agg.cost, inventory: invUse };
    console.log(JSON.stringify(window ? { window: { from: fromStr, to: toStr }, ...body } : body, null, 2));
    return;
  }
  if (asMd) {
    printMarkdown(mainStats, agents, hookLog, window, blockLedger, invUse);
    return;
  }
  printReport(mainStats, agents, hookLog, window, blockLedger, invUse);
}

// Run only as a COMMAND. Required as a module (the tests, which need to reach hookJoinStats),
// it must define its functions and do nothing else - otherwise the require prints the usage
// line and exits 1 before a single assertion runs.
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
