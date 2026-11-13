#!/usr/bin/env node
'use strict';
// plan-status.js - THE ONE WRITER OF A PLAN FOLDER'S status.json (PF1 D7, D8, D10; an engine copied beside layout.js,
// not wired). A plan is a folder `<docs root>/work/plans/<id>/` holding `<id>.md`; this engine keeps `status.json`
// beside it - the gate, the approval and the build's progress - so a reader never parses the Markdown for them.
//   node .claude/hooks/plan-status.js <verb> --plan <id or path> [flags]    labelled values on stdin (a heredoc)
// Exit codes: 0 written or nothing to change; 2 refused (usage, a rule, an unknown task); 3 the file on disk is not a
// schema 1 status file; 4 the write could not be made. Never 1: an unexpected throw is exit 4. The whole file goes to
// a temp file in the same folder, then a rename over status.json, under a lock (D8). The contract it writes to is
// docs/plan-folder-contract.md; scripts/plan-contract.test.js holds the two together.
const fs = require('fs');
const path = require('path');
const layout = require('./layout.js');

const SCHEMA = 1;
const MAX_BYTES = 1048576;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'failed'];
const KEYS = ['schema', 'title', 'updatedAt', 'approvedAt', 'completedAt', 'tasks', 'reopenedAt', 'reopens',
    'retiredIds', 'dropped', 'gate', 'approval', 'resume', 'decisions', 'deviations', 'conformance', 'completion'];
const TASK_KEYS = ['id', 'title', 'status', 'estimateMin', 'startedAt', 'doneAt', 'result', 'needs', 'why', 'card', 'by'];
const CAPS = { result: 2000, field: 1000, card: 6000, gate: 4000 };
const TASK_ID = /^[1-9]\d*$/;
const LISTS = ['reopens', 'retiredIds', 'dropped', 'decisions', 'deviations'];
const TEMP_STALE_MS = 60000;
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 20;

// UTC to the minute: YYYY-MM-DDTHH:MMZ.
const stamp = (date = new Date()) => `${date.toISOString().slice(0, 16)}Z`;

