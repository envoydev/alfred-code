'use strict';
// A session measures its arm only when nothing else's instructions reach it. Claude Code reads
// CLAUDE.md, CLAUDE.local.md and .claude/ (its CLAUDE.md and rules) from every directory above the one
// it starts in, so a cell inside this repository loads this repository's own instructions into every
// arm - measured in the first pilot: 142,258 characters of host rules, and `bare` calling the stack's
// skills by name. The harness refuses such a place rather than measure a contaminated arm.
const fs = require('node:fs');
const path = require('node:path');

const INSTRUCTION_NAMES = ['CLAUDE.md', 'CLAUDE.local.md', '.claude'];

// The nearest real directory at or above `dir`: a work root or cell may not be made yet.
function realOrParent(dir)
{
    let at = path.resolve(dir);
    for (;;)
    {
        try { return { real: fs.realpathSync(at), made: at === path.resolve(dir) }; }
        catch { /* not made yet */ }
        const up = path.dirname(at);
        if (up === at) return { real: at, made: false };
        at = up;
    }
}

// The first instruction file or folder above `dir` (and in it, with `inclusive`), or null.
function instructionsAbove(dir, { inclusive = false } = {})
{
    const { real, made } = realOrParent(dir);
    let at = made && !inclusive ? path.dirname(real) : real;
    for (;;)
    {
        for (const name of INSTRUCTION_NAMES)
        {
            const p = path.join(at, name);
            if (fs.existsSync(p)) return p;
        }
        const up = path.dirname(at);
        if (up === at) return null;
        at = up;
    }
}

function assertIsolated(dir, what, opts)
{
    const hit = instructionsAbove(dir, opts);
    if (hit) throw new Error(`${what} sits under ${hit} - every session there would load it (Claude Code reads CLAUDE.md and .claude/ from each directory above its own); pick a --work-root with none above it`);
}

module.exports = { instructionsAbove, assertIsolated, INSTRUCTION_NAMES };
