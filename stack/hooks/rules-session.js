#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// rules-session.js - the rule loader: the rules in `.alfred/stack/rules` (and each workspace member's) sent as context.
// A SessionStart and a SubagentStart row (`--part 1`) send part 1 alone on Claude Code: the always-on rules it does not load
// itself (a store rule with no same-name file in .claude/rules yet), the members index, and the notes an update clears; its
// `--part 2`-`5` rows print nothing. A Cursor payload, which reads no .claude/rules and sends no touch event, gets every rule
// (path rules with their globs named) and each member's rules in up to five parts at SessionStart. No store: nothing.
// The plugin copy yields to a copied twin by event and matcher only, never by `--part` (hook-prelude.js).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them. Required inside main only: loading it
// changes the process, and scripts require this file.
const loadPrelude = () => { try { return require(path.join(__dirname, 'hook-prelude.js')); } catch { return null; } };

const PART_ROOM = 9900;   // under the 10,000-character cap on one hook's context (stage 0, P1: 10,000 arrive whole); 100 spare
const RULE_PARTS = 5;
// meta/recommendations.json `always.rules`, which the installer locks; lint holds the two lists equal.
const LOCKED_RULES = Object.freeze(['alfred-docs-root', 'alfred-interaction', 'alfred-navigation', 'alfred-preferences',
    'alfred-quality-gates', 'alfred-security', 'markdown-docs']);
