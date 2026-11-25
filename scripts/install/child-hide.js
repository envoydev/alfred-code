'use strict';
// A workspace root hides from its own sessions what a child below it also loads: the child's copy of a skill the root links
// (a `skillOverrides` key `<child path>:<name>`) and the native rule file the root keeps for a set-aside child (a
// `claudeMdExcludes` glob). It reads the child stamps and the workspace records; the rules of what to hide are pure, in
// scripts/workspace-include/hide.js. The rule globs are returned to `workspaceStep`, which syncs them with the other
// excludes. The skill keys are synced by `syncSkillKeys`, the last step of the root's run: after the stamp and after
// `refreshBelow` re-links the children, so they are read as the run leaves them. This file requires workspace.js, so
// workspace.js requires it only inside a function.
//
// Known limit: a child's own later run that adds a link leaves the root's key missing until the root's next run, since the
// root never runs from a child.

const fs = require('node:fs');
const path = require('node:path');
const ws = require('./workspace.js');
const stamp = require('./stamp.js');
const childKeep = require('./child-keep.js');
const nativeRules = require('./native-rules.js');
const hide = require('../workspace-include/hide.js');
const brand = require('./brand.js');
const settingsKeys = require('./settings-keys.js');
const { OBJECT_PATH, SKILL_HIDDEN, LAST_ROW } = require('./settings-keys-constants.js');
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

// The child's path from the root as the disk spells it (a record may write another case on a disk that folds it). A child
// that is a link to a project outside the root has no path inside it: the record's own spelling stands.
function relOnDisk(top, childRoot, recorded)
{
    const rel = path.relative(top, childRoot);
    return !rel || path.isAbsolute(rel) || rel.split(path.sep)[0] === '..' ? recorded.split(path.sep).join('/') : rel.split(path.sep).join('/');
}

// { '<rel>:<name>': 'off' } for the running project: each skill a child below holds as the stack's that this run links into
// the root's own `.claude/skills` (`ctx.linkedSkills`, the names of the link step's want - a member pick the root links is
// one, a store item kept for a set-aside child alone is not).
function wantedSkills(ctx)
{
    const top = fs.realpathSync.native(ctx.projectRoot);
    const { rows } = childKeep.recordsBelow(ctx.projectRoot, { env: ctx.env, dataRoot: ctx.dataInfo.root });
    const children = hide.belowRows(rows).map((row) => ({ rel: relOnDisk(top, row.root, row.rel), skills: stackSkillsOf(row.root) }));
    return Object.fromEntries(hide.hiddenSkillKeys({ children, listed: ctx.linkedSkills || [] }).map((key) => [key, SKILL_HIDDEN]));
}

// { ruleGlobs: [glob], stays: [{ name, rel }] } for the running project. `ctx.lists` is the run's final set and
// `ctx.held.keepOnly` the lines it keeps for a set-aside child alone, both set before the workspace step.
function wantedRules(ctx)
{
    const { records } = childKeep.recordsBelow(ctx.projectRoot, { env: ctx.env, dataRoot: ctx.dataInfo.root });
    const kept = ctx.held ? hide.keptRuleNames(ctx.held.keepOnly, ctx.lists.rules.map(bare)).filter((name) => isStackFile(nativeFileOf(ctx.projectRoot, name))) : [];
    const shared = new Map();
    const shares = (rel) =>
    {
        if (!shared.has(rel)) shared.set(rel, ws.sameRepo(path.join(ctx.projectRoot, ...rel.split('/')), ctx.projectRoot));
        return shared.get(rel);
    };
    const verdicts = hide.ruleVerdicts({ rules: kept, keepers: hide.ruleKeepers(records), shares });
    const ruleGlobs = ws.excludeGlobs(verdicts.hide.map((name) => nativeFileOf(ctx.projectRoot, name)), process.platform);
    return { ruleGlobs, stays: verdicts.stays };
}

// The last step of a root's run (install or update, switch on, `--print-plan` never reaches it): brings the `skillOverrides`
// keys to what the children hold now, and re-renders the root's own `managed-settings` line from the stamp this run wrote,
// byte for byte through `stamp.settingsLine` (as refreshBelow does a child's). A failed stamp write puts the settings file
// back. An unusable local file gets no row. Returns { created } - true when the keys made settings.local.json.
function syncSkillKeys(ctx)
{
    if (ctx.localBad) return { created: false };
    const file = path.join(ctx.claudeDir, 'settings.local.json');
    const stampFile = path.join(ctx.claudeDir, brand.BRAND.stamp);
    const ledger = stamp.readLedger(stampFile);
    if (!ledger) return { created: false };
    const settingsMap = ledger.settings || {};
    const prior = settingsMap['settings.local.json'] || {};
    const want = wantedSkills(ctx);
    if (!Object.keys(want).length && !Object.keys(prior).some((row) => settingsKeys.KEY_PATH.test(row))) return { created: false };
    let before = null;
    try { before = fs.readFileSync(file); }
    catch (err) { if (!err || err.code !== 'ENOENT') { ctx.note(`settings.local.json could not be read (${err && err.code}) - its ${OBJECT_PATH.skillOverrides} keys are left as they are`); return { created: false }; } }
    const got = settingsKeys.syncKeys({ file, objectPath: OBJECT_PATH.skillOverrides, want, prior, log: ctx.log, note: ctx.note, report: ctx.report });
    if (got.refused) return { created: false };
    const others = Object.fromEntries(Object.entries(prior).filter(([row]) => !settingsKeys.KEY_PATH.test(row)));
    // The ledger's own order (alfred-code.js ledgerOf): the other rows, the keys, then the memory row last.
    const { [LAST_ROW]: lastRow, ...beforeLast } = others;
    const local = { ...beforeLast, ...got.rows, ...(lastRow === undefined ? {} : { [LAST_ROW]: lastRow }) };
    const keysNow = (rows) => Object.entries(rows).filter(([row]) => settingsKeys.KEY_PATH.test(row)).map(([row, hash]) => `${row}=${hash}`).sort().join(',');
    if (!got.changed && keysNow(prior) === keysNow(got.rows)) return { created: false };
    const next = { ...settingsMap, 'settings.local.json': local };
    if (!Object.keys(local).length) delete next['settings.local.json'];
    try { stamp.markLine(stampFile, 'managed-settings', stamp.settingsLine(next)); }
    catch (err)
    {
        try { if (before === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, before); }
        catch { /* the file stays as written; the next run reads it */ }
        ctx.note(`workspace: the ${OBJECT_PATH.skillOverrides} rows could not be recorded in the stamp (${err.message}) - the settings file is put back`);
        return { created: false };
    }
    return { created: got.created };
}

module.exports = { wantedSkills, wantedRules, syncSkillKeys, stackSkillsOf };