function emptyStatus(title, at)
{
    return {
        schema: SCHEMA, title, updatedAt: at, approvedAt: null, completedAt: null, tasks: [], reopenedAt: null,
        reopens: [], retiredIds: [], dropped: [], gate: null, approval: null, resume: { note: null, next: null, at },
        decisions: [], deviations: [], conformance: null, completion: null,
    };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (v) => typeof v === 'string' && TIME_RE.test(v);
const strOrNull = (v) => v === null || typeof v === 'string';

// Every problem as '<field> - <why>', in file order; empty when valid. Types only: no cap is checked, and a key this
// engine does not know is no problem (R10 - an older engine copy must not refuse a newer release's added key).
function validate(status)
{
    if (!isObject(status)) return ['status - not a JSON object'];
    const out = [];
    const need = (ok, field, why) => { if (!ok) out.push(`${field} - ${why}`); };
    const time = (v, field) => need(isTime(v), field, 'not a YYYY-MM-DDTHH:MMZ time');
    const timeOrNull = (v, field) => need(v === null || isTime(v), field, 'not a YYYY-MM-DDTHH:MMZ time or null');
    const text = (v, field) => need(strOrNull(v), field, 'not a string or null');
    // An object value whose keys are each checked; a missing key is one problem and its type is not checked.
    const shape = (v, field, keys, check) =>
    {
        if (!isObject(v)) { out.push(`${field} - not an object`); return; }
        for (const k of keys) if (!(k in v)) out.push(`${field}.${k} - missing`); else check(k, v[k], `${field}.${k}`);
    };
    const present = KEYS.filter((k) => { if (k in status) return true; out.push(`${k} - missing`); return false; });
    const has = new Set(present);
    if (has.has('schema')) need(status.schema === SCHEMA, 'schema', `not ${SCHEMA}`);
    if (has.has('title')) need(typeof status.title === 'string', 'title', 'not a string');
    if (has.has('updatedAt')) time(status.updatedAt, 'updatedAt');
    for (const k of ['approvedAt', 'completedAt', 'reopenedAt']) if (has.has(k)) timeOrNull(status[k], k);
    for (const k of LISTS) if (has.has(k)) need(Array.isArray(status[k]), k, 'not an array');
    const retired = new Set(Array.isArray(status.retiredIds) ? status.retiredIds : []);
    if (Array.isArray(status.retiredIds))
        status.retiredIds.forEach((id, i) => need(typeof id === 'string' && TASK_ID.test(id), `retiredIds[${i}]`, 'not a task id'));
    if (has.has('tasks'))
    {
        if (!Array.isArray(status.tasks)) out.push('tasks - not an array');
        else
        {
            const seen = new Set();
            status.tasks.forEach((t, i) => shape(t, `tasks[${i}]`, TASK_KEYS, (k, v, field) =>
            {
                if (k === 'id')
                {
                    if (typeof v !== 'string' || !TASK_ID.test(v)) out.push(`${field} - not a whole number above 0, as a string`);
                    else if (seen.has(v)) out.push(`${field} - '${v}' is used twice`);
                    else if (retired.has(v)) out.push(`${field} - '${v}' is a retired id`);
                    if (typeof v === 'string') seen.add(v);
                }
                else if (k === 'title') need(typeof v === 'string', field, 'not a string');
                else if (k === 'status') need(STATUSES.includes(v), field, `not one of ${STATUSES.join(', ')}`);
                else if (k === 'estimateMin') need(v === null || (Number.isInteger(v) && v >= 0), field, 'not a whole number of 0 or more, or null');
                else if (k === 'startedAt' || k === 'doneAt') timeOrNull(v, field);
                else text(v, field);
            }));
        }
    }
    if (has.has('gate') && status.gate !== null)
        shape(status.gate, 'gate', ['at', 'verdict', 'block'], (k, v, field) => (k === 'at' ? time(v, field) : need(typeof v === 'string', field, 'not a string')));
    if (has.has('approval') && status.approval !== null)
        shape(status.approval, 'approval', ['mode', 'words'], (k, v, field) =>
            (k === 'mode' ? need(v === null || v === 'session' || v === 'agents', field, 'not session, agents or null') : text(v, field)));
    if (has.has('resume'))
        shape(status.resume, 'resume', ['note', 'next', 'at'], (k, v, field) => (k === 'at' ? time(v, field) : text(v, field)));
    for (const k of ['reopens', 'dropped', 'decisions', 'deviations'])
        if (Array.isArray(status[k])) status[k].forEach((e, i) => shape(e, `${k}[${i}]`, ['at'], (_, v, field) => time(v, field)));
    if (has.has('conformance') && status.conformance !== null)
        shape(status.conformance, 'conformance', ['at', 'verdict', 'reviewer', 'skipped'], (k, v, field) =>
            (k === 'at' ? time(v, field) : k === 'verdict' ? need(typeof v === 'string', field, 'not a string') : text(v, field)));
    if (has.has('completion') && status.completion !== null)
        shape(status.completion, 'completion', ['suite', 'open'], (k, v, field) =>
            (k === 'suite' ? text(v, field) : need(Array.isArray(v) && v.every((id) => typeof id === 'string'), field, 'not a list of task ids')));
    return out;
}

// <dir>/status.json, read and checked; never throws.
function readStatus(dir)
{
    const file = path.join(dir, 'status.json');
    let st;
    try { st = fs.statSync(file); }
    catch (e) { return e && e.code === 'ENOENT' ? { ok: false, why: 'absent', detail: 'no status.json' } : { ok: false, why: 'unreadable', detail: String(e && e.code || e) }; }
    if (!st.isFile()) return { ok: false, why: 'unreadable', detail: 'not a file' };
    if (st.size > MAX_BYTES) return { ok: false, why: 'unreadable', detail: 'over 1 MB' };
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { return { ok: false, why: 'unreadable', detail: String(e && e.code || e) }; }
    if (!text) return { ok: false, why: 'unreadable', detail: 'empty' };
    let status;
    try { status = JSON.parse(text); }
    catch { return { ok: false, why: 'unreadable', detail: 'not JSON' }; }
    const problems = validate(status);
    return problems.length ? { ok: false, why: 'shape', detail: problems[0] } : { ok: true, status };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const removeQuiet = (file) => { try { fs.rmSync(file, { force: true }); } catch { /* gone or held */ } };
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

// The whole text to <file>.<pid>.tmp, then a rename over <file> (D8). A rename a scanner refuses is retried; a temp
// left by a crashed call over a minute ago is swept. No lock here - the verbs take it.
function writeWhole(file, text, { rename = fs.renameSync } = {})
{
    const dir = path.dirname(file);
    const base = path.basename(file);
    const own = `${file}.${process.pid}.tmp`;
    const isTemp = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.tmp$`);
    let names = [];
    try { names = fs.readdirSync(dir); }
    catch { /* the write below reports it */ }
    const now = Date.now();
    for (const name of names.filter((n) => isTemp.test(n)))
    {
        const full = path.join(dir, name);
        try { if (full === own || now - fs.statSync(full).mtimeMs > TEMP_STALE_MS) fs.rmSync(full, { force: true }); }
        catch { /* another call's, or gone */ }
    }
    fs.writeFileSync(own, text, { flag: 'wx' });
    for (let attempt = 0; ; attempt++)
    {
        try { rename(own, file); return; }
        catch (e)
        {
            if (attempt < RENAME_RETRIES && e && RETRY_CODES.has(e.code)) { sleep(RENAME_RETRY_MS); continue; }
            removeQuiet(own);
            throw e;
        }
    }
}


// ---- the CLI frame (PF1 D7, D9; the plan's 'engine's rules') ----

const VERBS = {
    write: ['sync', 'gate', 'approve', 'redesign', 'start', 'done', 'block', 'fail', 'reopen', 'add-task', 'drop', 'cursor',
        'decide', 'deviate', 'conformance', 'complete'],
    read: ['resume', 'show', 'list', 'check'],
};
const TASK_VERBS = ['start', 'done', 'block', 'fail', 'reopen', 'add-task', 'drop'];
const STDIN_VERBS = ['gate', 'approve', 'redesign', 'done', 'block', 'fail', 'reopen', 'add-task', 'drop', 'cursor', 'decide',
    'deviate', 'conformance', 'complete'];
const VALUE_FLAGS = ['plan', 'task', 'after', 'mode'];
const BOOL_FLAGS = ['with-open', 'full', 'all'];
// What each verb takes; `need` lists the flags it cannot run without. A verb the engine has no handler for yet is an
// unknown verb (HANDLERS below).
const TAKES = {
    sync: { flags: ['plan'], need: ['plan'] },
    gate: { flags: ['plan'], need: ['plan'] },
    approve: { flags: ['plan', 'mode'], need: ['plan'] },
    redesign: { flags: ['plan', 'task'], need: ['plan'] },
    start: { flags: ['plan', 'task'], need: ['plan', 'task'] },
    done: { flags: ['plan', 'task'], need: ['plan', 'task'] },
    block: { flags: ['plan', 'task'], need: ['plan', 'task'] },
    fail: { flags: ['plan', 'task'], need: ['plan', 'task'] },
    reopen: { flags: ['plan', 'task'], need: ['plan', 'task'] },
    'add-task': { flags: ['plan', 'after'], need: ['plan'] },
    drop: { flags: ['plan', 'task'], need: ['plan', 'task'] },
    cursor: { flags: ['plan'], need: ['plan'] },
    decide: { flags: ['plan', 'task'], need: ['plan'] },
    deviate: { flags: ['plan', 'task'], need: ['plan'] },
    conformance: { flags: ['plan'], need: ['plan'] },
    complete: { flags: ['plan', 'with-open'], need: ['plan'] },
    resume: { flags: ['plan'], need: ['plan'] },
    show: { flags: ['plan', 'full'], need: ['plan'] },
    list: { flags: [], need: [] },
    check: { flags: ['plan', 'all'], need: [] },
};
const LOCK_RETRY_MS = 20;
const LOCK_WAIT_MS = 1500;
const LOCK_STALE_MS = 5000;
const HELD_CODES = new Set(['EEXIST', 'EPERM', 'EBUSY']);

class Refusal extends Error
{
    constructor(code, line) { super(line); this.code = code; this.line = line; }
}
const fold = (text) => String(text).replace(/\s*\r?\n\s*/g, ' ');
const rootOf = (cwd, env) => env.CLAUDE_PROJECT_DIR || layout.projectRootOf(cwd).project;
const slashed = (p) => p.split(path.sep).join('/');
function relOf(root, dir)
{
    const rel = path.relative(root, dir);
    return `${slashed(!rel || rel.startsWith('..') || path.isAbsolute(rel) ? dir : rel)}/`;
}

// A plan ref - a bare id, the folder, its Markdown, either slash - to the plan folder. The folder need not exist.
function resolvePlan(ref, { cwd = process.cwd(), env = process.env } = {})
{
    const text = String(ref || '').replace(/\\/g, '/');
    if (!text) return { ok: false, why: 'no --plan given' };
    const root = rootOf(cwd, env);
    let id;
    let dir;
    if (!text.includes('/'))
    {
        if (/\.md$/i.test(text)) return { ok: false, why: 'a plan id carries no .md' };
        if (!layout.planFolderId(text)) return { ok: false, why: `'${text}' is not a plan id` };
        id = text;
        dir = path.join(layout.planDirs(root, env)[0], text);
    }
    else
    {
        const found = layout.planOf(path.resolve(cwd, text));
        if (!found) return { ok: false, why: 'not a plan folder - a plan is <plans>/<id>/ holding <id>.md' };
        if (found.shape === 'flat') return { ok: false, why: 'a flat plan has no status.json' };
        id = found.id;
        dir = found.dir;
    }
    // Review Focus 4: on a case-folding disk the id is the folder's name as the disk spells it.
    try
    {
        const names = fs.readdirSync(path.dirname(dir));
        if (!names.includes(id))
        {
            const listed = names.find((n) => n.toLowerCase() === id.toLowerCase());
            if (listed) { id = listed; dir = path.join(path.dirname(dir), listed); }
        }
    }
    catch { /* no parent yet: the folder need not exist */ }
    return { ok: true, id, dir, md: path.join(dir, `${id}.md`), rel: relOf(root, dir), root };
}

// Spec 3's stdin rule: a label opening its line starts its value once; every other line continues the value above.
function parseStdin(text, labels)
{
    const values = {};
    let current = null;
    for (const line of String(text || '').replace(/\r/g, '').split('\n'))
    {
        const m = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
        if (m && labels.includes(m[1]) && !(m[1] in values)) { current = m[1]; values[current] = [m[2]]; }
        else if (current) values[current].push(line);
    }
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.join('\n').replace(/\s+$/, '')]));
}

const CARD_RE = /^### Task ([1-9]\d*) - (.+)$/;
const CARD_LIKE_RE = /^### Task(?: |$)/;
const ESTIMATE_RE = /^\s*-\s*estimate:\s*(\d+)\s*m\b/i;
// The title, the cards and their estimates from a plan's Markdown; a fenced block holds no heading and no estimate.
function parseCards(markdown)
{
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let title = null;
    const cards = [];
    const problems = [];
    let fence = null;
    let card = null;
    lines.forEach((line, i) =>
    {
        const marker = /^(`{3,}|~{3,})/.exec(line);
        if (fence) { if (marker && marker[1][0] === fence) fence = null; return; }
        if (marker) { fence = marker[1][0]; return; }
        if (title === null && /^# /.test(line)) title = line.slice(2).trim().replace(/ - plan$/, '');
        if (/^#{2,3} /.test(line)) card = null;
        const c = CARD_RE.exec(line);
        if (c) { card = { id: c[1], title: c[2].trim(), estimateMin: null }; cards.push(card); return; }
        if (CARD_LIKE_RE.test(line)) { problems.push(`line ${i + 1} - a card with no whole-number id`); return; }
        const e = card && card.estimateMin === null && !card.estimated ? ESTIMATE_RE.exec(line) : null;
        if (e) { card.estimateMin = Number(e[1]); card.estimated = true; }
    });
    const seen = new Set();
    for (const c of cards)
    {
        if (seen.has(c.id) && !problems.includes(`task ${c.id} - two cards carry this id`)) problems.push(`task ${c.id} - two cards carry this id`);
        seen.add(c.id);
    }
    const bare = cards.find((c) => c.estimateMin === null);
    if (bare && cards.some((c) => c.estimateMin !== null)) problems.push(`estimates on some cards only (none on task ${bare.id})`);
    return { title, cards: cards.map(({ id, title: t, estimateMin }) => ({ id, title: t, estimateMin })), problems };
}

function counts(status)
{
    const out = { total: 0, done: 0, todo: 0, in_progress: 0, blocked: 0, failed: 0 };
    for (const t of status.tasks || []) { out.total++; if (t.status in out) out[t.status]++; }
    return out;
}
function resumeText(status)
{
    const next = status.resume && status.resume.next ? `next task ${status.resume.next}` : 'no task left';
    const note = status.resume && status.resume.note;
    return note ? `${fold(note)} - ${next}` : next;
}
const tasksLine = (status, suffix = '') => { const c = counts(status); return `Tasks: ${c.done} of ${c.total} done${suffix}`; };

const newTask = (id, title, estimateMin) => ({ id, title, status: 'todo', estimateMin, startedAt: null, doneAt: null,
    result: null, needs: null, why: null, card: null, by: null });

// Sync's merge of the Markdown's cards into the tasks (spec 3's sync row and its order rule). Returns a refusal or
// null; the status is changed in place.
function syncTasks(status, parsed, at)
{
    if (parsed.problems.length) return parsed.problems[0];
    const retired = new Set(status.retiredIds);
    const old = status.tasks;
    const byId = new Map(old.map((t) => [t.id, t]));
    for (const c of parsed.cards)
    {
        if (retired.has(c.id)) return `task ${c.id} - a retired id`;
        if (byId.has(c.id) && byId.get(c.id).card !== null) return `task ${c.id} - an added task holds this id`;
    }
    const next = parsed.cards.map((c) =>
    {
        const t = byId.get(c.id);
        if (!t) return newTask(c.id, c.title, c.estimateMin);
        if (t.status === 'todo') t.title = c.title;
        if (t.startedAt === null) t.estimateMin = c.estimateMin;
        return t;
    });
    const carded = new Set(parsed.cards.map((c) => c.id));
    old.forEach((t, i) =>
    {
        if (carded.has(t.id)) return;
        if (t.card === null && t.status === 'todo')
        {
            status.dropped.push({ id: t.id, title: t.title, at, why: 'card removed from the plan' });
            status.retiredIds.push(t.id);
            return;
        }
        let place = 0;
        for (let j = i - 1; j >= 0; j--)
        {
            const k = next.indexOf(old[j]);
            if (k >= 0) { place = k + 1; break; }
        }
        next.splice(place, 0, t);
    });
    status.tasks = next;
    if (parsed.title !== null) status.title = parsed.title;
    return null;
}

// Known keys in file order, then any the engine does not know (R10).
function ordered(obj, keys)
{
    const out = {};
    for (const k of keys) if (k in obj) out[k] = obj[k];
    for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
    return out;
}
const inFileOrder = (status) => ordered({ ...status, tasks: status.tasks.map((t) => ordered(t, TASK_KEYS)) }, KEYS);
const sameBut = (a, b, skip) => JSON.stringify({ ...a, [skip]: null }) === JSON.stringify({ ...b, [skip]: null });

function takeLock(plan)
{
    const lock = path.join(plan.dir, 'status.json.lock');
    const start = Date.now();
    let denied = 0;
    for (;;)
    {
        try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return lock; }
        catch (e)
        {
            if (!e || !HELD_CODES.has(e.code)) throw new Refusal(4, `cannot write in ${plan.rel}: ${e && e.code || e}`);
            let age = null;
            try { age = Date.now() - fs.statSync(lock).mtimeMs; }
            catch
            {
                // No lock on disk: EEXIST means it was just let go, so the create runs again; EPERM or EBUSY twice
                // with no lock is the folder refusing the write (a deny-write ACL, an immutable folder) - exit 4.
                if (e.code !== 'EEXIST' && ++denied >= 2) throw new Refusal(4, `cannot write in ${plan.rel}: ${e.code}`);
            }
            if (age !== null && age > LOCK_STALE_MS) { removeQuiet(lock); continue; }
            if (Date.now() - start >= LOCK_WAIT_MS) throw new Refusal(4, 'status.json.lock is held - run the call again');
            if (age !== null || e.code !== 'EEXIST') sleep(LOCK_RETRY_MS);
        }
    }
}

