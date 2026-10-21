#!/usr/bin/env node
// preferences-session.js - PreToolUse (Read|Write|Edit|MultiEdit|NotebookEdit, the navigation server's two edit tools and
// the shell route) + SessionStart + SubagentStart.
// The user's preferences docs under <docs-path>/preferences/ bind the work (alfred-preferences.md names them and says when
// each is read - the user's ruling of 2026-10-21: one pointer rule and this hook, nothing inlined in an always-on rule).
// A rule asks the model to read; this hook makes the read happen at the moments that need it:
//   - the FIRST file edit of each actor (the main session, and each seat by its agent_id) waits until the code docs
//     that exist were read - PERSONAL-CODE-PREFERENCES.md, ARCHITECTURE-PREFERENCES.md and the sections of
//     PROJECT-CODE-PREFERENCES.md that cover the target (a later edit a not-yet-handed section covers waits again);
//   - the FIRST git write of each actor (a call that moves the index, the tree, a ref or a stash, makes a branch, a tag
//     or a release, or a `gh pr merge` / `gh pr create`) waits until GIT-PREFERENCES.md was read;
//   - a solution designer holds no edit tool (verified against meta/seat-tools.json), so no edit hold fires for it:
//     it is handed the code docs at its SubagentStart.
// The hold HANDS THE DOCS OVER in its denial (the docs-session gate's pattern), so a retry is all it costs: the user's own
// two docs whole, then the project doc's covering and cover-less sections; the git doc read live, its locked entries first
// AS THE SEED STATES THEM (an edited copy is named, never handed over as locked). Both holds share ONE room of
// INLINE_CAP, git first; what does not fit is named as a `docs.js show` line or a Read. A doc handed over, or read WHOLE by
// the actor (a Read with no range, a `cat` of it, a `docs.js show` of each of its sections), is marked in the actor's own
// record, <data root>/state/sessions/preferences-<session>-<actor>.json - the OS temp dir when that cannot be written,
// and no hold at all (a one-line note instead) when neither can. A compaction or a /clear drops the docs from context,
// so a SessionStart with the source `compact` or `clear` deletes that actor's record (a seat's own compaction runs the
// SessionStart hooks inside the seat, with its agent_id - only its record goes).
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
const prelude = () => { try { return require('./hook-prelude.js'); } catch { return null; } };

