#!/usr/bin/env node
// Copied into each repo as .claude/kit/status-hook.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// A UserPromptSubmit hook: with every request it shows the user one line - is auto-run on, is scoring on, does the run
// approve its own plans, which model plans, audits, reviews, implements and searches - and gives Claude the same values with their sources, so neither a new
// session nor a compacted one has to remember them. The values are the kit's file .claude/kit/settings.json, then the
// KIT_* variables, then the defaults (kit-settings.mjs) - the last two only for a name the file lacks, and the hook fills in
// what is missing.
//
// Its cost is one Node start for each request: 32 ms at the median where Node alone takes 22 (40 runs, Node 24, an
// Apple-silicon laptop, 2026-11-17), far inside the timeout its entry in .claude/settings.json sets.
//
// A request that opens with words to switch a mode - 'stop scoring', 'turn on scoring', 'enable auto run', 'turn auto
// run off', 'auto approve on' - or to name a role's model - 'plan model fable', 'set the review model to sonnet', 'audit with fable' - is
// saved to that file by this hook, and the same request already shows it. The hook also writes the whole file once where it is absent
// or lacks a name (the owner's ruling, 2026-11-21), so every origin on the line then reads the file. What the user says in chat is saved until the
// user changes it (the user's ruling, 2026-11-16). Only the first line of a request is read, and the words must make up
// the whole of it - or all of it but a tail like 'for good' or 'please' and what follows punctuation - so a sentence that
// merely starts that way, or a question, saves nothing. Claude's values then end with what was saved, or why it was not.
//
// The event also fires on requests nobody typed - a scheduled task, a background agent's report, a message from another
// session - and nothing in its input tells them from a typed one (the hooks reference, read 2026-11-17). The hook reads
// every request the same way, so one of those is saved too when its first line is only a switch or a model choice.
//
// It never blocks a request: whatever goes wrong, it exits 0 and says so on stderr.
//
// After the status it adds the communication rule's reminder line, read from the rule each time so the rule stays its one
// source, and a note when Claude's last reply passed the rule's limits (reply-budget.mjs). A missing rule or reminder
// line adds nothing.
//
// It reads the kit's file, the communication rule, the end of the session's transcript (up to 32 MB, in growing tails), the committed
// .claude/settings.json and the three agent files of the repo it sits in, writes
// only that kit file and opens no connection. A hook a repo commits runs in a `claude -p` or SDK session with no trust
// dialog: before scripting over a clone you did not write, read this file as you would an install script, or start the
// run with --bare.
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
    try { return { ...(await import('./constants.mjs')), ...(await import('./kit-settings.mjs')), ...(await import('./reply-budget.mjs')) }; }
    catch (error)
    {
        console.error(`claude-kit status hook: ${describeError(error)}`);
        return null;
    }
}

const siblings = await loadSiblings();
const {
    ARTICLE, COMMUNICATION_RULE_FILE, CUT_MARK, HOOK_ERROR_PREFIX, KIT_SETTINGS_FILE, MAX_SHOWN_LENGTH, MODEL_CONNECTORS,
    MODEL_LEADING_VERBS, MODEL_ROLES, MODEL_WORD_PATTERN, MODELS, NEWLINE, NOT_SAVED_PREFIX, POLITE_PREFIX, QUESTION_MARK,
    ROLE_JOINERS, SAVED_PREFIX, SETTING, SETTINGS_REFUSED, SPLIT_VERBS, SWITCH, SWITCH_MODES, SWITCH_VERBS, TRANSCRIPT_TAIL_STEPS,
    VALUE_END, VERB_CONNECTOR, completeKitSettings, isKitFolder, reminderContextOf, replyCheckOf, resolveKitSettings, setKitSettings,
} = siblings ?? {};

function readStdin()
{
    try { return readFileSync(0, 'utf8'); }
    catch { return ''; }
}

