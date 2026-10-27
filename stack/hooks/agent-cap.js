// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// ALFRED_CODE_MAXIMUM_RUN_AGENTS (the user's task of 2026-10-27): how many of a session's agents may run at once. Not a
// hook - a module the dispatch guard, the stop contract and the answer hook require inside a try, so a copy without it
// fails open. Spec: the maximum-run-agents design of 2026-10-27.
//
// A PreToolUse payload carries no list of running agents, so the session keeps one: flat files in
// <data root>/state/sessions/, one line of JSON each, written to a temp name and renamed into place, ordered by an
// exclusive-create lock. The 7-day sweep of the AGENT-CAP- prefix takes them all.
//   AGENT-CAP-<sid>-P-<tool_use_id>  a dispatch not started yet: { type, at, parent }
//   AGENT-CAP-<sid>-R-<agent_id>     a started agent: { type, at, parent, transcript, stop }
//   AGENT-CAP-<sid>.lock             the lock
//   AGENT-CAP-<sid>.denied           a main-session denial the Stop half may continue once, until a typed prompt
// Every function fails open: a throw inside returns the neutral value.
'use strict';

const fs = require('fs');
const path = require('path');

const CAP_DEFAULT = 5;
const CAP_MAX = 50;
const PENDING_MS = 60 * 1000;
// Just over the Bash tool's 10-minute cap; measured 2026-10-27 over 2,289 subagent transcripts: 26 working gaps past it.
const ACTIVE_MS = 12 * 60 * 1000;
const STOPPED_KEEP_MS = 2 * 60 * 1000;
const SENT_BACK_MS = 1000;
const LOCK_RETRY_MS = 20;
const LOCK_WAIT_MS = 1500;
const LOCK_STALE_MS = 5000;
const TYPES_SHOWN = 8;
// The harness's own agent id: every one of 4,583 local subagent transcripts (2026-10-27) is named agent-a<16 hex>. A
// SendMessage `to` of that shape naming no counted agent is a resume even when its stopped file is gone; another shape
// (a name, a teammate) is out of model, so a changed id format falls back to the registry alone.
const AGENT_ID = /^a[0-9a-f]{16}$/;
const SETTLED_STATUS = /^(?:completed?|done|failed|killed|stopped|cancell?ed|error|finished)$/i;   // docs-session.js's test

// The one parse rule: the value, trimmed, is a whole-string integer, else 5; 0 is off; past 50 reads as 50.
function capOf(env = process.env)
{
    const s = String((env || {}).ALFRED_CODE_MAXIMUM_RUN_AGENTS ?? '').trim();
    if (!/^\d+$/.test(s)) return CAP_DEFAULT;
    return Math.min(Number(s), CAP_MAX);
}

// An id as part of a file name: every character outside [A-Za-z0-9_-] becomes `_`, cut to 64; an agent id loses a
// leading `agent-` (the docs spell it both ways). '' when no letter or digit survives - no such id names a file.
function cleanId(id, { agent = false } = {})
{
    let s = String(id === undefined || id === null ? '' : id);
    if (agent) s = s.replace(/^agent-/, '');
    s = s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    return /[A-Za-z0-9]/.test(s) ? s : '';
}

function openRegistry(root, sessionId, env = process.env)
{
    try
    {
        const sid = cleanId(sessionId);
        if (!sid || !root) return null;
        const layout = require('./layout.js');
        const dir = path.dirname(layout.statePath(root, 'sessions', 'x', env));
        // The 7-day sweep of the prefix, every session's files at once - at most once a day per folder (the prelude's stamp).
        try { require('./hook-prelude.js').sweepStale(dir, 'AGENT-CAP-'); } catch { /* no prelude: nothing swept */ }
        return { dir, sid };
    }
    catch { return null; }
}

const fileOf = (reg, kind, id) => path.join(reg.dir, `AGENT-CAP-${reg.sid}-${kind}-${id}`);
const lockOf = (reg) => path.join(reg.dir, `AGENT-CAP-${reg.sid}.lock`);
const deniedOf = (reg) => path.join(reg.dir, `AGENT-CAP-${reg.sid}.denied`);