const NOT_SCHEMA = (detail) => `status.json is not a schema 1 status file: ${detail} - the user's to repair (the docs hook refuses a model's edit): ask them to fix the file, or to delete it and run sync (it rebuilds the tasks at todo)`;

// Steps 3 to 10 of the order of checks: the lock, the read, the common rules, the verb's change on a copy, the write.
// change(status, ctx) returns { refused } or { lines } (a list, or a function of the status); ctx.created is true
// when sync made the file.
function mutate(plan, verb, change, ctx)
{
    const refuse = (why) => { throw new Refusal(2, `${verb} refused: ${why}`); };
    if (!fs.existsSync(plan.dir))
    {
        if (verb === 'sync' || verb === 'approve') refuse(`no ${plan.id}.md in the plan folder`);
        throw new Refusal(2, 'no status yet - run sync');
    }
    const lock = takeLock(plan);
    try
    {
        const read = readStatus(plan.dir);
        let before = null;
        let status;
        if (read.ok) { before = read.status; status = JSON.parse(JSON.stringify(read.status)); }
        else if (read.why === 'absent')
        {
            if (!ctx.createIfAbsent) throw new Refusal(2, 'no status yet - run sync');
            status = emptyStatus(plan.id, ctx.at);
        }
        else throw new Refusal(3, NOT_SCHEMA(read.detail));
        if (before && status.completedAt !== null) refuse('new scope is a new plan');
        if (before && status.reopenedAt !== null && TASK_VERBS.includes(verb)) refuse('approve the design again first');
        for (const id of [ctx.flags.task, ctx.flags.after])
            if (id !== undefined && !status.tasks.some((t) => t.id === id)) refuse(`unknown task ${id}`);
        const result = change(status, { ...ctx, created: !before });
        if (result.refused) refuse(result.refused);
        const firstOpen = status.tasks.find((t) => t.status !== 'done');
        const next = result.keepNext ? status.resume.next : (firstOpen ? firstOpen.id : null);
        if (!before || next !== before.resume.next || status.resume.note !== before.resume.note) status.resume = { ...status.resume, next, at: ctx.at };
        status.resume = ordered(status.resume, ['note', 'next', 'at']);
        const after = inFileOrder(status);
        // A verb's middle lines: a list, or a function of the status as written (or as it stands, with nothing to change).
        const linesOf = (st) => (typeof result.lines === 'function' ? result.lines(st) : result.lines || []);
        if (before && sameBut(after, inFileOrder(before), 'updatedAt'))
            return { code: 0, out: [`plan-status: ${verb} - nothing to change - plan ${plan.id} (${plan.rel})`, ...linesOf(before), `Resume: ${resumeText(before)}`] };
        after.updatedAt = ctx.at;
        const problems = validate(after);
        if (problems.length) throw new Refusal(4, `the result is not a valid status file: ${problems[0]}`);
        const text = `${JSON.stringify(after, null, 2)}\n`;
        // readStatus refuses a file over 1 MB, so writing one would leave a file no verb can read: the last good one stays.
        if (Buffer.byteLength(text) > MAX_BYTES) refuse('status.json would pass 1 MB - complete this plan and start a new one for the rest');
        try { writeWhole(path.join(plan.dir, 'status.json'), text); }
        catch (e) { throw new Refusal(4, `cannot write in ${plan.rel}: ${e && e.code || e}`); }
        return { code: 0, out: [`plan-status: ${verb} ok - plan ${plan.id} (${plan.rel})`, ...linesOf(after), `Resume: ${resumeText(after)}`] };
    }
    finally { removeQuiet(lock); }
}

