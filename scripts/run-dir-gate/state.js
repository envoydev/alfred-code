'use strict';
// What the form matcher knows about one call: the run dir, the project dir, the script shapes and the marker path - and the
// tests every form shares to place a word against them. Pure.
const { SHELL, SESSION_FILE, REPO_DIR, ARG } = require('./constants.js');
const { compileTemplate } = require('./values.js');
const { canon, resolveWord, isUnder, isStrictlyUnder, sepOf, fold, segmentsBelow } = require('./paths.js');

// The table's `scripts` object as a Map keyed in lower case: script -> mode -> { sequences, flags }, where `sequences` are the
// positional templates of each call the bodies write and `flags` maps a flag to { values, bare } (`bare`: it may stand
// alone). A malformed entry is left out, which only narrows what passes. Anything else is empty.
const compiled = (templates) => (Array.isArray(templates) ? templates.map(compileTemplate).filter(Boolean) : []);

function flagsOf(flags)
{
    const out = new Map();
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return out;
    for (const [name, entries] of Object.entries(flags))
    {
        if (!Array.isArray(entries)) continue;
        out.set(name, { values: compiled(entries.filter((entry) => entry !== true)), bare: entries.includes(true) });
    }
    return out;
}

function modeOf(shape)
{
    if (!shape || !Array.isArray(shape.positionals)) return null;
    const sequences = shape.positionals.filter(Array.isArray).map((sequence) => sequence.map(compileTemplate)).filter((sequence) => !sequence.includes(null));
    return { sequences, flags: flagsOf(shape.flags) };
}

function shapesOf(scripts)
{
    const shapes = new Map();
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return shapes;
    for (const [name, modes] of Object.entries(scripts))
    {
        if (!modes || typeof modes !== 'object' || Array.isArray(modes)) continue;
        const byMode = new Map();
        for (const [mode, shape] of Object.entries(modes))
        {
            const read = modeOf(shape);
            if (read) byMode.set(mode, read);
        }
        shapes.set(name.toLowerCase(), byMode);
    }
    return shapes;
}

function makeState(ctx)
{
    const win = SHELL.driveStart.test(ctx.runDir);
    const runDir = canon(ctx.runDir, win);
    const cwd = canon(ctx.cwd, win);
    return {
        win,
        runDir,
        repoDir: `${runDir}${sepOf(win)}${REPO_DIR}`,
        cwd,
        roots: [runDir, cwd],
        scripts: shapesOf(ctx.scripts),
        accountDirs: [ctx.accountDir, ctx.accountDirReal].filter((dir) => typeof dir === 'string' && dir !== '').map((dir) => canon(dir, win)),
        marker: ctx.markerPath ? canon(ctx.markerPath, win) : null,
    };
}

const resolveIn = (word, base, state) => resolveWord(word.value, base, state.win);

const isPlainBelowRunDir = (target, state) => segmentsBelow(target, state.runDir, state.win).every((segment) => ARG.targetSegment.test(segment));

function isTarget(word, base, state)
{
    const target = resolveIn(word, base, state);
    if (!target || !isStrictlyUnder(target, state.runDir, state.win) || isUnder(target, state.repoDir, state.win)) return false;
    const below = segmentsBelow(target, state.runDir, state.win);
    return isPlainBelowRunDir(target, state) && fold(below[below.length - 1]) !== SESSION_FILE;
}

function isRunDirFile(word, base, state)
{
    const file = resolveIn(word, base, state);
    return Boolean(file) && isStrictlyUnder(file, state.runDir, state.win) && isPlainBelowRunDir(file, state);
}

module.exports = { makeState, resolveIn, isTarget, isRunDirFile };
