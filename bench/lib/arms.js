'use strict';
// The arms and the one session they all share. Fairness lives in `common.json` - model, effort,
// permission mode, the harness settings layer, the env every session gets - so an arm file carries
// only what makes it that arm: its pin, its setup commands, its onboarding prompts and its own env.
// An arm naming a session field is refused rather than merged, because a merge is exactly how one
// arm would quietly run a different session from the others.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ARMS_DIR = path.join(__dirname, '..', 'arms');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions', 'manual'];
const SESSION_KEYS = ['model', 'effort', 'permissionMode', 'settings'];
const ARM_KEYS = ['name', 'pin', 'setup', 'onboarding', 'env'];
const PIN_KINDS = ['tag', 'commit', 'cli'];
// What a template's setup and onboarding may name: its own directories, the fixture's clone, the
// arm's pinned source, the bench and repo roots, and the pin itself.
const TEMPLATE_VARS = ['template', 'repo', 'config', 'home', 'src', 'bench', 'root', 'pin', 'arm'];
const HARNESS_ENV = ['CLAUDE_CONFIG_DIR', 'HOME'];
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isStringMap = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((s) => typeof s === 'string');

function readJson(file)
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { return undefined; }
    try { return JSON.parse(text); }
    catch (err) { throw new Error(`${path.basename(file)}: not JSON - ${err.message}`); }
}

// A note is any key starting with '_': it explains, it never changes a run, so it never enters a hash.
function canonical(value)
{
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
    {
        const out = {};
        for (const k of Object.keys(value).filter((k) => !k.startsWith('_')).sort()) out[k] = canonical(value[k]);
        return out;
    }
    return value;
}

// The template key: everything that could make two templates differ - the arm's definition and the
// session its onboarding runs in, the Claude Code version included when the run knows it.
function armHash(arm, session)
{
    const body = {
        arm: canonical({ ...arm, env: arm.env || {} }),
        session: canonical({ model: session.model, effort: session.effort, permissionMode: session.permissionMode, settings: session.settings, cli: session.cliVersion || null }),
    };
    return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function placeholders(value, found = new Set())
{
    if (typeof value === 'string') for (const m of value.matchAll(PLACEHOLDER)) found.add(m[1]);
    else if (Array.isArray(value)) value.forEach((v) => placeholders(v, found));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => placeholders(v, found));
    return found;
}

function resolve(value, vars)
{
    if (typeof value === 'string')
    {
        return value.replace(PLACEHOLDER, (whole, name) =>
        {
            if (!Object.prototype.hasOwnProperty.call(vars, name)) throw new Error(`unknown placeholder {${name}}`);
            return String(vars[name]);
        });
    }
    if (Array.isArray(value)) return value.map((v) => resolve(v, vars));
    if (value && typeof value === 'object')
    {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = resolve(v, vars);
        return out;
    }
    return value;
}

function checkEffort(effort, where)
{
    if (!EFFORTS.includes(effort)) throw new Error(`${where}: effort '${effort}' is not one of ${EFFORTS.join('|')}`);
}