const NO_RULES_SEAT = /^(Explore|Plan)$/;   // the built-in types load no project rule (stage 0, P8)
// The members index a root's start opens part 1 with: a line a child, at most MEMBER_LINES of them and MEMBER_CHARS in all.
const MEMBER_LINES = 12;
const MEMBER_CHARS = 1500;
const MEMBER_HEAD = 'Workspace members - before you plan or edit inside one, Read its instructions. Its rule files load natively when the session works in that folder; a Cursor start sends them here.';
const MEMBER_MORE = (left) => `- and ${left} more (the workspace record lists them)`;
const MEMBER_MORE_LINE = /^- and \d+ more \(/;
const UPDATE_HINT = 'Rules not yet in .claude/rules - run /alfred-code:update so Claude Code loads them itself.';
const SEATS_MOVED = 'The stack\'s agents moved out of the plugin - run /alfred-code:update to link this project\'s picks; until then no alfred-code seat dispatches here.';
const SEATS_ROUTE_PLUGIN = /^seats-route: plugin$/m;
const INSTRUCTION_FILES = Object.freeze([['AGENTS.md'], ['CLAUDE.md'], ['.claude', 'AGENTS.md'], ['.claude', 'CLAUDE.md']]);
const RULE_FILES = ['.claude', 'rules'];

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

// A glob as an anchored RegExp, the way Claude Code matches a rule's paths: `**/` any folders, a trailing `/**` all below,
// `*` and `?` within a segment, `[...]` a class, `{a,b}` (nested too) either, a leading `/` the rule's own folder;
// null on a negation or an unclosed brace or class.
function pathGlob(glob)
{
    const g = String(glob).replace(/^\//, '');
    if (g.startsWith('!')) return null;
    let depth = 0;
    let re = '';
    for (let i = 0; i < g.length;)
    {
        if (g.startsWith('**/', i)) { re += '(?:.*/)?'; i += 3; }
        else if (g.slice(i) === '/**') { re += '/.*'; i = g.length; }
        else if (g.startsWith('**', i)) { re += '.*'; i += 2; }
        else if (g[i] === '*') { re += '[^/]*'; i += 1; }
        else if (g[i] === '?') { re += '[^/]'; i += 1; }
        else if (g[i] === '[')
        {
            const end = g.indexOf(']', i + 2);
            if (end < 0) return null;
            re += `[${g.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
            i = end + 1;
        }
        else if (g[i] === '{') { re += '(?:'; depth += 1; i += 1; }
        else if (g[i] === '}' && depth) { re += ')'; depth -= 1; i += 1; }
        else if (g[i] === ',' && depth) { re += '|'; i += 1; }
        else { re += g[i].replace(/[.+^$()|\\\]}]/, (c) => `\\${c}`); i += 1; }
    }
    return depth ? null : new RegExp(`^${re}$`);
}

// The KEY LINE of a rule (card 'Layered native rules', 2026-11-23): its first sentence once the frontmatter, every HTML
// comment (one over several lines included), the headings and fenced blocks are gone - a sentence ends at '.', '!' or
// '?' before whitespace or the end, never inside a code span nor before a lowercase word - cut at KEY_LINE_CHARS with ', ...'.
const KEY_LINE_CHARS = 240;
const KEY_LINE_TAIL = ', ...';
function keyLine(text)
{
    let body = String(text).replace(/\r\n/g, '\n');
    const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(body);
    if (fm) body = body.slice(fm[0].length);
    body = body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, '');
    const prose = body.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n').trim();
    const flat = (prose.split(/\n\s*\n/)[0] || '').replace(/\s+/g, ' ').trim();
    let inCode = false;
    let end = flat.length;
    for (let i = 0; i < flat.length; i++)
    {
        if (flat[i] === '`') inCode = !inCode;
        else if (!inCode && /[.!?]/.test(flat[i]) && (i + 1 === flat.length || (flat[i + 1] === ' ' && !/[a-z]/.test(flat[i + 2] || ''))))
        { end = i + 1; break; }
    }
    const sentence = flat.slice(0, end);
    if (sentence.length <= KEY_LINE_CHARS) return sentence;
    const room = KEY_LINE_CHARS - KEY_LINE_TAIL.length;
    const cut = sentence.lastIndexOf(' ', room);
    return `${sentence.slice(0, cut > 0 ? cut : room).replace(/[,;:\s-]+$/, '')}${KEY_LINE_TAIL}`;
}

const opening = (k, n) => `Project rules, part ${k} of ${n} - binding instructions for this project`;
const closing = (k, n) => `End of project rules, part ${k} of ${n}`;
const BASE = opening(1, 1).length + closing(1, 1).length + 2;   // k and n stay one digit, so the room never moves
// A rule's heading and the lines under it: a Cursor member rule's binding line, a path rule's globs.
const headingOf = (r, more) => [`## ${r.name} (${r.rel})${more ? ' - continued' : ''}${r.note ? ` - ${r.note}` : ''}`, ...(r.lines || []),
    ...(r.globs && r.globs.length ? [`- applies to: ${r.globs.join(', ')}`] : [])].join('\n');
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

// A rule too long for one part, cut at line ends (a single longer line at the room) into chunks of a part each.
function cut(r, lead)
{
    const chunks = [];
    for (let rest = r.text; rest;)
    {
        const head = headingOf(r, chunks.length > 0);
        const room = PART_ROOM - BASE - (chunks.length ? 0 : lead) - head.length - 3;   // the lead (natives line, index) sits in part 1, with the first chunk
        const at = rest.length <= room ? rest.length : rest.lastIndexOf('\n', room);
        const end = at > 0 ? at : room;
        chunks.push({ rel: r.rel, text: `${head}\n${rest.slice(0, end)}` });
        rest = rest.slice(rest[end] === '\n' ? end + 1 : end);
    }
    return chunks;
}

// The always-on rules in 1 to `limit` (RULE_PARTS) parts: a cut rule's chunks alone but its last, the rest first fit, largest first, ties by
// name; with `limit` 1 a rule too long for the part is left out whole, never cut. Part 1 opens with the natives line and the members `index`, both counted in its room. Past the last part a rule is
// unsent, and so is that part's last block while the unsent line has no room beside it.
function parts(always, { natives = [], index = '', limit = RULE_PARTS } = {})
{
    const nativeLine = natives.length ? `loaded natively: ${natives.join(', ')}` : '';
    const lead = [nativeLine, index].reduce((room, text) => room + (text ? text.length + 2 : 0), 0);
    const packed = [];
    const open = (own) => packed[packed.push({ blocks: [], own, used: BASE + (packed.length ? 0 : lead) }) - 1];
    const add = (p, b) => { p.blocks.push(b); p.used += b.text.length + 2; };
    const blocks = [];
    const tooLong = [];
    for (const r of [...always].sort(byName))
    {
        const text = `${headingOf(r)}\n${r.text}`;
        if (BASE + lead + text.length + 2 <= PART_ROOM) blocks.push({ rel: r.rel, name: r.name, text });
        else if (limit === 1) tooLong.push(r.rel);   // one part holds no chunk of a rule it cannot hold whole, and its rest would crowd the others out
        else
        {
            // The last chunk's part takes other rules that fit beside it: a short tail alone wasted a part (2026-11-22).
            const chunks = cut(r, lead);
            chunks.forEach((chunk, i) => add(open(i < chunks.length - 1), chunk));
        }
    }
    blocks.sort((a, b) => b.text.length - a.text.length || byName(a, b));
    for (const b of blocks) add(packed.find((q) => !q.own && q.used + b.text.length + 2 <= PART_ROOM) || open(false), b);
    if (!packed.length) open(false);
    const unsent = new Set([...tooLong, ...packed.slice(limit).flatMap((p) => p.blocks.map((b) => b.rel))]);
    const kept = packed.slice(0, limit);
    const last = kept[kept.length - 1];
    const unsentLine = () => `Not sent - past part ${limit}: ${[...unsent].sort().join(', ')}`;
    while (unsent.size && last.blocks.length && last.used + unsentLine().length + 2 > PART_ROOM)
    {
        const b = last.blocks.pop();
        last.used -= b.text.length + 2;
        unsent.add(b.rel);
    }
    const n = kept.length;
    const out = kept.map((p, i) => [opening(i + 1, n), i === 0 && nativeLine, i === 0 && index, ...p.blocks.map((b) => b.text),
        i === n - 1 && unsent.size && unsentLine(), closing(i + 1, n)].filter(Boolean).join('\n\n'));
    return { parts: out, unsent: [...unsent].sort() };
}

const RULES = ['.alfred', 'stack', 'rules'];
const STAMP = ['.claude', 'alfred-code.stamp'];
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const mdFiles = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && isFile(path.join(dir, f))).sort(); } catch { return []; } };
const posix = (from, to) => path.relative(from, to).split(path.sep).join('/');