const envOf = (env, suffix) => { const v = env[`ALFRED_CODE_${suffix}`]; return v === '' ? undefined : v; };
const dataRootRel = () => (layout ? layout.dataRoot() : String(envOf(process.env, 'DATA_PATH') || '.alfred'));
const docsRootRel = () => (layout ? layout.docsRoot() : envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`);

const PREFS = 'preferences';
// The hand-over order is the priority order: the user's own two docs first, the captured project doc after them.
const CODE_DOCS = [
  { key: 'PERSONAL-CODE', file: 'PERSONAL-CODE-PREFERENCES.md' },
  { key: 'ARCHITECTURE', file: 'ARCHITECTURE-PREFERENCES.md' },
  { key: 'PROJECT-CODE', file: 'PROJECT-CODE-PREFERENCES.md', sectioned: true },
];
const GIT_DOC = { key: 'GIT', file: 'GIT-PREFERENCES.md' };
const PERSONAL_DOC = { key: 'PERSONAL', file: 'PERSONAL-PREFERENCES.md' };
// preferences.js caps the doc at 3,000 chars; the push cuts a hand-edited one a little past that, at a line or a word.
const PUSH_CAP = 3200;
const ALL_DOCS = [...CODE_DOCS, GIT_DOC];
// The pasted text's budget, ONE room for both holds of a call (git first); the frame lines around it stay under 1,000
// more, so a denial stays under Claude Code's 10,000-char hook output cap. preferences.js caps the edit hold's two docs
// and the git doc at 5,000 each, so each fits whole on its own and the git doc leaves the code docs room beside it.
const INLINE_CAP = 7000;
// Under this much room left after the git doc, the code docs wait for the retry instead of being named in a crumb.
const CODE_MIN_ROOM = 1000;
const DOC_READ_BYTES = 512 * 1024;
const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// The navigation server's two edit tools the stack keeps on - both routes' spellings (docs-session.js NAV_EDIT).
const NAV_EDIT = /^mcp__(?:plugin_(?:alfred-)?navigation_)?(?:alfred-)?navigation__(?:rename_symbol|safe_delete_symbol)$/;
// A reader that prints the whole file, and the words that cut what a reader prints (a pipe into head reads a peek).
const WHOLE_READER = /^(?:cat|bat|less|more|nl|type|get-content|gc)$/i;
const PARTIAL_WORD = /^(?:head|tail|grep|egrep|fgrep|rg|sed|awk|wc|cut|select-string|sls|select-object)$/i;
const PARTIAL_FLAG = /^-(?:TotalCount|Head|Tail|First|Last)$/i;
const DESIGNER = /(?:^|:)[\w-]*solution-designer$/;
// The locked keys the seed carries, for an install whose seed is not beside this hook.
const KNOWN_LOCKED = /^(?:consent|scope|checkpoint|safety)$/;
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
  return {
    home, bases, prefs: prefsAt(home), prefsDirs,
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
  return null;
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
// `##` entries, their comment lines (id, covers, locked) read from just under the heading; a fenced block is text.
function parseDoc(text) {
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
    return {
      heading, id, mark: id || heading.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''),
      covers: ((/<!--\s*covers:\s*(.*?)\s*-->/.exec(meta) || [])[1] || '').split(/[,\s]+/).filter(Boolean),
      locked: (/<!--\s*locked:\s*([a-z][a-z-]*)\s*-->/.exec(meta) || [])[1] || '',
      text: clean(body.join('\n')),
      rules: squash(clean(body.slice(1).join('\n'))),
    };
  });
  return { preamble: clean(lines.slice(0, heads.length ? heads[0] : lines.length).join('\n')), sections };
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
const coversAny = (s, targets) => s.covers.length > 0 && targets.some((t) => s.covers.some((g) => globRe(g).test(t)));
// What of the code docs this edit still needs: the user's two docs unread, and the project doc's covering and cover-less
// sections not yet handed. `all` (a designer) takes every section.
function codeNeeds(docs, marks, targets, all) {
  const needs = [];
  for (const d of docs) {
    if (!d.sectioned) { if (!docRead(d, marks)) needs.push({ doc: d }); continue; }
    if (marks[d.key]) continue;
    const { sections } = parseDoc(d.text);
    if (!sections.length) { needs.push({ doc: d }); continue; }
    const want = sections.filter((s) => (all || coversAny(s, targets) || !s.covers.length) && !marks[`${d.key}#${s.mark}`]);
    if (want.length) needs.push({ doc: d, want, fresh: !sections.some((s) => marks[`${d.key}#${s.mark}`]) });
  }
  return needs;
}

// ---- the hand-overs -----------------------------------------------------------------------------------------------
const PRECEDENCE = 'they rank above every skill and house convention; where an entry and another instruction disagree, ask the user which wins, the entry\'s side marked (Recommended) - a seat names the clash in its report and carries on with the entry\'s side';

// The code docs in `room`: returns the text parts, the named refs and the marks earned. A doc or section is marked when it
// was pasted whole, or - in a room nothing else shared - when it was cut or named because it can never fit.
function codeParts(ctx, needs, room, fullRoom, label) {
  const parts = [];
  const named = [];
  const marks = [];
  for (const n of needs) {
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
    const { preamble, sections } = parseDoc(d.text);
    const head = n.fresh && preamble ? preamble : '';
    const pasted = [];
    let left = room - title.length - (head ? head.length + 2 : 0);
    for (const s of n.want) {
      if (s.text.length + 2 <= left) { pasted.push(s.text); left -= s.text.length + 2; marks.push(`${d.key}#${s.mark}`); continue; }
      if (!pasted.length && left > 400) { pasted.push(cut(s.text, left, d.rel)); left = 0; }
      else named.push(refOf(ctx, d, s));
      if (fullRoom) marks.push(`${d.key}#${s.mark}`);
    }
    if (n.fresh) for (const s of sections) if (!n.want.includes(s)) named.push(refOf(ctx, d, s));
    if (pasted.length) {
      const t = `--- ${d.file} (${d.rel})${label ? ` - ${label}` : ''} ---`;
      const body = [head, ...pasted].filter(Boolean).join('\n\n');
      parts.push('', t, body);
      room -= t.length + body.length + 2;
    }
  }
  return { parts, named, marks, used: parts.reduce((k, p) => k + p.length + 1, 0) };
}

