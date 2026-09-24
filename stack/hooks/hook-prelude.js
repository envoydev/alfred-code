#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// The two gates every stack hook runs before it does anything, kept in ONE file because a copy
// of the same twelve lines inlined in every hook is a chance to drift per hook. The hooks already reach
// siblings this way (`require('./docs.js')`, `model-windows.json` through `__dirname`), so this is
// the established shape rather than a new one.
//
// GATE 1 - ALFRED_CODE_HOOKS_OFF. A csv of hook names a project does not want. It replaces the
// guided walk's hooks LAYER: selection used to mean 'do not copy this file', and once the hooks
// arrive through a plugin there is no file to leave out - the whole set ships together and a
// project turns one off by naming it. Matching is exact on the base name, `.js` optional, case and
// surrounding space ignored; a PREFIX never matches, so `guard-secret` does not silence
// `guard-secret-value`.
//
// GATE 2 - the migration window. Between the release that starts shipping hooks through the plugin
// and the update run that prunes the copies, a project can carry BOTH: the copied hook files
// wired in `.claude/settings.json` and the same hooks enabled through the plugin. Every guard
// would then fire twice - two denials for one command, two block rows in the ledger, two
// AskUserQuestions. The PLUGIN copy is the one that steps aside, because the copied one is what the
// project's own settings file points at and is the older, already-trusted route.
//
// Both gates FAIL OPEN. A hook that cannot read the settings file, or reads junk, runs normally: a
// guard that goes silent on a malformed file is a guard an attacker turns off by corrupting a file.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The wiring the installers write, in both spellings that shipped: quoted (current) and bare
// (through 0.2.4x). Only a `$CLAUDE_PROJECT_DIR/.claude/hooks/<file>` command counts - a user
// running their own copy of a same-named hook from their own path is NOT this hook's twin, and the
// plugin must keep working for them.
const COPIED_PREFIX = '$CLAUDE_PROJECT_DIR/.claude/hooks/';

function baseName(hook)
{
    return String(hook || '').trim().toLowerCase().replace(/\.js$/, '');
}

function hookDisabled(hook, env)
{
    const source = env || process.env;
    const off = String((source && source.ALFRED_CODE_HOOKS_OFF) || '');
    if (!off.trim()) return false;
    const wanted = baseName(hook);
    if (!wanted) return false;
    return off.split(',').map(baseName).filter(Boolean).includes(wanted);
}

// Every command string in the settings file, whatever the event and matcher nesting.
function wiredCommands(settingsFile)
{
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { return []; }
    const hooks = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.hooks : null;
    if (!hooks || typeof hooks !== 'object') return [];
    const out = [];
    for (const blocks of Object.values(hooks))
    {
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks)
        {
            const list = block && Array.isArray(block.hooks) ? block.hooks : [];
            for (const entry of list) if (entry && typeof entry.command === 'string') out.push(entry.command);
        }
    }
    return out;
}

function yieldToCopiedTwin(hook, env)
{
    const source = env || process.env;
    if (!source || !source.CLAUDE_PLUGIN_ROOT) return false;   // this IS the copied hook
    const root = source.CLAUDE_PROJECT_DIR;
    if (!root) return false;
    const wanted = baseName(hook);
    if (!wanted) return false;
    const target = (COPIED_PREFIX + wanted + '.js').toLowerCase();
    for (const command of wiredCommands(path.join(root, '.claude', 'settings.json')))
    {
        const clean = command.replace(/"/g, '').trim().toLowerCase();
        if (clean === target || clean.startsWith(target + ' ')) return true;
    }
    return false;
}

// Three of these files are also CLIs the model and the commands run by hand -
// `guard-secret-value.js --presence <file> KEY ...`, `--redacted`, `--redacted-env`. A hook
// invocation never carries an argument (every catalog row's args field is empty), so a leading
// `--<flag>` says this is the CLI, and a CLI is never gated: switching a guard off must not take
// away the sanctioned way to READ a credential's presence.
function isCliInvocation(argv)
{
    return /^--/.test(String((argv || process.argv)[2] || ''));
}

// The one call every hook makes: true means do nothing at all, exit 0, print nothing.
function standDown(hook, env, argv)
{
    try
    {
        if (isCliInvocation(argv)) return false;
        return hookDisabled(hook, env) || yieldToCopiedTwin(hook, env);
    }
    catch { return false; }
}

module.exports = { hookDisabled, yieldToCopiedTwin, standDown, isCliInvocation, COPIED_PREFIX };
