#!/usr/bin/env node
// preferences-session.js - PreToolUse (Read|Grep|LSP|Write|Edit|MultiEdit|NotebookEdit|Skill, the navigation server's two
// edit tools and five lookups, and the shell route) + SessionStart + SubagentStart + UserPromptExpansion (the typed runs).
// The user's preferences docs under <docs-path>/preferences/ bind the work (alfred-preferences.md names them and says when
// each is read - the user's ruling of 2026-10-21: one pointer rule and this hook, nothing inlined in an always-on rule).
// A rule asks the model to read; this hook makes the read happen at the moments that need it:
//   - the FIRST file edit of each actor (the main session, and each seat by its agent_id) waits until the code docs
//     that exist were read - the entries of PERSONAL-CODE-PREFERENCES.md and ARCHITECTURE-PREFERENCES.md whose Scope:
//     reaches the target (or every target: a plain area, or none), and the sections of PROJECT-CODE-PREFERENCES.md that
//     cover it (a later edit a not-yet-handed entry or section reaches waits again);
//   - the FIRST git write of each actor (a call that moves the index, the tree, a ref or a stash, makes a branch, a tag
//     or a release, or a `gh pr merge` / `gh pr create`) waits until GIT-PREFERENCES.md was read;
//   - a solution designer, a verifier and the three finding seats (JUDGE) hold no edit tool (verified against
//     meta/seat-tools.json), so no edit hold fires for them: each is handed the code docs at its SubagentStart, marked in
//     its record, and what one room could not hold comes with its first reads - each Read, Grep or LSP call outside
//     the preferences folder, navigation-server symbol lookup, or shell read of a file (`cat`, `sed`, `grep` ...), waits,
//     handing over the next part, until every entry has come (the user's rulings of 2026-10-22; a held Grep or shell
//     grep also says to locate through the navigation server). A bare seat name counts only where the install stamp
//     records its copy - a project's own agent of that name is no stack seat;
//   - the main session's RUN - the last capture-, loop-, task- or issue- skill, review-code or review-security (or a
//     built-in code-review / security-review the user types) it
//     started, until the user's next typed turn (a go-on reply such as 'continue' is none), typed (UserPromptExpansion: a typed command makes no Skill call) or called (Skill) - is kept in its
//     record: a review run's first Skill call waits for the code docs, a typed one is handed them at its expansion, and
//     its first reads bring the rest; the architecture analyzer is handed the architecture doc alone at its start only
//     inside an architecture quality run - the map capture dispatches it to describe the code as it is.
// The hold HANDS THE DOCS OVER in its denial (the docs-session gate's pattern), so a retry is all it costs: the user's own
// two docs' entries (each without its Check: line), then the project doc's covering and cover-less sections; the git doc
// read live, its locked entries first AS THE SEED STATES THEM (an edited copy is named, never handed over as locked).
// Both holds share ONE room of INLINE_CAP, git first; a user's entry that does not fit waits for the retry, which hands
// it over (the docs after it waiting too), and the project doc's rest is named as a `docs.js show` line or a Read. A doc
// handed over, or read WHOLE by
// the actor (a Read with no range, a `cat` of it, a `docs.js show` of each of its sections), is marked in the actor's own
// record, <data root>/state/sessions/preferences-<session>-<actor>.json - the OS temp dir when that cannot be written,
// and no hold at all (a one-line note instead) when neither can. A compaction or a /clear drops the docs from context,
// so a SessionStart with the source `compact` or `clear` deletes that actor's marks (a seat's own compaction runs the
// SessionStart hooks inside the seat, with its agent_id - only its record goes); a compaction keeps the run and a seat's
// architecture hand-over, which go on.
// PERSONAL-PREFERENCES.md - how the user wants the assistant to work (the user's ruling of 2026-10-21) - binds the MAIN
// session's every turn, so it is PUSHED at every main SessionStart whatever the source (startup, resume, clear, compact,
// fork - so it is back after each compaction), comments dropped and cut at PUSH_CAP with a Read line for the rest. A seat
// answers the main session, never the user: nothing is pushed into one.
// The docs are found from the session's folder up (a subfolder start, a monorepo package) and, for a linked worktree whose
// docs are git-ignored, in the main checkout (hook-prelude.js checkoutsOf). A doc that is a link is never read: a cloned
// repo could point one at a credential store. A target in a seat's `.claude/worktrees/<n>/` is judged as the project path
// it mirrors. Edits outside the project, under the data root and the docs root (bar the plan folders), .claude/ and .git/
// are no code change. It holds with nobody at the terminal too: the hold asks nothing, it only hands content over.
// Fail-open: any error passes the call.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
if (require.main === module) {
  let off = false;
  try { off = require('./hook-prelude.js').standDown('preferences-session'); } catch { /* an install without the prelude runs the hook */ }
  // Outside the try: the dispatchers run this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}

let layout = null;
try { layout = require('./layout.js'); } catch { /* an older copy route: the paths below are spelled inline */ }
let shellReader = null;
try { shellReader = require(path.join(__dirname, 'shell-writes.js')); } catch { /* no reader: the shell route judges nothing */ }
let forgeLib = null;
// The tool order's start line (the capture-preferences tools area); null when the copy is not there.
let toolsCache;
const toolsLib = () => {
  if (toolsCache === undefined) {
    try { toolsCache = require(path.join(__dirname, '..', 'skills', 'capture-preferences', 'scripts', 'tools.js')); } catch { toolsCache = null; }
  }
  return toolsCache;
};
try { forgeLib = require(path.join(__dirname, 'forge.js')); } catch { /* no classifier: forge writes past git go unread */ }
const prelude = () => { try { return require('./hook-prelude.js'); } catch { return null; } };

const envOf = (env, suffix) => { const v = env[`ALFRED_CODE_${suffix}`]; return v === '' ? undefined : v; };
const dataRootRel = () => (layout ? layout.dataRoot() : String(envOf(process.env, 'DATA_PATH') || '.alfred'));
const docsRootRel = () => (layout ? layout.docsRoot() : envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`);

const PREFS = 'preferences';
// The hand-over order is the priority order: the user's own two docs first, the captured project doc after them.
const CODE_DOCS = [
  { key: 'PERSONAL-CODE', file: 'PERSONAL-CODE-PREFERENCES.md', entries: true },
  { key: 'ARCHITECTURE', file: 'ARCHITECTURE-PREFERENCES.md', entries: true },
  { key: 'PROJECT-CODE', file: 'PROJECT-CODE-PREFERENCES.md', sectioned: true },
];
const GIT_DOC = { key: 'GIT', file: 'GIT-PREFERENCES.md' };
const PERSONAL_DOC = { key: 'PERSONAL', file: 'PERSONAL-PREFERENCES.md' };
// preferences.js caps the doc at 3,000 chars; the push cuts a hand-edited one a little past that, at a line or a word.
const PUSH_CAP = 3200;
const ALL_DOCS = [...CODE_DOCS, GIT_DOC];
// The pasted text's budget, ONE room for both holds of a call (git first); the frame lines around it stay under 1,000
// more, so a denial stays under Claude Code's 10,000-char hook output cap. preferences.js caps the git doc at 5,000, so
// it fits whole and leaves the code docs room beside it; the user's code and architecture docs have no doc cap (the
// user's ruling of 2026-10-22) - what does not fit one room comes with the retry, one entry at most 5,000.
const INLINE_CAP = 7000;
// Under this much room left after the git doc, the code docs wait for the retry instead of being named in a crumb.
const CODE_MIN_ROOM = 1000;
const DOC_READ_BYTES = 512 * 1024;
const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// A navigation server's two edit tools, by name under any registration (docs-session.js NAV_EDIT).
const NAV_EDIT = /^mcp__.+__(?:rename_symbol|safe_delete_symbol)$/;
// Its symbol lookups, which read code as a Read does - a seat told to locate before it reads may never call Read.
const NAV_READ = /^mcp__.+__(?:find_symbol|find_referencing_symbols|get_symbols_overview|find_declaration|find_implementations)$/;
// The harness's own readers and the input key naming what each reads: a Grep and an LSP call read code as a Read does, so
// a judge that greps instead of locating skips no part (the user's ruling of 2026-10-22, 'Hold both, steer off Grep').
const READ_PATH = new Map([['Read', 'file_path'], ['Grep', 'path'], ['LSP', 'filePath']]);
const GREP_STEER = 'Locate a symbol through the navigation tools your start line orders (LSP first) - Grep is for a literal you already located.';
// The shell's grep words, which earn the same line.
const SHELL_GREP = /^(?:grep|egrep|fgrep|rg|select-string|sls)$/i;
// The main session's RUN - the last orchestration skill it started, typed (UserPromptExpansion) or called (Skill), bare
// only: another plugin's skill is its own. A review run's first Skill call waits for the code docs, and a typed one is
// handed them, its first reads bringing the rest (the user's ruling of 2026-10-22, 'Hold its first review skill'); the
// architecture analyzer is handed the architecture doc only inside an architecture quality run, never the map capture's.
const RUN_NAME = /^(?:(?:alfred-)?(?:capture|loop|task|issue|mode)-[\w-]+|review-code|review-security|code-review|security-review)$/;
const REVIEW_RUN = /^(?:review-code|review-security|code-review|security-review|loop-code-quality|loop-architecture-quality)$/;
const ARCH_RUN = /^loop-architecture-quality$/;
// capture-quality's run is its part (hook-prelude.js qualityPart, recorded beside the run; an older copy's capture name
// is read from its words there): the code and architecture parts and the chain review the code, the architecture part
// and the chain read the architecture doc (2026-10-29).
function runKinds(run, part) {
  const name = String(run || '');
  const p = prelude();
  const kind = String(part || '') || (p && typeof p.qualityPart === 'function' ? p.qualityPart(name, '') : '');
  return {
    review: REVIEW_RUN.test(name) || /^(?:architecture-quality|code-quality|chain)$/.test(kind),
    arch: ARCH_RUN.test(name) || /^(?:architecture-quality|chain)$/.test(kind),
  };
}
// A design run in the chat ends in a plan and may never edit a scoped file, so no edit hold hands it the code docs: its
// load is handed them beside the skill's own text and never denied (item 4 gap D, 2026-10-25). A seat has its start's.
const DESIGN_RUN = /^(?:task-design|issue-diagnoser|task-build-from-scratch)$/;
// A reader that prints the whole file, and the words that cut what a reader prints (a pipe into head reads a peek).
const WHOLE_READER = /^(?:cat|bat|less|more|nl|type|get-content|gc)$/i;
const PARTIAL_WORD = /^(?:head|tail|grep|egrep|fgrep|rg|sed|awk|wc|cut|select-string|sls|select-object)$/i;
const PARTIAL_FLAG = /^-(?:TotalCount|Head|Tail|First|Last)$/i;
// The shell words that print a file's text, as a Read does; `wc` and `ls` print none of it.
const SHELL_READ = /^(?:cat|bat|less|more|nl|type|get-content|gc|head|tail|grep|egrep|fgrep|rg|sed|awk|cut|select-string|sls)$/i;
// The read-only judges: a solution designer, a verifier, the three seats whose findings a preference shapes - the
// code-quality analyzer, the security auditor and the integration reviewer - and the output scorer, which grades a plan
// against the docs its producer read, handed the code docs. The architecture
// analyzer, which reports smells, is handed the architecture doc alone (the user's ruling of 2026-10-22). A bare name is
// the stack's own only where the install stamp records its copy (the copy route); a project's own agent of the same
// name, or another plugin's, gets nothing.
const JUDGE = /^(?:[\w-]*solution-designer|[\w-]+-verifier|code-quality-analyzer|security-auditor|integration-reviewer|output-scorer)$/;
const ARCH_SEAT = /^architecture-analyzer$/;
const STAMP_BYTES = 64 * 1024;
// The locked keys the seed carries, for an install whose seed is not beside this hook.
const KNOWN_LOCKED = /^(?:consent|checkpoint|safety|attribution|checks)$/;
const SEED = path.join(__dirname, '..', 'skills', 'capture-preferences', 'references', 'git-seed.md');

const isShell = (name) => (shellReader && typeof shellReader.isShellTool === 'function' ? shellReader.isShellTool(name) : /^(Bash|PowerShell|Monitor)$/.test(name));
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
// A path as it sits on disk, resolved through the deepest folder that exists (macOS /var is /private/var).
function real(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest); } catch { /* not there yet: one folder up */ }
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(p);
    rest.unshift(path.basename(cur));
    cur = up;
  }
}
const inside = (dir, p) => {
  const r = path.relative(fold(dir), fold(p));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
const posix = (p) => p.split(path.sep).join('/');
const under = (rel, dir) => !!dir && (fold(rel) === fold(dir) || fold(rel).startsWith(`${fold(dir)}/`));
const safe = (s) => String(s || 'nosession').replace(/[^\w.-]/g, '_').slice(-80);
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// The docs engine's glob, the same spelling (docs.js globRe): a bare `*` stops at one segment, `**` crosses them.
const globRe = (g) => new RegExp(`^${g.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);

// ---- where the docs are -------------------------------------------------------------------------------------------
// The session's folder, its checkouts up to the git top level and, for a linked worktree, the main checkout: the docs are
// the first of them holding the preferences folder (`home`); a target is judged against the deepest checkout holding it.
function contextOf(start) {
  const begin = real(start);
  let roots = [begin];
  try { roots = prelude().checkoutsOf(begin).map(real); } catch { /* no prelude: the session folder alone */ }
  const prefsAt = (at) => path.resolve(at, docsRootRel(), PREFS);
  const home = roots.find((at) => { try { return fs.statSync(prefsAt(at)).isDirectory(); } catch { return false; } }) || begin;
  const checkouts = roots.filter((at) => fs.existsSync(path.join(at, '.git')));
  const bases = [...new Set([home, ...checkouts])];
  const relTo = (abs) => posix(path.relative(home, path.resolve(home, abs)));
  // Each doc is read where it first sits: the home's folder, then the other checkouts' - a doc git keeps out (the personal
  // ones, audit 2026-10-21 Q-1) exists only in the main checkout, never in a linked worktree.
  const prefsDirs = [...new Set([home, ...roots].map(prefsAt))];
  let up;
  return {
    home, bases, prefs: prefsAt(home), prefsDirs,
    // R4b: each linked workspace member's preferences, after the own ones - read on first use only, since this context is
    // built on every hook call.
    get ancestorDirs() {
      if (up === undefined) { try { up = layout && layout.ancestorPrefsDirs ? layout.ancestorPrefsDirs(home) : []; } catch { up = []; } }
      return up;
    },
    dataRel: relTo(dataRootRel()), docsRel: relTo(docsRootRel()),
    plans: (layout ? layout.planDirs(home) : [path.resolve(home, docsRootRel(), 'work', 'plans'), path.resolve(home, docsRootRel(), 'plans')]).map(relTo),
  };
}
// The project path of a target, or null outside every base. A seat's worktree under `.claude/worktrees/<n>/` mirrors the
// project, so its lead is dropped.
function relOf(ctx, abs) {
  const P = real(abs);
  let best = null;
  for (const b of ctx.bases) if (inside(b, P) && (!best || b.length > best.length)) best = b;
  if (!best) return null;
  const rel = posix(path.relative(best, P));
  const wt = /^\.claude\/worktrees\/[^/]+\/(.+)$/.exec(rel);
  return wt ? wt[1] : rel;
}
// Exempt from the code hold: outside the project, the data root and the docs root (the captures write there - bar the
// plan folders, whose plan carries code decisions), .claude/ and .git/.
function exempt(ctx, abs) {
  const rel = relOf(ctx, abs);
  if (rel === null || rel === '' || rel.startsWith('..')) return true;
  if (ctx.plans.some((d) => under(rel, d))) return false;
  return [ctx.dataRel, ctx.docsRel, '.claude', '.git'].some((d) => !d.startsWith('..') && under(rel, d));
}

// ---- the docs -----------------------------------------------------------------------------------------------------
// A doc is read only when it is a plain file: a link is refused whatever it points at (a cloned repo could carry one to a
// credential store, and this hook pastes what it reads), and so is a binary file.
function readDoc(ctx, d) {
  for (const dir of ctx.prefsDirs || [ctx.prefs]) {
    let st;
    try { st = fs.lstatSync(path.join(dir, d.file)); } catch { continue; }
    return st.isSymbolicLink() || !st.isFile() ? null : readFile(ctx, d, path.join(dir, d.file));
  }
  // R3: no own copy - the nearest linked member's, unless an `ignore doc` skips the file there. It is marked an ancestor's.
  for (const { dir, skip } of ctx.ancestorDirs || []) {
    if (skip.has(d.file)) continue;
    let st;
    try { st = fs.lstatSync(path.join(dir, d.file)); } catch { continue; }
    const doc = st.isSymbolicLink() || !st.isFile() ? null : readFile(ctx, d, path.join(dir, d.file));
    return doc && { ...doc, ancestor: true };
  }
  return null;
}
// The copy of a doc that applies here, as readDoc picks it, without reading it: an own copy first, else an ancestor's.
function docPathOf(ctx, d) {
  const has = (dir) => { try { fs.lstatSync(path.join(dir, d.file)); return true; } catch { return false; } };
  const own = (ctx.prefsDirs || [ctx.prefs]).find(has);
  if (own) return path.join(own, d.file);
  const up = (ctx.ancestorDirs || []).find((a) => !a.skip.has(d.file) && has(a.dir));
  return up ? path.join(up.dir, d.file) : null;
}
// Inside a preferences folder this session reads: its own, or - for a path under a folder named `preferences` alone, so
// the chain is read only then (R4b) - a linked member's.
function inPrefs(ctx, p) {
  const P = real(p);
  if (ctx.prefsDirs.some((dir) => inside(real(dir), P))) return true;
  if (!P.split(/[\\/]/).includes(PREFS)) return false;
  return (ctx.ancestorDirs || []).some((a) => inside(real(a.dir), P));
}
function readFile(ctx, d, file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, DOC_READ_BYTES));
      fs.readSync(fd, buf, 0, buf.length, 0);
      if (buf.includes(0)) return null;
      return { ...d, path: file, rel: posix(inside(ctx.home, file) ? path.relative(ctx.home, file) : file), text: buf.toString('utf8') };
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}
// The text a model is handed: HTML comments out (one line or many, inline too), fenced blocks kept as written.
function clean(t) {
  const out = [];
  let run = [];
  let fence = null;
  const flush = () => { if (run.length) out.push(run.join('\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '')); run = []; };
  for (const l of String(t).replace(/\r\n/g, '\n').split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (fence) { out.push(l); if (f && f[1][0] === fence) fence = null; continue; }
    if (f) { flush(); fence = f[1][0]; out.push(l); continue; }
    run.push(l);
  }
  flush();
  return out.join('\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// What an entry's Scope: reaches, as tests on a project path - read by the capture's own reader (preferences.js scopeOf,
// beside this hook in the plugin as the git seed is), so the two can no longer drift: a copy here split a `{ts,tsx}` glob on
// its comma as the script's did (review 2026-10-23). None when any part is a plain area ('every language', 'Node.js'), and
// such an entry is handed over for every edit - as every entry is where the script is absent (a copy route that did not
// pick the capture).
let captureReader;
function scopeOf(value) {
  if (captureReader === undefined) {
    try { captureReader = require(path.join(__dirname, '..', 'skills', 'capture-preferences', 'scripts', 'preferences.js')); } catch { captureReader = null; }
  }
  if (!captureReader || typeof captureReader.scopeOf !== 'function') return [];
  try { return captureReader.scopeOf(value).map((x) => x.test); } catch { return []; }
}
// The lines of a body outside its fenced blocks that `test` picks, or every line but those when `drop` is set.
function fieldLines(body, test, drop) {
  let fence = null;
  return body.filter((l) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (fence) { if (f && f[1][0] === fence) fence = null; return drop; }
    if (f) { fence = f[1][0]; return drop; }
    return test(l) !== drop;
  });
}
const CHECK_LINE = (l) => /^- Check:/.test(l);
const SCOPE_LINE = (l) => /^- Scope:/.test(l);
// `##` entries, their comment lines (id, covers, locked) read from just under the heading; a fenced block is text. An
// entry doc (the user's code and architecture docs) reaches by each entry's Scope: and is handed over without its Check:
// line - the script's data, never a rule the model follows - and without the title and stamp lines above its entries.
function parseDoc(text, entries = false) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const heads = [];
  let fence = null;
  lines.forEach((l, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return; }
    if (!fence && /^##\s+\S/.test(l)) heads.push(i);
  });
  const sections = heads.map((h, k) => {
    const body = lines.slice(h, k + 1 < heads.length ? heads[k + 1] : lines.length);
    const meta = body.slice(1, 9).filter((l) => /^\s*<!--[\s\S]*?-->\s*$/.test(l)).join('\n');
    const heading = body[0].replace(/^##\s+/, '').trim();
    const id = (/<!--\s*id:\s*([\w-]+)\s*-->/.exec(meta) || [])[1] || '';
    const covers = ((/<!--\s*covers:\s*(.*?)\s*-->/.exec(meta) || [])[1] || '').split(/[,\s]+/).filter(Boolean);
    return {
      heading, id, mark: id || heading.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''),
      covers,
      reach: entries ? scopeOf((fieldLines(body, SCOPE_LINE, false)[0] || '').replace(/^- Scope:/, ''))
        : covers.map((g) => { const re = globRe(g); return (t) => re.test(t); }),
      locked: (/<!--\s*locked:\s*([a-z][a-z-]*)\s*-->/.exec(meta) || [])[1] || '',
      text: clean((entries ? fieldLines(body, CHECK_LINE, true) : body).join('\n')),
      rules: squash(clean(body.slice(1).join('\n'))),
    };
  });
  const preamble = clean(lines.slice(0, heads.length ? heads[0] : lines.length).join('\n'));
  return { preamble: entries ? preamble.split('\n').filter((l) => l.trim() && !/^#\s|^(?:Updated|Retired|Captured):/.test(l.trim())).join('\n') : preamble, sections };
}
// The seed's locked entries, key -> section, in the seed's order; null when the seed is not beside this hook.
let seedCache;
function seedLocked() {
  if (seedCache !== undefined) return seedCache;
  try { seedCache = new Map(parseDoc(fs.readFileSync(SEED, 'utf8')).sections.filter((s) => s.locked).map((s) => [s.locked, s])); }
  catch { seedCache = null; }
  return seedCache;
}
// A section of the project doc not pasted: its show line where the engine can serve it, else the file to read.
function refOf(ctx, doc, s) {
  // R4: an ancestor's section is read where it sits - `docs.js show` resolves in this project's docs root.
  if (doc.ancestor) return `Read ${doc.path} ('${s.heading}')`;
  const engine = fs.existsSync(path.join(ctx.home, '.claude', 'hooks', 'docs.js')) && fs.existsSync(path.join(ctx.prefs, 'watch.json'));
  return engine && s.id ? `\`node .claude/hooks/docs.js show ${doc.file.replace(/\.md$/, '')}#${s.id}\`` : `${doc.rel} ('${s.heading}')`;
}
// The names of what was not pasted, themselves capped: past NAMED_CAP the rest is one count pointing at the doc.
const NAMED_CAP = 700;
function nameList(names, rel) {
  let text = '';
  let k = 0;
  for (const nm of names) {
    if (text && text.length + nm.length + 2 > NAMED_CAP) break;
    text += `${text ? ', ' : ''}${nm}`;
    k += 1;
  }
  return k < names.length ? `${text}, and ${names.length - k} more in ${rel}` : text;
}
const cut = (text, room, rel) => (text.length <= room ? text : `${text.slice(0, Math.max(room - 80, 0)).replace(/\s+\S*$/, '')}\n... (${text.length - Math.max(room - 80, 0)} more chars: Read ${rel})`);

// ---- the marks ----------------------------------------------------------------------------------------------------
// A doc is read when its key is marked (a whole read, a hand-over) or every one of its sections is.
function docRead(doc, marks) {
  if (marks[doc.key]) return true;
  const { sections } = parseDoc(doc.text);
  return sections.length > 0 && sections.every((s) => marks[`${doc.key}#${s.mark}`]);
}
const coversAny = (s, targets) => s.reach.length > 0 && targets.some((t) => s.reach.some((f) => f(t)));
// What of the code docs this edit still needs: the user's two docs' entries this edit reaches (or that reach every edit)
// not yet handed, and the project doc's covering and cover-less sections not yet handed. `all` (a designer) takes every
// entry and section.
function codeNeeds(docs, marks, targets, all) {
  const needs = [];
  for (const d of docs) {
    if (!d.sectioned && !d.entries) { if (!docRead(d, marks)) needs.push({ doc: d }); continue; }
    if (marks[d.key]) continue;
    const { sections } = parseDoc(d.text, d.entries);
    if (!sections.length) { needs.push({ doc: d }); continue; }
    const want = sections.filter((s) => (all || coversAny(s, targets) || !s.reach.length) && !marks[`${d.key}#${s.mark}`]);
    if (want.length) needs.push({ doc: d, want, fresh: !sections.some((s) => marks[`${d.key}#${s.mark}`]) });
  }
  return needs;
}

// ---- the hand-overs -----------------------------------------------------------------------------------------------
const PRECEDENCE = 'they rank above every skill and house convention; where an entry and another instruction disagree, ask the user which wins, the entry\'s side marked (Recommended) - a seat names the clash in its report and carries on with the entry\'s side';

// The code docs in `room`: returns the text parts, the named refs, the entries left for the retry and the marks earned. A
// doc or section is marked when it was pasted whole, or - in a room nothing else shared - when it was cut or named because
// it can never fit. The user's own entries bind (the user's ruling of 2026-10-22: the hand-over is capped, never their
// docs): under `chunked` (a hold) an entry that did not fit stays unmarked for the retry, and every doc after it waits;
// only one that fits no room at all is cut, once. A designer's start has no retry, so there it is named.
function codeParts(ctx, needs, room, fullRoom, label, chunked = true) {
  const parts = [];
  const named = [];
  const later = [];
  let laterRel = '';
  const marks = [];
  for (const n of needs) {
    if (later.length) break;
    const d = n.doc;
    const title = `--- ${d.file} (${d.rel}) ---`;
    if (!n.want) {
      const body = clean(d.text);
      if (body.length + title.length + 2 <= room) { parts.push('', title, body); room -= title.length + body.length + 2; marks.push(d.key); continue; }
      if (room - title.length > 200) { const c = cut(body, room - title.length, d.rel); parts.push('', title, c); room -= title.length + c.length + 2; }
      else named.push(`Read ${d.rel}`);
      if (fullRoom) marks.push(d.key);
      continue;
    }
    const { preamble, sections } = parseDoc(d.text, d.entries);
    const head = n.fresh && preamble ? preamble : '';
    const pasted = [];
    let left = room - title.length - (head ? head.length + 2 : 0);
    for (const s of n.want) {
      const key = `${d.key}#${s.mark}`;
      if (s.text.length + 2 <= left) { pasted.push(s.text); left -= s.text.length + 2; marks.push(key); continue; }
      if (d.entries) {
        if (fullRoom && !parts.length && !pasted.length) { pasted.push(cut(s.text, left, d.rel)); left = 0; marks.push(key); }
        else if (chunked) { later.push(s.heading); laterRel = d.rel; }
        else named.push(refOf(ctx, d, s));
        continue;
      }
      if (!pasted.length && left > 400) { pasted.push(cut(s.text, left, d.rel)); left = 0; }
      else named.push(refOf(ctx, d, s));
      if (fullRoom) marks.push(key);
    }
    // By mark: `n.want` came from codeNeeds' own parse, so no section here is the same object.
    const wanted = new Set(n.want.map((s) => s.mark));
    if (n.fresh) for (const s of sections) if (!wanted.has(s.mark)) named.push(refOf(ctx, d, s));
    if (pasted.length) {
      const t = `--- ${d.file} (${d.rel})${label ? ` - ${label}` : ''} ---`;
      const body = [head, ...pasted].filter(Boolean).join('\n\n');
      parts.push('', t, body);
      room -= t.length + body.length + 2;
    }
  }
  return { parts, named, later, laterRel, marks, used: parts.reduce((k, p) => k + p.length + 1, 0) };
}

// The edit hold's text (`change`), a seat's or a reviewing session's read hold (`read`), a review skill's hold
// (`review`), or a design load's hand-over (`design`): the same parts, worded for the work it does; `kind` names the docs a
// seat was handed. A design load is no hold, so nothing comes with a retry: it marks only what it pasted whole and names
// the rest, which the first scoped edit still hands over.
function codeReason(ctx, needs, targets, room, fullRoom, mode = 'change', kind = 'code') {
  const target = targets[0] || '';
  const design = mode === 'design';
  const c = codeParts(ctx, needs, room, design ? false : fullRoom, target ? `the sections for ${target}` : '');
  if (design) {
    const rest = restLines(needs, c.marks);
    const text = [
      `Before this design, read the user's ${kind} preferences - ${PRECEDENCE}:`,
      ...c.parts,
      ...(rest.length ? ['', 'Not pasted here - read each before a decision it bears on:', ...rest] : []),
      '', 'Follow them in every decision of this design.',
    ].join('\n');
    return { text, marks: c.marks, used: c.used };
  }
  const sectioned = needs.find((n) => n.doc.sectioned);
  const change = mode === 'change';
  const again = mode === 'review' ? 'start the review' : `make the ${mode}`;
  const lead = { change: `Before changing ${target || 'code'}, read`, read: 'Before this read, take the rest of', review: 'Before this review, read' }[mode];
  const text = [
    `${lead} the user's ${kind} preferences - ${PRECEDENCE}:`,
    ...c.parts,
    ...(c.named.length ? ['', `Not pasted here - read before a ${change ? 'change' : 'decision'} it bears on: ${nameList(c.named, (sectioned || needs[0]).doc.rel)}.`] : []),
    ...(c.later.length ? ['', `Not pasted yet, and they bind this ${change ? 'change' : 'work'}: ${nameList(c.later, c.laterRel)} - the retry hands them over, or Read ${c.laterRel} whole.`] : []),
    '', c.later.length ? `Follow what is pasted; now ${again} again for the next part.`
      : change ? 'Follow them for this change and every later one; now make the change.'
        : mode === 'review' ? 'Follow them in every finding; now start the review again.' : 'Follow them in every decision and finding; now make the read again.',
  ].join('\n');
  return { text, marks: c.marks, used: c.used };
}

// What a design load did not paste whole, one `read <doc> '<entry>'` line each (a doc with no entries, `read <doc>`),
// the lines capped as the named list is: past NAMED_CAP the rest is one line naming each doc to read whole.
function restLines(needs, marks) {
  const handed = new Set(marks);
  const rest = [];
  for (const n of needs) {
    if (!n.want) { if (!handed.has(n.doc.key)) rest.push({ rel: n.doc.rel, line: `read ${n.doc.rel}` }); continue; }
    for (const s of n.want) if (!handed.has(`${n.doc.key}#${s.mark}`)) rest.push({ rel: n.doc.rel, line: `read ${n.doc.rel} '${s.heading}'` });
  }
  const lines = [];
  let size = 0;
  for (let i = 0; i < rest.length; i += 1) {
    if (lines.length && size + rest[i].line.length + 1 > NAMED_CAP) {
      const left = rest.slice(i);
      lines.push(`read ${[...new Set(left.map((r) => r.rel))].join(' and ')} whole for the other ${left.length}`);
      break;
    }
    lines.push(rest[i].line);
    size += rest[i].line.length + 1;
  }
  return lines;
}

// The git doc, its locked entries as the SEED states them (an edited copy named, never trusted), then the rest.
function gitReason(doc, room) {
  const { sections } = parseDoc(doc.text);
  const head = `Before this git write, read the user's git preferences - ${doc.file} (${doc.rel}), as it reads now:`;
  const tail = 'Follow them for this command and every later git write; now run the command again.';
  const seed = seedLocked();
  if (!sections.length && !seed) { const body = cut(clean(doc.text), room, doc.rel); return { text: [head, '', body, '', tail].join('\n'), used: body.length }; }
  const isHouse = (s) => !!s.locked && (seed ? seed.has(s.locked) : KNOWN_LOCKED.test(s.locked));
  const locked = seed ? [...seed.values()] : sections.filter(isHouse);
  const edits = seed ? sections.filter((s) => isHouse(s) && s.rules !== seed.get(s.locked).rules) : [];
  const rest = sections.filter((s) => !isHouse(s));
  const out = [head];
  let used = 0;
  if (locked.length) {
    const text = cut(locked.map((s) => s.text).join('\n\n'), room, doc.rel);
    out.push('', 'Locked - no other entry, skill or instruction weakens these:', '', text);
    used += text.length;
    for (const s of edits) out.push('', `Your doc's '${s.heading}' differs from the house line above; the house line holds - \`preferences.js lint\` names the edit and /alfred-code:update restores it.`);
  }
  const pasted = [];
  const named = [];
  for (const s of rest) {
    if (s.text.length + 2 <= room - used) { pasted.push(s.text); used += s.text.length + 2; }
    else named.push(s.heading);
  }
  if (!sections.length && doc.text.trim()) { const body = cut(clean(doc.text), Math.max(room - used, 300), doc.rel); out.push('', body); used += body.length; }
  if (pasted.length) out.push('', locked.length ? 'The other entries:' : '', ...(locked.length ? [''] : []), pasted.join('\n\n'));
  if (named.length) out.push('', `Not pasted here - Read ${doc.rel} for: ${nameList(named, doc.rel)}.`);
  out.push('', tail);
  return { text: out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'), used };
}

// ---- the record ---------------------------------------------------------------------------------------------------
// One file per actor, so parallel seats never drop each other's marks; the OS temp dir stands in when the data root
// cannot take it.
function recordFiles(ctx, sid, actor) {
  const name = `preferences-${safe(sid)}-${safe(actor)}.json`;
  const primary = layout ? layout.statePath(ctx.home, 'sessions', name) : path.resolve(ctx.home, dataRootRel(), 'state', 'sessions', name);
  const key = crypto.createHash('sha1').update(ctx.home).digest('hex').slice(0, 12);
  return [primary, path.join(os.tmpdir(), `alfred-code-preferences-${key}-${safe(sid)}-${safe(actor)}.json`)];
}
function loadMarks(files) {
  const marks = {};
  for (const f of files.slice().reverse()) {
    try {
      const v = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(marks, v);
    } catch { /* absent or garbage: no record, so the hold hands the docs over again */ }
  }
  return marks;
}
function saveMarks(files, marks) {
  for (const file of files) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(marks));
      fs.renameSync(tmp, file);
      try { prelude().sweepStale(path.dirname(file), file === files[0] ? 'preferences-' : 'alfred-code-preferences-'); } catch { /* no prelude: no sweep */ }
      return true;
    } catch { /* the next place */ }
  }
  return false;
}
const dropRecord = (files) => { for (const f of files) { try { fs.rmSync(f, { force: true }); } catch {} } };
function blockRow(ctx, input, kind, reason, extra = {}) {
  try {
    const dir = layout ? layout.statsPath(ctx.home, ['hook-blocks']) : path.resolve(ctx.home, dataRootRel(), 'statistics', 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${safe(input.session_id)}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'preferences-session.js', event: input.hook_event_name || '', tool: input.tool_name || '', ...extra, kind, reason: String(reason).split('\n')[0].slice(0, 200) })}\n`);
  } catch {}
}

// ---- what a call does ---------------------------------------------------------------------------------------------
const docOfPath = (ctx, abs) => {
  const P = fold(real(abs));
  const rel = relOf(ctx, abs);
  const own = ALL_DOCS.find((d) => ctx.prefsDirs.some((dir) => fold(real(path.join(dir, d.file))) === P)
    || (rel !== null && fold(rel) === fold(`${ctx.docsRel}/${PREFS}/${d.file}`)));
  if (own) return own;
  // R4b: an ancestor's copy marks a doc only where it is the copy that applies - this project holds none of its own.
  const base = path.basename(P);
  return ALL_DOCS.find((d) => {
    if (fold(d.file) !== base) return false;
    const at = docPathOf(ctx, d);
    return Boolean(at) && fold(real(at)) === P;
  }) || null;
};
// What a Read marks: the doc when the read reaches all of it (no range, or a range from line 1 past its last line).
function readMarks(ctx, t, cwd) {
  const d = typeof t.file_path === 'string' && t.file_path ? docOfPath(ctx, path.resolve(cwd, t.file_path)) : null;
  if (!d) return [];
  const offset = Number(t.offset) || 0;
  if (offset > 1) return [];
  if (t.limit === undefined || t.limit === null) return [d.key];
  const doc = readDoc(ctx, d);
  return doc && Number(t.limit) >= doc.text.split('\n').length ? [d.key] : [];
}
// What a shell command marks: a whole-file reader naming a doc (no pipe into a cutter, no head/tail flag), or a
// `docs.js show <doc>#<id>` of one section. A name in an echo, a toc `show` and a peek mark nothing.
function shellMarks(command, targets) {
  let words = [];
  try { words = shellReader.commandWords(command); } catch { return []; }
  const docByBase = (arg) => ALL_DOCS.find((d) => path.basename(String(arg)) === d.file) || null;
  const written = (d) => targets.some((x) => path.basename(String(x)) === d.file);
  const partial = words.some((w) => PARTIAL_WORD.test(w.name));
  const out = [];
  for (const w of words) {
    if (WHOLE_READER.test(w.name) && !partial && !w.argv.some((a) => PARTIAL_FLAG.test(a))) {
      for (const a of w.argv) { const d = docByBase(a); if (d && !written(d)) out.push(d.key); }
      continue;
    }
    let showArgs = [];
    if (/(?:^|[\\/])docs\.js$/.test(w.name) && w.argv[0] === 'show') showArgs = w.argv.slice(1);
    else if (/^node(?:\.exe)?$/i.test(w.name) && /(?:^|[\\/])docs\.js$/.test(w.argv[0] || '') && w.argv[1] === 'show') showArgs = w.argv.slice(2);
    for (const a of showArgs) {
      const m = /^(?:[\w./-]*\/)?([\w-]+?)(?:\.md)?#([\w-]+)$/.exec(a);
      const d = m ? ALL_DOCS.find((x) => x.file === `${m[1]}.md`) : null;
      if (d) out.push(`${d.key}#${m[2]}`);
    }
  }
  return [...new Set(out)];
}
// A branch made by name (`git branch x`) is a write; the listing forms read.
const BRANCH_LIST = /^(?:-a|--all|-r|--remotes|-l|--list|-v|-vv|--verbose|--show-current|--contains(?:=.*)?|--no-contains(?:=.*)?|--merged(?:=.*)?|--no-merged(?:=.*)?|--points-at(?:=.*)?|--format(?:=.*)?|--sort(?:=.*)?|--column(?:=.*)?|--color(?:=.*)?|--no-color)$/;
function gitWrites(command, cwd) {
  let read;
  try { read = shellReader.gitText(command, cwd); } catch { return false; }
  if (read.unreadAt >= 0) return true;   // text naming git the reader could not read: judged as a write, conservatively
  for (const c of read.calls || []) {
    if (c.opaque) return true;
    if (!c.sub) continue;
    if (shellReader.gitMutates(c.sub, c.argv)) return true;
    if (c.sub === 'branch' && c.argv.some((a) => !a.startsWith('-')) && !c.argv.some((a) => BRANCH_LIST.test(a))) return true;
    if (c.sub === 'worktree' && c.argv[0] === 'add' && c.argv.some((a) => /^-[bB]/.test(a))) return true;
  }
  // A forge write by concept, on any CLI or API call (forge.js): opening or merging a change request, a branch write, a
  // release - `gh pr merge` and `glab mr create` alike. An unknown forge call is held too: it may be one of them.
  try {
    for (const r of forgeLib.classifyCommand(read.command, cwd, { parsed: read.parsed }))
      if (forgeLib.PREF_HOLD.has(r.concept)) return true;
  } catch { /* no classifier: the git calls above decide */ }
  return false;
}
// The same hold on an MCP server outside the stack: the tool read by its words (`create_merge_request`, `push_files`,
// `repo_pull_request_write {autoComplete: true}`).
function mcpGitWrite(input) {
  try { const r = forgeLib.classify(input); return !!r && forgeLib.PREF_HOLD.has(r.concept); } catch { return false; }
}
function shellTargets(command, cwd) {
  try {
    const scan = shellReader.scanShell(String(command), {});
    return scan.targets.filter((t) => !t.unknown).map((t) => scan.expandVars(String(t.raw || '')).replace(/^['"]|['"]$/g, ''))
      .filter((t) => t && !t.includes('$') && !t.startsWith('/dev/')).map((t) => path.resolve(cwd, t));
  } catch { return []; }
}
// What a shell command reads as a Read would: null when no word prints a file outside the preferences folder; else
// whether a grep word did it, which earns the steer line. A path argument counts when it names something on disk - as
// written, through a variable the command itself sets, or as a glob one entry matches; a pattern, a sed or awk program
// and a flag are no file. Read too: a search given no path, which searches the folder it runs in as the Grep tool does
// (`rg` reading no pipe or `<` input, a recursive `grep`), a reader that `find -exec` or `xargs` runs, and a
// `Select-String` fed by a file listing. A path the command computes (`$(...)`) or a script (`node -e`) stays unseen.
const PROGRAM_WORD = /^(?:grep|egrep|fgrep|rg|sed|awk|select-string|sls)$/i;
const PROGRAM_FLAG = /^(?:-[ef]|--regexp(?:=.*)?|--file(?:=.*)?|--expression(?:=.*)?|-pattern)$/i;
const LISTER = /^(?:get-childitem|gci|dir|ls|get-item|gi)$/i;
function shellReads(ctx, command, cwd) {
  let words = [];
  try { words = shellReader.commandWords(command); } catch { return null; }
  let expand = (t) => t;
  try { const scan = shellReader.scanShell(String(command), {}); expand = (t) => scan.expandVars(t); } catch { /* no expansion: a $ argument stays unseen */ }
  const outsidePrefs = (p) => !inPrefs(ctx, p);
  const onDisk = (raw) => {
    let a = String(raw).replace(/^['"]|['"]$/g, '');
    if (a.includes('$')) { try { a = String(expand(a)); } catch { return null; } }
    if (!a || a.startsWith('-') || a.includes('$')) return null;
    const p = path.resolve(cwd, a);
    if (fs.existsSync(p)) return p;
    const segs = a.split(/[\\/]/);
    const at = segs.findIndex((x) => /[*?[]/.test(x));
    if (at < 0) return null;
    const dir = path.resolve(cwd, segs.slice(0, at).join('/') || '.');
    try { const re = globRe(segs[at]); return fs.readdirSync(dir).some((n) => re.test(n)) ? dir : null; } catch { return null; }
  };
  let reads = false;
  let grep = false;
  const hit = (w) => { reads = true; if (SHELL_GREP.test(w.name)) grep = true; };
  for (const w of words) {
    if (!SHELL_READ.test(w.name)) continue;
    if (w.via === 'xargs') { if (outsidePrefs(cwd)) hit(w); continue; }
    if (w.via === 'find') {
      const f = words.find((x) => x.name === 'find' && x.cmd === w.cmd);
      const roots = [];
      for (const a of (f ? f.argv : [])) { if (/^[-(!]/.test(a)) break; roots.push(a); }
      const at = roots.length ? roots.map(onDisk).filter(Boolean) : [cwd];
      if (at.some(outsidePrefs)) hit(w);
      continue;
    }
    let named = false;
    let program = PROGRAM_WORD.test(w.name) && !w.argv.some((a) => PROGRAM_FLAG.test(a));
    for (const raw of w.argv) {
      if (String(raw).startsWith('-')) continue;
      if (program) { program = false; continue; }
      const p = onDisk(raw);
      if (!p) continue;
      named = true;
      if (outsidePrefs(p)) hit(w);
    }
    if (named || !outsidePrefs(cwd)) continue;
    const piped = (w.cmd && w.cmd.stage > 0) || (w.cmd && (w.cmd.redirs || []).some((r) => /^<(?:<<)?$/.test(r.op)));
    const recursive = w.argv.some((a) => /^-[A-Za-z]*[rR]/.test(a) || /^--(?:dereference-)?recursive$/.test(a));
    const listed = !!w.cmd && w.cmd.stage > 0 && words.some((x) => x.cmd && x.cmd.index < w.cmd.index && x.cmd.index >= w.cmd.index - w.cmd.stage && LISTER.test(x.name));
    if ((/^rg$/i.test(w.name) && !piped) || (/^[ef]?grep$/i.test(w.name) && recursive) || (/^(?:select-string|sls)$/i.test(w.name) && listed)) hit(w);
  }
  return reads ? { grep } : null;
}

// ---- who is handed what -------------------------------------------------------------------------------------------
// The seats the copy route copied, from the install stamp's `library-agents:` line (`name=<sha>,...`); empty on the plugin
// route, with no stamp, or with one that cannot be read.
function copiedSeats(ctx) {
  for (const base of ctx.bases) {
    const file = path.join(base, '.claude', 'alfred-code.stamp');
    let text = '';
    try {
      if (!fs.lstatSync(file).isFile()) continue;
      const fd = fs.openSync(file, 'r');
      try { const buf = Buffer.alloc(STAMP_BYTES); text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, STAMP_BYTES, 0)); } finally { fs.closeSync(fd); }
    } catch { continue; }
    const m = /^library-agents:[ \t]*(.*)$/m.exec(text);
    return new Set(m ? m[1].split(',').map((x) => x.split('=')[0].trim()).filter((x) => /^[\w-]+$/.test(x)) : []);
  }
  return new Set();
}
// The stack seat an agent type names, or '': `alfred-code:<seat>` always, a bare name only where the stamp records its copy.
function stackSeat(ctx, type) {
  const m = /^(alfred-code:)?([\w-]+)$/.exec(String(type || ''));
  if (!m) return '';
  if (m[1]) return m[2];
  return (JUDGE.test(m[2]) || ARCH_SEAT.test(m[2])) && copiedSeats(ctx).has(m[2]) ? m[2] : '';
}
// What a seat is handed: a judge the code docs; the architecture analyzer the architecture doc, where `arch` holds -
// inside an architecture quality run at its start, and after a start that handed it at its reads.
function seatDocs(ctx, type, arch) {
  const seat = stackSeat(ctx, type);
  if (JUDGE.test(seat)) return { defs: CODE_DOCS, kind: 'code' };
  if (ARCH_SEAT.test(seat) && arch) return { defs: CODE_DOCS.filter((d) => d.key === 'ARCHITECTURE'), kind: 'architecture' };
  return null;
}
const runOf = (name) => { const n = String(name || '').trim().replace(/^\//, ''); return RUN_NAME.test(n) ? n : ''; };
// A run starts where the transcript stood when it was recorded, and ends at the user's next typed turn - any but the run's
// own command row (the user's answer of 2026-10-22, 'Transcript check at the hold'): read only at an architecture
// analyzer's start and a reviewing main session's held read, never per prompt. No transcript, or one that cannot be read,
// keeps the run.
const RUN_TAIL = 8 * 1024 * 1024;
function recordRun(marks, run, input) {
  marks.run = run;
  const p = prelude();
  const args = input.hook_event_name === 'UserPromptExpansion' ? input.command_args : (input.tool_input || {}).args;
  const part = p && typeof p.qualityPart === 'function' ? p.qualityPart(run, args) : '';
  if (part) marks.part = part; else delete marks.part;
  // the call's id: a hook that refused the call (the built-in review's deny, the fresh-session hold) ends the run at its
  // first held read, where the record was made before anyone knew the call would run (review 2026-10-23)
  if (input.tool_use_id) marks.runId = String(input.tool_use_id); else delete marks.runId;
  const file = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  let size = NaN;
  try { size = fs.statSync(file).size; } catch { /* not there yet: the whole file is after the start */ }
  if (file) { marks.runFile = file; marks.runAt = Number.isFinite(size) ? size : 0; } else { delete marks.runFile; delete marks.runAt; }
}
// A row the user typed: not the harness's (a skill body, a summary, a command's output, a notification, a seat's hand-back
// frame - hook-prelude.js harnessPrompt's list - a `!` shell command and its output, an Esc's interrupt marker, which
// carries no isMeta), not a tool result.
const HARNESS_ROW = /^\s*(?:<(?:local-command-stdout|local-command-caveat|task-notification|agent-message|bash-input|bash-stdout|bash-stderr)\b|Another Claude session sent a message:|\[Request interrupted by user)/;
// A typed reply that only says go on keeps the run (the user's answer of 2026-10-22, 'Keep go-on replies'): a typed
// 'continue' after an Esc ended it, so the helpers after it lost the hand-over. English only, as the other hooks read.
const GO_ON = /^\s*(?:continue|go on|proceed|carry on|resume|keep going|yes|ok|okay)[\s.!]*$/i;
function typedTurn(row) {
  if (!row || row.type !== 'user' || row.isMeta || row.isCompactSummary || row.interruptedMessageId) return null;
  const c = row.message && row.message.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    if (c.some((x) => x && x.type === 'tool_result')) return null;
    text = c.filter((x) => x && x.type === 'text').map((x) => String(x.text || '')).join('\n');
  }
  return HARNESS_ROW.test(text) || GO_ON.test(text) ? null : text;
}
function runLive(marks) {
  const file = marks.runFile;
  const at = Number(marks.runAt);
  if (typeof file !== 'string' || !file || !Number.isFinite(at)) return true;
  let text = '';
  try {
    const size = fs.statSync(file).size;
    if (size <= at) return true;
    const from = Math.max(at, size - RUN_TAIL);
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(size - from); text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, from)); } finally { fs.closeSync(fd); }
  } catch { return true; }
  const own = new RegExp(`<command-name>\\s*/?(?:[\\w-]+:)?${String(marks.run || '').replace(/[^\w-]/g, '')}\\s*</command-name>`);
  const id = typeof marks.runId === 'string' && marks.runId ? marks.runId : '';
  for (const line of text.split('\n')) {
    if (!line.includes('"user"')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const c = row && row.message && row.message.content;
    if (id && Array.isArray(c) && c.some((x) => x && x.type === 'tool_result' && x.tool_use_id === id && x.is_error === true)) return false;
    const typed = typedTurn(row);
    if (typed !== null && !own.test(typed)) return false;
  }
  return true;
}

// The personal doc as a session's starting context, or '' when it holds nothing but its title and stamps.
function personalPush(ctx) {
  const doc = readDoc(ctx, PERSONAL_DOC);
  const body = doc ? clean(doc.text) : '';
  if (!body.split('\n').some((l) => l.trim() && !/^#\s|^(?:Updated|Retired|Captured):/.test(l.trim()))) return '';
  let shown = body;
  if (body.length > PUSH_CAP) {
    const line = body.lastIndexOf('\n', PUSH_CAP);
    const word = body.lastIndexOf(' ', PUSH_CAP);
    const at = line >= PUSH_CAP / 2 ? line : word >= PUSH_CAP / 2 ? word : PUSH_CAP;
    shown = `${body.slice(0, at).trimEnd()}\n\n[... cut at ${at} of ${body.length} chars - Read ${doc.rel} for the rest]`;
  }
  return `The user's personal preferences - ${doc.rel}, pushed at every session start and after each compaction. They bind `
    + `this session as alfred-preferences.md ranks them:\n\n${shown}`;
}

// R6/R7 (release 3): the workspace root's memory index at a child's main start. Claude Code swaps a hook context past
// 10,000 characters for a path and a preview, so the index is sized last, by what the other parts used, with a 500 margin:
// its first 60 lines, then 6 KB of UTF-8, then the room left, each cut at a line; under 300 left, the path alone.
const MEMORY_ROOM = 9500;
const MEMORY_LINES = 60;
const MEMORY_BYTES = 6144;
const MEMORY_FLOOR = 300;
const cutAtLine = (s, fits) => {
  let at = s.length;
  while (at > 0 && !fits(s.slice(0, at))) at = s.lastIndexOf('\n', at - 1);
  return at > 0 ? s.slice(0, at) : '';
};
// `used`: the characters the rest of the start's additionalContext holds, the separator before this part included.
function memoryLine(file, text, used) {
  const head = `Workspace root memory (read-only): ${file}`;
  const left = MEMORY_ROOM - used - head.length - 1;
  if (left < MEMORY_FLOOR) return head;
  let body = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n').slice(0, MEMORY_LINES).join('\n').trimEnd();
  body = cutAtLine(body, (x) => Buffer.byteLength(x, 'utf8') <= MEMORY_BYTES);
  body = cutAtLine(body, (x) => x.length <= left);
  return body ? `${head}\n${body}` : head;
}
function memoryText(ctx, used) {
  let dir = null;
  try { dir = layout && layout.workspaceMemoryOf ? layout.workspaceMemoryOf(ctx.home) : null; } catch { dir = null; }
  if (!dir) return '';
  const file = path.join(dir, 'MEMORY.md');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  return text.trim() ? memoryLine(file, text, used) : '';
}

// A seat's start, or a typed review's: the docs it judges against (`seat` from seatDocs), every section of the project doc
// as far as it fits. With a record to keep (`files`) what was handed is marked there, with `extra` beside it, and the
// entries one room could not hold wait for its first reads; with none, they are named.
function seatPush(ctx, files, seat, extra = {}) {
  const docs = seat.defs.map((d) => readDoc(ctx, d)).filter(Boolean);
  if (!docs.length) return '';
  const marks = files ? loadMarks(files) : {};
  const needs = codeNeeds(docs, marks, [], true);
  if (!needs.length) return '';
  let c = codeParts(ctx, needs, INLINE_CAP, true, '', !!files);
  if (files) {
    for (const k of c.marks) marks[k] = true;
    if (!saveMarks(files, { ...marks, ...extra })) c = codeParts(ctx, needs, INLINE_CAP, true, '', false);
  }
  const sectioned = needs.find((n) => n.doc.sectioned);
  return [
    seat.kind === 'architecture'
      ? `The user's architecture preferences - ${PRECEDENCE}; report each place the code departs from one as a smell naming its id (\`${CODE_DOCS[1].file}#a3\`), located like any other - whether it is a finding stays your caller's call:`
      : `The user's code preferences - ${PRECEDENCE}. Name the entry id in each decision or finding it shapes:`,
    ...c.parts,
    ...(c.named.length ? ['', `Not pasted here - read before a decision it bears on: ${nameList(c.named, (sectioned || needs[0]).doc.rel)}.`] : []),
    ...(c.later.length ? ['', `Not pasted yet, and they bind this work: ${nameList(c.later, c.laterRel)} - your first Read or symbol lookup hands them over, or Read ${c.laterRel} whole.`] : []),
  ].join('\n');
}

// A chat design load's hand-over (DESIGN_RUN): the code docs in one room as additionalContext, no permission decision, the
// marks only what was pasted whole, so the actor's first scoped edit still hands the rest.
function designPush(ctx, files, marks, event) {
  const needs = codeNeeds(CODE_DOCS.map((d) => readDoc(ctx, d)).filter(Boolean), marks, [], true);
  if (!needs.length) return;
  const c = codeReason(ctx, needs, [], INLINE_CAP, true, 'design');
  for (const k of c.marks) marks[k] = true;
  saveMarks(files, marks);
  emit(event, { additionalContext: c.text });
}

// The seats that never touch the project's code - Claude Code's guides - are told no tool order.
const NO_ORDER_SEAT = /^(?:claude-code-guide|statusline-setup)$/;

// THE HOST'S SHELL TRAPS (audit 2026-10-14 RU13, the user's ruling; moved here from the retired memory-session.js on
// 2026-10-24, the one other hook that spoke at every start). The always-on navigation rule carried the Windows Git Bash line
// into every macOS / Linux session and the zsh lines into every bash one; each host now gets only its own, at the
// session's and every seat's start. Keyed on this process's platform and $SHELL - the shell the Bash tool runs
// (shell-guards.js reads the same variable for its zsh rewrite). A per-host line is no per-OS rule copy (rule-prose.test.js
// M68), and the rule keeps a one-line pointer here.
const ZSH_LINES = [
  "- zsh aborts the WHOLE command on an unmatched bare path glob, status 1 like a genuine no-match, so an aborted scan reads as 'nothing there': list a path glob that may match nothing with `find <dir> -name '<pat>'`.",
  '- zsh never word-splits `$VAR`, so a command plus flags held in one variable runs as one word - use a function or an array.',
];
const WINDOWS_LINES = [
  "- On Windows (Git Bash): pass a `/tmp/x` path to native `node` through `cygpath -w` (or write under `$TEMP`); prefix a `git show <rev>:<path>` with `MSYS2_ARG_CONV_EXCL='*'`, or path conversion rewrites it; run PowerShell as a quoted-heredoc (`<<'EOF'`) `.ps1` via `-File \"$(cygpath -w <file>)\"`, never a double-quoted `-Command` (Bash expands its `$_`).",
];
function hostLines(platform = process.platform, shell = process.env.SHELL) {
  const name = String(shell || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  const lines = [...(platform === 'win32' ? WINDOWS_LINES : []), ...(name === 'zsh' ? ZSH_LINES : [])];
  return lines.length ? ['Shell commands on this host:', ...lines] : [];
}
// `preferences-session:host` in the off-list drops them and nothing else.
function hostText() {
  try { if (prelude().partOff('preferences-session', 'host')) return ''; } catch { /* no prelude: on */ }
  return hostLines().join('\n');
}
// What the tool order resolves a seat against: its definition's frontmatter where the file is found - the core's own seat
// beside this hook (`alfred-code:<seat>`), else the project's copy - and 'other' (the main session's reach) where not.
function seatOf(ctx, type) {
  const m = /^(alfred-code:)?([\w-]+)$/.exec(String(type || ''));
  if (!m) return 'other';
  const files = [...(m[1] ? [path.join(__dirname, '..', 'agents', `${m[2]}.md`)] : []), path.join(ctx.home, '.claude', 'agents', `${m[2]}.md`)];
  for (const file of files) {
    try {
      const fd = fs.openSync(file, 'r');
      try { const buf = Buffer.alloc(STAMP_BYTES); return { frontmatter: buf.toString('utf8', 0, fs.readSync(fd, buf, 0, STAMP_BYTES, 0)) }; } finally { fs.closeSync(fd); }
    } catch { /* the next place */ }
  }
  return 'other';
}
// The tool order an actor is told at its start, or '' with the part switched off or the tools script absent. Only the
// main session's start may spend the one suggestion, and only once the part is on.
function toolsText(ctx, seat) {
  try { if (prelude().partOff('preferences-session', 'tools')) return ''; } catch { /* no prelude: on */ }
  const lib = toolsLib();
  if (!lib) return '';
  try {
    const suggest = seat === null && lib.suggestOnce(ctx.home);
    const line = lib.toolsLine({ projectRoot: ctx.home, env: process.env, seat, suggest });
    // Custom memory with nothing to hold the lessons: the main session is told, a seat is not.
    const none = seat === null && lib.memoryMode({ projectRoot: ctx.home, env: process.env }) === 'custom'
      && !lib.jobOrder({ projectRoot: ctx.home, env: process.env, job: 'memory' }).ranks.length;
    return [line, none ? MEMORY_NONE : ''].filter(Boolean).join('\n');
  } catch { return ''; }
}
const MEMORY_NONE = 'Memory: custom, but no memory tool is reachable here - nothing is stored this session; rank one with /capture-preferences tools, or /alfred-code:configure switches to native.';

function emit(event, extra) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...extra } }));
}

// A held read: the next part of the docs `seat` names; false once every entry has come, or once the main session's review
// run has ended (its record then drops the run, so no later read reads the transcript again).
function seatHold(ctx, input, files, marks, seat, grep) {
  const docs = seat.defs.map((d) => readDoc(ctx, d)).filter(Boolean);
  const needs = codeNeeds(docs, marks, [], true);
  if (!needs.length) return false;
  if (!input.agent_id && !runLive(marks)) {
    delete marks.run; delete marks.part; delete marks.runAt; delete marks.runFile; delete marks.runId;
    saveMarks(files, marks);
    return false;
  }
  const c = codeReason(ctx, needs, [], INLINE_CAP, true, 'read', seat.kind);
  for (const k of c.marks) marks[k] = true;
  if (!saveMarks(files, marks)) {
    emit('PreToolUse', { additionalContext: `preferences-session could not keep its read record, so it holds nothing - read ${needs.map((n) => n.doc.rel).join(', ')} before your findings.` });
    return true;
  }
  const text = grep ? `${c.text}\n${GREP_STEER}` : c.text;
  blockRow(ctx, input, 'read', text);
  emit('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: text });
  return true;
}

function main() {
  try { prelude().blockingStdio(); } catch { /* no prelude: the default stdio */ }
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  if (!input || typeof input !== 'object') return;
  let cursorOff = false;
  try { cursorOff = prelude().cursorStandDown(input, __filename); } catch { /* no prelude: run */ }
  if (cursorOff) return;
  const start = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const ctx = contextOf(start);
  // The documented examples spell one seat 'agent-abc123' on one event and 'abc123' on another (docs-session.js
  // agentKey), so the prefix is dropped: the start's marks must reach the seat's own Reads.
  const actor = input.agent_id ? String(input.agent_id).replace(/^agent-/, '') : 'main';
  const files = recordFiles(ctx, input.session_id, actor);
  if (input.hook_event_name === 'SessionStart') {
    if (input.source === 'clear') dropRecord(files);
    else if (input.source === 'compact') {
      // The docs left the context; the run and a seat's architecture hand-over go on.
      const kept = {};
      const was = loadMarks(files);
      for (const k of ['run', 'runAt', 'runFile', 'runId', 'arch']) if (was[k] !== undefined) kept[k] = was[k];
      dropRecord(files);
      if (Object.keys(kept).length) saveMarks(files, kept);
    }
    if (input.agent_id) {
      // a seat's own compaction: the personal doc is the main session's, the seat's tool order is its own
      const tools = input.agent_type && !NO_ORDER_SEAT.test(String(input.agent_type)) ? toolsText(ctx, seatOf(ctx, input.agent_type)) : '';
      const text = [tools, hostText()].filter(Boolean).join('\n\n');
      if (text) emit('SessionStart', { additionalContext: text });
      return;
    }
    // The personal doc leads: in an output Claude Code caps, the tools line is the part to lose; the host lines are short.
    const personal = personalPush(ctx);
    const rest = [personal, toolsText(ctx, null), hostText()].filter(Boolean).join('\n\n');
    const memory = memoryText(ctx, rest ? rest.length + 2 : 0);
    const text = [rest, memory].filter(Boolean).join('\n\n');
    // A measurement, never a block (`mode`): the usage analyzer's preferences claim reads it (item 7, 2026-10-25).
    if (personal) blockRow(ctx, input, 'preferences-push', `probe: preferences-push - ${PERSONAL_DOC.file}, ${personal.length} chars`, { mode: 'probe' });
    if (text) emit('SessionStart', { additionalContext: text });
    return;
  }
  if (input.hook_event_name === 'SubagentStart') {
    const tools = NO_ORDER_SEAT.test(String(input.agent_type || '')) ? '' : toolsText(ctx, seatOf(ctx, input.agent_type));
    const main = loadMarks(recordFiles(ctx, input.session_id, 'main'));
    const seat = seatDocs(ctx, input.agent_type, runKinds(main.run, main.part).arch && runLive(main));
    const docs = seat ? seatPush(ctx, input.agent_id ? files : null, seat, seat.kind === 'architecture' ? { arch: true } : {}) : '';
    const text = [docs, tools, hostText()].filter(Boolean).join('\n\n');
    if (text) emit('SubagentStart', { additionalContext: text });
    return;
  }
  if (input.hook_event_name === 'UserPromptExpansion') {
    // A typed run emits no Skill call: it is recorded here, and a typed review is handed the code docs as a seat is.
    const run = input.agent_id ? '' : runOf(input.command_name);
    if (!run) return;
    const was = loadMarks(files);
    recordRun(was, run, input);
    saveMarks(files, was);
    if (DESIGN_RUN.test(run)) { designPush(ctx, files, was, 'UserPromptExpansion'); return; }
    if (!runKinds(run, was.part).review) return;
    const text = seatPush(ctx, files, { defs: CODE_DOCS, kind: 'code' });
    if (text) emit('UserPromptExpansion', { additionalContext: text });
    return;
  }
  if (input.hook_event_name !== 'PreToolUse') return;
  const name = String(input.tool_name || '');
  const t = input.tool_input || {};
  const cwd = typeof input.cwd === 'string' && input.cwd ? path.resolve(start, input.cwd) : start;
  const marks = loadMarks(files);
  const mark = (keys) => { const fresh = keys.filter((k) => !marks[k]); if (!fresh.length) return; for (const k of fresh) marks[k] = true; saveMarks(files, marks); };
  // Who reads against the docs: a seat by its type, the main session while a review run is on.
  const reader = () => (input.agent_id ? seatDocs(ctx, input.agent_type, !!marks.arch)
    : runKinds(marks.run, marks.part).review ? { defs: CODE_DOCS, kind: 'code' } : null);

  if (name === 'Skill') {
    const run = input.agent_id ? '' : runOf(t.skill);
    if (!run) return;
    recordRun(marks, run, input);
    saveMarks(files, marks);
    if (DESIGN_RUN.test(run)) { designPush(ctx, files, marks, 'PreToolUse'); return; }
    if (!runKinds(run, marks.part).review) return;
    const needs = codeNeeds(CODE_DOCS.map((d) => readDoc(ctx, d)).filter(Boolean), marks, [], true);
    if (!needs.length) return;
    const c = codeReason(ctx, needs, [], INLINE_CAP, true, 'review');
    // this hook refuses the call to hand the docs over, and its text says to start the review again: that refusal is the
    // run's first step, so it never ends the run the way another hook's does
    delete marks.runId;
    for (const k of c.marks) marks[k] = true;
    if (!saveMarks(files, marks)) {
      emit('PreToolUse', { additionalContext: `preferences-session could not keep its read record, so it holds nothing - read ${needs.map((n) => n.doc.rel).join(', ')} before this review.` });
      return;
    }
    blockRow(ctx, input, 'review', c.text);
    emit('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: c.text });
    return;
  }

  if (READ_PATH.has(name) || NAV_READ.test(name)) {
    if (name === 'Read') mark(readMarks(ctx, t, cwd));
    if (READ_PATH.has(name)) {
      const raw = t[READ_PATH.get(name)];
      const p = typeof raw === 'string' && raw ? real(path.resolve(cwd, raw)) : '';
      if (name === 'Read' && !p) return;
      if (p && inPrefs(ctx, p)) return;   // the docs themselves, the ancestors' included, are never held
    }
    const seat = reader();
    if (seat) seatHold(ctx, input, files, marks, seat, name === 'Grep');
    return;
  }

  let editTargets = [];
  let gitWrite = false;
  if (EDIT_TOOLS.test(name)) {
    const p = typeof t.file_path === 'string' && t.file_path ? t.file_path : typeof t.notebook_path === 'string' ? t.notebook_path : '';
    if (p) editTargets = [path.resolve(cwd, p)];
  } else if (NAV_EDIT.test(name)) {
    if (typeof t.relative_path === 'string' && t.relative_path) editTargets = [path.resolve(start, t.relative_path)];
  } else if (isShell(name) && shellReader) {
    const command = typeof t.command === 'string' ? t.command : '';
    if (!command) return;
    const targets = shellTargets(command, cwd);
    mark(shellMarks(command, targets));
    // A seat's `cat` or `grep` of code reads as its Read does (the user's ruling of 2026-10-22).
    const seat = reader();
    const reads = seat ? shellReads(ctx, command, cwd) : null;
    if (reads && seatHold(ctx, input, files, marks, seat, reads.grep)) return;
    editTargets = targets;
    gitWrite = gitWrites(command, cwd);
  } else if (/^mcp__/.test(name) && forgeLib) {
    gitWrite = mcpGitWrite(input);
    if (!gitWrite) return;
  } else return;

  const editing = editTargets.filter((p) => !exempt(ctx, p)).map((p) => relOf(ctx, p));
  const reasons = [];
  const handed = [];
  const kinds = [];
  const docsNamed = [];
  let room = INLINE_CAP;
  if (gitWrite && !marks[GIT_DOC.key]) {
    const doc = readDoc(ctx, GIT_DOC);
    if (doc && !docRead(doc, marks)) {
      const g = gitReason(doc, room);
      reasons.push(g.text); handed.push(GIT_DOC.key); kinds.push('git'); docsNamed.push(doc.rel);
      room -= g.used;
    }
  }
  if (editing.length) {
    const docs = CODE_DOCS.map((d) => readDoc(ctx, d)).filter(Boolean);
    const needs = codeNeeds(docs, marks, editing, false);
    if (needs.length && room >= CODE_MIN_ROOM) {
      const c = codeReason(ctx, needs, editing, room, room === INLINE_CAP);
      reasons.push(c.text); handed.push(...c.marks); kinds.push('code'); docsNamed.push(...needs.map((n) => n.doc.rel));
    }
  }
  if (!reasons.length) return;
  for (const k of handed) marks[k] = true;
  if (!saveMarks(files, marks)) {
    // Nowhere to keep the record: a hold here would repeat at every call, so the call passes with the docs named.
    emit('PreToolUse', { additionalContext: `preferences-session could not keep its read record, so it holds nothing - read ${docsNamed.join(', ')} before this change.` });
    return;
  }
  blockRow(ctx, input, kinds.join('+'), reasons.join('\n\n'));
  emit('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: reasons.join('\n\n') });
}

module.exports = { hostLines, parseDoc, scopeOf, clean, codeNeeds, codeReason, gitReason, gitWrites, exempt, contextOf, relOf, personalPush, seatPush, seatDocs, shellMarks, shellReads, memoryLine, CODE_DOCS, GIT_DOC, PERSONAL_DOC, INLINE_CAP, PUSH_CAP, MEMORY_ROOM };
if (require.main === module) {
  try { main(); } catch { /* fail open: a hand-over hook never blocks on its own error */ }
}
