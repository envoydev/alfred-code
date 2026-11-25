#!/usr/bin/env node
// Copied into each repo as .claude/kit/agent-reminders.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// A UserPromptSubmit hook: with every request it gives Claude the reminder line of each rule in a fixed list
// (REMINDER_SOURCES in constants.mjs: communication, then cleanup), read from the rule each time so the rule stays its
// one source, and a note on the communication line when Claude's last reply passed that rule's limits (reply-budget.mjs).
// A rule loads once per session, and a long session drifts from it (the user, 2026-11-21 and 2026-11-25). A missing rule
// or reminder line adds nothing. The kit's settings line is the status hook's job (status-hook.mjs).
//
// It never blocks a request: whatever goes wrong, it exits 0, and a failure other than a missing file goes to stderr.
//
// It reads the listed rules of the repo it sits in and the end of the session's transcript (up to 32 MB, in growing
// tails), writes nothing and opens no connection.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function describeError(error)
{
    return error instanceof Error ? error.message : String(error);
}

// The sibling modules load here, not as static imports, so that a missing or broken one is reported and the request goes
// through. Their stderr prefix lives in constants.mjs, which may be the module that failed, so it is written out here.
async function loadSiblings()
{
    try { return { ...(await import('./constants.mjs')), ...(await import('./reply-budget.mjs')) }; }
    catch (error)
    {
        console.error(`claude-kit agent-reminders hook: ${describeError(error)}`);
        return null;
    }
}

const siblings = await loadSiblings();
const { REMINDERS_HOOK_ERROR_PREFIX, REMINDER_SOURCES, TRANSCRIPT_TAIL_STEPS, reminderContextOf, replyCheckOf } = siblings ?? {};

function readStdin()
{
    try { return readFileSync(0, 'utf8'); }
    catch { return ''; }
}

function parseHookInput(text)
{
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return {}; }
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

// A file that is not there is normal; any other failure to read goes to stderr.
function reportReadError(error)
{
    if (error?.code !== 'ENOENT') console.error(`${REMINDERS_HOOK_ERROR_PREFIX} ${describeError(error)}`);
}

function readTextOrEmpty(file)
{
    try { return readFileSync(file, 'utf8'); }
    catch (error)
    {
        reportReadError(error);
        return '';
    }
}

// The last byteCount bytes of a file, and whether they reach its start - the first line may be cut where they do not.
function readTail(file, byteCount)
{
    let descriptor;
    try
    {
        descriptor = openSync(file, 'r');
        const { size } = fstatSync(descriptor);
        const length = Math.min(byteCount, size);
        const buffer = Buffer.alloc(length);
        const bytesRead = readSync(descriptor, buffer, 0, length, size - length);
        return { text: buffer.subarray(0, bytesRead).toString('utf8'), reachedStart: length === size };
    }
    catch (error)
    {
        reportReadError(error);
        return { text: '', reachedStart: true };
    }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
}

// The note on Claude's last reply, from growing tails of the transcript: the first tail that holds the typed request the
// reply answered decides. With no request in the largest tail, or in the whole file, there is no note.
function replyNoteFrom(transcriptPath)
{
    if (typeof transcriptPath !== 'string' || transcriptPath === '') return null;
    for (const byteCount of TRANSCRIPT_TAIL_STEPS)
    {
        const { text, reachedStart } = readTail(transcriptPath, byteCount);
        const { requestFound, note } = replyCheckOf(text);
        if (requestFound) return note;
        if (reachedStart) return null;
    }
    return null;
}

function buildOutput(hookInput, root)
{
    const ruleTexts = Object.fromEntries(REMINDER_SOURCES.map(({ file }) => [file, readTextOrEmpty(join(root, file))]));
    const reminder = reminderContextOf(ruleTexts, replyNoteFrom(hookInput.transcript_path));
    return reminder === null ? null : { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: reminder } };
}

if (siblings !== null)
{
    try
    {
        const folder = dirname(fileURLToPath(import.meta.url));
        const output = buildOutput(parseHookInput(readStdin()), join(folder, '..', '..'));
        if (output !== null) console.log(JSON.stringify(output));
    }
    catch (error)
    {
        // A reminder is never worth a blocked request: report the failure where the debug log keeps it and let the request through.
        console.error(`${REMINDERS_HOOK_ERROR_PREFIX} ${describeError(error)}`);
    }
}
