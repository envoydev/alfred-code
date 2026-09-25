#!/usr/bin/env node
'use strict';
// A task prompt that names either stack's machinery tells the session which arm it is in, and a
// prompt written in one stack's words favours that stack. Every bench/tasks/<id>/prompt.md is
// checked against our skill, agent and command names - read from the tree at lint time AND from
// the pinned list of the release under test (arms/ours-vocabulary.txt), because this tree may carry
// an older release than the one ours.json installs - ECC's (the pinned list in
// arms/ecc-vocabulary.txt) and the generic phrases below. A hyphenated name is
// flagged as a whole token; a single-word name ('plan', 'dotnet') only as a slash command, because
// as a plain word it is ordinary English a user would type.
//
//   node bench/lint-prompts.js      exit 1 and one line per finding
const fs = require('node:fs');
const path = require('node:path');

const BENCH_DIR = __dirname;
const ECC_FILE = path.join(BENCH_DIR, 'arms', 'ecc-vocabulary.txt');
const OURS_FILE = path.join(BENCH_DIR, 'arms', 'ours-vocabulary.txt');

const GENERIC = [
    [/\bskills?\b/i, 'names the skill machinery'],
    [/\bsub-?agents?\b/i, 'names the agent machinery'],
    [/(?<![\w-])hooks?\b/i, 'names the hook machinery'],
    [/\b(?:CLAUDE|AGENTS)\.md\b/i, 'names an instruction file'],
    [/\bslash commands?\b/i, 'names the command machinery'],
    [/\bMCP\b/, 'names the tool-server machinery'],
    [/\bplugins?\b/i, 'names the plugin machinery'],
    [/\buse the docs\b/i, 'steers toward the docs'],
    [/\barchitecture docs?\b/i, 'steers toward the docs'],
    [/\b(?:serena|context7|claude-stack|alfred(?:-code)?|ECC)\b/i, 'names a stack or its server'],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mdNames(dir)
{
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
}

function dirNames(dir)
{
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

function ourNames(root)
{
    return [...new Set([
        ...dirNames(path.join(root, 'stack', 'skills')),
        ...mdNames(path.join(root, 'stack', 'agents')),
        ...mdNames(path.join(root, 'setup-plugin', 'commands')),
        ...dirNames(path.join(root, 'setup-plugin', 'skills')),
    ])].sort();
}

// A pinned list: one name per line, '#' lines are its header (where it was read from).
function pinnedList(file, what, how)
{
    if (!fs.existsSync(file)) throw new Error(`no ${what} at ${file} - ${how}`);
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function eccNames(file = ECC_FILE)
{
    return pinnedList(file, 'ECC vocabulary', 'regenerate it from the commit bench/arms/ecc.json pins');
}

function pinnedOurNames(file = OURS_FILE)
{
    return pinnedList(file, 'vocabulary for the stack under test', 'regenerate it from the release bench/arms/ours.json pins');
}

// One finding per distinct word, in the order the text holds them; a generic word inside a name
// already found ('ecc' in /ecc:plan) is that finding, not a second one.
function checkText(text, names)
{
    const found = [];
    const add = (index, word, why) =>
    {
        const end = index + word.length;
        if (found.some((f) => f.word.toLowerCase() === word.toLowerCase() || (index < f.index + f.word.length && f.index < end))) return;
        found.push({ index, word, why });
    };
    for (const name of names)
    {
        // `/name`, `/plugin:name`, never a path segment like /api/name.
        const slash = new RegExp(`(?<![\\w/.-])/(?:[a-z0-9-]+:)?${escape(name)}(?![\\w/-])`, 'gi');
        for (const m of text.matchAll(slash)) add(m.index, m[0], `slash command '${name}'`);
        if (!/[-_:]/.test(name)) continue;
        const token = new RegExp(`(?<![\\w/-])${escape(name)}(?![\\w-])`, 'gi');
        for (const m of text.matchAll(token)) add(m.index, m[0], `a stack's name '${name}'`);
    }
    for (const [re, why] of GENERIC)
    {
        for (const m of text.matchAll(new RegExp(re.source, `${re.flags}g`))) add(m.index, m[0], why);
    }
    return found.sort((a, b) => a.index - b.index).map(({ word, why }) => ({ word, why }));
}

function lintTasks({ tasksDir = path.join(BENCH_DIR, 'tasks'), names } = {})
{
    const all = names || [...new Set([...ourNames(path.join(BENCH_DIR, '..')), ...pinnedOurNames(), ...eccNames()])];
    const out = [];
    if (!fs.existsSync(tasksDir)) return out;
    for (const id of dirNames(tasksDir).sort())
    {
        const file = path.join(tasksDir, id, 'prompt.md');
        if (!fs.existsSync(file)) continue;
        for (const f of checkText(fs.readFileSync(file, 'utf8'), all)) out.push({ file: path.join(id, 'prompt.md'), ...f });
    }
    return out;
}

module.exports = { checkText, ourNames, eccNames, pinnedOurNames, lintTasks };

if (require.main === module)
{
    const found = lintTasks();
    for (const f of found) console.log(`${f.file}: '${f.word}' - ${f.why}`);
    if (found.length) process.exit(1);
    console.log('lint-prompts: clean');
}
