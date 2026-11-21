'use strict';
// Path logic for the form matcher: one canonical spelling per path, and the containment test. Pure string work. A path keeps
// its case; every comparison folds it, since a file system can ignore case and a case variant must name the same place.
const path = require('node:path');
const { SHELL, PATH } = require('./constants.js');

const apiOf = (win) => (win ? path.win32 : path.posix);
const sepOf = (win) => (win ? PATH.sep.win : PATH.sep.posix);
const fold = (text) => String(text).toLowerCase();
const sameFolded = (first, second) => fold(first) === fold(second);

// A normalised path with no trailing separator. In Windows mode `/c/x` reads as `C:\x`.
function canon(text, win)
{
    let value = String(text);
    if (win)
    {
        const drive = SHELL.msysDrive.exec(value);
        if (drive) value = `${drive[1]}:${PATH.sep.win}${drive[2] || ''}`;
    }
    value = apiOf(win).normalize(value);
    if (value.length > 1 && PATH.endsWithSep.test(value) && !PATH.driveRoot.test(value)) value = value.replace(PATH.trailingSeps, '');
    return value;
}

const isAbsoluteWord = (word, win) => apiOf(win).isAbsolute(word) || (win && SHELL.msysDrive.test(word));

const hasParentSegment = (word) => word.split(SHELL.segmentSplit).includes(SHELL.parentSegment);

// The canonical absolute path a word names, resolved against `base`; null for a word with a `..` segment or a home `~`.
function resolveWord(word, base, win)
{
    if (hasParentSegment(word) || word.startsWith(SHELL.home)) return null;
    return canon(isAbsoluteWord(word, win) ? word : apiOf(win).join(base, word), win);
}

function isUnder(candidate, root, win)
{
    const inside = fold(candidate);
    const outside = fold(root);
    if (inside === outside) return true;
    const sep = sepOf(win);
    return inside.startsWith(outside.endsWith(sep) ? outside : outside + sep);
}

// The folder a `..`-only word reaches from `base`.
const ancestorOf = (word, base, win) => canon(apiOf(win).join(base, word), win);

const isStrictlyUnder = (candidate, root, win) => !sameFolded(candidate, root) && isUnder(candidate, root, win);

// The segments of `candidate` below `root`, in the candidate's own case; call it for a candidate known to be under `root`.
function segmentsBelow(candidate, root, win)
{
    const split = (text) => text.split(win ? SHELL.segmentSplit : PATH.sep.posix);
    return split(candidate).slice(split(root).length);
}

module.exports = { canon, resolveWord, isAbsoluteWord, ancestorOf, isUnder, isStrictlyUnder, sepOf, fold, sameFolded, segmentsBelow };
