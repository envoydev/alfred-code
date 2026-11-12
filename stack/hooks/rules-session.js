#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// rules-session.js - the rule loader: the rules in `.alfred/stack/rules` (and each workspace member's) sent as context.
// Five SessionStart and five SubagentStart rows (`--part 1`-`5`) each send one part of the always-on rules; one
// PostToolUse row sends a path rule the first time a touched file matches its `paths:`, and a joined member's block. No store: nothing.
// The plugin copy yields to a copied twin by event and matcher only, never by `--part` (hook-prelude.js).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them. Required inside main only: loading it
// changes the process, and scripts require this file.
const loadPrelude = () => { try { return require(path.join(__dirname, 'hook-prelude.js')); } catch { return null; } };

const PART_ROOM = 9500;   // under the 10,000-character cap on one hook's context (stage 0, P1)
const RULE_PARTS = 5;
// meta/recommendations.json `always.rules`, which the installer locks; lint holds the two lists equal.
const LOCKED_RULES = Object.freeze(['alfred-docs-root', 'alfred-interaction', 'alfred-navigation', 'alfred-preferences',
    'alfred-quality-gates', 'alfred-security', 'markdown-docs']);
const NO_RULES_SEAT = /^(Explore|Plan)$/;   // the built-in types load no project rule (stage 0, P8)

// What the model is sent of a rule: Claude Code drops the frontmatter and block-level HTML comments, a fenced one
// kept (code.claude.com/docs/en/memory). Lint check 33 counts the always-on surface with this same function.
function render(text)
{
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    if (lines[0] === '---')
    {
        const end = lines.indexOf('---', 1);
        if (end > 0) i = end + 1;
    }
    const out = [];
    let fence = null;
    let inComment = false;
    const afterClose = (line) => line.slice(line.indexOf('-->') + 3);
    for (; i < lines.length; i++)
    {
        const line = lines[i];
        if (inComment)
        {
            if (!line.includes('-->')) continue;
            inComment = false;
            if (afterClose(line).trim()) out.push(afterClose(line));
            continue;
        }
        const f = /^\s*(```|~~~)/.exec(line);
        if (f)
        {
            if (!fence) fence = f[1];
            else if (line.trim().startsWith(fence)) fence = null;
            out.push(line);
            continue;
        }
        if (!fence && /^\s*<!--/.test(line))
        {
            if (!line.includes('-->')) inComment = true;
            else if (afterClose(line).trim()) out.push(afterClose(line));
            continue;
        }
        out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The frontmatter's `paths:` as a list: an inline `["a", "b"]`, a scalar or `- item` lines; [] when there is none.
function pathsOf(text)
{
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
    const m = fm && /^paths:[ \t]*(.*)((?:\r?\n[ \t]*-.*)*)/m.exec(fm[1]);
    if (!m) return [];
    const inline = m[1].trim();
    const list = /^\[(.*)\]$/.exec(inline);
    const items = !inline ? m[2].split(/\r?\n/).map((l) => l.replace(/^\s*-/, '')) : list ? list[1].match(/"[^"]*"|'[^']*'|[^,]+/g) || [] : [inline];
    return items.map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
}

// A glob as an anchored RegExp (`**/` any folders, a trailing `/**` all below, `*` within a segment); null on ? [ { !
function pathGlob(glob)
{
    const g = String(glob);
    if (/[?[{!]/.test(g)) return null;
    let re = '';
    for (let i = 0; i < g.length;)
    {
        if (g.startsWith('**/', i)) { re += '(?:.*/)?'; i += 3; }
        else if (g.slice(i) === '/**') { re += '/.*'; i = g.length; }
        else if (g[i] === '*') { re += '[^/]*'; i += 1; }
        else { re += g[i].replace(/[.+^$()|\\\]}]/, '\\$&'); i += 1; }
    }
    return new RegExp(`^${re}$`);
}

const opening = (k, n) => `Project rules, part ${k} of ${n} - binding instructions for this project`;
const closing = (k, n) => `End of project rules, part ${k} of ${n}`;
const BASE = opening(1, 1).length + closing(1, 1).length + 2;   // k and n stay one digit, so the room never moves
const headingOf = (r, more) => `## ${r.name} (${r.rel})${more ? ' - continued' : ''}`;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

// A rule too long for one part, cut at line ends (a single longer line at the room) into chunks of a part each.
function cut(r, lead)
{
    const chunks = [];
    for (let rest = r.text; rest;)
    {
        const head = headingOf(r, chunks.length > 0);
        const room = PART_ROOM - BASE - lead - head.length - 3;
        const at = rest.length <= room ? rest.length : rest.lastIndexOf('\n', room);
        const end = at > 0 ? at : room;
        chunks.push({ rel: r.rel, text: `${head}\n${rest.slice(0, end)}` });
        rest = rest.slice(rest[end] === '\n' ? end + 1 : end);
    }
    return chunks;
}

