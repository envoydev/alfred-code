#!/usr/bin/env node
// Copied into each repo as .claude/kit/settings.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Prints the values the kit's skills run on, each with where it came from, so a new session - or one that lost its
// context to a compaction - reads them with one command instead of remembering them:
//
//   node .claude/kit/settings.mjs
//
// A value is set in the `env` block of a Claude Code settings file (~/.claude/settings.json, .claude/settings.json
// or .claude/settings.local.json). Claude Code decides which file wins and puts the value in the environment:
//
//   KIT_PASS_SCORE      the score a graded spec or plan must reach, a whole number from 1 to 100 (90 without it)
//   KIT_GRADER_MODEL    the model the refining-plans reviewer runs on
//   KIT_AUDITOR_MODEL   the model the audit-planner agent runs on
//   KIT_EDITOR_MODEL    the model the audit-editor agent runs on
//   KIT_SCORING=off     grading is off until the variable goes
//   KIT_AUTO_RUN=on     auto-run is on from a session's first ask
//
// A model is one of sonnet, opus, haiku, fable - what a dispatch accepts. Without a variable it is the model the
// agent's own file names. KIT_SCORING and KIT_AUTO_RUN switch a safeguard off, so they count only from a file that
// is not committed: one found in .claude/settings.json is ignored and named.
// Always exits 0: a value that cannot be used falls back to its default, and the line says why.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
const DEFAULT_PASS_SCORE = 90;
const COMMITTED_SETTINGS = '.claude/settings.json';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readVariable(variable)
{
    const value = (process.env[variable] ?? '').trim();
    return value === '' ? null : value;
}

function committedEnvNames()
{
    try { return Object.keys(JSON.parse(readFileSync(join(root, COMMITTED_SETTINGS), 'utf8')).env ?? {}); }
    catch { return []; }
}

function agentModel(agent)
{
    try { return /^model:\s*(\S+)\s*$/m.exec(readFileSync(join(root, '.claude', 'agents', `${agent}.md`), 'utf8'))?.[1] ?? null; }
    catch { return null; }
}

function passScore()
{
    const value = readVariable('KIT_PASS_SCORE');
    if (value === null) return `${DEFAULT_PASS_SCORE} (default)`;
    const score = /^\d+$/.test(value) ? Number(value) : 0;
    if (score >= 1 && score <= 100) return `${score} (KIT_PASS_SCORE)`;
    return `${DEFAULT_PASS_SCORE} (default - KIT_PASS_SCORE='${value}' is not a whole number from 1 to 100)`;
}

function seatModel(variable, agent)
{
    const own = agentModel(agent);
    const fallback = own === null
        ? `none (.claude/agents/${agent}.md names no model - pass no model`
        : `${own} (the ${agent} agent's own`;
    const value = readVariable(variable);
    if (value === null) return `${fallback})`;
    if (MODELS.includes(value)) return `${value} (${variable})`;
    return `${fallback} - ${variable}='${value}' is not one of ${MODELS.join(', ')})`;
}

// A switch that turns a safeguard off: `flipped` is the one value that changes it, and only an uncommitted file may.
function safeguard(variable, standing, flipped, committedNames)
{
    const value = readVariable(variable);
    if (committedNames.includes(variable))
        return `${standing} (default - ${variable} in ${COMMITTED_SETTINGS} is ignored: set it in .claude/settings.local.json)`;
    if (value === null) return `${standing} (default)`;
    if (value === flipped) return `${flipped} (${variable})`;
    return `${standing} (default - ${variable}='${value}' is not '${flipped}')`;
}

const committedNames = committedEnvNames();
console.log(`pass_score: ${passScore()}`);
console.log(`grader_model: ${seatModel('KIT_GRADER_MODEL', 'plan-grader')}`);
console.log(`auditor_model: ${seatModel('KIT_AUDITOR_MODEL', 'audit-planner')}`);
console.log(`editor_model: ${seatModel('KIT_EDITOR_MODEL', 'audit-editor')}`);
console.log(`scoring: ${safeguard('KIT_SCORING', 'on', 'off', committedNames)}`);
console.log(`auto_run: ${safeguard('KIT_AUTO_RUN', 'off', 'on', committedNames)}`);
