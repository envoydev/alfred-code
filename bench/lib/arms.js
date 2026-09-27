'use strict';
// The arms and the one session they all share. Fairness lives in `common.json` - model, effort,
// permission mode, the harness settings layer, the env every session gets - so an arm file carries
// only what makes it that arm: its pin, its setup commands, its onboarding prompts, what that onboarding
// must leave in the clone (`expects`, checked before any cell runs on the template), its own env, an
// env its onboarding alone gets (`onboardingEnv` - a stack's unattended switch, never a measured
// cell's) and its own entry per task kind for the flow block (`flow`).
// An arm naming a session field is refused rather than merged, because a merge is exactly how one
// arm would quietly run a different session from the others.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ARMS_DIR = path.join(__dirname, '..', 'arms');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions', 'manual'];
const SESSION_KEYS = ['model', 'effort', 'permissionMode', 'settings'];
const ARM_KEYS = ['name', 'pin', 'setup', 'onboarding', 'expects', 'env', 'onboardingEnv', 'flow'];
// The flow block's entries: per task kind, the prompts the arm's own recommended route sends, in
// order. `{prompt}` is the task's prompt; `{file:<path>}` is the one file in the clone that path names
// when the prompt is sent (a `*` in its last part), because a flow's next step can name what the step
// before it wrote - a findings file, a plan.
const FLOW_KINDS = ['feature', 'cross', 'bug'];
const FLOW_VARS = ['prompt'];
const FLOW_FILE = /\{file:([^}]*)\}/g;
const PIN_KINDS = ['tag', 'commit', 'cli'];
// What a template's setup and onboarding may name: its own directories, the fixture's clone, the
// arm's pinned source, the bench and repo roots, and the pin itself.
const TEMPLATE_VARS = ['template', 'repo', 'config', 'home', 'src', 'bench', 'root', 'pin', 'arm'];
const HARNESS_ENV = ['CLAUDE_CONFIG_DIR', 'HOME', 'TMPDIR', 'CLAUDE_CODE_TMPDIR', 'PATH', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'COMPOSE_PROJECT_NAME', 'CLAUDE_ENV_FILE'];
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
    // The flow entries never change what a template holds: a changed flow prompt must not rebuild one
    // (ours' onboarding is a 20-minute billed session). They carry a key of their own (flowHash).
    const { flow, ...built } = arm;
    const body = {
        arm: canonical({ ...built, env: built.env || {}, onboardingEnv: built.onboardingEnv || {} }),
        session: canonical({ model: session.model, effort: session.effort, permissionMode: session.permissionMode, settings: session.settings, env: session.env || {}, bashEnv: session.bashEnv || {}, restore: session.restore || [], cli: session.cliVersion || null }),
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

const flowHash = (flow) => (flow ? crypto.createHash('sha256').update(JSON.stringify(canonical(flow))).digest('hex') : null);

function checkFlow(name, flow)
{
    if (flow === undefined) return null;
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) throw new Error(`${name}: flow is not a map of task kinds (${FLOW_KINDS.join('|')})`);
    for (const kind of Object.keys(flow))
    {
        if (!kind.startsWith('_') && !FLOW_KINDS.includes(kind)) throw new Error(`${name}: flow names an unknown kind '${kind}' - one of ${FLOW_KINDS.join('|')}`);
    }
    const out = {};
    for (const kind of FLOW_KINDS)
    {
        const prompts = flow[kind];
        if (prompts === undefined) throw new Error(`${name}: flow names no entry for kind '${kind}'`);
        if (!isStrings(prompts) || !prompts.length) throw new Error(`${name}: flow ${kind} is not a list of prompts`);
        if (!prompts.some((p) => p.includes('{prompt}'))) throw new Error(`${name}: flow ${kind} never sends the task's {prompt}`);
        for (const used of placeholders(prompts.map((p) => p.replace(FLOW_FILE, ''))))
        {
            if (!FLOW_VARS.includes(used)) throw new Error(`${name}: flow ${kind} uses an unknown placeholder {${used}} - a flow prompt knows {prompt} and {file:<path>}`);
        }
        for (const p of prompts)
        {
            for (const [, rel] of p.matchAll(FLOW_FILE))
            {
                const parts = rel.split(/[\\/]/);
                if (!rel || path.isAbsolute(rel) || parts.includes('..')) throw new Error(`${name}: flow ${kind} names a file outside the clone: {file:${rel}}`);
                if (parts.slice(0, -1).some((part) => part.includes('*'))) throw new Error(`${name}: flow ${kind} names a file pattern with a wildcard above its last part: {file:${rel}}`);
            }
        }
        out[kind] = [...prompts];
    }
    return out;
}