function loadSession(dir, override)
{
    const common = readJson(path.join(dir, 'common.json'));
    if (!common) throw new Error(`common.json: absent from ${dir}`);
    for (const key of [...SESSION_KEYS, 'env', 'graceSec', 'auth', 'scrub'])
    {
        if (common[key] === undefined) throw new Error(`common.json: missing ${key}`);
    }
    if (typeof common.model !== 'string' || !common.model) throw new Error('common.json: model is not a model id');
    checkEffort(common.effort, 'common.json');
    if (!PERMISSION_MODES.includes(common.permissionMode)) throw new Error(`common.json: permissionMode '${common.permissionMode}' is not one of ${PERMISSION_MODES.join('|')}`);
    if (!isStringMap(common.env)) throw new Error('common.json: env is not a map of strings');
    if (!(typeof common.graceSec === 'number' && common.graceSec > 0)) throw new Error('common.json: graceSec is not a positive number');
    if (!isStrings(common.auth) || !common.auth.length) throw new Error('common.json: auth names no variable');
    if (!isStrings(common.scrub)) throw new Error('common.json: scrub is not a list of names');

    const settingsFile = path.join(dir, common.settings);
    const settings = readJson(settingsFile);
    if (!settings) throw new Error(`common.json: settings file ${common.settings} is absent`);

    const session = {
        model: common.model, effort: common.effort, permissionMode: common.permissionMode,
        settingsFile, settings, env: { ...common.env }, graceSec: common.graceSec,
        auth: [...common.auth], scrub: [...common.scrub], cliVersion: null,
    };
    if (override.model !== undefined)
    {
        if (typeof override.model !== 'string' || !override.model) throw new Error('override: model is not a model id');
        session.model = override.model;
    }
    if (override.effort !== undefined)
    {
        checkEffort(override.effort, 'override');
        session.effort = override.effort;
    }
    if (override.cliVersion) session.cliVersion = String(override.cliVersion);
    return session;
}

function loadArm(dir, name, session)
{
    const arm = readJson(path.join(dir, `${name}.json`));
    if (!arm) throw new Error(`no arm '${name}' in ${dir}`);
    for (const key of Object.keys(arm))
    {
        if (key.startsWith('_')) continue;
        if (SESSION_KEYS.includes(key)) throw new Error(`${name}: ${key} belongs in common.json - every arm runs the same session`);
        if (!ARM_KEYS.includes(key)) throw new Error(`${name}: unknown key ${key}`);
    }
    for (const key of ['name', 'pin', 'setup', 'onboarding'])
    {
        if (arm[key] === undefined) throw new Error(`${name}: missing ${key}`);
    }
    if (arm.name !== name) throw new Error(`${name}.json: name is '${arm.name}'`);
    if (!arm.pin || !PIN_KINDS.includes(arm.pin.kind) || typeof arm.pin.value !== 'string' || !arm.pin.value)
    {
        throw new Error(`${name}: pin is not { kind: ${PIN_KINDS.join('|')}, value }`);
    }
    if (!Array.isArray(arm.setup)) throw new Error(`${name}: setup is not a list`);
    arm.setup.forEach((step, i) =>
    {
        if (!isStrings(step) || !step.length) throw new Error(`${name}: setup[${i}] is not a command (an array of strings)`);
    });
    if (!isStrings(arm.onboarding)) throw new Error(`${name}: onboarding is not a list of prompts`);
    const env = arm.env === undefined ? {} : arm.env;
    if (!isStringMap(env)) throw new Error(`${name}: env is not a map of strings`);
    const owned = new Set([...HARNESS_ENV, ...session.auth, ...session.scrub, ...Object.keys(session.env)]);
    for (const key of Object.keys(env))
    {
        if (owned.has(key)) throw new Error(`${name}: env ${key} is the harness's (common.json or the session) - an arm cannot set it`);
    }
    for (const used of placeholders([arm.setup, arm.onboarding, env]))
    {
        if (!TEMPLATE_VARS.includes(used)) throw new Error(`${name}: unknown placeholder {${used}} - a template knows ${TEMPLATE_VARS.map((v) => `{${v}}`).join(' ')}`);
    }
    const clean = { name, pin: { ...arm.pin }, setup: arm.setup.map((s) => [...s]), onboarding: [...arm.onboarding], env: { ...env } };
    return { ...clean, hash: armHash(clean, session) };
}

function load({ dir = ARMS_DIR, names, override = {} } = {})
{
    const session = loadSession(dir, override);
    const list = names || fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f !== 'common.json' && f !== path.basename(session.settingsFile))
        .map((f) => f.slice(0, -'.json'.length))
        .sort();
    return { session, arms: list.map((name) => loadArm(dir, name, session)) };
}

module.exports = { load, armHash, resolve, ARMS_DIR, TEMPLATE_VARS, EFFORTS, PERMISSION_MODES };
