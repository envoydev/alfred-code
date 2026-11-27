'use strict';
// THE DISCARD WITH NO PROMPT (the user, 2026-11-27). The rm guard asks before a discard of uncommitted work or a stash.
// Two discards are not that harm and pass unasked:
//  - the user's own typed word: the newest prompt the user TYPED asks for the discard ('then drop', 'discard it') and the
//    model's text right before it named every row the discard loses - so the user saw what goes (a stash drop the user
//    said in chat still waited on a prompt click, and auto mode refused the old approval-note path);
//  - the run's own lines: every line the discard loses is one this session's own Edit, MultiEdit or Write added, and
//    every line it puts back is one such an edit took out, counted (a debug probe, a stash the run made of its own
//    edits) - at most OWN_FILES_MAX files and OWN_LINES_MAX lines, so a whole deliverable still asks.
// Both need the command to hold that one discard call, and neither serves a seat. A line made through the shell (sed, a
// heredoc) or by a seat, a staged version and a stash with untracked files are not seen here, so that discard asks.
// A flat hook module by contract (the installer copies it by name, HOOK_MODULES).
const fs = require('fs');
const path = require('path');

const TRANSCRIPT_TAIL_BYTES = 32 * 1024 * 1024;
const DIFF_MAX_BYTES = 2 * 1024 * 1024;
// The own route is for a probe or a debug line, never a whole deliverable (review 2026-11-27 F11, F12).
const OWN_FILES_MAX = 5;
const OWN_LINES_MAX = 40;
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
const STASH_ROW_RE = /^(stash@\{\d+\}):\s*(.*)$/;
const STASH_REF_G = /stash@\{\d+\}/g;
// The calls that may sit between the proposal and the drop: a plain read of the stash list, and tools that change
// nothing in git (fifth review R5-4: a ToolSearch or Read call first is routine).
const STASH_READ_RE = /^\s*git(?:\s+(?:-C\s+[^\s;&|<>`$]+|--no-pager))*\s+stash\s+(?:list|show)\b[^;&|<>`$\n]*$/;
// A Skill is not here: a forked skill can run git where this hook cannot see it (sixth review R6-2). A `cd X &&`
// stash read is not either: the cd stays for the next command (R6-3).
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch', 'LSP']);
const TREE_ROW_RE = /^(.)(.) (.+)$/;
// A row the own route judges: a tracked file changed in the tree with nothing staged (review F10: an index version is
// another copy of the work, unseen by `git diff HEAD`).
const OWN_XY = ' M';
const DISCARD_VERBS = {
    stash: String.raw`drop|discard|delete|remove|clear`,
    tree: String.raw`discard|revert|reset|restore|drop|delete|remove|undo`,
};
const ANY_DISCARD_VERB_RE = /\b(?:drop|discard|delete|remove|clear|revert|reset|restore|undo|throw\s+away)\b/i;
// The typed word is a bare imperative: an opener ('then', 'yes,'), the verb, at most an object word, nothing after
// (review F2: 'shouldn't drop', 'drop it if ...', 'drop it later' and 'before you drop it' read as consent).
const OPENER = String.raw`(?:(?:then|ok(?:ay)?|yes|sure|go\s+ahead(?:\s+and)?|please)[,!.]?\s+)*`;
const OBJECT = String.raw`(?:\s+(?:it|them|that|this|both|all|the\s+stash(?:es)?|the\s+changes?|stash@\{\d+\}))?`;
const typedDiscardRe = (verbs) => new RegExp(String.raw`^\s*${OPENER}(?:${verbs})${OBJECT}(?:\s+please)?\s*[.!]*\s*$`, 'i');
// A line that keeps or negates is no proposal to discard (review F1: 'stash@{1} is your WIP - keep it').
const KEEP_OR_NOT_RE = /\b(?:keep|kept|don'?t|do\s+not|never|not|no|won'?t|shouldn'?t)\b|n['’]t\b/i;
const PATH_EDGE = String.raw`(?:^|[\s\`'"(\[])`;
const PATH_END = String.raw`(?=$|[\s\`'"),.;:\]])`;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whether the typed prompt asks for a discard of this kind: a bare imperative, nothing before or after but an opener.
function promptAsksDiscard(prompt, kind)
{
    const verbs = DISCARD_VERBS[kind];
    return Boolean(verbs) && typedDiscardRe(verbs).test(String(prompt || ''));
}

// Whether one line of text names a lost row: a stash by its exact `stash@{N}`, a file by its full path (review F3).
function lineNamesRow(line, kind, row)
{
    if (kind === 'stash')
    {
        const m = STASH_ROW_RE.exec(row);
        return Boolean(m) && line.includes(m[1]);
    }
    const m = TREE_ROW_RE.exec(row);
    if (!m) return false;
    const file = m[3].replace(/^.* -> /, '');
    return new RegExp(`${PATH_EDGE}${escapeRe(file)}${PATH_END}`).test(line);
}

// Whether the model proposed this row's discard: one line names it beside a discard verb, with no keep and no negation
// anywhere on that line.
function namesRow(text, kind, row)
{
    return String(text || '').split('\n').some((line) =>
        lineNamesRow(line, kind, row) && ANY_DISCARD_VERB_RE.test(line) && !KEEP_OR_NOT_RE.test(line));
}

// The lines one edit adds and takes out, with their counts: what the new text has more of is added, the rest removed.
function editLines(oldText, newText)
{
    const count = (t) =>
    {
        const m = new Map();
        for (const l of String(t || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) m.set(l, (m.get(l) || 0) + 1);
        return m;
    };
    const before = count(oldText);
    const after = count(newText);
    const added = [];
    const removed = [];
    for (const [l, n] of after) for (let i = (before.get(l) || 0); i < n; i++) added.push(l);
    for (const [l, n] of before) for (let i = (after.get(l) || 0); i < n; i++) removed.push(l);
    return { added, removed };
}

// The result of each tool call in the rows, by call id: { isError, result }.
function resultsOf(rows)
{
    const out = new Map();
    for (const row of rows)
    {
        const content = row && row.type === 'user' && row.message && row.message.content;
        if (!Array.isArray(content)) continue;
        for (const b of content) if (b && b.type === 'tool_result' && b.tool_use_id) out.set(b.tool_use_id, { isError: b.is_error === true, result: row.toolUseResult });
    }
    return out;
}

// The session's own edits by absolute file path, as NET line counts: { added: Map, removed: Map }. An edit counts only
// once its result came back without an error, and a Write only when it created the file - a Write over a file keeps
// whatever it was handed, the user's lines included (review F5, F6).
function ownEditsOf(rows)
{
    const results = resultsOf(rows);
    const raw = new Map();
    const add = (file, lines) =>
    {
        if (!file) return;
        const key = path.resolve(file);
        const entry = raw.get(key) || { added: new Map(), removed: new Map() };
        for (const l of lines.added) entry.added.set(l, (entry.added.get(l) || 0) + 1);
        for (const l of lines.removed) entry.removed.set(l, (entry.removed.get(l) || 0) + 1);
        raw.set(key, entry);
    };
    for (const row of rows)
    {
        if (!row || row.type !== 'assistant' || row.isSidechain) continue;
        const content = row.message && row.message.content;
        if (!Array.isArray(content)) continue;
        for (const block of content)
        {
            if (!block || block.type !== 'tool_use' || !EDIT_TOOLS.has(block.name) || !block.input) continue;
            const done = results.get(block.id);
            if (!done || done.isError) continue;
            const input = block.input;
            if (block.name === 'Write') { if (done.result && done.result.type === 'create') add(input.file_path, editLines('', input.content)); }
            else if (block.name === 'Edit') add(input.file_path, editLines(input.old_string, input.new_string));
            else for (const e of Array.isArray(input.edits) ? input.edits : []) add(input.file_path, editLines(e && e.old_string, e && e.new_string));
        }
    }
    const byFile = new Map();
    for (const [file, e] of raw)
    {
        const net = { added: new Map(), removed: new Map() };
        for (const l of new Set([...e.added.keys(), ...e.removed.keys()]))
        {
            const d = (e.added.get(l) || 0) - (e.removed.get(l) || 0);
            if (d > 0) net.added.set(l, d);
            if (d < 0) net.removed.set(l, -d);
        }
        net.rawAdded = e.added;
        net.rawRemoved = e.removed;
        byFile.set(file, net);
    }
    return byFile;
}

// The `+` and `-` lines of a unified diff by file, read by hunk state (review F7: a content line opening `--` or `++`
// is content); null when a file header cannot be read (review F8: a quoted path).
function diffLines(diff)
{
    const out = new Map();
    let file = null;
    let inHunk = false;
    for (const line of String(diff || '').split('\n'))
    {
        if (line.startsWith('diff --git '))
        {
            const head = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
            if (!head) return null;
            file = head[2];
            inHunk = false;
            out.set(file, { added: [], removed: [] });
            continue;
        }
        if (!file) continue;
        if (line.startsWith('@@')) { inHunk = true; continue; }
        if (!inHunk) continue;
        const text = line.slice(1).trim();
        if (!text) continue;
        if (line[0] === '+') out.get(file).added.push(text);
        else if (line[0] === '-') out.get(file).removed.push(text);
    }
    return out;
}

// Whether a count of lines fits inside the own net counts.
function fits(lines, own)
{
    const need = new Map();
    for (const l of lines) need.set(l, (need.get(l) || 0) + 1);
    for (const [l, n] of need) if ((own.get(l) || 0) < n) return false;
    return true;
}

// Whether every line a diff changes is the session's own: the lines the discard loses were added by own edits of that
// file and the lines it puts back were taken out by them, counted. Returns the lost line count, or -1 when not own.
function diffOwnLines(diff, top, own)
{
    const files = diffLines(diff);
    if (!files || !files.size || files.size > OWN_FILES_MAX) return -1;
    let total = 0;
    for (const [rel, lines] of files)
    {
        const mine = own.get(path.resolve(top, rel));
        if (!mine || (!lines.added.length && !lines.removed.length)) return -1;
        // A line an own edit took out is gone from the base in this diff, or an own edit had added it: else the edit
        // rewrote a line the user wrote, and its new text is not the run's alone (re-review N5, third review H2, R1).
        const gone = new Map();
        for (const l of lines.removed) gone.set(l, (gone.get(l) || 0) + 1);
        for (const [l, n] of mine.rawRemoved || []) if ((gone.get(l) || 0) + ((mine.rawAdded && mine.rawAdded.get(l)) || 0) < n) return -1;
        if (!fits(lines.added, mine.added) || !fits(lines.removed, mine.removed)) return -1;
        total += lines.added.length + lines.removed.length;
    }
    return total;
}
const diffIsOwn = (diff, top, own) => diffOwnLines(diff, top, own) >= 0;

// The transcript's rows from its newest TRANSCRIPT_TAIL_BYTES; a torn first row is dropped and a bad row skipped.
function transcriptRows(file)
{
    try
    {
        const size = fs.statSync(file).size;
        const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
        const fd = fs.openSync(file, 'r');
        let text;
        try { const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); text = buf.toString('utf8'); }
        finally { fs.closeSync(fd); }
        const lines = text.split('\n');
        if (start > 0) lines.shift();
        const rows = [];
        for (const line of lines) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* a torn or foreign row */ } }
        return rows;
    }
    catch { return []; }
}