// The always-on rules in 1 to RULE_PARTS parts: a cut rule's chunks alone, the rest first fit, largest first, ties by
// name. Past part 5 a rule is unsent, and so is part 5's last block while the unsent line has no room beside it.
function parts(always, { natives = [] } = {})
{
    const nativeLine = natives.length ? `loaded natively: ${natives.join(', ')}` : '';
    const lead = nativeLine ? nativeLine.length + 2 : 0;
    const packed = [];
    const open = (own) => packed[packed.push({ blocks: [], own, used: BASE + (packed.length ? 0 : lead) }) - 1];
    const add = (p, b) => { p.blocks.push(b); p.used += b.text.length + 2; };
    const blocks = [];
    for (const r of [...always].sort(byName))
    {
        const text = `${headingOf(r)}\n${r.text}`;
        if (BASE + lead + text.length + 2 <= PART_ROOM) blocks.push({ rel: r.rel, name: r.name, text });
        else for (const chunk of cut(r, lead)) add(open(true), chunk);
    }
    blocks.sort((a, b) => b.text.length - a.text.length || byName(a, b));
    for (const b of blocks) add(packed.find((q) => !q.own && q.used + b.text.length + 2 <= PART_ROOM) || open(false), b);
    if (!packed.length) open(false);
    const unsent = new Set(packed.slice(RULE_PARTS).flatMap((p) => p.blocks.map((b) => b.rel)));
    const kept = packed.slice(0, RULE_PARTS);
    const last = kept[kept.length - 1];
    const unsentLine = () => `Not sent - past part 5: ${[...unsent].sort().join(', ')}`;
    while (unsent.size && last.blocks.length && last.used + unsentLine().length + 2 > PART_ROOM)
    {
        const b = last.blocks.pop();
        last.used -= b.text.length + 2;
        unsent.add(b.rel);
    }
    const n = kept.length;
    const out = kept.map((p, i) => [opening(i + 1, n), i === 0 && nativeLine, ...p.blocks.map((b) => b.text),
        i === n - 1 && unsent.size && unsentLine(), closing(i + 1, n)].filter(Boolean).join('\n\n'));
    return { parts: out, unsent: [...unsent].sort() };
}

const RULES = ['.alfred', 'stack', 'rules'];
const STAMP = ['.claude', 'alfred-code.stamp'];
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const mdFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return []; } };
const posix = (from, to) => path.relative(from, to).split(path.sep).join('/');

// The first checkout holding `.alfred`; with no install record in them, the nearest stamped folder above; else null.
function projectOf(start, prelude)
{
    const roots = prelude.checkoutsOf(start);
    const found = roots.find((d) => isDir(path.join(d, '.alfred')));
    if (found || roots.some((d) => prelude.INSTALL_RECORDS.some((r) => fs.existsSync(path.join(d, '.claude', ...r))))) return found || null;
    const home = require('node:os').homedir();
    for (let at = path.dirname(roots[roots.length - 1]); at !== path.dirname(at) && at !== home; at = path.dirname(at))
        if (fs.existsSync(path.join(at, ...STAMP))) return at;
    return null;
}