// The child folders of a workspace root's record that are folders and whose own record points back at this root (hop rule N1),
// the ignored ones out; [] when there is none or the workspace switch is 0. Never throws.
function memberChildren(project, env = process.env)
{
    try
    {
        const layout = require(path.join(__dirname, 'layout.js'));
        const file = require(path.join(__dirname, 'workspace-file.js'));
        if (!layout.workspaceOn({ env, projectRoot: project })) return [];
        const read = file.readRecord(path.join(project, layout.dataRootOf(project, { env })));
        const view = file.viewOf(read.state === 'ok' ? read.record : file.emptyRecord());
        const pointsBack = (child) => { const first = layout.workspaceChain(path.join(project, child), { env }).members[0]; return !!first && layout.pathKey(first.root) === layout.pathKey(project); };
        return view.children.filter((c) => isDir(path.join(project, c)) && pointsBack(c));
    }
    catch { return []; }
}

// The members index of a workspace root: one line a child (memberChildren), naming the instruction file and the count of
// rule files under it; '' when there is no such child. Never throws.
function memberIndex(project, env = process.env)
{
    const lines = memberChildren(project, env).map((c) =>
    {
        const instructions = INSTRUCTION_FILES.map((f) => [c, ...f].join('/')).find((rel) => isFile(path.join(project, rel)));
        const rules = mdFiles(path.join(project, c, ...RULE_FILES)).length;
        const count = rules === 1 ? '1 file' : `${rules} files`;
        return `- ${c}: instructions ${instructions || 'none'}; rules ${rules ? `${count} under ${[c, ...RULE_FILES].join('/')}` : 'none'}`;
    });
    if (!lines.length) return '';
    const text = (shown) => [MEMBER_HEAD, ...lines.slice(0, shown), ...(shown < lines.length ? [MEMBER_MORE(lines.length - shown)] : [])].join('\n');
    let shown = Math.min(lines.length, MEMBER_LINES);
    while (shown > 0 && text(shown).length > MEMBER_CHARS) shown -= 1;
    return text(shown);
}