function checkEnv(name, key, value, owned)
{
    const env = value === undefined ? {} : value;
    if (!isStringMap(env)) throw new Error(`${name}: ${key} is not a map of strings`);
    for (const k of Object.keys(env))
    {
        if (owned.has(k)) throw new Error(`${name}: ${key} ${k} is the harness's (common.json or the session) - an arm cannot set it`);
    }
    return env;
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
    // bashEnv: what every Bash command of every session sources (CLAUDE_ENV_FILE), and nothing else sees.
    const bashEnv = common.bashEnv === undefined ? {} : common.bashEnv;
    if (!isStringMap(bashEnv) || !Object.keys(bashEnv).every((k) => SHELL_NAME.test(k))) throw new Error('common.json: bashEnv is not a map of shell variable names to strings');
    const restore = common.restore === undefined ? [] : common.restore;
    if (!Array.isArray(restore) || !restore.every((c) => isStrings(c) && c.length)) throw new Error('common.json: restore is not a list of commands');

    const settingsFile = path.join(dir, common.settings);
    const settings = readJson(settingsFile);
    if (!settings) throw new Error(`common.json: settings file ${common.settings} is absent`);

    const session = {
        model: common.model, effort: common.effort, permissionMode: common.permissionMode,
        settingsFile, settings, env: { ...common.env }, bashEnv: { ...bashEnv }, graceSec: common.graceSec,
        auth: [...common.auth], scrub: [...common.scrub], restore: restore.map((c) => [...c]), cliVersion: null,
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
    const expects = arm.expects === undefined ? [] : arm.expects;
    if (!isStrings(expects)) throw new Error(`${name}: expects is not a list of paths in the clone`);
    for (const rel of expects)
    {
        if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`${name}: expects '${rel}' is not a path inside the clone`);
    }
    if (arm.onboarding.length && !expects.length) throw new Error(`${name}: onboarding names no expected output - list what it must leave in the clone under expects`);
    const owned = new Set([...HARNESS_ENV, ...session.auth, ...session.scrub, ...Object.keys(session.env), ...Object.keys(session.bashEnv || {})]);
    const env = checkEnv(name, 'env', arm.env, owned);
    const onboardingEnv = checkEnv(name, 'onboardingEnv', arm.onboardingEnv, owned);
    for (const used of placeholders([arm.setup, arm.onboarding, env, onboardingEnv]))
    {
        if (!TEMPLATE_VARS.includes(used)) throw new Error(`${name}: unknown placeholder {${used}} - a template knows ${TEMPLATE_VARS.map((v) => `{${v}}`).join(' ')}`);
    }
    const flow = checkFlow(name, arm.flow);
    const clean = { name, pin: { ...arm.pin }, setup: arm.setup.map((s) => [...s]), onboarding: [...arm.onboarding], expects: [...expects], env: { ...env }, onboardingEnv: { ...onboardingEnv } };
    return { ...clean, flow, hash: armHash(clean, session), flowHash: flowHash(flow) };
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

module.exports = { load, armHash, resolve, ARMS_DIR, TEMPLATE_VARS, EFFORTS, PERMISSION_MODES, FLOW_KINDS, FLOW_FILE };