// The rules for a session or seat started in `start`: each holder's (the project, then its workspace members) store
// rules, the nearest holder winning by name, a native `.claude/rules` file at one holder first (Claude Code only).
function rulesFor(start, env = process.env, { host = 'claude' } = {})
{
    const prelude = loadPrelude();
    const layout = require(path.join(__dirname, 'layout.js'));
    let from = path.resolve(start);
    try { from = fs.realpathSync.native(from); } catch { /* as given */ }
    const out = { project: projectOf(from, prelude), hasStore: false, always: [], scoped: [], natives: [], notes: [] };
    if (!out.project) return out;
    const chain = layout.workspaceChain(out.project, { env });   // the switch off freezes the chain, never cuts it (4c review I3)
    const holders = [{ root: out.project, ignores: chain ? chain.ignores : [] }, ...(chain ? chain.members : [])];
    out.hasStore = holders.some((h) => isDir(path.join(h.root, ...RULES)));
    if (!out.hasStore) return out;
    const won = new Map();
    holders.forEach((h, depth) =>
    {
        if (host === 'claude') for (const f of mdFiles(path.join(h.root, '.claude', 'rules'))) if (!won.has(f)) won.set(f, null);
        for (const f of mdFiles(path.join(h.root, ...RULES)))
        {
            const file = path.join(h.root, ...RULES, f);
            const rel = posix(from, file);
            let st;
            try { st = fs.lstatSync(file); } catch { continue; }
            if (st.isSymbolicLink() || st.size > 65536) out.notes.push(`rule skipped: ${rel} - ${st.isSymbolicLink() ? 'a link' : 'over 64 KB'}`);
            else if (st.isFile() && !won.has(f)) won.set(f, { name: f.slice(0, -3), file, rel, root: h.root, depth });
        }
    });
    const picks = (dir, key) =>
    {
        try { return (new RegExp(`^${key}: (.*)$`, 'm').exec(fs.readFileSync(path.join(dir, ...STAMP), 'utf8')) || [])[1]?.split(',') || []; }
        catch { out.notes.push(`stamp not read: ${posix(from, path.join(dir, ...STAMP)) || '.'}`); return []; }
    };
    const top = chain && chain.members.length ? holders.length - 1 : -1;
    const memberPicks = top > 0 ? picks(holders[top].root, 'member-picks') : [];
    const picked = memberPicks.length ? holders.slice(0, top).flatMap((h) => picks(h.root, 'own-picks')) : [];
    for (const [f, r] of won)
    {
        if (!r) { out.natives.push(f.slice(0, -3)); continue; }
        const ignored = holders.slice(0, r.depth).some((h) => h.ignores.some((i) => i.category === 'rule' && i.name === r.name));
        if (ignored && LOCKED_RULES.includes(r.name)) out.notes.push(`ignore rule ${r.name} not honoured: the rule is locked`);
        else if (ignored) continue;
        const pick = `rule/${r.name}`;
        if (r.depth === top && memberPicks.includes(pick) && !picked.includes(pick)) continue;
        let raw;
        try { raw = fs.readFileSync(r.file, 'utf8'); } catch { out.notes.push(`rule skipped: ${r.rel} - not read`); continue; }
        const rule = { name: r.name, file: r.file, rel: r.rel, root: r.root, text: render(raw), globs: pathsOf(raw) };
        for (const g of rule.globs) if (!pathGlob(g)) out.notes.push(`glob not matched: ${g} in ${rule.rel}`);
        (rule.globs.length ? out.scoped : out.always).push(rule);
    }
    for (const list of [out.always, out.scoped, out.natives]) list.sort((a, b) => byName({ name: a.name || a }, { name: b.name || b }));
    return out;
}

// The touched file's path for a rule's globs: from the rule's project, else from its own checkout; else null.
function relFor(file, root)
{
    const inRoot = path.relative(root, file);
    if (inRoot && !inRoot.startsWith('..') && !path.isAbsolute(inRoot)) return inRoot.split(path.sep).join('/');
    for (let at = path.dirname(file); at !== path.dirname(at); at = path.dirname(at)) if (fs.existsSync(path.join(at, '.git'))) return posix(at, file);
    return null;
}

const recordOf = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).sent || []; } catch { return []; } };
function writeRecord(file, sent)
{
    const tmp = `${file}.${process.pid}.tmp`;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify({ sent })); fs.renameSync(tmp, file); }
    catch { try { fs.unlinkSync(tmp); } catch { /* none written */ } }
}

// Unsent path rules matching the file, whole, to `room`; one that alone passes a whole room is cut and counts as sent.
function pathPush(rules, file, sent, room = PART_ROOM, keyOf = (r) => r.name)
{
    let text = 'Project path rules - binding instructions for this project';
    const now = [];
    for (const r of rules.scoped)
    {
        const rel = sent.includes(keyOf(r)) ? null : relFor(file, r.root);
        if (rel === null || !r.globs.some((g) => { const re = pathGlob(g); return re && re.test(rel); })) continue;
        const block = `\n\n${headingOf(r)}\n${r.text}`;
        if (text.length + block.length <= room) { text += block; now.push(keyOf(r)); continue; }
        if (now.length || room < PART_ROOM) continue;
        return { text: text + cutTo(block, room - text.length, r.rel), now: [keyOf(r)] };
    }
    return { text, now };
}

// A block cut at a line end (else at the room) so it and the line naming the rest fit `room` characters.
const cutTo = (block, room, rel, tail = `\n(cut at ${PART_ROOM} characters - read ${rel} for the rest)`, at = block.lastIndexOf('\n', room - tail.length)) =>
    block.slice(0, at > 1 ? at : room - tail.length) + tail;
