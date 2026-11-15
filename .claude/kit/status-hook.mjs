#!/usr/bin/env node
// Copied into each repo as .claude/kit/status-hook.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// A UserPromptSubmit hook: with every request it shows the user one line - is auto-run on, is scoring on, which
// model plans, reviews, implements and searches - and gives Claude the same values with their sources, so neither a new
// session nor a compacted one has to remember them. The values are the settings' KIT_* variables (kit-settings.mjs)
// and this session's own switches, the last 'Auto-run:' and 'Scoring:' lines of kit-session.md in the session
// scratchpad, which outrank the settings in both directions. A request that opens with words to switch one -
// 'stop scoring', 'turn on scoring', 'enable auto run', 'turn auto run off' - is recorded there by this hook.
//
// It never blocks a request: whatever goes wrong, it exits 0 and says so on stderr.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_FILE, SESSION_SWITCHES, SPLIT_VERBS, SWITCH, SWITCH_VERBS } from './constants.mjs';
import { resolveKitSettings } from './kit-settings.mjs';

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

function readSessionFile(file)
{
    try { return readFileSync(file, 'utf8'); }
    catch { return ''; }
}

// The switch a request opens with - the mode's line and the value asked for - or null. Three forms count: a verb
// and the mode ('turn off scoring'), the mode between the verb's halves ('turn scoring off'), and the mode with
// its value alone ('scoring off'), which must end there so that 'scoring on the last plan' is not one.
function switchOf(request)
{
    const opening = request.trimStart().toLowerCase().replace(/\s+/g, ' ').replace(/^please /, '');
    for (const { line, names } of SESSION_SWITCHES)
    {
        const mode = `(?:the )?(?:${names.join('|')})`;
        for (const value of [SWITCH.on, SWITCH.off])
        {
            const forms = [
                `(?:${SWITCH_VERBS[value].join('|')}) ${mode}\\b`,
                `(?:${SPLIT_VERBS.join('|')}) ${mode} ${value}\\b`,
                `${mode} ${value} ?(?:[.,;:!]|$)`,
            ];
            if (forms.some((form) => new RegExp(`^${form}`).test(opening))) return { line, value };
        }
    }
    return null;
}

function recordSwitch(file, { line, value })
{
    const existing = readSessionFile(file);
    const today = new Date().toLocaleDateString('en-CA');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${existing !== '' && !existing.endsWith('\n') ? '\n' : ''}${line}: ${value} - ${today}\n`);
}

// The session's own word on a switch: the last line of its kind, or null when the session never set it.
function sessionSwitch(sessionText, kind)
{
    const pattern = new RegExp(`^${kind}: (on|off)\\b`);
    const matches = sessionText.split('\n').map((line) => pattern.exec(line)).filter((match) => match !== null);
    return matches.at(-1)?.[1] ?? null;
}

function withSession(setting, sessionValue)
{
    return sessionValue === null ? setting : { value: sessionValue, origin: 'this session' };
}

// The short form for the user's line: the value, and its source only when it is not the plain default.
function shown(label, { value, origin }, detail = '')
{
    const source = origin.startsWith('default') ? detail : origin;
    return `${label} ${value}${source === '' ? '' : ` (${source})`}`;
}

function buildOutput(hookInput, env, root)
{
    const sessionFile = typeof hookInput.scratchpad_dir === 'string' && hookInput.scratchpad_dir !== ''
        ? join(hookInput.scratchpad_dir, SESSION_FILE)
        : null;
    const settings = resolveKitSettings(env, root);
    const asked = typeof hookInput.prompt === 'string' ? switchOf(hookInput.prompt) : null;
    if (sessionFile !== null && asked !== null) recordSwitch(sessionFile, asked);
    const sessionText = sessionFile === null ? '' : readSessionFile(sessionFile);

    const autoRun = withSession(settings.auto_run, sessionSwitch(sessionText, 'Auto-run'));
    const scoring = withSession(settings.scoring, sessionSwitch(sessionText, 'Scoring'));

    const userLine = [
        shown('kit: auto-run', autoRun),
        shown('scoring', scoring, scoring.value === SWITCH.on ? `pass ${settings.pass_score.value}` : ''),
        `plan ${settings.plan_model.value}`,
        `review ${settings.review_model.value}`,
        `implement ${settings.implement_model.value}`,
        `search ${settings.search_model.value}`,
    ].join(' | ');

    const values = { auto_run: autoRun, scoring, pass_score: settings.pass_score, plan_model: settings.plan_model, review_model: settings.review_model, implement_model: settings.implement_model, search_model: settings.search_model };
    const context = [
        'kit status (.claude/kit/status-hook.mjs):',
        ...Object.entries(values).map(([name, { value, origin }]) => `${name}=${value} (${origin});`),
        `session file=${sessionFile ?? 'unknown (the hook was given no scratchpad_dir - use kit-session.md in the session scratchpad)'}`,
    ].join(' ');

    return { systemMessage: userLine, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
}

try
{
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    console.log(JSON.stringify(buildOutput(parseHookInput(readStdin()), process.env, root)));
}
catch (error)
{
    // A status line is never worth a blocked request: report the failure where the debug log keeps it and let the request through.
    console.error(`claude-kit status hook: ${error instanceof Error ? error.message : String(error)}`);
}