// A file that is not there is normal; any other failure to read goes to stderr.
function reportReadError(error)
{
    if (error?.code !== 'ENOENT') console.error(`${HOOK_ERROR_PREFIX} ${describeError(error)}`);
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

function parseHookInput(text)
{
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return {}; }
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

// The first line of a request, read as a person would: lower case, runs of blanks as one space, no 'please' in front.
// Everything after the first newline is another matter, and no form below looks at it.
function openingOf(request)
{
    return request.trimStart().split(NEWLINE)[0].toLowerCase().replace(/\s+/g, ' ').replace(new RegExp(`^${POLITE_PREFIX}`), '').trimEnd();
}

// The switch an opening line holds - the mode's setting and the value asked for - or null. Three forms count: a verb
// and the mode ('turn off scoring'), the mode between the verb's halves ('turn scoring off'), and the mode with its
// value alone ('scoring off'). Each must end the form where VALUE_END says, so that 'scoring on the last plan' and
// 'enable scoring model fable' are none.
function switchOf(opening)
{
    for (const { setting, names } of SWITCH_MODES)
    {
        const mode = `(?:${ARTICLE})?(?:${names.join('|')})`;
        for (const value of [SWITCH.on, SWITCH.off])
        {
            const forms = [
                `(?:${SWITCH_VERBS[value].join('|')}) ${mode}${VALUE_END}`,
                `(?:${SPLIT_VERBS.join('|')}) ${mode} ${value}${VALUE_END}`,
                `${mode} ${value}${VALUE_END}`,
            ];
            if (forms.some((form) => new RegExp(`^${form}`).test(opening))) return { setting, value };
        }
    }
    return null;
}

function rolesNamed(roleList)
{
    const parts = roleList.split(new RegExp(ROLE_JOINERS.join('|')));
    const names = parts.map((part) => part.replace(new RegExp(`^${ARTICLE}`), '').replace(new RegExp(` ${MODEL_WORD_PATTERN}$`), ''));
    return MODEL_ROLES.filter(({ names: roleNames }) => names.some((name) => roleNames.includes(name)));
}

// The model choices an opening line holds - a role's setting and the model - in the role table's order, one per role
// named, or none. Two forms count: the roles and the word 'model' ('plan and review models fable', 'set the review
// model to sonnet') and a role's verb ('audit with fable'). The model must end the form where VALUE_END says, so
// 'fabled', 'fable in the repo' and 'fable for this run' are no choice.
function modelChoicesOf(opening)
{
    const modelName = `(${MODELS.join('|')})(?=${VALUE_END})`;
    const rolePart = `(?:${ARTICLE})?(?:${MODEL_ROLES.flatMap(({ names }) => names).join('|')})`;
    const roleList = `(?:${rolePart}(?: ${MODEL_WORD_PATTERN})?(?:${ROLE_JOINERS.join('|')}))*${rolePart} ${MODEL_WORD_PATTERN}`;
    const listed = new RegExp(`^(?:(?:${MODEL_LEADING_VERBS.join('|')}) )?(${roleList})(?:${MODEL_CONNECTORS.join('|')})${modelName}`).exec(opening);
    if (listed !== null) return rolesNamed(listed[1]).map(({ setting }) => ({ setting, value: listed.at(-1) }));
    for (const { setting, verbs } of MODEL_ROLES)
    {
        const spoken = new RegExp(`^(?:${verbs.join('|')}) ${VERB_CONNECTOR} ${modelName}`).exec(opening);
        if (spoken !== null) return [{ setting, value: spoken.at(-1) }];
    }
    return [];
}

// Saves the choices to the kit's file, all or none, and says so for Claude's values: what was saved, or why it was not.
// Only a hook installed in a repo's .claude/kit saves; one run from a checkout would write beside the checkout.
function saveChoices(root, folder, choices)
{
    if (choices.length === 0) return null;
    const result = isKitFolder(root, folder) ? setKitSettings(root, choices) : { ok: false, error: SETTINGS_REFUSED };
    if (result.ok) return `${SAVED_PREFIX} ${choices.map(({ setting, value }) => `${setting}=${value}`).join(', ')} in ${KIT_SETTINGS_FILE};`;
    console.error(`${HOOK_ERROR_PREFIX} ${result.error}`);
    return `${NOT_SAVED_PREFIX} ${result.error};`;
}

// Writes the full file once, on a request that finds a name missing or the file absent; a complete file is left as it is, so a
// request costs no git change. A file that does not parse is never rewritten, and only a hook installed in a repo's
// .claude/kit writes.
function completeFile(root, folder)
{
    if (!isKitFolder(root, folder)) return;
    const result = completeKitSettings(root);
    if (!result.ok && result.skipped !== true) console.error(`${HOOK_ERROR_PREFIX} ${result.error}`);
}

// A request that asks - its first line ends in a question mark - saves nothing, whatever words it opens with.
function choicesOf(request)
{
    const opening = openingOf(request);
    if (opening.endsWith(QUESTION_MARK)) return [];
    const switchAsked = switchOf(opening);
    return switchAsked === null ? modelChoicesOf(opening) : [switchAsked];
}

// A value or a source as the hook prints it, cut where it would run on: Claude Code replaces a string of more than
// 10,000 characters that a hook returns with a pointer to a file, and the note of what was saved would go with it.
function cutToShow(text)
{
    return text.length > MAX_SHOWN_LENGTH ? `${text.slice(0, MAX_SHOWN_LENGTH)}${CUT_MARK}` : text;
}

function buildOutput(hookInput, env, root, folder)
{
    const request = typeof hookInput.prompt === 'string' ? hookInput.prompt : '';
    const savedNote = saveChoices(root, folder, choicesOf(request));
    completeFile(root, folder);
    const settings = Object.fromEntries(Object.entries(resolveKitSettings(env, root))
        .map(([name, { value, origin }]) => [name, { value: cutToShow(value), origin: cutToShow(origin) }]));

    const scoring = settings[SETTING.scoring].value;
    const userLine = [
        `kit: auto-run ${settings[SETTING.autoRun].value}`,
        `scoring ${scoring}${scoring === SWITCH.on ? ` (pass ${settings[SETTING.passScore].value})` : ''}`,
        `auto-approve ${settings[SETTING.autoApprove].value}`,
        ...MODEL_ROLES.map(({ label, setting }) => `${label} ${settings[setting].value}`),
    ].join(' | ');

    const names = [SETTING.autoRun, SETTING.scoring, SETTING.passScore, SETTING.autoApprove, ...MODEL_ROLES.map(({ setting }) => setting)];
    const context = [
        'kit status (.claude/kit/status-hook.mjs):',
        ...names.map((name) => `${name}=${settings[name].value} (${settings[name].origin});`),
        ...(savedNote === null ? [] : [savedNote]),
    ].join(' ');
    const reminder = reminderContextOf(readTextOrEmpty(join(root, COMMUNICATION_RULE_FILE)), replyNoteFrom(hookInput.transcript_path));
    const fullContext = reminder === null ? context : [context, reminder].join(NEWLINE);

    return { systemMessage: userLine, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: fullContext } };
}

if (siblings !== null)
{
    try
    {
        const folder = dirname(fileURLToPath(import.meta.url));
        console.log(JSON.stringify(buildOutput(parseHookInput(readStdin()), process.env, join(folder, '..', '..'), folder)));
    }
    catch (error)
    {
        // A status line is never worth a blocked request: report the failure where the debug log keeps it and let the request through.
        console.error(`${HOOK_ERROR_PREFIX} ${describeError(error)}`);
    }
}
