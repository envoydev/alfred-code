'use strict';
// What the form matcher knows about one call: the run dir, the project dir, the script shapes and the marker path - and the
// tests every form shares to place a word against them. Pure.
const { SHELL, SESSION_FILE, REPO_DIR, ARG } = require('./constants.js');
const { canon, resolveWord, isUnder, isStrictlyUnder, sepOf } = require('./paths.js');

// The table's `scripts` object as a Map keyed in lower case: { modes: Set, flags: Set } each. Anything else is empty.
function shapesOf(scripts)
{
    const shapes = new Map();
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return shapes;
    for (const [name, shape] of Object.entries(scripts))
    {
        if (!shape || !Array.isArray(shape.modes) || !Array.isArray(shape.flags)) continue;
        const modes = new Set(shape.modes);
        shapes.set(name.toLowerCase(), { modes, flags: new Set(shape.flags), hasModes: [...modes].some((mode) => mode !== ARG.noMode) });
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
        marker: ctx.markerPath ? canon(ctx.markerPath, win) : null,
    };
}

const resolveIn = (word, base, state) => resolveWord(word.value, base, state.win);

function isTarget(word, base, state)
{
    const target = resolveIn(word, base, state);
    if (!target || !isStrictlyUnder(target, state.runDir, state.win) || isUnder(target, state.repoDir, state.win)) return false;
    return target.split(sepOf(state.win)).pop() !== SESSION_FILE;
}

function isRunDirFile(word, base, state)
{
    const file = resolveIn(word, base, state);
    return Boolean(file) && isStrictlyUnder(file, state.runDir, state.win);
}

module.exports = { makeState, resolveIn, isTarget, isRunDirFile };