// The text of a row the user typed, else null: a tool result, a meta, seat or harness row is no typed turn.
function typedText(row, isHarness)
{
    if (!row || row.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary || !row.message) return null;
    const c = row.message.content;
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return null;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n') : '';
    return text.trim() && !isHarness(text) ? text : null;
}

// The newest typed prompt and the model's text between the typed prompt before it and it, or null with no typed prompt.
// Whether a row holds a tool call other than a plain stash read (and other than the call judged now).
function otherCall(row, callId)
{
    const content = row && row.type === 'assistant' && row.message && row.message.content;
    return Array.isArray(content) && content.some((b) => b && b.type === 'tool_use' && b.id !== callId && !READ_ONLY_TOOLS.has(b.name)
        && !(b.name === 'Bash' && b.input && !b.input.run_in_background && STASH_READ_RE.test(String(b.input.command || ''))));
}

function lastExchange(rows, isHarness, callId)
{
    let at = -1;
    for (let i = rows.length - 1; i >= 0; i--) if (typedText(rows[i], isHarness) !== null) { at = i; break; }
    if (at < 0) return null;
    // A row after the prompt that is no tool call or result - a prompt queued mid-turn ('wait, keep it') - is a newer
    // word than the prompt read here (review F9).
    // Claude Code writes many attachment rows after each prompt (environment, date, deltas); only a queued prompt is a
    // newer word (re-review N1).
    for (let i = at + 1; i < rows.length; i++)
    {
        const row = rows[i];
        if (!row) continue;
        if (row.type === 'queue-operation' && row.operation === 'enqueue') return null;
        if (row.type === 'attachment' && row.attachment && row.attachment.type === 'queued_command') return null;
        // A newer turn - typed, or a harness prompt such as a task notice - is no longer the user's answer here.
        if (row.type === 'user' && !row.isMeta && row.message && !(Array.isArray(row.message.content) && row.message.content.every((b) => b && b.type === 'tool_result'))) return null;
        // Any call but a plain stash read since the word can move the refs or carry newer words - a stash or pull
        // --autostash, a seat, an ask, a refused call's feedback (third review H1, fourth review N2, N3, N5).
        if (otherCall(row, callId)) return null;
        if (row.type === 'user' && Array.isArray(row.message && row.message.content) && row.message.content.some((b) => b && b.type === 'tool_result' && b.is_error)) return null;
    }
    const said = [];
    for (let i = at - 1; i >= 0; i--)
    {
        if (typedText(rows[i], isHarness) !== null) break;
        const row = rows[i];
        if (!row || row.type !== 'assistant' || row.isSidechain) continue;
        // Text before a call that could move the refs named a stash list that is gone (fourth review N1).
        if (otherCall(row, callId)) break;
        const content = row.message && row.message.content;
        if (Array.isArray(content)) for (const b of content) if (b && b.type === 'text') said.push(b.text || '');
    }
    return { prompt: typedText(rows[at], isHarness), said: said.reverse().join('\n') };
}

