'use strict';
// THE DOCS LAYER - where a capture's documents live, and how they are versioned.
//
// Two jobs, both absent-only:
//
//   - THE DOMAIN MIGRATION. Three documents a capture used to write at an old path now write at a
//     new one, so an existing install's file is relocated ONCE, byte-identical, and NEVER over a
//     file already at the new path. A folder becomes a domain the engine sees only when it holds a
//     `watch.json`, so a moved document stayed invisible until its capture re-ran - two of the
//     three get the minimal `{}` written for them. `quality/` is watch-less BY DESIGN and is left alone: it is
//     recomputed every run. The working papers that sat in `related-context/` move to `work/cross-project-tasks/`
//     with the 2.8.0 layout (migrateLayout).
//
//   - THE VERSIONING SEED. `ALFRED_CODE_DOCS_VERSIONING` says HOW the docs follow a branch: `git`
//     when they are committed, `local` when they are kept out of git and need per-branch overlays.
//     The rule lives in FOUR homes (both installer seeds, `stamp-docs-root.js`, the `docs.js`
//     engine fallback) and one table-driven test pins them together. Getting it wrong is silent and
//     expensive in one direction: seeding `local` over committed docs hides every section behind an
//     overlay, so the probe is written to fail toward `git`.
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');
const rt = require('./runtime.js');  // R105: every external command through the one Windows-safe spawn

// A folder under the docs root is a DOMAIN when it holds a watch.json - architecture/ is
// grandfathered without one. `references/` and `history/` are reserved names, never domains. The
// same rule as the engine's own domains(), reserved names and all.
const RESERVED = ['references', 'history'];

function domains(docsBase)
{
    let names;
    try { names = fs.readdirSync(docsBase, { withFileTypes: true }); }
    catch { return []; }
    return names
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !RESERVED.includes(d.name))
        .map((d) => d.name)
        .filter((name) => name === 'architecture' || fs.existsSync(path.join(docsBase, name, 'watch.json')))
        .sort();
}

// git, with every call its own yes/no. Forward slashes DELIBERATELY, also on Windows: a
// backslash pathspec can fail to match, and a false negative here seeds `local` over committed
// docs - the exact silent switch this seed exists to prevent.
const realGit = (projectRoot) => ({
    tracked(dir)
    {
        try { rt.execCommand('git', ['ls-files', '--error-unmatch', '--', dir], { cwd: projectRoot, stdio: 'ignore' }); return true; }
        catch { return false; }
    },
    // `<docs>/` WITH the trailing slash: git answers check-ignore for a path that does not exist
    // yet, but a directory-only pattern ('.alfred/docs/') matches the bare name only once the
    // folder is there.
    ignored(rel)
    {
        if (!rel) return false;
        try { rt.execCommand('git', ['check-ignore', '-q', '--', `${rel}/`], { cwd: projectRoot, stdio: 'ignore' }); return true; }
        catch { return false; }
    },
});

