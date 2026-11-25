'use strict';
// A workspace root hides from its own sessions what a child below it also loads: the child's copy of a skill the root lists
// (a `skillOverrides` key `<child path>:<name>`) and the native rule file the root keeps for a set-aside child (a
// `claudeMdExcludes` glob). It reads the child stamps and the workspace records; the rules of what to hide are pure, in
// scripts/workspace-include/hide.js. Nothing is written here: `workspaceStep` syncs the values this returns. This file
// requires workspace.js, so workspace.js requires it only inside a function.
//
// Known limit: a child's later run that adds a link leaves the root's key missing until the root's next run, since the
// root never runs from a child.

const fs = require('node:fs');
const path = require('node:path');
const ws = require('./workspace.js');
const stamp = require('./stamp.js');
const childKeep = require('./child-keep.js');
const nativeRules = require('./native-rules.js');
const hide = require('../workspace-include/hide.js');
const { SKILL_HIDDEN } = require('./settings-keys-constants.js');
const { RULES_DIR_PARTS } = require('./native-rules-constants.js');

const bare = (file) => file.replace(/\.md$/, '');
const exists = (target) => { try { fs.lstatSync(target); return true; } catch { return false; } };

// The stack's skills in one child that sit in its own `.claude/skills`: what its stamp's links and library lines name.
function stackSkillsOf(childRoot)
{
    const file = stamp.stampFiles({ projectRoot: childRoot }).read;
    if (!file) return [];
    const named = hide.stackSkillNames(stamp.readLinks(file), Object.keys((stamp.readLibrary(file) || {}).skills || {}));
    return named.filter((name) => exists(path.join(childRoot, '.claude', 'skills', name)));
}

// The native file the root keeps for a rule, when the stack wrote it: a file with no marker is the user's and is left loading.
const nativeFileOf = (projectRoot, name) => path.join(projectRoot, ...RULES_DIR_PARTS, `${name}.md`);
function isStackFile(file)
{
    try { return nativeRules.hasMarker(fs.readFileSync(file, 'utf8')); }
    catch { return false; }
}

// { skills: { '<rel>:<name>': 'off' }, ruleGlobs: [glob], stays: [{ name, rel }] } for the running project. `ctx.lists` is the
// run's final set and `ctx.held.keepOnly` the lines it keeps for a set-aside child alone, both set before the workspace step.
function wanted(ctx)
{
    const { rows, records } = childKeep.recordsBelow(ctx.projectRoot, { env: ctx.env, dataRoot: ctx.dataInfo.root });
    const below = hide.belowRows(rows);
    const listed = ctx.lists.skills.map((entry) => entry.split('|').pop());
    const children = below.map((row) => ({ rel: row.rel, skills: stackSkillsOf(row.root) }));
    const skills = Object.fromEntries(hide.hiddenSkillKeys({ children, listed }).map((key) => [key, SKILL_HIDDEN]));
    const kept = ctx.held ? hide.keptRuleNames(ctx.held.keepOnly, ctx.lists.rules.map(bare)).filter((name) => isStackFile(nativeFileOf(ctx.projectRoot, name))) : [];
    const shared = new Map();
    const shares = (rel) =>
    {
        if (!shared.has(rel)) shared.set(rel, ws.sameRepo(path.join(ctx.projectRoot, ...rel.split('/')), ctx.projectRoot));
        return shared.get(rel);
    };
    const verdicts = hide.ruleVerdicts({ rules: kept, keepers: hide.ruleKeepers(records), shares });
    const ruleGlobs = ws.excludeGlobs(verdicts.hide.map((name) => nativeFileOf(ctx.projectRoot, name)), process.platform);
    return { skills, ruleGlobs, stays: verdicts.stays };
}

module.exports = { wanted, stackSkillsOf };
