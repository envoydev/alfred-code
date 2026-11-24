'use strict';
// Gathers the facts the layout rows judge from a project on disk - the one file of this folder that touches the file
// system, the workspace and git - then hands them to layout-rows.js. Read-only. The tests of "what counts as ours" are the
// installer's own (links.js, native-rules.js, settings.js, workspace.js), so validate and update agree.
const fs = require('node:fs');
const path = require('node:path');
const links = require('../install/links.js');
const nativeRules = require('../install/native-rules.js');
const { CANARY_RULE } = require('../install/native-rules-constants.js');
const { seatOfDenyRow } = require('../install/settings.js');
const workspace = require('../install/workspace.js');
const stampLib = require('../install/stamp.js');
const selection = require('../install/selection.js');
const { loadManifest } = require('../install/manifest.js');
const { parseJson } = require('../install/json-file.js');
const { stampFile } = require('../install/brand.js');
const { layoutRows } = require('./layout-rows.js');
const { KIND, FILE, EXCLUDES_KEY, MARKDOWN_EXTENSION } = require('./constants.js');

const lstatOf = (file) => fs.lstatSync(file, { throwIfNoEntry: false }) || null;
const isDir = (file) => Boolean(fs.statSync(file, { throwIfNoEntry: false })?.isDirectory());
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const readJson = (file) => { try { return parseJson(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
const entriesOf = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const bare = (name) => name.replace(MARKDOWN_EXTENSION, '');
const namesIn = (lines, category) => lines.filter((l) => l.startsWith(`${category} `)).map((l) => l.slice(category.length + 1));

// The joined chain above the project (the installer's own read): its roots, nearest first.
function chainRoots(project)
{
    try { return workspace.chain(project).members.map((m) => m.root); } catch { return []; }
}

// A child is a project under a joined chain; with the workspace switched off, one still holding links into a chain stands in for it
// (alfred-code.js reads it the same way).
function ruleFacts({ project, library, picks, recorded, roots, switchedOn })
{
    if (!isDir(links.storeOf(project, 'rules'))) return null;
    const child = roots.length > 0 || (!switchedOn && links.inherited(project, recorded).length > 0);
    const picked = nativeRules.nativeNames({ projectRoot: project, library, ownPicks: picks.own, memberPicks: picks.member, chainRoots: roots, child });
    const stores = [project, ...roots].map((root) => links.storeOf(root, 'rules'));
    const hasText = picked.filter((name) => stores.some((dir) => fs.existsSync(path.join(dir, `${name}.md`))));
    const rulesDir = path.join(project, '.claude', 'rules');
    const onDisk = {};
    for (const entry of entriesOf(rulesDir).filter((e) => e.name.endsWith('.md')))
    {
        const at = path.join(rulesDir, entry.name);
        onDisk[bare(entry.name)] = lstatOf(at)?.isFile() && nativeRules.hasMarker(readText(at)) ? 'marked' : 'unmarked';
    }
    return { picked, hasText, onDisk, exempt: [...selection.GENERATED_FILES, CANARY_RULE] };
}

// One linked kind: what is expected on disk, what is picked, and what is there.
function linkFacts({ project, kind, own, library, picks, recorded }, singular)
{
    const dir = path.join(project, '.claude', kind);
    const store = links.storeOf(project, kind);
    const inRecord = recorded.filter((e) => e.path.startsWith(`${kind}/`)).map((e) => bare(e.path.slice(kind.length + 1)));
    const inherited = new Set(links.inherited(project, recorded).filter((e) => e.path.startsWith(`${kind}/`)).map((e) => bare(e.path.slice(kind.length + 1))));
    const listed = new Set(stampLib.readPicked(own)?.[kind] || []);
    const picked = new Set([...listed, ...namesIn(picks.own, singular), ...namesIn(picks.member, singular), ...Object.keys(library[kind] || {}), ...inherited]);
    const stored = (name) => fs.existsSync(path.join(store, name));
    // A seat whose flat `.claude/agents/<name>.md` is the user's is no pick (the installer keeps it and links nothing over it).
    const userFlat = (name) => kind === KIND.agents && Boolean(lstatOf(path.join(dir, `${name}.md`))?.isFile());
    const expected = [...new Set([...inRecord, ...(isDir(store) ? [...picked].filter(stored) : [])])].filter((name) => !userFlat(name));
    const onDisk = {};
    for (const entry of entriesOf(dir))
    {
        const link = entry.isSymbolicLink();
        onDisk[entry.name] = { link, live: !link || fs.existsSync(path.join(dir, entry.name)), intoStore: link && links.pointsIntoStore(dir, entry.name),
            listed: inRecord.includes(entry.name) };
    }
    return { expected, picked: [...picked], onDisk };
}

// The seats this release ships, retired or renamed - the rows the installer removes; with no source, the stamp's own seats.
function shippedSeats(source, library, picked)
{
    if (!source) return new Set([...Object.keys(library.agents || {}), ...(picked ? picked.agents : [])].map(bare));
    try
    {
        const manifest = loadManifest(source);
        return new Set([...manifest.agents, ...manifest.retired.agents, ...Object.keys(manifest.renamed.agents)].map(bare));
    }
    catch { return new Set(entriesOf(path.join(source, 'stack', 'agents')).filter((e) => e.name.endsWith('.md')).map((e) => bare(e.name))); }
}

function denyFacts({ project, source, library, own })
{
    const seats = shippedSeats(source, library, stampLib.readPicked(own));
    const out = [];
    for (const file of Object.values(FILE))
    {
        const deny = (readJson(path.join(project, '.claude', file)).permissions || {}).deny;
        for (const seat of (Array.isArray(deny) ? deny : []).map(seatOfDenyRow).filter((s) => s && seats.has(s))) out.push({ file, seat });
    }
    return out;
}

// A child's excludes against the chain's: what the chain wants and the file lacks, and what the stack wrote and the chain no longer wants.
function excludeFacts({ project, own, env, switchedOn })
{
    if (!switchedOn) return null;
    try
    {
        const ancestors = workspace.stampedAncestors(project, { env });
        const ignores = workspace.readWorkspace(project, { env }).view.ignores || [];
        const want = workspace.excludeGlobs(workspace.chainExcludes(ancestors, project, ignores), process.platform);
        const held = readJson(path.join(project, '.claude', FILE.local))[EXCLUDES_KEY];
        const actual = Array.isArray(held) ? held.filter((v) => typeof v === 'string') : [];
        const rows = ((stampLib.readLedger(own) || {}).settings || {})[FILE.local] || {};
        const wrote = new Set(Object.keys(rows).filter((row) => row.startsWith(`${EXCLUDES_KEY}[`)).map((row) => rows[row]));
        return { missing: want.filter((v) => !actual.includes(v)).length, stale: actual.filter((v) => wrote.has(stampLib.valueHash(v)) && !want.includes(v)).length };
    }
    catch { return null; }
}

const workspaceSwitchedOn = (project, env) => { try { return workspace.workspaceOn({ env, projectRoot: project }); } catch { return false; } };

// A child with no repository of its own under a root that links agents: a session there lists the root's seats too.
function sharedRepoRoot(project, roots)
{
    if (!roots.length || lstatOf(path.join(project, '.git'))) return null;
    const root = roots.find((r) => stampLib.readLinks(stampFile(path.join(r, '.claude')).write).some((e) => e.path.startsWith(`${KIND.agents}/`)));
    return root ? path.relative(fs.realpathSync(project), root).split(path.sep).join('/') || '.' : null;   // the chain's roots are real paths
}

function layoutOf({ project, source, own, stamp, env })
{
    const switchedOn = workspaceSwitchedOn(project, env);
    const ownPicks = stampLib.readOwnPicks(own) || [];
    const memberPicks = stampLib.readMemberPicks(own) || [];
    const picks = { own: ownPicks, member: memberPicks };
    const recorded = stampLib.readLinks(own);
    const roots = chainRoots(project);
    const common = { project, own, library: stamp, picks, recorded };
    return layoutRows({
        rules: ruleFacts({ ...common, roots, switchedOn }),
        links: { skills: linkFacts({ ...common, kind: KIND.skills }, 'skill'), agents: linkFacts({ ...common, kind: KIND.agents }, 'agent') },
        denies: denyFacts({ project, source, library: stamp, own }),
        excludes: excludeFacts({ project, own, env, switchedOn }),
        sharedRepo: sharedRepoRoot(project, roots),
    });
}

module.exports = { layoutOf };