// Whether the user's typed word clears every loss group: its prompt asks for that kind of discard, and the text before
// it named every row.
// Stashes only: a file revert agreed to in words can lose more than the words named (re-review N3). The model's text names
// exactly one stash ref, so 'drop it' points at one entry (re-review F1), and a ref the prompt types is that ref (N2).
function typedConsent(exchange, groups)
{
    if (!exchange || groups.length !== 1 || groups[0].kind !== 'stash' || groups[0].rows.length !== 1) return false;
    const row = groups[0].rows[0];
    const ref = STASH_ROW_RE.exec(row);
    if (!ref) return false;
    const refsSaid = new Set(String(exchange.said).match(STASH_REF_G) || []);
    const refsTyped = new Set(String(exchange.prompt).match(STASH_REF_G) || []);
    if (refsSaid.size !== 1 || !refsSaid.has(ref[1]) || [...refsTyped].some((r) => r !== ref[1])) return false;
    return promptAsksDiscard(exchange.prompt, 'stash') && namesRow(exchange.said, 'stash', row);
}

// Whether every loss is the session's own lines, at most OWN_FILES_MAX files and OWN_LINES_MAX lines in all.
// `diffOf(loss, row)` returns { diff, top } or null (git cannot answer, or a stash index that is a third copy).
function ownConsent(losses, own, diffOf)
{
    if (!losses.length || !own.size) return false;
    let files = 0;
    let lines = 0;
    for (const loss of losses)
    {
        for (const row of loss.rows)
        {
            if (loss.kind === 'tree' && !(TREE_ROW_RE.test(row) && row.slice(0, 2) === OWN_XY)) return false;
            if (loss.kind === 'stash' && !STASH_ROW_RE.test(row)) return false;
            if (loss.kind !== 'tree' && loss.kind !== 'stash') return false;
            if (++files > OWN_FILES_MAX) return false;
            const got = diffOf(loss, row);
            if (!got || !got.diff || got.diff.length > DIFF_MAX_BYTES) return false;
            const n = diffOwnLines(got.diff, got.top, own);
            if (n < 0 || (lines += n) > OWN_LINES_MAX) return false;
        }
    }
    return files > 0;
}

// The one call the rm guard makes: true when the discard may run unasked. Never throws - a failure asks as before.
function discardCleared({ transcriptPath, groups, losses, diffOf, isHarness = () => false, single = false, seat = false, callId = null })
{
    try
    {
        // One discard call alone (review F4: stash refs shift inside `git stash && git stash drop`), never a seat's
        // (review F14: the user's word went to the main session, and the own edits read are the main session's).
        if (!transcriptPath || !groups.length || !single || seat) return false;
        const rows = transcriptRows(transcriptPath);
        if (!rows.length) return false;
        if (typedConsent(lastExchange(rows, isHarness, callId), groups)) return 'typed';
        return ownConsent(losses, ownEditsOf(rows), diffOf) ? 'own' : false;
    }
    catch { return false; }
}

module.exports = { discardCleared, promptAsksDiscard, namesRow, editLines, ownEditsOf, diffLines, diffIsOwn, diffOwnLines, lastExchange, typedConsent, ownConsent, transcriptRows, STASH_ROW_RE, TREE_ROW_RE, OWN_LINES_MAX };