function readEntry(file)
{
    try
    {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    }
    catch { return null; }
}
function writeEntry(file, body)
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(body) + '\n');
    fs.renameSync(tmp, file);
}
const remove = (file) => { try { fs.rmSync(file, { force: true }); } catch { /* gone */ } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const mtimeOf = (file) => { try { return file ? fs.statSync(file).mtimeMs : 0; } catch { return 0; } };

// Every entry of this session: { kind: 'P' | 'R', id, name, file, body } - a temp file never matches.
function entries(reg)
{
    const re = new RegExp(`^AGENT-CAP-${reg.sid}-([PR])-([A-Za-z0-9_-]+)$`);
    const out = [];
    let listed = [];
    try { listed = fs.readdirSync(reg.dir); } catch { return out; }
    for (const name of listed)
    {
        const m = re.exec(name);
        if (!m) continue;
        const file = path.join(reg.dir, name);
        out.push({ kind: m[1], id: m[2], name, file, body: readEntry(file) });
    }
    return out;
}

// The lock in a line: exclusive create, retried every 20 ms for up to 1.5 s, broken past 5 s. `ok: false` when it was
// never taken; a throw inside `fn` still releases it and reads as no value.
function withLock(reg, fn)
{
    const lock = lockOf(reg);
    const deadline = Date.now() + LOCK_WAIT_MS;
    try { fs.mkdirSync(reg.dir, { recursive: true }); } catch { return { ok: false }; }
    for (;;)
    {
        try { fs.closeSync(fs.openSync(lock, 'wx')); break; }
        catch (err)
        {
            if (!err || err.code !== 'EEXIST') return { ok: false };
            if (Date.now() - mtimeOf(lock) > LOCK_STALE_MS) { remove(lock); continue; }
            if (Date.now() >= deadline) return { ok: false };
            sleep(LOCK_RETRY_MS);
        }
    }
    try { return { ok: true, value: fn() }; }
    catch { return { ok: true, value: undefined }; }
    finally { remove(lock); }
}

// The count, under the lock. A pending file counts under 60 s; a started one while its activity - the newer of its `at`
// and its transcript's mtime - is under 12 minutes, and after a stop only when the transcript was written more than a
// second past it (a hold sent the seat back); a file a counted one names as `parent` counts too. What does not count is
// deleted, except a stopped file in its first 2 minutes; one that expired with no stop writes an `agent-cap-expired` row.
function count(reg, { now = Date.now(), probe = () => {} } = {})
{
    const none = { running: 0, types: [], counted: new Set(), live: [] };
    try
    {
        const all = entries(reg);
        const alive = new Map();
        for (const e of all)
        {
            if (!e.body) { remove(e.file); continue; }
            const at = Number(e.body.at) || 0;
            if (e.kind === 'P') { if (now - at < PENDING_MS) alive.set(e.name, e); else remove(e.file); continue; }
            const written = mtimeOf(e.body.transcript);
            e.activity = Math.max(at, written);
            const stop = Number(e.body.stop) || 0;
            const fresh = now - e.activity < ACTIVE_MS;
            if (fresh && (!stop || written > stop + SENT_BACK_MS)) alive.set(e.name, e);
        }
        const started = new Map(all.filter((e) => e.kind === 'R' && e.body).map((e) => [e.id, e]));
        for (let grew = true; grew;)
        {
            grew = false;
            for (const e of [...alive.values()])
            {
                const parent = started.get(cleanId(e.body.parent, { agent: true }));
                if (parent && !alive.has(parent.name)) { alive.set(parent.name, parent); grew = true; }
            }
        }
        for (const e of started.values())
        {
            if (alive.has(e.name)) continue;
            const stop = Number(e.body.stop) || 0;
            if (stop && now - stop < STOPPED_KEEP_MS) continue;
            if (!stop) probe('agent-cap-expired', `probe: ${e.body.type || 'an agent'} wrote nothing for 12 minutes and no SubagentStop came - its running file is dropped`);
            remove(e.file);
        }
        const live = [...alive.values()];
        return { running: live.length, types: live.map((e) => String(e.body.type || 'agent')), counted: new Set(live.map((e) => `${e.kind}-${e.id}`)), live };
    }
    catch { return none; }
}

function addPending(reg, toolUseId, { type = '', parent = '', now = Date.now() } = {})
{
    try
    {
        const id = cleanId(toolUseId) || `t${now}${process.pid}`;
        writeEntry(fileOf(reg, 'P', id), { type: String(type || 'general-purpose'), at: now, parent: String(parent || '') });
        return id;
    }
    catch { return ''; }
}
function dropPending(reg, toolUseId)
{
    const id = cleanId(toolUseId);
    if (id) remove(fileOf(reg, 'P', id));
}

// A start takes the oldest pending file of its type, else the oldest one, and carries its parent; a start with none
// writes its running file all the same - whatever runs, counts. A resume starts the same id again and clears `stop`.
function startAgent(reg, { agentId, type = '', transcript = '', now = Date.now() } = {})
{
    try
    {
        const id = cleanId(agentId, { agent: true });
        if (!id) return;
        const pending = entries(reg).filter((e) => e.kind === 'P' && e.body).sort((a, b) => (Number(a.body.at) || 0) - (Number(b.body.at) || 0));
        const taken = pending.find((e) => e.body.type === type) || pending[0];
        const before = readEntry(fileOf(reg, 'R', id));
        const parent = taken ? String(taken.body.parent || '') : String((before && before.parent) || '');
        if (taken) remove(taken.file);
        writeEntry(fileOf(reg, 'R', id), { type: String(type || (taken && taken.body.type) || 'agent'), at: now, parent, transcript: String(transcript || (before && before.transcript) || '') });
    }
    catch { /* fail open */ }
}

// A stop sets `stop`, and the transcript the payload reports when it sits inside the session's folder; nothing is
// deleted, so a seat a hold sends back is still found.
function stopAgent(reg, { agentId, transcriptPath = '', sessionDir = '', now = Date.now() } = {})
{
    try
    {
        const id = cleanId(agentId, { agent: true });
        if (!id) return;
        const file = fileOf(reg, 'R', id);
        const body = readEntry(file);
        if (!body) return;
        const reported = transcriptPath ? path.resolve(String(transcriptPath)) : '';
        const home = sessionDir ? path.resolve(String(sessionDir)) : '';
        if (reported && home && reported.startsWith(home + path.sep)) body.transcript = reported;
        body.stop = now;
        writeEntry(file, body);
    }
    catch { /* fail open */ }
}

// The main session's Stop, with the payload's background_tasks: every main-session pending file goes (by its Stop each
// dispatch started or was refused), then the counted started files are matched to the agents still in flight - by id
// when any id matches, else the N most recently active are kept. No registry of tasks: nothing is touched.
function reconcile(reg, backgroundTasks, { now = Date.now(), probe = () => {} } = {})
{
    try
    {
        if (!Array.isArray(backgroundTasks)) return 0;
        let removed = 0;
        for (const e of entries(reg))
        {
            if (e.kind === 'P' && (!e.body || !String(e.body.parent || ''))) { remove(e.file); removed++; }
        }
        const inflight = backgroundTasks.filter((t) => t && typeof t === 'object' && t.type === 'subagent' && !SETTLED_STATUS.test(String(t.status || '')));
        const ids = new Set(inflight.map((t) => cleanId(t.id, { agent: true })).filter(Boolean));
        const started = count(reg, { now, probe }).live.filter((e) => e.kind === 'R');
        const byId = started.some((e) => ids.has(e.id));
        const keep = byId ? new Set(started.filter((e) => ids.has(e.id)).map((e) => e.id))
            : new Set([...started].sort((a, b) => b.activity - a.activity).slice(0, inflight.length).map((e) => e.id));
        for (const e of started) if (!keep.has(e.id)) { remove(e.file); removed++; }
        if (removed) probe('agent-cap-reconciled', `probe: the Stop reconcile dropped ${removed} agent-cap file(s) - ${byId ? 'matched by id' : 'kept the most recently active'} against ${inflight.length} agent(s) in flight`);
        return removed;
    }
    catch { return 0; }
}

// The ONE gate both halves read, so they cannot drift: the cap stands down - writing nothing - with no session id, its
// part or either hook switched off, `minimal`, a repo never set up, a Cursor payload or a cap of 0. `canContinue` is the
// Stop half's extra gate: guard-answer scopes `.denied` to its prompt, so with it off a Stop never continues for the cap.
function capGates(payload, env = process.env, { stop = false } = {})
{
    try
    {
        if (!payload || typeof payload !== 'object') return null;
        const pre = require('./hook-prelude.js');
        if (pre.cursorHost(payload)) return null;
        for (const hook of ['guard-unapproved-dispatch', 'guard-stop-contract'])
        {
            if (pre.hookDisabled(hook, env) || pre.profileOff(hook, env)) return null;
        }
        if (pre.partOff('guard-unapproved-dispatch', 'cap', env) || pre.neverSetUp(env)) return null;
        const n = capOf(env);
        if (!n) return null;
        const root = env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
        const reg = openRegistry(root, payload.session_id, env);
        if (!reg) return null;
        return { n, reg, root, canContinue: !stop || !(pre.hookDisabled('guard-answer', env) || pre.profileOff('guard-answer', env)) };
    }
    catch { return null; }
}

// The denial, three lines: the count and the types (at most 8, then how many more), what to do - a seat works inline -
// and whose the setting is. It never says how to lift the cap: a model told so could write 0 into the shared settings.
function denialText(c, n, { seat = false } = {})
{
    const types = c.types.slice(0, TYPES_SHOWN).join(', ') + (c.types.length > TYPES_SHOWN ? ` and ${c.types.length - TYPES_SHOWN} more` : '');
    return `${c.running} of this session's agents are running and ALFRED_CODE_MAXIMUM_RUN_AGENTS is ${n}: ${types}\n` +
        (seat ? 'Do this step yourself - the session is at its cap.' : 'Dispatch this one when one hands back - its notice wakes you - and send the rest of a fan-out the same way.') + '\n' +
        "The setting is the user's - never change it yourself.";
}

// Where a seat's transcript lands before its SubagentStop reports it: <session folder>/<session id>/subagents/agent-<id>.jsonl.
function subagentTranscript(transcriptPath, sessionId, agentId)
{
    const sid = cleanId(sessionId);
    const id = cleanId(agentId, { agent: true });
    if (!transcriptPath || !sid || !id) return '';
    return path.join(path.dirname(String(transcriptPath)), sid, 'subagents', `agent-${id}.jsonl`);
}

// `.denied`: a main-session denial the Stop half continues once; a passing main-session dispatch or a typed prompt clears it.
const markDenied = (reg, c, n) => { try { writeEntry(deniedOf(reg), { at: Date.now(), running: c.running, cap: n }); } catch { /* fail open */ } };
const clearDenied = (reg) => remove(deniedOf(reg));

// The line a session's context and a seat's start carry so a flow knows its number before it fans out - '' at the
// default 5, so a session on the default pays nothing.
function startLine(env = process.env)
{
    const n = capOf(env);
    if (n === CAP_DEFAULT) return '';
    return n ? `Agents at once: ${n} (ALFRED_CODE_MAXIMUM_RUN_AGENTS)` : 'Agents at once: no cap';
}

// The main session's Stop, in the stop contract's Stop block and behind the same gates as the deny: `stopReconcile`
// right after its state sweep (it never decides), `stopContinue` after the scorer backstop - once per `.denied` file, the
// turn goes on when the count is under the cap again. Neither acts with no task registry on the payload.
const stopGates = (payload, env) => (!payload || payload.agent_id || !Array.isArray(payload.background_tasks) ? null : capGates(payload, env, { stop: true }));
function stopReconcile(payload, env = process.env)
{
    try
    {
        const g = stopGates(payload, env);
        if (!g) return;
        const probe = probeWriter(g.root, payload, 'guard-stop-contract.js');
        withLock(g.reg, () => reconcile(g.reg, payload.background_tasks, { probe }));
    }
    catch { /* fail open */ }
}
// Returns the continuation's text, or ''.
function stopContinue(payload, env = process.env)
{
    try
    {
        const g = stopGates(payload, env);
        if (!g || !g.canContinue) return '';
        const probe = probeWriter(g.root, payload, 'guard-stop-contract.js');
        const done = withLock(g.reg, () =>
        {
            const denied = readEntry(deniedOf(g.reg));
            if (!denied) return '';
            const c = count(g.reg, { probe });
            if (c.running >= g.n) return '';
            remove(deniedOf(g.reg));
            const stopped = Math.max(1, (Number(denied.running) || 0) - c.running);
            return `The agent cap denied a dispatch this turn, and ${stopped} of the agents it counted have stopped since - send that dispatch again now.`;
        });
        return (done.ok && done.value) || '';
    }
    catch { return ''; }
}

// One `mode: probe` row in the hook-blocks ledger, the shape the guards' ledgerRow writes.
function probeWriter(root, payload, hookName)
{
    return (kind, reason) =>
    {
        try
        {
            const layout = require('./layout.js');
            const dir = layout.statsPath(root, ['hook-blocks']);
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, `${String((payload && payload.session_id) || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                ts: new Date().toISOString(), hook: hookName, event: (payload && payload.hook_event_name) || '', tool: (payload && payload.tool_name) || '',
                agent: (payload && payload.agent_id) || null, mode: 'probe', kind, reason,
            }) + '\n');
        }
        catch { /* a lost row is a lost measurement */ }
    };
}

module.exports = {
    capOf, cleanId, openRegistry, capGates, withLock, count, addPending, dropPending, startAgent, stopAgent, reconcile, probeWriter,
    denialText, subagentTranscript, markDenied, clearDenied, startLine, stopReconcile, stopContinue, fileOf, deniedOf, readEntry, writeEntry, entries,
    AGENT_ID, CAP_DEFAULT, CAP_MAX, PENDING_MS, ACTIVE_MS, STOPPED_KEEP_MS, LOCK_WAIT_MS, LOCK_STALE_MS, TYPES_SHOWN, SETTLED_STATUS,
};
