'use strict';
// Path logic for the form matcher: one canonical spelling per path, and the containment test. Pure string work.
const path = require('node:path');
const { SHELL } = require('./constants.js');

const apiOf = (win) => (win ? path.win32 : path.posix);
const sepOf = (win) => (win ? '\\' : '/');

// A normalised path with no trailing separator. In Windows mode `/c/x` reads as `C:\x` and the case is folded, since the
// file system folds it.
function canon(text, win)
{
    let value = String(text);
    if (win)
    {
        const drive = SHELL.msysDrive.exec(value);
        if (drive) value = `${drive[1]}:\\${drive[2] || ''}`;
    }
    value = apiOf(win).normalize(value);
    if (value.length > 1 && /[\\/]$/.test(value) && !/^[A-Za-z]:[\\/]$/.test(value)) value = value.replace(/[\\/]+$/, '');
    return win ? value.toLowerCase() : value;
}

const hasParentSegment = (word) => word.split(SHELL.segmentSplit).includes('..');

// The canonical absolute path a word names, resolved against `base`; null for a word with a `..` segment or a home `~`.
function resolveWord(word, base, win)
{
    if (hasParentSegment(word) || word.startsWith('~')) return null;
    const absolute = apiOf(win).isAbsolute(word) || (win && SHELL.msysDrive.test(word));
    return canon(absolute ? word : apiOf(win).join(base, word), win);
}

function isUnder(candidate, root, win)
{
    if (candidate === root) return true;
    const sep = sepOf(win);
    return candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

const isStrictlyUnder = (candidate, root, win) => candidate !== root && isUnder(candidate, root, win);

module.exports = { canon, resolveWord, isUnder, isStrictlyUnder, sepOf };