// Each child's own store rules, always-on and path rules both, named from the project's folder, each under the binding line
// and, where the workspace holds a rule of the name (`held`), the replaces note: what a Cursor start sends of a member,
// since Cursor has no touch event to carry it.
function memberRules(project, env = process.env, held = [])
{
    return memberChildren(project, env).flatMap((child) =>
    {
        const root = path.join(project, child);
        const own = rulesFor(root, env, { host: 'cursor' });
        return [...own.always, ...own.scoped].filter((r) => r.root === root).map((r) => ({ ...r, rel: posix(project, r.file),
            lines: [`Rules and data of ${child}. Binding for work under ${child}, in addition to the workspace's rules.`],
            ...(held.includes(r.name) ? { note: `replaces the workspace's rule of this name for files under ${child}` } : {}) }));
    });
}

// True when the stamp says the seats came through the plugin and no seat of the stack is linked into .claude/agents yet.
function seatsMoved(project)
{
    try { if (!SEATS_ROUTE_PLUGIN.test(fs.readFileSync(path.join(project, ...STAMP), 'utf8'))) return false; } catch { return false; }
    const dir = path.join(project, '.claude', 'agents');
    try { return !fs.readdirSync(dir).some((f) => fs.lstatSync(path.join(dir, f)).isSymbolicLink()); } catch { return true; }
}

// The first checkout holding `.alfred`; with no install record in them, the nearest stamped folder above; else null.
function projectOf(start, prelude)
{
    const roots = prelude.checkoutsOf(start);
    const found = roots.find((d) => isDir(path.join(d, '.alfred')));
    if (found || roots.some((d) => prelude.INSTALL_RECORDS.some((r) => fs.existsSync(path.join(d, '.claude', ...r))))) return found || null;
    const home = require('node:os').homedir();
    for (let at = path.dirname(roots[roots.length - 1]); at !== path.dirname(at) && at !== home; at = path.dirname(at))
    {
        if (!fs.existsSync(path.join(at, ...STAMP))) continue;
        // W3: a folder the stamped one's record ignores (or a record nobody can read) is sent nothing.
        const file = require(path.join(__dirname, 'workspace-file.js'));
        const { pathKey } = require(path.join(__dirname, 'layout.js'));
        const read = file.readRecord(path.join(at, '.alfred'));
        if (read.state === 'garbage' || file.covered(read.record.ignoredChildren, pathKey(at), pathKey(start))) return null;
        return at;
    }
    return null;
}