// ---- the verbs ----

// R4: a value longer than its cap keeps its first cap - 3 characters and ends in '...'.
const cut = (value, cap) => (value.length > cap ? `${value.slice(0, cap - 3)}...` : value);
// The labelled values a verb reads from stdin, each cut at its cap; a label met with an empty value is missing.
function labelled(stdin, caps)
{
    const got = parseStdin(stdin, Object.keys(caps));
    return Object.fromEntries(Object.entries(got).filter(([, v]) => v !== '').map(([k, v]) => [k, cut(v, caps[k])]));
}
const usage = (line) => { throw new Refusal(2, line); };

// Sync's Markdown read and merge, shared with approve; a refusal text or null.
function syncFromMarkdown(plan, status, at)
{
    if (fs.existsSync(path.join(path.dirname(plan.dir), `${plan.id}.md`))) return `a flat ${plan.id}.md holds this id`;
    let md;
    try { md = fs.readFileSync(plan.md, 'utf8'); }
    catch { return `no ${plan.id}.md in the plan folder`; }
    return syncTasks(status, parseCards(md), at);
}

function verbSync(plan, ctx)
{
    return mutate(plan, 'sync', (status, c) =>
    {
        if (!c.created && status.approvedAt !== null && status.reopenedAt === null) return { refused: 'the plan is approved - redesign reopens it' };
        const refused = syncFromMarkdown(plan, status, c.at);
        return refused ? { refused } : { lines: (st) => [tasksLine(st)] };
    }, { ...ctx, createIfAbsent: true });
}

const GATE_LABELS = ['Oriented', 'Asked', 'Decisions', 'Scope', 'Existence', 'Passes', 'Findings', 'Gated'];
function verbGate(plan, ctx)
{
    const text = String(ctx.stdin).replace(/\r/g, '').replace(/\s+$/, '');
    const got = parseStdin(text, GATE_LABELS);
    return mutate(plan, 'gate', (status, c) =>
    {
        const missing = GATE_LABELS.find((l) => !(l in got));
        if (missing) return { refused: `no ${missing}: line` };
        // The verdict is the Gated: line's own value; anything after it (a blank line, a next step) stays in the block.
        status.gate = { at: c.at, verdict: cut(got.Gated.split('\n')[0].trim(), CAPS.field), block: cut(text, CAPS.gate) };
        return { lines: (st) => [`Gated: ${fold(st.gate.verdict)}`] };
    }, ctx);
}

