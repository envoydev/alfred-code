'use strict';
// What a child below a workspace root holds, read from its stamp and its folder: shared by the root's hide keys
// (child-hide.js) and its trim keys (children-only-read.js), so neither requires the other.

const fs = require('node:fs');
const path = require('node:path');
const stamp = require('./stamp.js');
const hide = require('../workspace-include/hide.js');

const exists = (target) => { try { fs.lstatSync(target); return true; } catch { return false; } };

// The stack's skills in one child that sit in its own `.claude/skills`: what its stamp's links and library lines name.
function stackSkillsOf(childRoot)
{
    const file = stamp.stampFiles({ projectRoot: childRoot }).read;
    if (!file) return [];
    const named = hide.stackSkillNames(stamp.readLinks(file), Object.keys((stamp.readLibrary(file) || {}).skills || {}));
    return named.filter((name) => exists(path.join(childRoot, '.claude', 'skills', name)));
}

// The child's path from the root as the disk spells it (a record may write another case on a disk that folds it). A child
// that is a link to a project outside the root has no path inside it: the record's own spelling stands.
function relOnDisk(top, childRoot, recorded)
{
    const rel = path.relative(top, childRoot);
    return !rel || path.isAbsolute(rel) || rel.split(path.sep)[0] === '..' ? recorded.split(path.sep).join('/') : rel.split(path.sep).join('/');
}

module.exports = { stackSkillsOf, relOnDisk };