// The rules for a session or seat started in `start`: each holder's (the project, then its workspace members) store
// rules, the nearest holder winning by name, a native `.claude/rules` file at one holder first (Claude Code only).
// `prelude` can be handed in (W3's keepRules): the installer walks with a stub, never loading hook-prelude.js into its process.
function rulesFor(start, env = process.env, { host = 'claude', prelude = loadPrelude() } = {})
{
    const layout = require(path.join(__dirname, 'layout.js'));
    let from = path.resolve(start);
    try { from = fs.realpathSync.native(from); } catch { /* as given */ }
    const out = { project: projectOf(from, prelude), hasStore: false, always: [], scoped: [], natives: [], notes: [] };
    if (!out.project) return out;
    const chain = layout.workspaceChain(out.project, { env });   // the switch off freezes the chain, never cuts it (4c review I3)
    const holders = out.holders = [{ root: out.project, ignores: chain ? chain.ignores : [] }, ...(chain ? chain.members : [])];
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

function main(argv = process.argv, env = process.env)
{
    const prelude = loadPrelude();
    if (prelude) prelude.blockingStdio();
    let input;
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || 'null'); } catch { return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    // GATE 6 (hook-prelude.js): this hook answers Cursor in its own shape, so the prelude lets it through.
    if (prelude && prelude.cursorStandDown(input, __filename)) return;
    if (input.hook_event_name === 'PreToolUse')
    {
        if (!(prelude && prelude.cursorHost(input))) require(path.join(__dirname, 'rules-summary.js')).onFileTool(input, env);   // the touch record and the edit-time reminder
        return;
    }
    const at = argv.indexOf('--part');
    const part = at < 0 ? 0 : Number(argv[at + 1]);
    if (!Number.isInteger(part) || part < 1 || part > RULE_PARTS) return;   // a PostToolUse call, an unknown part: nothing
    const cursor = Boolean(prelude && prelude.cursorHost(input));
    if (part > 1 && !cursor) return;   // Claude Code's rows for parts 2-5 stay wired for Cursor: nothing, before any read
    const event = String(input.hook_event_name || '');
    const kind = event.charAt(0).toUpperCase() + event.slice(1);
    if (!['SessionStart', 'SubagentStart'].includes(kind)) return;
    if (NO_RULES_SEAT.test(String(input.agent_type || '')) || (cursor && kind === 'SubagentStart')) return;
    const start = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const rules = rulesFor(start, env, { host: cursor ? 'cursor' : 'claude' });
    if (!rules.project) return;
    const sessionStart = kind === 'SessionStart';
    const moved = sessionStart && !cursor && seatsMoved(rules.project);
    if (!rules.hasStore && !moved) return;
    // Claude Code loads a rule written to .claude/rules itself; the store text is the fallback for one not written yet.
    // Cursor reads no .claude/rules and sends no touch event, so it gets every rule, the members' included, here.
    const held = [...rules.always, ...rules.scoped];
    const fallback = cursor ? [...held, ...(sessionStart ? memberRules(rules.project, env, held.map((r) => r.name)) : [])] : rules.always;
    const index = sessionStart && rules.hasStore ? memberIndex(rules.project, env) : '';
    const lead = [index, moved && SEATS_MOVED, !cursor && fallback.length > 0 && UPDATE_HINT].filter(Boolean).join('\n\n');
    if (!fallback.length && !lead) return;
    const out = parts(fallback, cursor ? { index: lead } : { index: lead, limit: 1 });
    if (!out.parts[part - 1]) return;
    const safe = (id) => (prelude ? prelude.safeSession(id) : String(id).replace(/[^\w.-]/g, '_'));
    const sid = (cursor && input.conversation_id) || input.session_id;
    const session = sid ? safe(sid) : null;
    if (session && part === 1)
        try
        {
            const dir = require(path.join(__dirname, 'layout.js')).statsPath(rules.project, ['hook-blocks'], env);
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, `${session}.jsonl`), `${JSON.stringify({ ts: new Date().toISOString(), hook: 'rules-session.js', event, mode: 'probe',
                kind: 'rules-push', chars: out.parts.join('').length, parts: out.parts.length, unsent: out.unsent.length, source: input.source,
                members: index ? index.split('\n').slice(1).filter((l) => !MEMBER_MORE_LINE.test(l)).length : 0,
                agent: safe(String(input.agent_id || 'main').replace(/^agent-/, '')) })}\n`);
        }
        catch { /* the row is a probe */ }
    const text = out.parts[part - 1];
    process.stdout.write(JSON.stringify(cursor ? { additional_context: text } : { hookSpecificOutput: { hookEventName: kind, additionalContext: text } }));
}

module.exports = { PART_ROOM, RULE_PARTS, LOCKED_RULES, NO_RULES_SEAT, render, pathsOf, pathGlob, keyLine, parts, memberIndex, rulesFor, mdFiles, RULE_FILES, main };
if (require.main === module)
{
    const prelude = loadPrelude();
    // The empty argv: `--part` is no CLI call. setUp: false: a never set-up repository below a stamped root is served.
    try { if (!(prelude && prelude.standDown('rules-session', process.env, [], { setUp: false }))) main(); } catch { /* fail open */ }
    process.exit(0);
}
