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

module.exports = {
    SCHEMA, MAX_BYTES, TIME_RE, STATUSES, KEYS, TASK_KEYS, CAPS,
    stamp, emptyStatus, validate, readStatus, writeWhole,
};
