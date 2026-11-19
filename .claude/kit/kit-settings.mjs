// Copied into each repo as .claude/kit/kit-settings.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Resolves the values the kit's skills run on, each with where it came from, and saves them. settings.mjs prints and
// changes them and status-hook.mjs adds them to every request, so a new session - or one that lost its context to a
// compaction - never has to remember them.
//
// A value comes from the first of these that holds a usable one: the kit's file .claude/kit/settings.json, the
// KIT_* variable, the default. The file is one JSON object committed with the repo, with these names: plan_model,
// audit_model, review_model, implement_model, search_model (a model), pass_score (a whole number from 1 to 100) and scoring,
// auto_run and auto_approve ('on' or 'off'). It is written by `node .claude/kit/settings.mjs set <name> <value>` and by the status hook
// when the user tells a session a model or a switch in chat: what the user says is saved until the user changes it
// (the user's ruling, 2026-11-16). The file may switch scoring, auto-run and auto-approve because the user chose it; a
// variable may not do so from the committed .claude/settings.json.
//
// A variable is set in the `env` block of a Claude Code settings file (~/.claude/settings.json, .claude/settings.json
// or .claude/settings.local.json). Claude Code decides which file wins and puts the value in the environment:
//
//   KIT_PASS_SCORE        the score a graded spec or plan must reach, a whole number from 1 to 100 (90 without it)
//   KIT_PLAN_MODEL        the model that writes plans: a spec or plan written by a dispatched agent, and the audit planner where no audit model is set
//   KIT_AUDIT_MODEL       the model of the audit planner seat (the plan model without it)
//   KIT_REVIEW_MODEL      the model that reviews: the refining-plans reviewer, the review of a finished change
//   KIT_IMPLEMENT_MODEL   the model that implements: the audit editor, a plan's build
//   KIT_SEARCH_MODEL      the model that finds things in the code for the other three (haiku without it)
//   KIT_SCORING           on or off: whether specs and plans are graded in every session (on without it)
//   KIT_AUTO_RUN          on or off: whether every session runs in auto-run from its first ask (off without it)
//   KIT_AUTO_APPROVE      on or off: whether the run approves a spec, design or plan itself (off without it: the user does)
//
// A model is one of sonnet, opus, haiku, fable - what a dispatch accepts. Without a value it is the model the role's
// agent file names; the audit role has no agent file of its own and takes the plan model's value, and the search role
// has no agent file, so its default is fixed. KIT_SCORING, KIT_AUTO_RUN and
// KIT_AUTO_APPROVE switch a safeguard off, so a variable counts only from a file that is not committed: one found in .claude/settings.json is
// ignored and named. Claude Code applies a new or changed variable to a session that is already open, but a deleted
// one stays set there until it restarts: to switch one back at once, set its other value (KIT_AUTO_RUN=off).
// An unusable value in the kit's file falls to the variable, then the default; an unusable variable falls to the
// default. The origin says why.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
    COMMITTED_SETTINGS, DEFAULT_PASS_SCORE, DEFAULT_SEARCH_MODEL, FIX_OR_DELETE, KIT_FILE_SETTINGS, KIT_FOLDER, KIT_SETTINGS_FILE,
    MAX_PASS_SCORE, MIN_PASS_SCORE, MODEL_REASON, MODELS, SCORE_REASON, SETTING, SETTINGS_COMMAND, SETTINGS_EXIT, SETTINGS_REFUSED,
    SETTINGS_USAGE, SWITCH, SWITCH_REASON, SWITCH_SETTINGS, TEMP_SUFFIX, VARIABLE,
} from './constants.mjs';

function readVariable(env, variable)
{
    const value = (env[variable] ?? '').trim();
    return value === '' ? null : value;
}

function committedEnvNames(root)
{
    try { return Object.keys(JSON.parse(readFileSync(join(root, COMMITTED_SETTINGS), 'utf8')).env ?? {}); }
    catch { return []; }
}

function agentModel(root, agent)
{
    try { return /^model:\s*(\S+)\s*$/m.exec(readFileSync(join(root, '.claude', 'agents', `${agent}.md`), 'utf8'))?.[1] ?? null; }
    catch { return null; }
}

function isPlainObject(value)
{
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text)
{
    try { return JSON.parse(text); }
    catch { return null; }
}

// The kit's file as an object: absent counts as empty, and one that is not a JSON object comes back as a failure.
function loadKitFile(root)
{
    let text;
    try { text = readFileSync(join(root, KIT_SETTINGS_FILE), 'utf8'); }
    catch (error)
    {
        if (error.code === 'ENOENT') return { ok: true, settings: {} };
        return { ok: false, error: `${KIT_SETTINGS_FILE} cannot be read (${error.message})${FIX_OR_DELETE}` };
    }
    const parsed = parseJson(text);
    if (isPlainObject(parsed)) return { ok: true, settings: parsed };
    return { ok: false, error: `${KIT_SETTINGS_FILE} is not a JSON object${FIX_OR_DELETE}` };
}

