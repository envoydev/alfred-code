// Copied into each repo as .claude/kit/kit-settings.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Resolves the values the kit's skills run on, each with where it came from. settings.mjs prints them and
// status-hook.mjs adds them to every request, so a new session - or one that lost its context to a compaction -
// never has to remember them.
//
// A value is set in the `env` block of a Claude Code settings file (~/.claude/settings.json, .claude/settings.json
// or .claude/settings.local.json). Claude Code decides which file wins and puts the value in the environment:
//
//   KIT_PASS_SCORE        the score a graded spec or plan must reach, a whole number from 1 to 100 (90 without it)
//   KIT_PLAN_MODEL        the model that writes plans: the audit planner, a spec or plan written by a dispatched agent
//   KIT_REVIEW_MODEL      the model that reviews: the refining-plans reviewer, the review of a finished change
//   KIT_IMPLEMENT_MODEL   the model that implements: the audit editor, a plan's build
//   KIT_SCORING=off       grading is off until the variable changes
//   KIT_AUTO_RUN=on       auto-run is on from a session's first ask
//
// A model is one of sonnet, opus, haiku, fable - what a dispatch accepts. Without a variable it is the model the
// role's agent file names. KIT_SCORING and KIT_AUTO_RUN switch a safeguard off, so they count only from a file that
// is not committed: one found in .claude/settings.json is ignored and named.
// Claude Code applies a new or changed value to a session that is already open, but a deleted variable stays set
// there until it restarts: to switch one back at once, set its other value (KIT_AUTO_RUN=off) instead of deleting it.
// A value that cannot be used falls back to its default, and its origin says why.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
const DEFAULT_PASS_SCORE = 90;
const COMMITTED_SETTINGS = '.claude/settings.json';

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

function passScore(env)
{
    const value = readVariable(env, 'KIT_PASS_SCORE');
    if (value === null) return { value: String(DEFAULT_PASS_SCORE), origin: 'default' };
    const score = /^\d+$/.test(value) ? Number(value) : 0;
    if (score >= 1 && score <= 100) return { value: String(score), origin: 'KIT_PASS_SCORE' };
    return { value: String(DEFAULT_PASS_SCORE), origin: `default - KIT_PASS_SCORE='${value}' is not a whole number from 1 to 100` };
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
    return { value: fallback.value, origin: `${fallback.origin} - ${variable}='${value}' is not one of ${MODELS.join(', ')}` };
}

// A switch that turns a safeguard off: `flipped` is the one value that changes it, and only an uncommitted file may.
function safeguard(env, variable, standing, flipped, committedNames)
{
    const value = readVariable(env, variable);
    if (committedNames.includes(variable))
        return { value: standing, origin: `default - ${variable} in ${COMMITTED_SETTINGS} is ignored: set it in .claude/settings.local.json` };
    if (value === null) return { value: standing, origin: 'default' };
    if (value === flipped || value === standing) return { value, origin: variable };
    return { value: standing, origin: `default - ${variable}='${value}' is neither 'on' nor 'off'` };
}

// `env` is the environment to read (process.env), `root` the repo whose agents and committed settings count.
export function resolveKitSettings(env, root)
{
    const committedNames = committedEnvNames(root);
    return {
        pass_score: passScore(env),
        plan_model: roleModel(env, root, 'KIT_PLAN_MODEL', 'audit-planner'),
        review_model: roleModel(env, root, 'KIT_REVIEW_MODEL', 'plan-grader'),
        implement_model: roleModel(env, root, 'KIT_IMPLEMENT_MODEL', 'audit-editor'),
        scoring: safeguard(env, 'KIT_SCORING', 'on', 'off', committedNames),
        auto_run: safeguard(env, 'KIT_AUTO_RUN', 'off', 'on', committedNames),
    };
}
