'use strict';
// THE DOCS LAYER - where a capture's documents live, and how they are versioned.
//
// Two jobs, both absent-only:
//
//   - THE DOMAIN MIGRATION. Three documents a capture used to write at an old path now write at a
//     new one, so an existing install's file is relocated ONCE, byte-identical, and NEVER over a
//     file already at the new path. A folder becomes a domain the engine sees only when it holds a
//     `watch.json`, so a moved document stayed invisible until its capture re-ran - two of the
//     three get the minimal `{}` written for them. `quality/` and `related-context/` are watch-less
//     BY DESIGN and are left alone: one is recomputed every run, the other is a drop box.
//
//   - THE VERSIONING SEED. `ALFRED_CODE_DOCS_VERSIONING` says HOW the docs follow a branch: `git`
//     when they are committed, `local` when they are kept out of git and need per-branch overlays.
//     The rule lives in FOUR homes (both installer seeds, `stamp-docs-root.js`, the `docs.js`
//     engine fallback) and one table-driven test pins them together. Getting it wrong is silent and
//     expensive in one direction: seeding `local` over committed docs hides every section behind an
//     overlay, so the probe is written to fail toward `git`.
const fs = require('node:fs');
const path = require('node:path');
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
    // yet, but a directory-only pattern ('.claude/docs/') matches the bare name only once the
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

// The three moves, and the two switch-ons. related-context/ keeps every sibling-repo working paper
// exactly where it is - only the orientation doc that capture wrote moves out of it.
const DOCS_MIGRATIONS = [
    ['PROJECT-CODE-STYLE.md', 'code-style/CODE-STYLE.md', 'code style'],
    ['architecture/ASSESSMENT.md', 'quality/ASSESSMENT.md', 'architecture quality'],
    ['related-context/PROJECT-RELATED-CONTEXT.md', 'related-projects/RELATED-PROJECTS.md', 'related projects'],
];
const DOCS_SWITCH_ON = [['code-style', 'CODE-STYLE.md'], ['related-projects', 'RELATED-PROJECTS.md']];

function migrateDocsDomains({ projectRoot, docsPath, log = () => {} })
{
    const base = path.join(projectRoot, String(docsPath || '').replace(/\/+$/, ''));
    const moved = [];
    for (const [from, to, label] of DOCS_MIGRATIONS)
        if (migrateDocsFile(path.join(base, from), path.join(base, to), label, { log })) moved.push(to);
    const switched = [];
    for (const [dir, doc] of DOCS_SWITCH_ON)
        if (switchOnDomain(path.join(base, dir), doc, { log })) switched.push(dir);
    return { moved, switched };
}

module.exports = { domains, docsVersioningSeed, migrateDocsFile, switchOnDomain, migrateDocsDomains, DOCS_MIGRATIONS, DOCS_SWITCH_ON, RESERVED };