// The score as a number when it is a whole number in range, written as a JSON number or a string of digits.
function parseScore(value)
{
    const isDigits = typeof value === 'string' && /^\d+$/.test(value);
    const score = typeof value === 'number' ? value : isDigits ? Number(value) : 0;
    return Number.isInteger(score) && score >= MIN_PASS_SCORE && score <= MAX_PASS_SCORE ? score : null;
}

function passScore(env)
{
    const value = readVariable(env, VARIABLE.passScore);
    if (value === null) return { value: String(DEFAULT_PASS_SCORE), origin: 'default' };
    const score = parseScore(value);
    if (score !== null) return { value: String(score), origin: VARIABLE.passScore };
    return { value: String(DEFAULT_PASS_SCORE), origin: `default - ${VARIABLE.passScore}='${value}' is ${SCORE_REASON}` };
}

function roleModel(env, root, variable, agent)
{
    const own = agentModel(root, agent);
    const fallback = own === null
        ? { value: 'none', origin: `.claude/agents/${agent}.md names no model - pass no model` }
        : { value: own, origin: `the ${agent} agent's own` };
    const value = readVariable(env, variable);
    if (value === null) return fallback;
    if (MODELS.includes(value)) return { value, origin: variable };
    return { value: fallback.value, origin: `${fallback.origin} - ${variable}='${value}' is ${MODEL_REASON}` };
}

// The audit model has no agent file: without a usable file value or variable it is the plan model's value, named as such.
function auditModel(env, plan)
{
    const fallback = { value: plan.value, origin: SETTING.planModel };
    const value = readVariable(env, VARIABLE.auditModel);
    if (value === null) return fallback;
    if (MODELS.includes(value)) return { value, origin: VARIABLE.auditModel };
    return { value: fallback.value, origin: `${fallback.origin} - ${VARIABLE.auditModel}='${value}' is ${MODEL_REASON}` };
}

function searchModel(env)
{
    const value = readVariable(env, VARIABLE.searchModel);
    if (value === null) return { value: DEFAULT_SEARCH_MODEL, origin: 'default' };
    if (MODELS.includes(value)) return { value, origin: VARIABLE.searchModel };
    return { value: DEFAULT_SEARCH_MODEL, origin: `default - ${VARIABLE.searchModel}='${value}' is ${MODEL_REASON}` };
}

// A switch that turns a safeguard off: `flipped` is the one value that changes it, and only an uncommitted file may.
function safeguard(env, variable, standing, flipped, committedNames)
{
    const value = readVariable(env, variable);
    if (committedNames.includes(variable))
        return { value: standing, origin: `default - ${variable} in ${COMMITTED_SETTINGS} is ignored: set it in .claude/settings.local.json` };
    if (value === null) return { value: standing, origin: 'default' };
    if (value === flipped || value === standing) return { value, origin: variable };
    return { value: standing, origin: `default - ${variable}='${value}' is ${SWITCH_REASON}` };
}

// The value to store for `name` when `value` is usable - a model, a score or a switch - or null.
function usableValue(name, value)
{
    if (name === SETTING.passScore) return parseScore(value);
    if (SWITCH_SETTINGS.includes(name)) return Object.values(SWITCH).includes(value) ? value : null;
    return MODELS.includes(value) ? value : null;
}

function reasonFor(name)
{
    if (name === SETTING.passScore) return SCORE_REASON;
    return SWITCH_SETTINGS.includes(name) ? SWITCH_REASON : MODEL_REASON;
}

// The kit's file outranks `fallback`, the variable-or-default result, when it holds a usable value for `name`.
function fromKitFile(fileSettings, name, fallback)
{
    if (!Object.hasOwn(fileSettings, name)) return fallback;
    const given = fileSettings[name];
    const usable = usableValue(name, given);
    if (usable !== null) return { value: String(usable), origin: KIT_SETTINGS_FILE };
    return { value: fallback.value, origin: `${fallback.origin} - ${name}=${JSON.stringify(given)} in ${KIT_SETTINGS_FILE} is ${reasonFor(name)}` };
}