function codeReason(ctx, needs, targets, room, fullRoom) {
  const target = targets[0] || '';
  const c = codeParts(ctx, needs, room, fullRoom, target ? `the sections for ${target}` : '');
  const sectioned = needs.find((n) => n.doc.sectioned);
  const text = [
    `Before changing ${target || 'code'}, read the user's code preferences - ${PRECEDENCE}:`,
    ...c.parts,
    ...(c.named.length ? ['', `Not pasted here - read before a change it bears on: ${nameList(c.named, (sectioned || needs[0]).doc.rel)}.`] : []),
    '', 'Follow them for this change and every later one; now make the change.',
  ].join('\n');
  return { text, marks: c.marks, used: c.used };
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
function blockRow(ctx, input, kind, reason) {
  try {
    const dir = layout ? layout.statsPath(ctx.home, ['hook-blocks']) : path.resolve(ctx.home, dataRootRel(), 'statistics', 'hook-blocks');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${safe(input.session_id)}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'preferences-session.js', event: input.hook_event_name || '', tool: input.tool_name || '', kind, reason: String(reason).split('\n')[0].slice(0, 200) })}\n`);
  } catch {}
}

// ---- what a call does ---------------------------------------------------------------------------------------------
const docOfPath = (ctx, abs) => {
  const P = fold(real(abs));
  const rel = relOf(ctx, abs);
  return ALL_DOCS.find((d) => ctx.prefsDirs.some((dir) => fold(real(path.join(dir, d.file))) === P)
    || (rel !== null && fold(rel) === fold(`${ctx.docsRel}/${PREFS}/${d.file}`))) || null;
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
  try {
    for (const w of shellReader.commandWords(read.command, read.parsed)) {
      if (w.name !== 'gh') continue;
      if (w.argv[0] === 'pr' && /^(?:merge|create)$/.test(w.argv[1] || '')) return true;
      if (w.argv[0] === 'release' && /^(?:create|edit|delete|upload|delete-asset)$/.test(w.argv[1] || '')) return true;
    }
  } catch { /* no word list: the git calls above decide */ }
  return false;
}
function shellTargets(command, cwd) {
  try {
    const scan = shellReader.scanShell(String(command), {});
    return scan.targets.filter((t) => !t.unknown).map((t) => scan.expandVars(String(t.raw || '')).replace(/^['"]|['"]$/g, ''))
      .filter((t) => t && !t.includes('$') && !t.startsWith('/dev/')).map((t) => path.resolve(cwd, t));
  } catch { return []; }
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

// A solution designer's start: the code docs it designs against, every section of the project doc as far as it fits.
function designerPush(ctx) {
  const docs = CODE_DOCS.map((d) => readDoc(ctx, d)).filter(Boolean);
  if (!docs.length) return '';
  const needs = codeNeeds(docs, {}, [], true);
  if (!needs.length) return '';
  const c = codeParts(ctx, needs, INLINE_CAP, true, '');
  const sectioned = needs.find((n) => n.doc.sectioned);
  return [
    `The user's code preferences - ${PRECEDENCE}. Name the entry id in each decision it shapes:`,
    ...c.parts,
    ...(c.named.length ? ['', `Not pasted here - read before a decision it bears on: ${nameList(c.named, (sectioned || needs[0]).doc.rel)}.`] : []),
  ].join('\n');
}

function emit(event, extra) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...extra } }));
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
  const actor = String(input.agent_id || 'main');
  const files = recordFiles(ctx, input.session_id, actor);
  if (input.hook_event_name === 'SessionStart') {
    if (input.source === 'compact' || input.source === 'clear') dropRecord(files);
    if (input.agent_id) return;   // a seat's own compaction: the personal doc is the main session's
    const text = personalPush(ctx);
    if (text) emit('SessionStart', { additionalContext: text });
    return;
  }
  if (input.hook_event_name === 'SubagentStart') {
    if (!DESIGNER.test(String(input.agent_type || ''))) return;
    const text = designerPush(ctx);
    if (text) emit('SubagentStart', { additionalContext: text });
    return;
  }
  if (input.hook_event_name !== 'PreToolUse') return;
  const name = String(input.tool_name || '');
  const t = input.tool_input || {};
  const cwd = typeof input.cwd === 'string' && input.cwd ? path.resolve(start, input.cwd) : start;
  const marks = loadMarks(files);
  const mark = (keys) => { const fresh = keys.filter((k) => !marks[k]); if (!fresh.length) return; for (const k of fresh) marks[k] = true; saveMarks(files, marks); };

  if (name === 'Read') { mark(readMarks(ctx, t, cwd)); return; }

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
    editTargets = targets;
    gitWrite = gitWrites(command, cwd);
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

module.exports = { parseDoc, clean, codeNeeds, codeReason, gitReason, gitWrites, exempt, contextOf, relOf, personalPush, designerPush, shellMarks, CODE_DOCS, GIT_DOC, PERSONAL_DOC, INLINE_CAP, PUSH_CAP };
if (require.main === module) {
  try { main(); } catch { /* fail open: a hand-over hook never blocks on its own error */ }
}
