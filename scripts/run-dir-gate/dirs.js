'use strict';
// Finds the run dirs a command names, and maps each to a path this process can read.
const { RUN_DIR_RE, SHELL, PATH, WIN32 } = require('./constants.js');

// Every run dir spelling in a command, as written, once each, in the order it first appears.
function findRunDirs(command)
{
    const found = [];
    for (const match of String(command).matchAll(RUN_DIR_RE)) if (!found.includes(match[1])) found.push(match[1]);
    return found;
}

// The path a run dir names on this platform, or null when it cannot be told. `cygpathW` turns one Unix-style path into a
// Windows one, or returns null.
function mapRunDir(raw, platform, cygpathW)
{
    if (platform !== WIN32 || SHELL.driveStart.test(raw)) return raw;
    const drive = SHELL.msysDrive.exec(raw);
    if (drive) return `${drive[1].toUpperCase()}:${PATH.sep.win}${(drive[2] || '').replace(PATH.slashes, PATH.sep.win)}`;
    return cygpathW(raw) || null;
}

function foldDir(dir)
{
    const text = String(dir).replace(PATH.backslashes, PATH.sep.posix).replace(PATH.trailingSlashes, '');
    const drive = PATH.foldedDrive.exec(text) || PATH.foldedMsysDrive.exec(text);
    return drive ? `${drive[1]}:${PATH.sep.posix}${drive[2]}`.toLowerCase() : text;
}

// Whether two spellings name one dir. A drive spelling (`C:\x`, `C:/x`, `/c/x`) folds to one form, so a pair that only
// differs in spelling never reads as two dirs.
const sameDir = (first, second) => foldDir(first) === foldDir(second);

module.exports = { findRunDirs, mapRunDir, sameDir };