const approvedLine = (st) => `Approved: ${st.approvedAt} - ${st.approval && st.approval.mode ? `mode ${st.approval.mode}` : `"${fold(st.approval && st.approval.words || '')}"`}`;
function verbApprove(plan, ctx)
{
    const mode = ctx.flags.mode;
    if (mode !== undefined && mode !== 'session' && mode !== 'agents') usage('--mode is session or agents');
    const { words } = labelled(ctx.stdin, { words: CAPS.field });
    if (mode === undefined && words === undefined) usage('approve needs --mode session|agents or a words: line');
    const approval = { mode: mode || null, words: words || null };
    return mutate(plan, 'approve', (status, c) =>
    {
        if (c.created || status.approvedAt === null || status.reopenedAt !== null)
        {
            const refused = syncFromMarkdown(plan, status, c.at);
            if (refused) return { refused };
            if (!status.tasks.length) return { refused: 'no task' };
            status.approvedAt = c.at;
            status.reopenedAt = null;
        }
        status.approval = approval;     // R6: an approval already given only changes its mode or words
        return { lines: (st) => [approvedLine(st)] };
    }, { ...ctx, createIfAbsent: true });
}

function verbRedesign(plan, ctx)
{
    const { why } = labelled(ctx.stdin, { why: CAPS.field });
    const named = ctx.flags.task;
    return mutate(plan, 'redesign', (status, c) =>
    {
        if (status.reopenedAt !== null) return { refused: 'the design is already reopened' };
        if (status.approvedAt === null) return { refused: 'the plan is not approved' };
        const flying = status.tasks.filter((t) => t.status === 'in_progress');
        if (named !== undefined)
        {
            if (!flying.some((t) => t.id === named)) return { refused: `task ${named} is not in_progress` };
            const other = flying.find((t) => t.id !== named);
            if (other) return { refused: `task ${other.id} is in_progress - finish or block it first` };
        }
        else if (flying.length) return { refused: `task ${flying[0].id} is in_progress - name it with --task` };
        status.reopens.push({ at: c.at, why: why || null, approvedAt: status.approvedAt, gate: status.gate, task: named || null });
        status.reopenedAt = c.at;
        status.gate = null;
        if (named !== undefined) Object.assign(status.tasks.find((t) => t.id === named), { status: 'todo', why: why || null });
        return { lines: [] };
    }, ctx);
}

function verbCursor(plan, ctx)
{
    const { note } = labelled(ctx.stdin, { note: CAPS.field });
    if (note === undefined) usage('cursor needs a note: line');     // R8: never a cleared note
    return mutate(plan, 'cursor', (status) => { status.resume.note = note; return { lines: [] }; }, ctx);
}

function verbDecide(plan, ctx)
{
    const { choice, precedent } = labelled(ctx.stdin, { choice: CAPS.field, precedent: CAPS.field });
    if (choice === undefined) usage('decide needs a choice: line');
    if (precedent === undefined) usage('decide needs a precedent: line');
    return mutate(plan, 'decide', (status, c) =>
    {
        status.decisions.push({ at: c.at, task: ctx.flags.task || null, choice, precedent });
        return { lines: [] };
    }, ctx);
}

function verbDeviate(plan, ctx)
{
    const { what, why, asked } = labelled(ctx.stdin, { what: CAPS.field, why: CAPS.field, asked: CAPS.field });
    if (what === undefined) usage('deviate needs a what: line');
    if (why === undefined) usage('deviate needs a why: line');
    return mutate(plan, 'deviate', (status, c) =>
    {
        status.deviations.push({ at: c.at, task: ctx.flags.task || null, what, why, asked: asked || null });
        return { lines: [] };
    }, ctx);
}

function verbConformance(plan, ctx)
{
    const { verdict, reviewer, skipped } = labelled(ctx.stdin, { verdict: CAPS.field, reviewer: CAPS.field, skipped: CAPS.field });
    if (reviewer === undefined && skipped === undefined) usage('conformance needs a reviewer: or a skipped: line');
    if (reviewer !== undefined && verdict === undefined) usage('conformance needs a verdict: line');    // R20
    return mutate(plan, 'conformance', (status, c) =>
    {
        status.conformance = { at: c.at, verdict: verdict || 'skipped', reviewer: reviewer || null, skipped: skipped || null };
        return { lines: (st) => [`Conformance: ${fold(st.conformance.verdict)}`] };
    }, ctx);
}

function verbComplete(plan, ctx)
{
    const { suite } = labelled(ctx.stdin, { suite: CAPS.result });
    if (suite === undefined) usage('complete needs a suite: line');
    return mutate(plan, 'complete', (status, c) =>
    {
        if (status.approvedAt === null) return { refused: 'the plan is not approved' };
        if (status.reopenedAt !== null) return { refused: 'the design is reopened - approve it again first' };     // R7
        const flying = status.tasks.find((t) => t.status === 'in_progress');
        if (flying) return { refused: `task ${flying.id} is in_progress` };
        const open = status.tasks.filter((t) => t.status !== 'done').map((t) => t.id);
        if (open.length && !ctx.flags['with-open'])
            return { refused: `${open.length === 1 ? `task ${open[0]} is` : `tasks ${open.join(', ')} are`} not done - finish or drop them, or pass --with-open` };
        status.completedAt = c.at;
        status.completion = { suite, open };
        status.resume.next = null;
        return { keepNext: true, lines: (st) => [`Completed: ${st.completedAt}`] };
    }, ctx);
}

// ---- the task verbs (spec 3's rows; the plan's Task 5) ----

const minutesBetween = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
// `Tasks: <done> of <total> done - task <id> <word>`, and for done its estimate and the minutes taken.
function taskLine(st, id, word)
{
    const t = st.tasks.find((x) => x.id === id);
    let suffix = ` - task ${id} ${word}`;
    if (t && word === 'done')
    {
        if (t.estimateMin !== null) suffix += `, ${t.estimateMin}m estimated`;
        if (t.startedAt && t.doneAt) suffix += `, ${minutesBetween(t.startedAt, t.doneAt)}m taken`;
    }
    return tasksLine(st, suffix);
}