// `local` ONLY when the docs are demonstrably kept out of git: no domain is tracked, AND either a
// domain exists (so there is something to have committed) or git ignores the docs root outright.
// Everything else, a fresh project included, is `git`.
function docsVersioningSeed({ projectRoot, docsPath, git })
{
    const g = git || realGit(projectRoot);
    const root = String(projectRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = String(docsPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const base = [root, ...parts].join('/');
    const names = domains(base);
    const committed = names.some((name) => g.tracked(`${base}/${name}`));
    const keptOut = !committed && (names.length > 0 || g.ignored(parts.join('/')));
    return keptOut ? 'local' : 'git';
}

// ABSENT-ONLY: never overwrites a file at the new path, never touches a missing old one. A plain
// move, so the content is unchanged.
function migrateDocsFile(oldPath, newPath, label, { log = () => {} } = {})
{
    if (!fs.existsSync(oldPath) || !fs.statSync(oldPath).isFile()) return false;
    if (fs.existsSync(newPath))
    {
        log(`  docs migration (${label}): ${newPath} already exists - ${oldPath} left in place, nothing overwritten`);
        return false;
    }
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
    log(`  docs migration (${label}): ${path.basename(oldPath)} -> ${newPath}`);
    return true;
}

// Keyed on the DOC at its new path, so an install an earlier run migrated is switched on too. Never
// overwrites a watch.json - any content, any validity, a dangling symlink included: it is theirs.
function switchOnDomain(dir, doc, { log = () => {} } = {})
{
    if (!fs.existsSync(path.join(dir, doc))) return false;
    const watch = path.join(dir, 'watch.json');
    try { fs.lstatSync(watch); return false; }                 // lstat: a dangling link still counts
    catch { /* absent - ours to write */ }

    // A doc an older capture wrote carries no section ids; once the folder is a domain, `docs.js
    // lint` flags each section. SAID here rather than fixed - seeding ids would rewrite the
    // project's docs across every domain.
    let note = '';
    try
    {
        const body = fs.readFileSync(path.join(dir, doc), 'utf8');
        if (/^#{2,4}\s/m.test(body) && !/<!--\s*id:/i.test(body))
            note = " - its sections predate section ids, so 'docs.js lint' flags them until 'node .claude/hooks/docs.js seed-ids' or the capture's next run";
    }
    catch { /* unreadable is not a reason to skip the switch-on */ }

    try { fs.writeFileSync(watch, '{}\n'); }
    catch
    {
        log(`  !! docs domain: could not write ${watch} - ${path.basename(dir)}/ stays invisible to the docs engine until its capture re-runs`);
        return false;
    }
    log(`  docs domain: ${path.basename(dir)}/ switched on - watch.json written ({}; the capture's next run fills in its entries)${note}`);
    return true;
}

// The moves, and the two switch-ons. Only the orientation doc that capture wrote moves out of related-context/ here;
// the working papers left beside it go to work/cross-project-tasks/ with the 2.8.0 layout (migrateLayout). The orientation
// doc's pre-folder home, loose at the root, moves too: its capture moves it on its next run, and a
// capture never re-runs by itself (2026-10-10: a 0.2.x project carried it loose to .alfred/docs/
// through the data move). The folder form is listed first, so it wins when both exist; so is the architecture
// assessment's newer home, quality/ASSESSMENT.md (2.0.0 to 2.4.0), over the older architecture/ one.
const DOCS_MIGRATIONS = [
    ['PROJECT-CODE-STYLE.md', 'code-style/CODE-STYLE.md', 'code style'],
    ['quality/ASSESSMENT.md', 'quality/ARCHITECTURE-ASSESSMENT.md', 'architecture quality'],
    ['architecture/ASSESSMENT.md', 'quality/ARCHITECTURE-ASSESSMENT.md', 'architecture quality'],
    ['related-context/PROJECT-RELATED-CONTEXT.md', 'related-projects/RELATED-PROJECTS.md', 'related projects'],
    ['PROJECT-RELATED-CONTEXT.md', 'related-projects/RELATED-PROJECTS.md', 'related projects'],
    // The run book follows its capture's name (the user's ruling of 2026-10-15). Its watch.json goes with it; the old
    // folder's credentials.local.env and .gitignore stay where adoptCredentials and pruneNestedIgnores look for them.
    ['project-capabilities/PROJECT-CAPABILITIES.md', 'project-awareness/PROJECT-AWARENESS.md', 'project awareness'],
    ['project-capabilities/watch.json', 'project-awareness/watch.json', 'project awareness'],
    // The awareness layout (the user's ruling of 2026-10-16): the run book and the sibling doc join the inventory in
    // ONE domain, after the rows above brought each to its 2026-10-15 home - so an older install arrives in one run.
    ['project-awareness/PROJECT-AWARENESS.md', 'awareness/PROJECT-AWARENESS.md', 'awareness'],
    ['project-awareness/watch.json', 'awareness/watch.json', 'awareness'],
    ['related-projects/RELATED-PROJECTS.md', 'awareness/RELATED-PROJECTS-AWARENESS.md', 'awareness'],
];
const DOCS_SWITCH_ON = [['code-style', 'CODE-STYLE.md']];
// A doc can move twice in one run (loose, then related-projects/, then awareness/): its last home, by the rows above.
function lastHome(to)
{
    let at = to;
    for (let hop = 0; hop < DOCS_MIGRATIONS.length; hop++)
    {
        const next = DOCS_MIGRATIONS.find(([from]) => from === at);
        if (!next) break;
        at = next[1];
    }
    return at;
}

// `rules` are the generated rules (selection.generatedRules), `instructions` the project's own AGENTS.md /
// CLAUDE.md files to name - see repointDocs.
function migrateDocsDomains({ projectRoot, docsPath, rules = [], instructions = [], log = () => {} })
{
    // resolve, not join: a docs root the user set may be absolute (migrateUsageReport and migratePlans read it so too)
    const base = path.resolve(projectRoot, String(docsPath || '').replace(/\/+$/, ''));
    const moved = [];
    for (const [from, to, label] of DOCS_MIGRATIONS)
    {
        // A copy at the LAST home already wins: the doc stays where it is, never one hop on per run.
        const last = lastHome(to);
        if (last !== to && fs.existsSync(path.join(base, from)) && fs.existsSync(path.join(base, last)))
        {
            log(`  docs migration (${label}): ${path.join(base, last)} already exists - ${path.join(base, from)} left in place, nothing overwritten`);
            continue;
        }
        if (migrateDocsFile(path.join(base, from), path.join(base, to), label, { log })) moved.push(to);
    }
    const switched = [];
    for (const [dir, doc] of DOCS_SWITCH_ON)
        if (switchOnDomain(path.join(base, dir), doc, { log })) switched.push(dir);
    const repointed = repointDocs({ projectRoot, docsPath, base, rules, instructions, log });
    const awareness = migrateAwareness({ projectRoot, base, docsPath, rules, log });
    return { moved, switched, repointed, awareness };
}

// THE AWARENESS LAYOUT (the user's ruling of 2026-10-16): the inventory, the run book and the sibling doc live in ONE
// domain, `awareness/`, which ONE generated rule, `alfred-awareness.md`, imports into every session. The file moves are
// DOCS_MIGRATIONS'; what a plain move leaves broken is here, once each doc sits at its new home and not its old one: the
// section ids its watch.json and its own text name take the new file key (`PROJECT-CAPABILITIES#build`,
// `RELATED-PROJECTS#acme`), the branch versions under `.branches/` (local versioning) move to the folder the engine now
// composes, and an old folder holding nothing else goes. Then the inventory: the capabilities rule's body becomes
// AGENTS-AWARENESS.md, since a capture never re-runs by itself. Last the rule, written by the capture's own script
// (`--rule`), so an update and a capture write the same bytes; it removes each rule it supersedes only when that rule
// still holds the capture's own text - one the user changed is named and kept.
const AWARENESS = 'awareness';
const AGENTS_DOC = 'AGENTS-AWARENESS.md';
const AWARENESS_SCRIPT = path.join(__dirname, '..', '..', 'stack', 'skills', 'capture-awareness', 'scripts', 'capabilities-inventory.js');
// Each awareness doc's earlier homes, as `[folder, file key]` - newest last, the order the moves above ran.
const AWARENESS_HOMES = {
    'PROJECT-AWARENESS': [['project-capabilities', 'PROJECT-CAPABILITIES'], ['project-awareness', 'PROJECT-AWARENESS']],
    'RELATED-PROJECTS-AWARENESS': [['related-projects', 'RELATED-PROJECTS']],
};
const INVENTORY_RULE = 'alfred-agent-awareness.md';

function migrateAwareness({ projectRoot, base, docsPath, rules = [], log = () => {} })
{
    const out = { respelled: [], overlays: [], agents: 'none', rule: 'none' };
    const rel = (file) => path.relative(projectRoot, file).split(path.sep).join('/');
    const dir = path.join(base, AWARENESS);
    // Only a doc at its new home, with no copy left at an old one, takes the new key: the move is then complete.
    const keys = Object.entries(AWARENESS_HOMES).filter(([key, homes]) => fs.existsSync(path.join(dir, `${key}.md`))
        && homes.every(([folder, old]) => !fs.existsSync(path.join(base, folder, `${old}.md`))));
    const escape = (o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A section ref is spelled `KEY#id`, `KEY.md#id` or with its folder in front.
    const respell = (text) => keys.reduce((acc, [key, homes]) => homes.reduce((s, [folder, old]) => s
        .replace(new RegExp(`\\b${escape(folder)}/${escape(old)}\\b(?!-)`, 'g'), `${AWARENESS}/${key}`)
        .replace(new RegExp(`\\b${escape(old)}(?=(?:\\.md)?#)`, 'g'), key), acc), text);
    for (const name of ['watch.json', ...keys.map(([key]) => `${key}.md`)])
    {
        const file = path.join(dir, name);
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const next = respell(text);
        if (next === text) continue;
        try { fs.writeFileSync(file, next); out.respelled.push(rel(file)); log(`  docs migration (awareness): ${rel(file)} - section ids re-spelled to the awareness/ file keys`); }
        catch (err) { log(`  !! docs migration (awareness): ${rel(file)} still names the old section ids (${err.code || err.message}) - re-run /capture-awareness`); }
    }
    out.overlays = moveAwarenessOverlays(base, keys, log);
    for (const folder of ['project-capabilities', 'project-awareness', 'related-projects']) removeOldDomain(path.join(base, folder), log);
    out.agents = inventoryToDoc({ projectRoot, dir, rules, log });
    out.rule = awarenessRule({ projectRoot, docsPath, log });
    return out;
}

// A branch's versions of a section sit at `.branches/<branch>/<domain>/<file key>/<id>.md`, with its base and conflict
// marker under `.base/` and `.conflict/` the same way (docs.js overlayParts): the folder pair moves whole, never over
// one already there.
function moveAwarenessOverlays(base, keys, log)
{
    const moved = [];
    const branches = path.join(base, '.branches');
    let names;
    try { names = fs.readdirSync(branches, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
    catch { return moved; }
    for (const name of names)
        for (const lane of ['', '.base', '.conflict'])
            for (const [key, homes] of keys)
                for (const [folder, old] of homes)
                {
                    const from = path.join(branches, name, lane, folder, old);
                    const to = path.join(branches, name, lane, AWARENESS, key);
                    try { if (!fs.statSync(from).isDirectory()) continue; }
                    catch { continue; }
                    const shown = ['.branches', name, lane].filter(Boolean).join('/');
                    if (fs.existsSync(to))
                    {
                        log(`  !! docs migration (awareness): ${shown}/${AWARENESS}/${key}/ already exists - ${shown}/${folder}/${old}/ is left in place; compare and remove it by hand`);
                        continue;
                    }
                    fs.mkdirSync(path.dirname(to), { recursive: true });
                    fs.renameSync(from, to);
                    removeIfEmpty(path.dirname(from), () => {}, '');
                    moved.push(`${shown}/${AWARENESS}/${key}`);
                    log(`  docs migration (awareness): ${shown}/${folder}/${old}/ -> ${shown}/${AWARENESS}/${key}/`);
                }
    return moved;
}

// A folder holding nothing but OS litter goes; anything else in it keeps it.
function removeIfEmpty(dir, log, label)
{
    let left;
    try { left = fs.readdirSync(dir); }
    catch { return false; }
    if (!left.every((n) => OS_LITTER.has(n))) return false;
    try
    {
        for (const n of left) fs.rmSync(path.join(dir, n), { force: true });
        fs.rmdirSync(dir);
    }
    catch { return false; }
    if (label) log(`  docs migration (${label}): ${path.basename(dir)}/ removed - nothing is left in it`);
    return true;
}

// An old domain folder goes once its doc moved: a `{}` watch.json is the stack's own switch-on (no capture writes an
// entry into the sibling domain), and an empty `references/` folder holds nothing. Anything else keeps it, and is named
// - a folder left silently looked like a live domain (the 2026-10-16 matrix: a 0-byte watch.json). Not named: a doc
// still there (its move row said why), and the run book's credentials file and nested .gitignore, which
// adoptCredentials and pruneNestedIgnores take later in the run.
const OLD_DOMAIN_OTHERS = new Set(['credentials.local.env', '.gitignore']);
const OLD_DOMAIN_DOCS = new Set(['PROJECT-CAPABILITIES.md', 'PROJECT-AWARENESS.md', 'RELATED-PROJECTS.md']);
function removeOldDomain(folder, log)
{
    const watch = path.join(folder, 'watch.json');
    try { if (/^\s*\{\s*\}\s*$/.test(fs.readFileSync(watch, 'utf8'))) fs.rmSync(watch); } catch { /* none, or not the stack's */ }
    try { fs.rmdirSync(path.join(folder, 'references')); } catch { /* none, or not empty */ }
    if (removeIfEmpty(folder, log, 'awareness')) return;
    let left;
    try { left = fs.readdirSync(folder).filter((n) => !OS_LITTER.has(n)).sort(); }
    catch { return; }
    if (left.some((n) => OLD_DOMAIN_DOCS.has(n))) return;
    const theirs = left.filter((n) => !OLD_DOMAIN_OTHERS.has(n));
    if (theirs.length) log(`  !! docs migration (awareness): ${path.basename(folder)}/ kept - it still holds ${theirs.join(', ')}, which the move does not take; compare with awareness/ and remove it by hand`);
}

// 'none' (no inventory rule), 'present' (the doc is there already), 'moved', 'yours' (named), 'failed'. The body moves
// whole, its frontmatter dropped - the doc is imported, so a frontmatter block would reach every session as text.
function inventoryToDoc({ projectRoot, dir, rules = [], log = () => {} })
{
    const file = rules.find((f) => path.basename(f) === INVENTORY_RULE);
    if (!file) return 'none';
    const doc = path.join(dir, AGENTS_DOC);
    if (fs.existsSync(doc)) return 'present';
    const shown = path.relative(projectRoot, file).split(path.sep).join('/');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return 'none'; }
    if (!/<!--\s*policy-rev:/.test(text))
    {
        log(`  !! ${shown} carries no policy stamp, so it is not the capture's own text and was not moved - re-run /capture-awareness`);
        return 'yours';
    }
    const body = text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n+/, '');
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(doc, body); }
    catch (err) { log(`  !! docs migration (awareness): ${shown} could not become ${AGENTS_DOC} (${err.code || err.message}) - re-run /capture-awareness`); return 'failed'; }
    log(`  docs migration (awareness): ${shown} -> ${path.relative(projectRoot, doc).split(path.sep).join('/')} (its body; the rule goes once alfred-awareness.md imports it)`);
    return 'moved';
}

// The rule, from the capture's own script: its verdict ('not written ...', 'created ...', 'unchanged ...'), or 'failed'.
function awarenessRule({ projectRoot, docsPath, log = () => {} })
{
    let script;
    try { script = require(AWARENESS_SCRIPT); }
    catch (err) { log(`  !! awareness: the capture's script could not be loaded (${err.code || err.message}) - re-run /capture-awareness to write .claude/rules/alfred-awareness.md`); return 'failed'; }
    const said = [];
    const docs = String(docsPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const result = script.writeAwarenessRule(projectRoot, { docs, print: false, say: (label, value) => said.push([label, value]) });
    for (const [label, value] of said)
    {
        // A quiet update says nothing: no doc, nothing to import, or the rule already current.
        if (label === 'IMPORTS' || (label === 'RULE' && /^(?:not written - (?:no awareness doc|nothing to import)|unchanged)/.test(value))) continue;
        const warn = /^(?:FAIL|kept)/.test(value) || (label === 'WATCH' && /not valid|not a JSON|could not/.test(value));
        log(`  ${warn ? '!! ' : ''}awareness: ${label.toLowerCase()} - ${value}`);
    }
    return result.code ? 'failed' : result.rule;
}

// A pointer rule names its doc by the literal path (a rule cannot resolve one at load), so a moved doc left the
// always-on rule sending the model to a file that is gone, and the model wrote the old path back. Each generated
// rule naming `<docs>/<old>` takes `<docs>/<new>` whenever the doc sits at its new home and not its old one - so a
// move an earlier run made heals too. The project's own instruction file is named, never rewritten (the split
// selection.respellRenamed keeps). Returns the rule files rewritten.
function repointDocs({ projectRoot, docsPath, base, rules = [], instructions = [], log = () => {} })
{
    const root = String(docsPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root) return [];
    const escape = (o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A pointer takes the doc's last home, however many rows it moved through.
    const done = DOCS_MIGRATIONS
        .map(([from, to]) => [from, lastHome(to)])
        .filter(([from, to]) => !fs.existsSync(path.join(base, from)) && fs.existsSync(path.join(base, to)))
        .map(([from, to]) => [`${root}/${from}`, `${root}/${to}`]);
    if (!done.length) return [];
    const pairs = Object.fromEntries(done);
    const re = new RegExp(`(?<![A-Za-z0-9_./-])(${done.map(([o]) => escape(o)).join('|')})(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'g');
    const rel = (file) => path.relative(projectRoot, file).split(path.sep).join('/');
    const out = [];
    for (const file of rules)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        let n = 0;
        const next = text.replace(re, (old) => { n += 1; return pairs[old]; });
        if (!n) continue;
        try { fs.writeFileSync(file, next); }
        catch (err) { log(`  !! docs migration: ${rel(file)} names ${n} moved doc path(s) and could not be re-pointed (${err.message}) - re-run its capture`); continue; }
        out.push(rel(file));
        log(`  docs migration: ${rel(file)} - ${n} path(s) re-pointed to the moved doc`);
    }
    for (const file of instructions)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const hits = [...new Set([...text.matchAll(re)].map((m) => m[1]))];
        for (const old of hits) log(`  !! ${rel(file)} is yours and names ${old}, which moved to ${pairs[old]} - re-point it by hand`);
    }
    return out;
}

// THE DOCS ROOT'S OWN .gitignore - only for a docs root OUTSIDE the data root, or under a data root whose
// .gitignore is the project's own: everywhere else the data root's one file carries these rules (data-root.js
// dataIgnoreText, the user's ruling of 2026-10-13) and an update removes this file when it is the stack's text.
// `local` keeps the whole root out of git - and git then answers check-ignore for the root, so the four-home rule
// reads it back as kept out. `git` commits the docs and keeps out only the two machine-local files under them
// (data-root.js DOCS_STATE_IGNORE): the run book's old credentials file and the awareness inventory. The hooks' state and
// ledgers left the docs root in 2.8.0 for the data root's state/ and statistics/ (docs.migrateLayout).
const { DOCS_STATE_IGNORE } = require('../../stack/mcp/data-root.js');
const DOCS_IGNORE = {
    local: '# alfred-code: the docs root is machine-local (ALFRED_CODE_DOCS_VERSIONING=local)\n*\n',
    git: '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git) but for the lines below\n'
        + `${DOCS_STATE_IGNORE.join('\n')}\n`,
};
// Texts an earlier release wrote, still the stack's own: an update replaces them instead of keeping them as
// the project's. 2.1.3's git text had no usage-report line; up to 2.1.6 the folder was `alfred-code-usage-report/`;
// up to 2.4.0 there was no credentials line; up to 2.5.0 no awareness line; up to 2.7.0 the six state lines and the usage
// audit's (the first row).
const DOCS_IGNORE_FORMER = [
    '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
        + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n'
        + '# the usage audit\'s raw transcript and ledger copies stay on this machine\n/usage-report/**/*.jsonl\n'
        + '# the run book\'s credentials file before 2026-10-13, which an older capture still writes\n/project-capabilities/credentials.local.env\n'
        + '# the awareness capture\'s inventory names this machine\'s plugins\n/awareness/AGENTS-AWARENESS.md\n',
    '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
        + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n'
        + '# the usage audit\'s raw transcript and ledger copies stay on this machine\n/usage-report/**/*.jsonl\n'
        + '# the run book\'s credentials file before 2026-10-13, which an older capture still writes\n/project-capabilities/credentials.local.env\n',
    '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
        + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n'
        + '# the usage audit\'s raw transcript and ledger copies stay on this machine\n/usage-report/**/*.jsonl\n',
    '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
        + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n',
    '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
        + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n'
        + '# the usage audit\'s raw transcript and ledger copies stay on this machine\n/alfred-code-usage-report/**/*.jsonl\n',
];

// THE USAGE AUDIT'S FOLDER took a plain name in 2.1.7 (`alfred-code-usage-report/` -> `usage-report/`, the user's
// ruling of 2026-10-06) and left the docs root in 2.8.0 for the data root's `statistics/usage-report/` (machine-local,
// the user's ruling of 2026-10-20) - so the 2.1.6 folder goes straight there; the 2.7.0 one is migrateLayout's. Run AFTER
// the .gitignore step (alfred-code.js ignoreStep), so the data root's file is current. An audit copies whole session
// transcripts (code, file contents, possibly secrets) beside its reports: a folder holding a raw `.jsonl` moves only where
// git keeps it out at the new path (no repository, or the data root's own file), else it stays and one `!!` line names
// the fix. A session folder the new one already holds is never overwritten - it stays at the old name and is named.
const USAGE_REPORT_OLD = 'alfred-code-usage-report';
const USAGE_REPORT_HOME = ['statistics', 'usage-report'];
const rawHeld = (from, to) => `holds raw session copies and git would not ignore them at ${to}/ - left in place; keep ${to}/ out of git `
    + `(the data root's .gitignore), then re-run /alfred-code:update`;

function holdsRaw(dir)
{
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        if (e.isDirectory() ? holdsRaw(path.join(dir, e.name)) : e.name.endsWith('.jsonl')) return true;
    return false;
}

function rawStaysOut(base, folder)
{
    const git = (args) => rt.execCommand('git', ['-C', base, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try { git(['rev-parse', '--is-inside-work-tree']); }
    catch { return true; }
    try { git(['check-ignore', '-q', '--', `${folder}/session/x.jsonl`]); return true; }
    catch { return false; }
}

// A path git tracks anything under (a `git`-mode root commits the reports) moves with `git mv`, so git sees a
// staged rename and keeps its history; anything else is a plain rename.
function moveKeepingHistory(base, src, dst)
{
    const rel = (p) => path.relative(base, p).split(path.sep).join('/');
    const git = (args) => rt.execCommand('git', ['-C', base, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    let tracked = false;
    try { tracked = String(git(['ls-files', '--', rel(src)])).trim() !== ''; }
    catch { tracked = false; }
    if (tracked)
    {
        try { git(['mv', '--', rel(src), rel(dst)]); return; }
        catch { /* git refused (a conflicted index): the plain rename below still moves it */ }
    }
    fs.renameSync(src, dst);
}

// One folder under the docs root renamed: absent at the new name, the whole folder moves; present there, each entry
// the new folder lacks moves and a clash stays at the old name, named - never overwritten. 'none' | 'moved' | 'merged'.
function moveDocsFolder(base, oldName, newName, label, log)
{
    const from = path.join(base, ...oldName.split('/'));
    const to = path.join(base, ...newName.split('/'));
    try { if (!fs.statSync(from).isDirectory()) return 'none'; }
    catch { return 'none'; }
    if (!fs.existsSync(to))
    {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        moveKeepingHistory(base, from, to);
        log(`  docs migration (${label}): ${oldName}/ -> ${newName}/`);
        return 'moved';
    }
    const kept = [];
    for (const name of fs.readdirSync(from))
    {
        if (fs.existsSync(path.join(to, name))) kept.push(name);
        else moveKeepingHistory(base, path.join(from, name), path.join(to, name));
    }
    if (kept.length)
        log(`  !! docs migration (${label}): ${newName}/ already holds ${kept.join(', ')} - the ${oldName}/ copies are left in place, `
            + 'nothing overwritten; compare and remove them by hand');
    else
    {
        fs.rmdirSync(from);
        log(`  docs migration (${label}): ${oldName}/ merged into ${newName}/`);
    }
    return 'merged';
}

// 'none' | 'moved' | 'merged' | 'held' (raw copies git would not keep out at the new name).
function migrateUsageReport({ projectRoot, docsPath, dataPath = '.alfred', log = () => {} })
{
    const rel = (p) => path.relative(projectRoot, p).split(path.sep).join('/');
    const from = path.resolve(projectRoot, String(docsPath || ''), USAGE_REPORT_OLD);
    const to = path.resolve(projectRoot, String(dataPath || '.alfred'), ...USAGE_REPORT_HOME);
    try { if (!fs.statSync(from).isDirectory()) return 'none'; }
    catch { return 'none'; }
    if (holdsRaw(from) && !rawStaysOut(projectRoot, rel(to)))
    {
        log(`  !! docs migration (usage report): ${rel(from)}/ ${rawHeld(rel(from), rel(to))}`);
        return 'held';
    }
    return moveDocsFolder(projectRoot, rel(from), rel(to), 'usage report', log);
}

// THE `superpowers/` FOLDER goes in 2.2.2: the name was the superpowers plugin's, a pick the stack dropped in 2.0.0,
// and read as that plugin's folder (the user's ruling of 2026-10-06). EVERY folder in it moves up to the docs root
// (plans/, specs/ and whatever else a run wrote there), merged the moveDocsFolder way, and a loose file moves when the
// root lacks it; a clash stays at the old name, named, never overwritten. `superpowers/` goes once only OS litter is
// left. Returns { <entry>: 'moved' | 'merged' | 'kept' }, empty when there is no such folder.
const OS_LITTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
function migratePlans({ projectRoot, docsPath, rules = [], instructions = [], log = () => {} })
{
    const base = path.resolve(projectRoot, String(docsPath || ''));
    const results = movePlans(base, log);
    repointSuperpowers({ projectRoot, docsPath, base, rules, instructions, log });
    return results;
}
function movePlans(base, log)
{
    const old = path.join(base, 'superpowers');
    let entries;
    try { entries = fs.readdirSync(old, { withFileTypes: true }); }
    catch { return {}; }
    const results = {};
    for (const e of entries)
    {
        if (OS_LITTER.has(e.name)) continue;
        if (e.isDirectory()) { results[e.name] = moveDocsFolder(base, `superpowers/${e.name}`, e.name, 'superpowers', log); continue; }
        if (fs.existsSync(path.join(base, e.name)))
        {
            log(`  !! docs migration (superpowers): ${e.name} is already at the docs root - superpowers/${e.name} is left in place, nothing overwritten; compare and remove it by hand`);
            results[e.name] = 'kept';
            continue;
        }
        moveKeepingHistory(base, path.join(old, e.name), path.join(base, e.name));
        log(`  docs migration (superpowers): superpowers/${e.name} -> ${e.name}`);
        results[e.name] = 'moved';
    }
    try
    {
        const left = fs.readdirSync(old);
        if (left.every((n) => OS_LITTER.has(n)))
        {
            for (const n of left) fs.rmSync(path.join(old, n), { force: true });
            fs.rmdirSync(old);
            log('  docs migration (superpowers): superpowers/ removed - its folders now sit at the docs root');
        }
    }
    catch { /* a clash keeps it */ }
    return results;
}

// The superpowers/ move's re-point, the repointDocs way (audit 2026-10-10 C23: a project's AGENTS.md still named
// `.alfred/docs/superpowers/` after the 2.2.2 move, and only the model's own grep found it). A mention of
// `<docs>/superpowers/<entry>` is stale once the entry sits at the docs root and not under superpowers/ - so a move an
// earlier run made heals too. A generated rule is rewritten; the project's own instruction file is named, never
// rewritten. Returns the rule files rewritten.
function repointSuperpowers({ projectRoot, docsPath, base, rules = [], instructions = [], log = () => {} })
{
    const root = String(docsPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root) return [];
    const escape = (o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_./-])${escape(root)}/superpowers/([A-Za-z0-9][A-Za-z0-9._-]*)`, 'g');
    const stale = (entry) => !fs.existsSync(path.join(base, 'superpowers', entry)) && fs.existsSync(path.join(base, entry));
    const rel = (file) => path.relative(projectRoot, file).split(path.sep).join('/');
    const out = [];
    for (const file of rules)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        let n = 0;
        const next = text.replace(re, (whole, entry) => (stale(entry) ? (n += 1, `${root}/${entry}`) : whole));
        if (!n) continue;
        try { fs.writeFileSync(file, next); }
        catch (err) { log(`  !! docs migration (superpowers): ${rel(file)} names ${n} moved path(s) and could not be re-pointed (${err.message}) - re-run its capture`); continue; }
        out.push(rel(file));
        log(`  docs migration (superpowers): ${rel(file)} - ${n} path(s) re-pointed to the docs root`);
    }
    for (const file of instructions)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const hits = [...new Set([...text.matchAll(re)].filter((m) => stale(m[1])).map((m) => m[1]))];
        for (const entry of hits) log(`  !! ${rel(file)} is yours and names ${root}/superpowers/${entry}, which moved to ${root}/${entry} - re-point it by hand`);
    }
    return out;
}

// THE 2.8.0 LAYOUT (the user's rulings of 2026-10-20): the hooks' state and ledgers leave the docs root for the data
// root's state/ and statistics/, the working papers gather under work/ and the quality loops' output under quality/ -
// the move map is layout.js LAYOUT_MOVES, which the hooks read too. Run after migratePlans (superpowers/plans/ reaches
// plans/ first) and after the .gitignore step (a nested history/.gitignore of the stack's is gone before history/ moves).
// Built the moveDocsRoot way, file by file: a file git tracks through `git mv`, any other by rename; a file its new home
// already holds stays at the old path, named, never overwritten; any failure puts back every file this call moved and
// every folder it made, then rethrows naming the file; a folder the moves emptied is removed. `.branches/` goes only
// while empty - a doc version is never deleted (the session-start line asks the user to re-apply and prune it). A second
// run moves nothing and says `layout: current`. Returns { moved, kept, removed }, project-relative.
const LAYOUT = require('../../stack/hooks/layout.js');
function migrateLayout({ projectRoot, docsPath, dataPath, log = () => {} })
{
    const docsBase = path.resolve(projectRoot, String(docsPath || ''));
    const dataBase = path.resolve(projectRoot, String(dataPath || '.alfred'));
    const rel = (p) => path.relative(projectRoot, p).split(path.sep).join('/');
    const out = { moved: [], kept: [], removed: [] };
    let tracked = new Set();
    try { tracked = new Set(String(rt.execCommand('git', ['-C', projectRoot, 'ls-files', '-z', '--', rel(docsBase) || '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).split('\0').filter(Boolean)); }
    catch { tracked = new Set(); }
    const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
    const filesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : OS_LITTER.has(e.name) ? [] : [path.join(dir, e.name)]));

    // Every move as a group (one log line): its source, its destination folder and the file pairs.
    const groups = [];
    const group = (from, to) => { let g = groups.find((x) => x.from === from && x.to === to); if (!g) groups.push(g = { from, to, pairs: [] }); return g; };
    const sources = [];
    for (const m of LAYOUT.LAYOUT_MOVES)
    {
        if (m.removeIfEmpty) continue;
        const from = path.join(docsBase, ...m.from.split('/'));
        if (m.file)
        {
            if (fs.existsSync(from) && !isDir(from)) group(from, path.join(dataBase, ...m.to.split('/'))).pairs.push([from, path.join(dataBase, ...m.to.split('/'))]);
            continue;
        }
        if (!isDir(from)) continue;
        sources.push(from);
        if (m.split === 'flow')
        {
            for (const file of filesUnder(from))
            {
                const kind = LAYOUT.flowKind(path.relative(from, file).split(path.sep)[0]);
                const to = path.join(dataBase, 'state', kind);
                group(from, to).pairs.push([file, path.join(to, path.relative(from, file))]);
            }
            continue;
        }
        const to = path.join(m.base === 'data' ? dataBase : docsBase, ...m.to.split('/'));
        const g = group(from, to);
        // the usage audit's raw transcript copies move only where git keeps them out (migrateUsageReport's rule)
        g.raw = m.from === 'usage-report';
        for (const file of filesUnder(from)) g.pairs.push([file, path.join(to, path.relative(from, file))]);
    }

    const done = [];
    const made = [];
    const ensureDir = (dir) =>
    {
        const missing = [];
        for (let at = dir; !fs.existsSync(at) && path.dirname(at) !== at; at = path.dirname(at)) missing.unshift(at);
        if (missing.length) { fs.mkdirSync(dir, { recursive: true }); made.push(...missing); }
    };
    const gitMv = (a, b) => rt.execCommand('git', ['-C', projectRoot, 'mv', '--', rel(a), rel(b)], { stdio: 'ignore' });
    const lines = [];
    try
    {
        for (const g of groups)
        {
            if (g.raw && holdsRaw(g.from) && !rawStaysOut(projectRoot, rel(g.to)))
            {
                out.kept.push(rel(g.from));
                lines.push(`  !! layout: ${rel(g.from)} ${rawHeld(rel(g.from), rel(g.to))}`);
                continue;
            }
            let n = 0;
            for (const [from, to] of g.pairs)
            {
                if (fs.existsSync(to))
                {
                    out.kept.push(rel(from));
                    lines.push(`  layout: kept ${rel(from)} - ${rel(to)} already holds it`);
                    continue;
                }
                try
                {
                    ensureDir(path.dirname(to));
                    let how = 'fs';
                    if (tracked.has(rel(from))) { try { gitMv(from, to); how = 'git'; } catch { /* git refused (a conflicted index): the rename below */ } }
                    if (how === 'fs') fs.renameSync(from, to);
                    done.push([how, from, to]);
                    n += 1;
                }
                catch (err) { throw new Error(`${rel(from)}: ${err.message}`); }
            }
            if (n)
            {
                out.moved.push(`${rel(g.from)} -> ${rel(g.to)}`);
                lines.push(`  layout: ${rel(g.from)} -> ${rel(g.to)} (${n} file${n === 1 ? '' : 's'})`);
            }
        }
    }
    catch (err)
    {
        for (const [how, from, to] of done.reverse())
        {
            try
            {
                fs.mkdirSync(path.dirname(from), { recursive: true });
                if (how === 'git') gitMv(to, from);
                else fs.renameSync(to, from);
            }
            catch { /* the error below names the move; a file that cannot go back stays where it is */ }
        }
        for (const dir of made.reverse()) { try { fs.rmdirSync(dir); } catch { /* not empty: something else is there */ } }
        throw err;
    }
    // Only folders the moves emptied (OS litter aside): a folder still holding a kept file stays.
    const prune = (dir) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) if (e.isDirectory()) prune(path.join(dir, e.name));
        try
        {
            const left = fs.readdirSync(dir);
            if (left.every((name) => OS_LITTER.has(name))) { for (const name of left) fs.rmSync(path.join(dir, name), { force: true }); fs.rmdirSync(dir); }
        }
        catch { /* left in place */ }
    };
    for (const dir of sources) prune(dir);
    const branches = path.join(docsBase, '.branches');
    if (isDir(branches))
    {
        if (fs.readdirSync(branches).every((name) => OS_LITTER.has(name)))
        {
            prune(branches);
            out.removed.push(rel(branches));
            lines.push('  layout: removed empty .branches/');
        }
        else
        {
            out.kept.push(rel(branches));
            lines.push('  layout: kept .branches/ - it holds doc versions, prune them first');
        }
    }
    for (const line of lines.length ? lines : ['  layout: current']) log(line);
    return out;
}

// 'written' | 'current' | 'replaced' | 'kept' (the project's own file) | 'outside' (the root is not in
// the project) | 'skipped' (no versioning to state, or a root under `.claude/`) | 'tracked' (local, over a
// root git already tracks docs in) | 'covered' (the data root's file carries the rules, no file here) | 'removed'
// (the stack's file here, removed because the data root's carries the rules). A file that is exactly the stack's
// text - for the OTHER mode, or one an earlier release wrote - is the stack's and follows the run; any other text is
// the project's. `covered`: the data root's own .gitignore (the stack's) holds the docs rules.
function ensureDocsIgnore({ projectRoot, docsPath, mode, covered = false, log = () => {} })
{
    if (!Object.hasOwn(DOCS_IGNORE, mode)) return 'skipped';
    const root = path.resolve(projectRoot);
    const base = path.resolve(root, String(docsPath || ''));
    const rel = path.relative(root, base);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'outside';
    // A root inside `.claude/` - the old default, kept or waiting on its move - never had a file of its
    // own: the project's `.claude/*` line is what governs it, and a move offered must find nothing new there.
    if (rel.split(path.sep)[0] === '.claude') return 'skipped';
    const file = path.join(base, '.gitignore');
    const want = DOCS_IGNORE[mode];
    let have = null;
    // CRLF-normalised: a checkout with autocrlf turns the stack's own file into different bytes.
    try { have = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { have = null; }
    const shown = rel.split(path.sep).join('/');
    const stacks = have !== null && (Object.values(DOCS_IGNORE).includes(have) || DOCS_IGNORE_FORMER.includes(have));
    if (covered)
    {
        if (have === null) return 'covered';
        if (!stacks)
        {
            log(`  docs root: ${shown}/.gitignore is the project's own - left as it is (the data root's .gitignore carries the stack's rules)`);
            return 'kept';
        }
        fs.rmSync(file);
        log(`  docs root: ${shown}/.gitignore removed - the data root's .gitignore carries its rules now (versioning ${mode})`);
        return 'removed';
    }
    if (have === want) return 'current';
    if (have !== null && !stacks)
    {
        log(`  docs root: ${shown}/.gitignore is the project's own - left as it is (versioning ${mode})`);
        return 'kept';
    }
    // `*` over a root git already tracks docs in would hide every NEW doc there while the old ones stay
    // committed - the versioning and the repo disagree, which `docs.js status` reports; never widen it here.
    if (mode === 'local')
    {
        let tracked = false;
        try { tracked = String(rt.execCommand('git', ['ls-files', '--', shown], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim() !== ''; }
        catch { tracked = false; }
        if (tracked)
        {
            log(`  docs root: git tracks docs under ${shown} - no .gitignore of * written over them (versioning local; docs.js status reports the disagreement)`);
            return 'tracked';
        }
    }
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(file, want);
    log(`  docs root: ${shown}/.gitignore ${have === null ? 'written' : 'rewritten'} - ${mode === 'local' ? 'the whole root stays out of git' : 'the docs are committed, two machine-local files under them are not'} (versioning ${mode})`);
    return have === null ? 'written' : 'replaced';
}

// ONE DOCS ROOT - <data root>/docs (2.8.0, the user's ruling of 2026-10-20, D7). ALFRED_CODE_DOCS_PATH is retired: no run
// writes it, and a run that finds it moves the stack's own docs from the root it names to <data root>/docs and then takes
// it out of the settings (alfred-code.js docsRootStep, settings.js applyEnv 3b). Only the stack's entries move - a hand-set
// root may be a folder the project uses too (`docs/`), so its own files stay and are named. A clash (a file at both
// places) moves nothing and keeps the key, so the hooks keep reading where the docs are until one side is cleared. With
// no key the root to drain is the earlier data root's docs (a data-root change), or on a stamped install the old default
// LEGACY_DOCS_ROOT, which a release before 2.0.0 read with no key at all. Never a part of the data-move offer: the docs
// move unasked, the servers' data stays asked.
const LEGACY_DOCS_ROOT = '.claude/docs';
const DOCS_KEY = 'ALFRED_CODE_DOCS_PATH';
const normRoot = (v) => String(v || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

// Every file under `dir`, relative, forward slashes - dot folders (`.branches/`) and ignored files included.
function filesUnder(dir)
{
    const out = [];
    const walk = (abs, rel) =>
    {
        let entries;
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(abs, e.name), r);
            else out.push(r);
        }
    };
    walk(dir, '');
    return out.sort();
}

// The top-level names a docs root holds that are the stack's: today's domains and work folders, every older home a
// migration below still moves on (DOCS_MIGRATIONS, the usage report, layout.js LAYOUT_MOVES), the first-look map, and
// any folder holding a watch.json (a domain by definition). Everything else under the root is the project's.
const STACK_DOCS = new Set([
    'architecture', 'code-style', 'preferences', 'decisions', 'awareness', 'work', 'quality', 'ORIENTATION.md', '.branches',
    ...DOCS_MIGRATIONS.map(([from]) => from.split('/')[0]), USAGE_REPORT_OLD, ...LAYOUT.LAYOUT_MOVES.map((m) => m.from),
]);
function stackEntry(base, e)
{
    if (STACK_DOCS.has(e.name)) return true;
    return e.isDirectory() && fs.existsSync(path.join(base, e.name, 'watch.json'));
}

// The settings each docs-root reader sees, read apart: settings.json (`shared`) and settings.local.json (`personal`),
// and the name of the one that does not parse (`broken`) - whose root it names cannot be told, and the settings write
// refuses it anyway.
function docsMoveViews({ claudeDir })
{
    const read = (name) =>
    {
        const file = path.join(claudeDir, name);
        if (!fs.existsSync(file)) return { env: {} };
        try
        {
            const v = parseJson(fs.readFileSync(file, 'utf8'));
            if (!v || typeof v !== 'object' || Array.isArray(v)) return { broken: true };
            return { env: v.env && typeof v.env === 'object' && !Array.isArray(v.env) ? v.env : {} };
        }
        catch { return { broken: true }; }
    };
    const shared = read('settings.json');
    const personal = read('settings.local.json');
    return { shared: shared.env || {}, personal: personal.env || {}, broken: shared.broken ? 'settings.json' : personal.broken ? 'settings.local.json' : null };
}

// What this run does with the docs root. `state`: 'none' (no key, nothing to drain), 'drop' (keys go, nothing to move),
// 'move' (the stack's files move from `from`, then the keys go), 'clash' (a file at both places - nothing moves, the keys
// stay) or 'blocked' (a key sits in settings.json, which a local-scope run does not write - nothing moves). `keys`: each
// file's value; `from`: the root in effect (settings.local.json over settings.json, Claude Code's merge); `left`: the
// project's own top-level entries there; `shadowed`: a settings.json root settings.local.json hid, named, never moved.
function docsMovePlan({ projectRoot, shared = {}, personal = {}, broken = null, scope = 'project', stamped = false, to, prior = null })
{
    const target = normRoot(to);
    // An empty value is still a key to drop, but names no root: every reader takes the default for it.
    const keys = [['settings.json', shared], ['settings.local.json', personal]]
        .filter(([, env]) => env && typeof env[DOCS_KEY] === 'string')
        .map(([file, env]) => ({ file, value: normRoot(env[DOCS_KEY]) }));
    const base = { to: target, keys, from: null, tracked: [], untracked: [], conflicts: [], left: [], shadowed: [], ignored: false };
    if (broken) return { ...base, state: 'none', why: `${broken} cannot be read` };
    const stuck = scope === 'local' ? keys.find((k) => k.file === 'settings.json' && k.value && k.value !== target) : null;
    if (stuck) return { ...base, from: stuck.value, state: 'blocked', why: `settings.json sets ${DOCS_KEY} '${stuck.value}', which a local-scope run does not write` };
    const effective = keys.length ? keys[keys.length - 1].value : '';
    const from = effective || (stamped && prior ? `${normRoot(prior)}/docs` : stamped ? LEGACY_DOCS_ROOT : null);
    const shadowed = keys.length > 1 && keys[0].value && keys[0].value !== from && keys[0].value !== target ? [keys[0].value] : [];
    const settled = { ...base, from, shadowed, state: keys.length ? 'drop' : 'none' };
    if (!from || from === target) return { ...settled, why: `the docs root is ${target}` };
    const abs = path.join(projectRoot, ...from.split('/'));
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { entries = []; }
    const ours = entries.filter((e) => stackEntry(abs, e));
    const stackIgnore = (name) => name === '.gitignore' && (() => { try { const t = fs.readFileSync(path.join(abs, name), 'utf8'); return Object.values(DOCS_IGNORE).includes(t) || DOCS_IGNORE_FORMER.includes(t); } catch { return false; } })();
    const left = entries.filter((e) => !ours.includes(e) && !OS_LITTER.has(e.name) && !stackIgnore(e.name)).map((e) => e.name).sort();
    const files = ours.flatMap((e) => (e.isDirectory() ? filesUnder(path.join(abs, e.name)).map((f) => `${e.name}/${f}`) : [e.name])).sort();
    if (!files.length) return { ...settled, left, why: `nothing of the stack's under ${from}` };
    let tracked = [];
    try
    {
        const listed = rt.execCommand('git', ['ls-files', '-z', '--', from], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const prefix = `${from}/`;
        tracked = String(listed).split('\0').filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
    }
    catch { tracked = []; }   // no repository: every file is a plain move
    const onDisk = new Set(files);
    tracked = tracked.filter((f) => onDisk.has(f)).sort();
    const isTracked = new Set(tracked);
    // What git saw of the old root: nothing, when it ignored the root and tracks none of it - which a move must keep,
    // or every plan and task card there shows up untracked under the new root.
    let ignored = false;
    if (!tracked.length)
        try { rt.execCommand('git', ['check-ignore', '-q', '--', `${from}/`], { cwd: projectRoot, stdio: 'ignore' }); ignored = true; }
        catch { ignored = false; }
    const dest = path.join(projectRoot, ...target.split('/'));
    const conflicts = files.filter((f) => fs.existsSync(path.join(dest, ...f.split('/'))));
    return {
        ...settled, left, ignored, tracked, untracked: files.filter((f) => !isTracked.has(f)), conflicts,
        state: conflicts.length ? 'clash' : 'move', why: conflicts.length ? `${conflicts.length} file(s) already at ${target}` : `the stack's docs under ${from}`,
    };
}

// One step: tracked files through `git mv` (the index records a rename, so history follows), every other
// file by rename, then the emptied folders of the old root. Any failure puts every file moved so far back
// - a half-moved root would leave the hooks reading one root while half the docs sit in the other.
function moveDocsRoot({ projectRoot, plan })
{
    const from = path.join(projectRoot, ...plan.from.split('/'));
    const to = path.join(projectRoot, ...normRoot(plan.to).split('/'));
    const done = [];
    const gitMv = (a, b) => rt.execCommand('git', ['mv', '--', a, b], { cwd: projectRoot, stdio: 'ignore' });
    const rel = (root, f) => `${normRoot(root)}/${f}`;
    try
    {
        for (const f of plan.tracked)
        {
            fs.mkdirSync(path.dirname(path.join(to, ...f.split('/'))), { recursive: true });
            try { gitMv(rel(plan.from, f), rel(plan.to, f)); }
            catch (err) { throw new Error(`git mv ${rel(plan.from, f)}: ${String(err.stderr || err.message).trim()}`); }
            done.push(['git', f]);
        }
        for (const f of plan.untracked)
        {
            const target = path.join(to, ...f.split('/'));
            try
            {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                if (fs.existsSync(target)) throw new Error('a file is already there');
                fs.renameSync(path.join(from, ...f.split('/')), target);
            }
            catch (err) { throw new Error(`${rel(plan.from, f)}: ${err.message}`); }
            done.push(['fs', f]);
        }
    }
    catch (err)
    {
        for (const [kind, f] of done.reverse())
        {
            try
            {
                fs.mkdirSync(path.dirname(path.join(from, ...f.split('/'))), { recursive: true });
                if (kind === 'git') gitMv(rel(plan.to, f), rel(plan.from, f));
                else fs.renameSync(path.join(to, ...f.split('/')), path.join(from, ...f.split('/')));
            }
            catch { /* the error below names the move; a file that cannot go back stays where it is */ }
        }
        return { ok: false, moved: 0, gitMoved: 0, error: err.message };
    }
    // Only folders the move emptied: a folder still holding anything is not the old root's to remove.
    const prune = (dir) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) if (e.isDirectory()) prune(path.join(dir, e.name));
        try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* left in place */ }
    };
    prune(from);
    return { ok: true, moved: done.length, gitMoved: done.filter(([k]) => k === 'git').length };
}

// THE DATA ROOT'S OWN .gitignore - the one the stack writes; its text and why live in stack/mcp/data-root.js
// (dataIgnoreText), the one home the launchers read too. The installer keeps it CURRENT: absent or the stack's own
// older text is written, any other text is the project's own and is left alone. `mode` is the docs versioning; a
// `local` root over docs git already tracks keeps them visible (a `*` would hide every NEW doc while the old ones
// stay committed - `docs.js status` reports the disagreement), the hooks' state still kept out.
const { DATA_IGNORE_HEAD, dataIgnoreText, docsInsideRoot, engineOfServer } = require('../../stack/mcp/data-root.js');

// 'written' | 'replaced' | 'current' | 'kept' (the project's own file).
function ensureDataIgnore({ projectRoot, root, docsPath, mode, log = () => {} })
{
    const base = path.join(projectRoot, ...normRoot(root).split('/'));
    const file = path.join(base, '.gitignore');
    let shape = mode;
    if (mode === 'local' && docsInsideRoot({ root, docsPath }))
    {
        const shown = String(docsPath).replace(/\\/g, '/').replace(/\/+$/, '');
        let tracked = false;
        try { tracked = String(rt.execCommand('git', ['ls-files', '--', shown], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim() !== ''; }
        catch { tracked = false; }
        if (tracked)
        {
            shape = 'git';
            log(`  data root: git tracks docs under ${shown} - they stay visible to git (versioning local; docs.js status reports the disagreement)`);
        }
    }
    const want = dataIgnoreText({ root, docsPath, mode: shape });
    let have = null;
    try { have = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { have = null; }
    if (have === want) return 'current';
    if (have !== null && !have.startsWith(DATA_IGNORE_HEAD))
    {
        log(`  data root: ${normRoot(root)}/.gitignore is the project's own - left as it is`);
        return 'kept';
    }
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(file, want);
    log(`  data root: ${normRoot(root)}/.gitignore ${have === null ? 'written' : 'rewritten'} - the servers' data stays out of git${want.split('\n').some((l) => l.startsWith('!/') && l !== '!/.gitignore') ? ', the docs under it do not' : ''}`);
    return have === null ? 'written' : 'replaced';
}

// A root the data just left: its emptied folders go, and the root itself when all it still holds is the
// stack's own .gitignore. A folder holding anything at all stays.
function pruneDataRoot({ projectRoot, root, log = () => {} })
{
    const base = path.join(projectRoot, ...normRoot(root).split('/'));
    const prune = (dir) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) if (e.isDirectory()) prune(path.join(dir, e.name));
        try { if (dir !== base && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* left in place */ }
    };
    prune(base);
    let names;
    try { names = fs.readdirSync(base); } catch { return false; }
    if (names.some((n) => n !== '.gitignore')) return false;
    let text = '';
    try { text = names.length ? fs.readFileSync(path.join(base, '.gitignore'), 'utf8') : ''; } catch { return false; }
    if (names.length && !text.startsWith(DATA_IGNORE_HEAD)) return false;
    try { fs.rmSync(base, { recursive: true }); } catch { return false; }
    log(`  data root: ${normRoot(root)}/ removed - everything in it moved`);
    return true;
}

// THE NESTED .gitignore FILES an earlier release wrote, once one file carries their rules (the user's ruling of
// 2026-10-13: one .gitignore, the data root's). Each goes only while it holds exactly the stack's text and a stack
// file covers it: `docsCovered` - the docs rules are in the data root's file or the docs root's own stack file;
// `dataCovered` - the data root's file is the stack's. A file holding anything else is the project's and stays.
// serena's own folder file is serena's: it writes one whenever the folder has none (serena/project.py), so it is
// never touched. Returns the removed paths, project-relative.
const NESTED_IGNORES = [
    { at: 'docs', rel: 'history/.gitignore', text: '*\n' },
    { at: 'docs', rel: 'project-capabilities/.gitignore', text: 'credentials.local.env\n' },
    { at: 'data', rel: '.alfred-memory/.gitignore', text: '*\n' },
];
function pruneNestedIgnores({ projectRoot, root, docsPath, docsCovered = false, dataCovered = false, log = () => {} })
{
    const out = [];
    for (const row of NESTED_IGNORES)
    {
        if (!(row.at === 'docs' ? docsCovered : dataCovered)) continue;
        const base = row.at === 'docs' ? path.resolve(projectRoot, String(docsPath || '')) : path.join(projectRoot, ...normRoot(root).split('/'));
        const file = path.join(base, ...row.rel.split('/'));
        let have;
        try { have = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
        if (have !== row.text) continue;
        try { fs.rmSync(file); }
        catch (err) { log(`  !! ${path.relative(projectRoot, file).split(path.sep).join('/')} could not be removed (${err.code || err.message}) - the data root's .gitignore covers it, so it can go by hand`); continue; }
        const shown = path.relative(projectRoot, file).split(path.sep).join('/');
        out.push(shown);
        log(`  gitignore: ${shown} removed - the ${row.at === 'docs' && !dataCovered ? "docs root's" : "data root's"} .gitignore covers it`);
    }
    return out;
}

// THE WHOLE DATA MOVE AN UPDATE OFFERS - every server class whose data sits somewhere other than its place under the root
// (the 2.0.0 place, or an earlier root the stamp names), minus the moves already recorded as pending. The docs are no part
// of it since 2.8.0: they move unasked (docsMovePlan). { state: 'offer' | 'none', why, rows, root }.
function dataOffer({ projectRoot, stamped, stampText = '', root, engines = [], memoryProject = false })
{
    const dr = require('../../stack/mcp/data-root.js');
    const none = (why) => ({ state: 'none', why, rows: [], root });
    if (!stamped) return none('no install record - a fresh install lays the data under the root');
    if (/^data-move: *kept *$/m.test(stampText)) return none('the data move was answered keep');
    const priorLine = (/^data-root: *(\S+) *$/m.exec(stampText) || [])[1];
    const prior = priorLine && dr.checkDataPath(priorLine).ok && priorLine !== root ? priorLine : null;
    const pending = dr.readPending(stampText);
    // An engine's profile leaving the root's own shared folder is no offer: the installer moves it unasked (isRelayout).
    const rows = dr.dataMovePlan({ projectRoot, root, prior, engines, memory: memoryProject })
        .filter((r) => !dr.isRelayout(r, root) && !pending.some((p) => p.cls === r.cls && p.from === r.from && p.to === r.to));
    if (!rows.length) return none('nothing to move');
    return { state: 'offer', why: 'data outside the root', rows, root };
}

// The preflight's line: `data-move: offer <root>\tfrom=<places>\tserena=yes|no browser=<engines|none> memory=yes|no
// [\tconflicts=<n>]`, or `data-move: none (<why>)`.
function dataOfferLine(offer)
{
    if (offer.state !== 'offer') return `data-move: none (${offer.why})`;
    const has = (cls) => (offer.rows.some((r) => r.cls === cls) ? 'yes' : 'no');
    const engines = offer.rows.map((r) => engineOfServer(r.cls)).filter(Boolean);
    const conflicts = offer.rows.filter((r) => r.conflict).length;
    return `data-move: offer ${offer.root}\tfrom=${offer.rows.map((r) => r.from).join(',')}\tserena=${has('serena')} browser=${engines.join(',') || 'none'} memory=${has('memory')}`
        + (conflicts ? `\tconflicts=${conflicts}` : '');
}

module.exports = {
    domains, docsVersioningSeed, migrateDocsFile, switchOnDomain, migrateDocsDomains, migrateAwareness, inventoryToDoc, ensureDocsIgnore, migrateUsageReport, migratePlans, docsMovePlan, docsMoveViews, moveDocsRoot,
    ensureDataIgnore, dataIgnoreText, pruneDataRoot, pruneNestedIgnores, dataOffer, dataOfferLine, migrateLayout,
    DOCS_IGNORE, DOCS_IGNORE_FORMER, DOCS_MIGRATIONS, DOCS_SWITCH_ON, RESERVED, LEGACY_DOCS_ROOT, DATA_IGNORE_HEAD, OS_LITTER,
};