// A joined member's block in sending order: its head (lines 1 to 6), then its own always-on rules, largest first.
function memberBlock(m, from, held, mine, layout)
{
    const [T, dr, at] = [posix(from, m.root), layout.docsRootOf(m.root), (...p) => posix(from, path.join(m.root, ...p))];
    const doc = ['AGENTS.md', 'CLAUDE.md'].find((f) => fs.existsSync(path.join(m.root, f)));
    const gen = mdFiles(path.join(m.root, '.claude', 'rules')).map((f) => at('.claude', 'rules', f)).join(', ');
    const [has, swap] = [[...mine.always, ...mine.scoped].map((r) => r.name).concat(mine.natives), [...held.always.map((r) => r.name), ...held.natives]];
    const out = held.always.filter((r) => !path.relative(r.root, m.root).startsWith('..') && !has.includes(r.name)).map((r) => r.name).join(', ');
    const head = [`Rules and data of ${T}. Binding for work under ${T}, in addition to the workspace's rules.`,
        doc && `Instructions of this project: ${at(doc)} - Read it before working here, unless it is already in your context.`,
        gen && `Rule files of this project: ${gen} - Read each one that is not already in your context before working here.`,
        isDir(dr) && `Docs of this project: ${posix(from, dr)} - read its map before designing or editing here.`,
        isDir(`${dr}/preferences`) && `Preferences of this project: ${posix(from, dr)}/preferences - for files under ${T} they come before the workspace's.`,
        out && `This project leaves out: ${out} - do not apply them to files under ${T}.`].filter(Boolean).join('\n');
    return [{ name: '#head', text: head }, ...mine.always.filter((r) => r.root === m.root).map((r) => ({ name: r.name, rel: r.rel,
        text: `${headingOf(r)}${swap.includes(r.name) ? ` - replaces the workspace's rule of this name for files under ${T}` : ''}\n${r.text}` }))
        .sort((a, b) => b.text.length - a.text.length || byName(a, b))];
}

// The next part of a member's block, claimed by the exclusive marker `<base>-<k>` (none when `base` is null), or null.
function memberPart(T, items, base, room, who)
{
    let [k, marks] = [1, []];
    for (let t; base && k <= RULE_PARTS; k++, marks = marks.concat(t.split('\n')))   // an empty marker: another call is mid-claim
    { try { t = fs.readFileSync(`${base}-${k}`, 'utf8'); } catch { break; } if (!t) return null; }
    const todo = items.filter((i) => !marks.includes(i.name));   // a marker line opening with '/' names no item
    if (!todo.length || k > RULE_PARTS) return null;
    const rest = (take) => todo.slice(take.length).map((i) => i.rel).sort().join(', ');
    const build = (take, more, last) => [`Project ${T}, part ${k}`, ...take.map((i) => i.text), last && `Not sent - past part 5: ${rest(take)}`,
        `End of project ${T}, part ${k} - ${more ? `more follows on the next file touch under ${T}` : 'complete'}`].filter(Boolean).join('\n\n');
    let take = build(todo).length <= room ? todo : todo.filter((_, n) => build(todo.slice(0, n + 1), true).length <= room);
    if (!take.length && room < PART_ROOM) return null;
    if (!take.length) take = [{ ...todo[0], text: cutTo(todo[0].text, room - build([], true).length - 2, todo[0].rel) }];
    const last = k === RULE_PARTS && take.length < todo.length;
    while (last && take.length > 1 && build(take, false, true).length > room) take = take.slice(0, -1);
    const text = build(take, !last && take.length < todo.length, last);
    const mark = [`/ ${T} ${text.length} ${who}`, last && `/ not sent: ${rest(take)}`, ...take.map((i) => i.name), ''].filter((l) => l !== false);
    if (base) try { fs.mkdirSync(path.dirname(base), { recursive: true }); fs.writeFileSync(`${base}-${k}`, mark.join('\n'), { flag: 'wx' }); }
    catch (e) { if (e.code === 'EEXIST' && e.syscall === 'open') return null; }   // another call claimed it; else the part goes unrecorded
    if (base) loadPrelude()?.sweepStale(path.dirname(base), 'rules-');
    return { k, text, left: todo.length - take.length };
}

function main(argv = process.argv, env = process.env)
{
    const prelude = loadPrelude();
    if (prelude) prelude.blockingStdio();
    let input;
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || 'null'); } catch { return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    // GATE 6 (hook-prelude.js): this hook answers Cursor in its own shape, so the prelude lets it through.
    if (prelude && prelude.cursorStandDown(input, __filename)) return;
    const at = argv.indexOf('--part');
    const part = at < 0 ? 0 : Number(argv[at + 1]);
    if (at >= 0 && !(Number.isInteger(part) && part >= 1 && part <= 5)) return;
    const cursor = Boolean(prelude && prelude.cursorHost(input));
    const event = String(input.hook_event_name || '');
    const kind = event.charAt(0).toUpperCase() + event.slice(1);
    if (part ? !['SessionStart', 'SubagentStart'].includes(kind) : kind !== 'PostToolUse') return;
    if (NO_RULES_SEAT.test(String(input.agent_type || '')) || (cursor && kind === 'SubagentStart')) return;
    const start = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const rules = rulesFor(start, env, { host: cursor ? 'cursor' : 'claude' });
    if (!rules.hasStore) return;
    const safe = (id) => (prelude ? prelude.safeSession(id) : String(id).replace(/[^\w.-]/g, '_'));
    const sid = (cursor && input.conversation_id) || input.session_id;   // Cursor's tool events carry the conversation alone
    const session = sid ? safe(sid) : null;
    const actor = safe(String(input.agent_id || 'main').replace(/^agent-/, ''));
    const layout = require(path.join(__dirname, 'layout.js'));
    const record = session && layout.statePath(rules.project, 'sessions', `rules-${session}-${actor}.json`, env);
    const say = (text) => text && process.stdout.write(JSON.stringify(cursor ? { additional_context: text }
        : { hookSpecificOutput: { hookEventName: kind, additionalContext: text } }));
    const ledger = (row, dir = layout.statsPath(rules.project, ['hook-blocks'], env)) => { if (session) try { fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${session}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'rules-session.js', event,
            mode: 'probe', ...row, agent: actor })}\n`); } catch { /* the row is a probe */ } };
    if (!part)
    {
        const tool = input.tool_input || {};
        const target = tool.file_path || tool.notebook_path;
        if (typeof target !== 'string' || !target) return;
        const file = layout.realpathOrSelf(path.resolve(input.cwd || start, target));   // as real as the roots
        const [from, texts, who] = [layout.realpathOrSelf(path.resolve(start)), [], `${session} ${actor}`];
        const chain = layout.memberOf(file, start, { env })?.chain || [];
        const room = () => texts.reduce((n, t) => n - 2 - t.length, PART_ROOM);
        let own = rules;   // the touched member's rules match its file (Task 4), each keyed by its holder in the chain
        for (const m of chain)
        {
            const [mine, T] = [own = rulesFor(m.root, env, { host: cursor ? 'cursor' : 'claude' }), posix(from, m.root)];
            for (const r of [...mine.always, ...mine.scoped]) r.rel = posix(from, r.file);
            const base = session && layout.statePath(rules.project, 'sessions', `rules-${session}-${actor}-m-${m.key}`, env);
            const p = memberPart(T, memberBlock(m, from, rules, mine, layout), base, room(), who);
            if (p && texts.push(p.text)) ledger({ kind: 'member-push', member: T, part: p.k, chars: p.text.length, unsent: p.left, tool: input.tool_name });
        }
        const sent = record ? recordOf(record) : [];
        const push = pathPush(own, file, sent, room(), (r, c = chain.find((x) => x.root === r.root)) => (c ? `${c.key}/${r.name}` : r.name));
        if (record && push.now.length) writeRecord(record, [...sent, ...push.now]);
        return void say([...texts, push.now.length && push.text].filter(Boolean).join('\n\n'));
    }
    if (['resume', 'fork'].includes(input.source)) return;
    const out = parts(rules.always, { natives: rules.natives });
    const stale = (f) => f === path.basename(record) || f.startsWith(`rules-${session}-${actor}-m-`);   // the record and its member markers
    if (part === 1 && record && ['compact', 'clear'].includes(input.source))
        try { for (const f of fs.readdirSync(path.dirname(record)).filter(stale)) fs.unlinkSync(path.join(path.dirname(record), f)); } catch { /* none yet */ }
    if (part === 1) ledger({ kind: 'rules-push', chars: out.parts.join('').length, parts: out.parts.length, unsent: out.unsent.length });
    say(out.parts[part - 1]);
}

module.exports = { PART_ROOM, RULE_PARTS, LOCKED_RULES, NO_RULES_SEAT, render, pathsOf, pathGlob, parts, rulesFor, memberBlock, memberPart, main };
if (require.main === module)
{
    const prelude = loadPrelude();
    // The empty argv: `--part` is no CLI call. setUp: false: a never set-up repository below a stamped root is served.
    try { if (!(prelude && prelude.standDown('rules-session', process.env, [], { setUp: false }))) main(); } catch { /* fail open */ }
    process.exit(0);
}