// A task verb: the approval rule, then the verb's own move on the task --task names.
function taskVerb(plan, ctx, verb, move)
{
    const id = ctx.flags.task;
    return mutate(plan, verb, (status, c) =>
    {
        if (status.approvedAt === null) return { refused: 'the plan is not approved' };
        const t = status.tasks.find((x) => x.id === id);
        const r = move(t, c, status);
        if (r && r.refused) return r;
        return { lines: (st) => [taskLine(st, id, st.tasks.find((x) => x.id === id).status), ...(r && r.warn ? r.warn : [])] };
    }, ctx);
}

function verbStart(plan, ctx)
{
    const session = ctx.env.CLAUDE_CODE_SESSION_ID || null;
    return taskVerb(plan, ctx, 'start', (t, c) =>
    {
        if (t.status === 'done') return { refused: `task ${t.id} is done - reopen it first` };
        if (t.status === 'in_progress')
            return { warn: t.by && session && t.by !== session ? [`!! task ${t.id} was started by another session (${t.by.slice(0, 8)})`] : [] };
        t.status = 'in_progress';
        if (t.startedAt === null) t.startedAt = c.at;
        t.by = session;
        return null;
    });
}

function verbDone(plan, ctx)
{
    const { result } = labelled(ctx.stdin, { result: CAPS.result });
    if (result === undefined) usage('done needs a result: line');
    return taskVerb(plan, ctx, 'done', (t, c) =>
    {
        if (t.status === 'done') return null;        // nothing to change: the stored result is kept
        if (t.status === 'todo' || t.status === 'failed') return { refused: `task ${t.id} is ${t.status} - start it first` };
        Object.assign(t, { status: 'done', doneAt: c.at, result });
        return null;
    });
}

function verbBlock(plan, ctx)
{
    const { needs } = labelled(ctx.stdin, { needs: CAPS.field });
    return taskVerb(plan, ctx, 'block', (t) =>
    {
        if (t.status !== 'in_progress') return { refused: `task ${t.id} is not in_progress` };
        Object.assign(t, { status: 'blocked', needs: needs || null });
        return null;
    });
}

function verbFail(plan, ctx)
{
    const { why } = labelled(ctx.stdin, { why: CAPS.field });
    return taskVerb(plan, ctx, 'fail', (t) =>
    {
        if (t.status !== 'in_progress' && t.status !== 'blocked') return { refused: `task ${t.id} is not in_progress or blocked` };
        Object.assign(t, { status: 'failed', why: why || null });
        return null;
    });
}

function verbReopen(plan, ctx)
{
    const { why } = labelled(ctx.stdin, { why: CAPS.field });
    return taskVerb(plan, ctx, 'reopen', (t) =>
    {
        if (t.status !== 'done') return { refused: `task ${t.id} is not done` };
        Object.assign(t, { status: 'in_progress', doneAt: null, why: why || null });
        return null;
    });
}

function verbDrop(plan, ctx)
{
    const { why } = labelled(ctx.stdin, { why: CAPS.field });
    const id = ctx.flags.task;
    return mutate(plan, 'drop', (status, c) =>
    {
        if (status.approvedAt === null) return { refused: 'the plan is not approved' };
        const t = status.tasks.find((x) => x.id === id);
        if (t.status !== 'todo' && t.status !== 'failed') return { refused: `task ${id} is not todo or failed` };
        status.tasks = status.tasks.filter((x) => x !== t);
        status.dropped.push({ id, title: t.title, at: c.at, why: why || null });
        status.retiredIds.push(id);
        return { lines: (st) => [tasksLine(st, ` - task ${id} dropped`)] };
    }, ctx);
}

