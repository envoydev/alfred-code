'use strict';
// The root's trim keys (root-children-only-picks): reads the catalogs, the children and the root's own files, and hands them
// to the pure verdict in children-only.js. Returns { want: { [name]: 'name-only' }, said: [line] }. A root that is no top
// root, a switch at `all`, no child below, a catalog that cannot be read or a walk that stopped at the depth cap gets an
// empty `want` - and the last two say why. It never requires child-hide.js (child-skills.js holds what both read).

const fs = require('node:fs');
const path = require('node:path');
const ws = require('./workspace.js');
const childKeep = require('./child-keep.js');
const selection = require('./selection.js');
const hide = require('../workspace-include/hide.js');
const scanEvidence = require('../scan-evidence.js');
const layout = require('../../stack/hooks/layout.js');
const { parseJson } = require('./json-file.js');
const { stackSkillsOf, relOnDisk } = require('./child-skills.js');
const { signalsOf, trimmedSkills } = require('./children-only.js');
const { NAME_ONLY, ROOT_SKILLS, CATALOG_FILES, META_DIR, CAP_LINE, catalogLine, sameRepoLine } = require('./children-only-constants.js');

const NOTHING = Object.freeze({ want: {}, said: [] });
const SKILL_LINE = 'skill ';

const switchOf = (ctx) => layout.variablesOf(ctx.projectRoot, { env: { ...ctx.env, CLAUDE_CONFIG_DIR: ctx.configDir }, dataRoot: ctx.dataInfo.root }).values[ROOT_SKILLS.key] || ROOT_SKILLS.own;

// { evidence, graph, recommendations } from the run's snapshot, or { failed: '<meta/file>' } for the first one unreadable.
function readCatalogs(sourceDir)
{
    const out = {};
    for (const [key, file] of Object.entries(CATALOG_FILES))
    {
        let parsed;
        try { parsed = parseJson(fs.readFileSync(path.join(sourceDir, META_DIR, file), 'utf8')); }
        catch { parsed = null; }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { failed: `${META_DIR}/${file}` };
        out[key] = parsed;
    }
    return out;
}

const toPosix = (root, file) => path.relative(root, file).split(path.sep).join('/');

function trimWant(ctx)
{
    if (ctx.workspace && ctx.workspace.parent) return NOTHING;
    if (switchOf(ctx) === ROOT_SKILLS.all) return NOTHING;
    const top = fs.realpathSync.native(ctx.projectRoot);
    const rows = hide.belowRows(childKeep.recordsBelow(ctx.projectRoot, { env: ctx.env, dataRoot: ctx.dataInfo.root }).rows);
    if (!rows.length) return NOTHING;
    const children = rows.map((row) => ({ rel: relOnDisk(top, row.root, row.rel), root: row.root, skills: stackSkillsOf(row.root), sameRepo: ws.sameRepo(row.root, ctx.projectRoot) }));
    const sharing = children.find((child) => child.sameRepo);
    if (sharing) return { want: {}, said: [sameRepoLine(sharing.rel)] };
    const catalogs = readCatalogs(ctx.source.dir);
    if (catalogs.failed) return { want: {}, said: [catalogLine(catalogs.failed)] };
    const walkReport = {};
    const files = scanEvidence.walk(ctx.projectRoot, null, { exclude: children.map((child) => child.rel), report: walkReport, pruneRepos: true });
    if (walkReport.capped) return { want: {}, said: [CAP_LINE] };
    const found = scanEvidence.scan(ctx.projectRoot, catalogs.evidence, null, { files });
    const linked = ctx.linkedSkills || [];
    const names = [...new Set([...linked, ...children.flatMap((child) => child.skills)])];
    const trimmed = trimmedSkills({
        linked,
        locked: new Set([...selection.lockedLines(catalogs.recommendations.always)].filter((line) => line.startsWith(SKILL_LINE)).map((line) => line.slice(SKILL_LINE.length))),
        children: children.map((child) => ({ skills: child.skills, sameRepo: child.sameRepo })),
        signals: signalsOf({ names, evidence: catalogs.evidence, graph: catalogs.graph, stacks: catalogs.recommendations.stacks }),
        evidenceHits: new Set(Object.keys(found.skills)),
        rootFiles: files.map((file) => toPosix(ctx.projectRoot, file)),
    });
    return { want: Object.fromEntries(trimmed.map((name) => [name, NAME_ONLY])), said: [] };
}

module.exports = { trimWant };
