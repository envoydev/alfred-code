// THE REASON AFTER A NO. A No at a hook's `ask` ends the turn, and the tool result carries only Claude Code's rejection
// text: the hook's additionalContext is dropped, so the model cannot say why the call was refused or offer the guard's fix
// (live, 2026-11-27, Claude Code 2.1.332). Every ask a guard builds (`hook-prelude.js blockVerdict`) is recorded here; the
// next UserPromptSubmit (`communication-reminder.js`) reads which of them the user declined and hands the model each
// one's guard and reason, once. A flat hook module by contract (the installer copies it by name, HOOK_MODULES).
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASKED_FILE_PREFIX = 'alfred-asked-';
const ASKED_KEEP_MS = 60 * 60 * 1000;
const ASKED_MAX = 16;
const REASON_MAX_CHARS = 4000;
const RESULT_TAIL_BYTES = 4 * 1024 * 1024;
// Claude Code shows a hook's context past 10,000 characters only as a preview, so the note keeps well inside it.
const REFUSAL_NOTE_MAX_CHARS = 4000;
const NOTE_REASON_MAX_CHARS = 1200;

const safeId = (value) => String(value).replace(/[^\w.-]/g, '_');
function logDir(env)
{
    const named = env && (env.ALFRED_CODE_HOOK_LOG_DIR || '').trim();
    return named || os.tmpdir();
}
const askedFile = (sessionId, env = process.env) => path.join(logDir(env), `${ASKED_FILE_PREFIX}${safeId(sessionId)}.jsonl`);

// Records one asked call. Never throws: a record that cannot be written only loses the relay.
function recordAsked(input, guard, reason, env = process.env, { now = Date.now() } = {})
{
    try
    {
        const sessionId = input && input.session_id;
        const id = input && input.tool_use_id;
        if (!sessionId || !id) return;
        const row = { id: String(id), guard: String(guard || ''), reason: String(reason).slice(0, REASON_MAX_CHARS), at: now };
        fs.appendFileSync(askedFile(sessionId, env), `${JSON.stringify(row)}\n`);
        try { require('./hook-prelude.js').sweepStale(logDir(env), ASKED_FILE_PREFIX, { now }); }
        catch { /* a sweep never costs the record */ }
    }
    catch { /* the relay is never allowed to break the ask */ }
}

function pendingRows(file)
{
    try
    {
        return fs.readFileSync(file, 'utf8').split('\n').map((line) =>
        {
            try { return JSON.parse(line); }
            catch { return null; }
        }).filter((row) => row && typeof row.id === 'string' && typeof row.reason === 'string' && Number.isFinite(row.at));
    }
    catch { return []; }
}

// The asked calls the user declined since the last read, newest last: `[{ id, guard, reason }]`. A call whose result shows it ran,
// or a hook's own deny, is settled and dropped; one with no result yet stays until ASKED_KEEP_MS. Never throws.
function refusedCalls(input, env = process.env, { now = Date.now() } = {})
{
    try
    {
        const sessionId = input && input.session_id;
        if (!sessionId) return [];
        const file = askedFile(sessionId, env);
        if (!fs.existsSync(file)) return [];
        const { toolResultOf, declinedByUser } = require('./hook-prelude.js');
        const refused = [];
        const kept = [];
        for (const row of pendingRows(file).slice(-ASKED_MAX))
        {
            if (now - row.at > ASKED_KEEP_MS) continue;
            const result = toolResultOf(input.transcript_path, row.id, { tailBytes: RESULT_TAIL_BYTES });
            if (!result.found) kept.push(row);
            else if (declinedByUser(result)) refused.push({ id: row.id, guard: row.guard, reason: row.reason });
        }
        if (kept.length) fs.writeFileSync(file, kept.map((row) => JSON.stringify(row)).join('\n') + '\n');
        else fs.rmSync(file, { force: true });
        return refused;
    }
    catch { return []; }
}

function refusalNote(refused)
{
    if (!Array.isArray(refused) || !refused.length) return '';
    const calls = new Set(refused.map((row) => row.id)).size;
    const which = calls === 1 ? 'your call, so it did' : `${calls} of your calls, so they did`;
    let note = ` REFUSED AT THE PROMPT: the user pressed No when a guard asked about ${which} not run. Each guard's reason, for when the user asks why or wants the fix:`;
    // A guard the runner's inner pass judged is recorded again under the dispatcher: one line per call and reason.
    const lines = [...new Map(refused.map((row) => [`${row.id}\n${row.reason}`, row])).values()]
        .map(({ guard, reason }) => `- alfred-code ${guard || 'guard'}: ${String(reason).slice(0, NOTE_REASON_MAX_CHARS)}`);
    const room = (left) => `\n- ${left} more not shown`;
    for (let at = 0; at < lines.length; at++)
    {
        if (note.length + 1 + lines[at].length + room(lines.length).length > REFUSAL_NOTE_MAX_CHARS)
            return note + room(lines.length - at);
        note += `\n${lines[at]}`;
    }
    return note;
}

module.exports = { ASKED_FILE_PREFIX, ASKED_KEEP_MS, REFUSAL_NOTE_MAX_CHARS, askedFile, recordAsked, refusedCalls, refusalNote };