const ADDED_HEADING_RE = /^### Task - (.+)$/;
function verbAddTask(plan, ctx)
{
    const text = String(ctx.stdin).replace(/\r/g, '').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
    const heading = ADDED_HEADING_RE.exec(text.split('\n')[0] || '');
    return mutate(plan, 'add-task', (status) =>
    {
        if (status.approvedAt === null) return { refused: 'the plan is not approved' };
        if (!heading) return { refused: "the heading is '### Task - <title>' - the script gives the id" };
        const parsed = parseCards(text.replace(/^### Task - /, '### Task 1 - '));
        const estimateMin = parsed.cards.length ? parsed.cards[0].estimateMin : null;
        if (estimateMin === null && status.tasks.some((t) => t.estimateMin !== null)) return { refused: 'the other tasks carry an estimate and this card has none' };
        const used = [...status.tasks.map((t) => t.id), ...status.retiredIds, ...status.dropped.map((d) => d.id)].map(Number);
        const id = String(used.length ? Math.max(...used) + 1 : 1);
        const added = { ...newTask(id, heading[1].trim(), estimateMin), card: cut(text, CAPS.card) };
        const after = ctx.flags.after === undefined ? -1 : status.tasks.findIndex((t) => t.id === ctx.flags.after);
        status.tasks.splice(after < 0 ? status.tasks.length : after + 1, 0, added);
        return { lines: (st) => [tasksLine(st, ` - task ${id} added`)] };
    }, ctx);
}

// ---- the reading verbs (no lock, no write) ----

// The plan's status for a reading verb: { status } or a finished answer (no folder, no status yet, garbage).
function readFor(plan, verb)
{
    if (!fs.existsSync(plan.dir)) throw new Refusal(2, `no plan folder at ${plan.rel}`);
    const read = readStatus(plan.dir);
    if (read.ok) return { status: read.status };
    if (read.why === 'absent') return { answer: { code: 0, out: [`plan-status: ${verb} - no status yet - run sync - plan ${plan.id} (${plan.rel})`] } };
    throw new Refusal(3, NOT_SCHEMA(read.detail));
}

function statusLines(st)
{
    const out = [];
    if (st.gate) out.push(`Gated: ${fold(st.gate.verdict)}`);
    if (st.approvedAt) out.push(approvedLine(st));
    if (st.conformance) out.push(`Conformance: ${fold(st.conformance.verdict)}`);
    if (st.completedAt) out.push(`Completed: ${st.completedAt}`);
    out.push(`Resume: ${resumeText(st)}`, tasksLine(st));
    return out;
}

// A labelled value, its later lines indented with it.
const field = (label, text) => `  ${label}: ${String(text)}`.split('\n').map((l, i) => (i ? `  ${l}` : l));
const section = (title, body) => [`## ${title}`, ...(body.length ? body : ['none']), ''];
// An added task's card as `### Task <id> - <title>`, then the card's text below its own first line.
const addedCard = (t) => [`### Task ${t.id} - ${t.title}`, ...t.card.split('\n').slice(1)];

function fullLines(st)
{
    const tasks = st.tasks.flatMap((t) =>
    {
        const parts = [];
        if (t.estimateMin !== null) parts.push(`${t.estimateMin}m estimated`);
        if (t.status === 'done' && t.startedAt && t.doneAt) parts.push(`${minutesBetween(t.startedAt, t.doneAt)}m taken`);
        const head = `${t.id} ${t.status} - ${t.title}${parts.length ? ` - ${parts.join(', ')}` : ''}`;
        const extra = t.status === 'done' && t.result !== null ? field('result', t.result)
            : t.status === 'blocked' && t.needs !== null ? field('needs', t.needs)
                : t.status !== 'done' && t.status !== 'blocked' && t.why !== null ? field('why', t.why) : [];
        return [head, ...extra];
    });
    const entry = (e, labels) => [`- ${e.task ? `task ${e.task}` : 'plan'} (${e.at})`,
        ...labels.flatMap((l) => (e[l] === null || e[l] === undefined ? [] : field(l, l === 'asked' ? `"${e[l]}"` : e[l])))];
    return [
        ...section('Tasks', tasks),
        ...section('Decisions', st.decisions.flatMap((e) => entry(e, ['choice', 'precedent']))),
        ...section('Deviations', st.deviations.flatMap((e) => entry(e, ['what', 'why', 'asked']))),
        ...section('Dropped', st.dropped.map((d) => `- ${d.id} - ${d.title}${d.why ? ` - ${fold(d.why)}` : ''}`)),
        ...section('Added cards', st.tasks.filter((t) => t.card !== null).flatMap(addedCard)),
    ];
}

function verbShow(plan, ctx)
{
    const r = readFor(plan, 'show');
    if (r.answer) return r.answer;
    const out = [`plan-status: show ok - plan ${plan.id} (${plan.rel})`, ...statusLines(r.status)];
    if (ctx.flags.full) out.push('', ...fullLines(r.status));
    return { code: 0, out };
}

// The Markdown's lines outside fences, each with its fence state, so a quoted heading is never read as one.
function headingAt(lines)
{
    let fence = null;
    return lines.map((line) =>
    {
        const marker = /^(`{3,}|~{3,})/.exec(line);
        if (fence) { if (marker && marker[1][0] === fence) fence = null; return false; }
        if (marker) { fence = marker[1][0]; return false; }
        return /^#{2,3} /.test(line);
    });
}

function verbResume(plan, ctx)
{
    const r = readFor(plan, 'resume');
    if (r.answer) return r.answer;
    const st = r.status;
    const out = [`plan-status: resume ok - plan ${plan.id} (${plan.rel})`, ...statusLines(st), ''];
    let lines = null;
    try { lines = fs.readFileSync(plan.md, 'utf8').replace(/\r\n?/g, '\n').split('\n'); }
    catch { out.push(`!! ${plan.id}.md is missing`); }
    const heading = lines ? headingAt(lines) : [];
    if (lines)
    {
        let end = lines.findIndex((l, i) => heading[i] && /^## Tasks\s*$/.test(l));
        if (end < 0) end = lines.findIndex((l, i) => heading[i] && CARD_RE.test(l));
        out.push(...lines.slice(0, end < 0 ? lines.length : end));
    }
    for (const t of st.tasks.filter((x) => x.status !== 'done'))
    {
        const at = lines ? lines.findIndex((l, i) => heading[i] && l.startsWith(`### Task ${t.id} - `)) : -1;
        if (at >= 0)
        {
            let end = lines.findIndex((l, i) => i > at && heading[i]);
            if (end < 0) end = lines.length;
            out.push(...lines.slice(at, end));
        }
        else if (t.card !== null) out.push(...addedCard(t));
        else out.push(`### Task ${t.id} - ${t.title}`, '(no card in the plan)');
    }
    return { code: 0, out };
}

// ---- parseCall: a plan-status call in a shell command's text (the hooks' one reader of the call) ----

const CALL_RE = /(?:^|[\s;&|(])node\s+(?:"([^"\n]*plan-status\.js)"|'([^'\n]*plan-status\.js)'|([^\s'";&|()<>]*plan-status\.js))(?=\s|$)/;
// The words of a command line up to its first |, ;, &, < or > outside quotes, each with its quotes removed.
function wordsOf(text)
{
    const words = [];
    let word = null;
    let quote = null;
    for (const ch of text)
    {
        if (quote) { if (ch === quote) quote = null; else word += ch; continue; }
        if (ch === '"' || ch === "'") { quote = ch; word = word === null ? '' : word; continue; }
        if (ch === '\n' || '|;&<>'.includes(ch)) break;
        if (/\s/.test(ch)) { if (word !== null) words.push(word); word = null; continue; }
        word = (word === null ? '' : word) + ch;
    }
    if (word !== null) words.push(word);
    return words;
}

function parseCall(command)
{
    if (typeof command !== 'string' || !command) return null;
    const m = CALL_RE.exec(command);
    if (!m) return null;
    const words = wordsOf(command.slice(m.index + m[0].length));
    const verb = words[0];
    if (![...VERBS.write, ...VERBS.read].includes(verb)) return null;
    const valueOf = (flag) => { const i = words.indexOf(flag); return i >= 0 && i + 1 < words.length ? words[i + 1] : null; };
    const plan = valueOf('--plan');
    if (plan !== null && /[$`]/.test(plan)) return null;
    const namesNone = verb === 'list' || (verb === 'check' && words.includes('--all'));
    if (!namesNone && plan === null) return null;
    return { verb, plan, task: valueOf('--task') };
}

// Every problem of one plan's status.json: null when it has none, or [] when absent.
function problemsOf(dir)
{
    const read = readStatus(dir);
    if (read.ok) return [];
    if (read.why === 'absent') return null;
    if (read.why === 'unreadable') return [`status.json unreadable - ${read.detail}`];
    try { return validate(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))); }
    catch { return [read.detail]; }
}

function verbCheck(ctx)
{
    const found = [];
    let checked = 0;
    let head;
    if (ctx.flags.all)
    {
        for (const p of layout.planFiles(ctx.root, ctx.env).filter((f) => f.shape === 'folder'))
        {
            const problems = problemsOf(p.dir);
            if (problems === null) continue;
            checked++;
            for (const pr of problems) found.push(`!! ${p.id}: ${pr}`);
        }
        head = `plan-status: check ok - ${checked} checked`;
    }
    else
    {
        const plan = ctx.plan;
        const problems = problemsOf(plan.dir);
        if (problems === null) return { code: 0, out: [`plan-status: check - no status yet - run sync - plan ${plan.id} (${plan.rel})`] };
        for (const pr of problems) found.push(`!! ${plan.id}: ${pr}`);
        head = `plan-status: check ok - plan ${plan.id} (${plan.rel})`;
    }
    if (!found.length) return { code: 0, out: [head] };
    return { code: 3, out: found, err: `plan-status: check found ${found.length} problem${found.length === 1 ? '' : 's'}` };
}

function stampOf(status)
{
    if (status.completedAt) return `completed ${status.completedAt}`;
    if (status.reopenedAt) return `reopened ${status.reopenedAt}`;
    if (status.approvedAt) return `approved ${status.approvedAt}`;
    return 'not approved';
}

function verbList(ctx)
{
    const plans = layout.planFiles(ctx.root, ctx.env);
    const folders = plans.filter((p) => p.shape === 'folder').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // PF1 flat plan - until 4.0.0: list counts the single-file plans beside the folders
    const flat = plans.length - folders.length;
    const out = ['plan-status: list ok'];
    for (const p of folders)
    {
        const read = readStatus(p.dir);
        const state = read.ok ? `${stampOf(read.status)} - ${counts(read.status).done} of ${counts(read.status).total} done - ${read.status.resume.next ? `next task ${read.status.resume.next}` : 'no task left'}`
            : read.why === 'absent' ? 'not synced' : 'unreadable';
        out.push(`${p.id} - ${state} (${relOf(ctx.root, p.dir)})`);
    }
    if (flat) out.push(`flat: ${flat}`);
    if (!folders.length && !flat) out.push('no plan');
    return { code: 0, out };
}

// The verbs this engine answers; a later task adds its own here.
const HANDLERS = {
    sync: (ctx) => verbSync(ctx.plan, ctx),
    gate: (ctx) => verbGate(ctx.plan, ctx),
    approve: (ctx) => verbApprove(ctx.plan, ctx),
    redesign: (ctx) => verbRedesign(ctx.plan, ctx),
    cursor: (ctx) => verbCursor(ctx.plan, ctx),
    decide: (ctx) => verbDecide(ctx.plan, ctx),
    deviate: (ctx) => verbDeviate(ctx.plan, ctx),
    conformance: (ctx) => verbConformance(ctx.plan, ctx),
    complete: (ctx) => verbComplete(ctx.plan, ctx),
    start: (ctx) => verbStart(ctx.plan, ctx),
    done: (ctx) => verbDone(ctx.plan, ctx),
    block: (ctx) => verbBlock(ctx.plan, ctx),
    fail: (ctx) => verbFail(ctx.plan, ctx),
    reopen: (ctx) => verbReopen(ctx.plan, ctx),
    'add-task': (ctx) => verbAddTask(ctx.plan, ctx),
    drop: (ctx) => verbDrop(ctx.plan, ctx),
    show: (ctx) => verbShow(ctx.plan, ctx),
    resume: (ctx) => verbResume(ctx.plan, ctx),
    check: (ctx) => verbCheck(ctx),
    list: (ctx) => verbList(ctx),
};

function parseArgs(argv)
{
    const flags = {};
    const rest = [];
    for (let i = 0; i < argv.length; i++)
    {
        const a = argv[i];
        if (!a.startsWith('--')) { rest.push(a); continue; }
        const name = a.slice(2);
        if (VALUE_FLAGS.includes(name))
        {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) throw new Refusal(2, `--${name} needs a value`);
            flags[name] = v;
            i++;
        }
        else if (BOOL_FLAGS.includes(name)) flags[name] = true;
        else throw new Refusal(2, `unknown flag ${a}`);
    }
    return { flags, rest };
}

// The engine as a function: never throws, never exits.
function run(argv, { now = () => new Date(), stdin = '', cwd = process.cwd(), env = process.env } = {})
{
    const lines = (out) => (out && out.length ? `${out.join('\n')}\n` : '');
    try
    {
        const [verb, ...args] = argv;
        const all = [...VERBS.write, ...VERBS.read];
        if (!verb) throw new Refusal(2, `no verb - one of ${all.join(', ')}`);
        if (!HANDLERS[verb]) throw new Refusal(2, `unknown verb '${verb}'`);
        const { flags, rest } = parseArgs(args);
        if (rest.length) throw new Refusal(2, `${verb} takes no argument '${rest[0]}'`);
        const takes = TAKES[verb];
        for (const f of Object.keys(flags)) if (!takes.flags.includes(f)) throw new Refusal(2, `${verb} takes no --${f}`);
        if (verb === 'check' && Boolean(flags.plan) === Boolean(flags.all)) throw new Refusal(2, 'check needs --plan <ref> or --all');
        for (const f of takes.need) if (flags[f] === undefined) throw new Refusal(2, `${verb} needs --${f} <${f === 'plan' ? 'ref' : 'id'}>`);
        const ctx = { verb, flags, stdin, cwd, env, at: stamp(now()), root: rootOf(cwd, env) };
        if (flags.plan !== undefined)
        {
            const plan = resolvePlan(flags.plan, { cwd, env });
            if (!plan.ok) throw new Refusal(2, plan.why);
            ctx.plan = plan;
        }
        const r = HANDLERS[verb](ctx);
        return { code: r.code, out: lines(r.out), err: r.err ? `${r.err}\n` : '' };
    }
    catch (e)
    {
        if (e instanceof Refusal) return { code: e.code, out: '', err: `plan-status: ${fold(e.line)}\n` };
        return { code: 4, out: '', err: `plan-status: ${fold(e && e.message || e)}\n` };
    }
}

// What the CLI hands a verb as stdin: a pipe or a file for a verb that reads one, never a terminal - a read of a
// terminal waits for Ctrl-D, and approve --mode or block are valid with nothing piped.
function stdinFor(argv, { isTTY, read })
{
    if (!STDIN_VERBS.includes(argv[0]) || isTTY) return '';
    try { return read(); }
    catch { return ''; }
}

module.exports = {
    SCHEMA, MAX_BYTES, TIME_RE, STATUSES, KEYS, TASK_KEYS, CAPS, VERBS,
    stamp, emptyStatus, validate, readStatus, writeWhole, resolvePlan, parseStdin, parseCards, counts, resumeText, run, parseCall, stdinFor,
    // for the verbs a later task adds
    mutate, syncTasks, HANDLERS, Refusal, tasksLine, newTask, labelled, cut, usage,
};

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const stdin = stdinFor(argv, { isTTY: process.stdin.isTTY, read: () => fs.readFileSync(0, 'utf8') });
    try { layout.applyVariables(process.env.CLAUDE_PROJECT_DIR || layout.projectRootOf(process.cwd()).checkout); }
    catch { /* the defaults stand */ }
    const r = run(argv, { stdin });
    if (r.out) process.stdout.write(r.out);
    if (r.err) process.stderr.write(r.err);
    process.exitCode = r.code;
}