// `env` is the environment to read (process.env), `root` the repo whose agents, kit file and committed settings count.
export function resolveKitSettings(env, root)
{
    const committedNames = committedEnvNames(root);
    const loaded = loadKitFile(root);
    const fileSettings = loaded.ok ? loaded.settings : {};
    const plan = fromKitFile(fileSettings, SETTING.planModel, roleModel(env, root, VARIABLE.planModel, 'audit-planner'));
    return {
        [SETTING.passScore]: fromKitFile(fileSettings, SETTING.passScore, passScore(env)),
        [SETTING.planModel]: plan,
        [SETTING.auditModel]: fromKitFile(fileSettings, SETTING.auditModel, auditModel(env, plan)),
        [SETTING.reviewModel]: fromKitFile(fileSettings, SETTING.reviewModel, roleModel(env, root, VARIABLE.reviewModel, 'plan-grader')),
        [SETTING.implementModel]: fromKitFile(fileSettings, SETTING.implementModel, roleModel(env, root, VARIABLE.implementModel, 'audit-editor')),
        [SETTING.searchModel]: fromKitFile(fileSettings, SETTING.searchModel, searchModel(env)),
        [SETTING.scoring]: fromKitFile(fileSettings, SETTING.scoring, safeguard(env, VARIABLE.scoring, SWITCH.on, SWITCH.off, committedNames)),
        [SETTING.autoRun]: fromKitFile(fileSettings, SETTING.autoRun, safeguard(env, VARIABLE.autoRun, SWITCH.off, SWITCH.on, committedNames)),
        [SETTING.autoApprove]: fromKitFile(fileSettings, SETTING.autoApprove, safeguard(env, VARIABLE.autoApprove, SWITCH.off, SWITCH.on, committedNames)),
    };
}

// Writes beside the file and renames over it, so a reader never sees half of it; the temporary file goes on any failure.
function writeKitFile(root, settings)
{
    const file = join(root, KIT_SETTINGS_FILE);
    const temporary = `${file}.${process.pid}${TEMP_SUFFIX}`;
    try
    {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
        renameSync(temporary, file);
        return { ok: true };
    }
    catch (error)
    {
        rmSync(temporary, { force: true });
        return { ok: false, error: `${KIT_SETTINGS_FILE} cannot be written (${error.message})` };
    }
}

// The save and remove functions return { ok: true } or { ok: false, error } - the file is never overwritten when it is not a JSON
// object. `pairs` is a list of { setting, value }: every one is checked first, and the file is written once or not at all.
export function setKitSettings(root, pairs)
{
    const stored = {};
    for (const { setting, value } of pairs)
    {
        if (!KIT_FILE_SETTINGS.includes(setting)) return { ok: false, error: `'${setting}' is not a setting the file may hold: ${KIT_FILE_SETTINGS.join(', ')}` };
        const usable = usableValue(setting, value);
        if (usable === null) return { ok: false, error: `${setting}=${JSON.stringify(value)} is ${reasonFor(setting)}` };
        stored[setting] = usable;
    }
    const loaded = loadKitFile(root);
    if (!loaded.ok) return loaded;
    return writeKitFile(root, { ...loaded.settings, ...stored });
}

export function setKitSetting(root, name, value)
{
    return setKitSettings(root, [{ setting: name, value }]);
}

export function unsetKitSetting(root, name)
{
    if (!KIT_FILE_SETTINGS.includes(name)) return { ok: false, error: `'${name}' is not a setting the file may hold: ${KIT_FILE_SETTINGS.join(', ')}` };
    const loaded = loadKitFile(root);
    if (!loaded.ok) return loaded;
    if (!Object.hasOwn(loaded.settings, name)) return { ok: true };
    const kept = { ...loaded.settings };
    delete kept[name];
    return writeKitFile(root, kept);
}

const formatSetting = (name, { value, origin }) => `${name}: ${value} (${origin})`;

// Whether `folder` is the repo's own .claude/kit: a script anywhere else - a checkout's bin/ - must not write the file.
export function isKitFolder(root, folder)
{
    return relative(root, folder).split(sep).join('/') === KIT_FOLDER;
}

// What `node .claude/kit/settings.mjs <args>` prints and exits with: { exitCode, stdout, stderr }. `folder` is where
// the script sits; a set or unset is refused unless that is the repo's .claude/kit, so a checkout never writes outside itself.
export function runSettingsCommand(args, env, root, folder)
{
    const [command, name, value] = args;
    if (args.length === 0)
        return { exitCode: SETTINGS_EXIT.ok, stdout: Object.entries(resolveKitSettings(env, root)).map(([key, setting]) => formatSetting(key, setting)).join('\n'), stderr: '' };
    const isSet = command === SETTINGS_COMMAND.set && args.length === 3;
    const isUnset = command === SETTINGS_COMMAND.unset && args.length === 2;
    if (!isSet && !isUnset) return { exitCode: SETTINGS_EXIT.failed, stdout: '', stderr: SETTINGS_USAGE };
    if (!isKitFolder(root, folder)) return { exitCode: SETTINGS_EXIT.failed, stdout: '', stderr: SETTINGS_REFUSED };
    const result = isSet ? setKitSetting(root, name, value) : unsetKitSetting(root, name);
    if (!result.ok) return { exitCode: SETTINGS_EXIT.failed, stdout: '', stderr: result.error };
    return { exitCode: SETTINGS_EXIT.ok, stdout: formatSetting(name, resolveKitSettings(env, root)[name]), stderr: '' };
}
