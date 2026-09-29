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

// THE ROOT'S OWN .gitignore. The old default sat under `.claude/`, which a project's own `.claude/*`
// line kept out of git for free; `.alfred/docs` is outside it, so the root states its versioning itself,
// absent-only, the `.playwright` / `.memory-mcp` way. `local` keeps the whole root out of git - and git
// then answers check-ignore for the root, so the four-home rule reads it back as kept out. `git` commits
// the docs and keeps out only what the hooks write for this machine: the flow receipts, the block and
// usage ledgers, the session history (which also ignores itself) and the local overlays.
const DOCS_IGNORE = {
    local: '# alfred-code: the docs root is machine-local (ALFRED_CODE_DOCS_VERSIONING=local)\n*\n',
    git: '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
        + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n',
};

// 'written' | 'current' | 'replaced' | 'kept' (the project's own file) | 'outside' (the root is not in
// the project) | 'skipped' (no versioning to state, or a root under `.claude/`) | 'tracked' (local, over a
// root git already tracks docs in). A file that is exactly the stack's text for the
// OTHER mode is the stack's and follows a versioning switch; any other text is the project's.
function ensureDocsIgnore({ projectRoot, docsPath, mode, log = () => {} })
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
    if (have === want) return 'current';
    const shown = rel.split(path.sep).join('/');
    if (have !== null && !Object.values(DOCS_IGNORE).includes(have))
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
    log(`  docs root: ${shown}/.gitignore ${have === null ? 'written' : 'rewritten'} - ${mode === 'local' ? 'the whole root stays out of git' : "the docs are committed, the hooks' machine-local state is not"} (versioning ${mode})`);
    return have === null ? 'written' : 'replaced';
}

// THE DOCS PART OF A DATA MOVE. The docs root is <data root>/docs (ALFRED_CODE_DATA_PATH, stack/mcp/data-root.js)
// whenever the stack owns ALFRED_CODE_DOCS_PATH. Until 2.0.0 the stack seeded it with LEGACY_DOCS_ROOT
// (meta/environment.json `former_defaults`), under a folder Claude Code protects: every plan, capture and
// receipt the model wrote there cost a prompt, and a headless run could not write it at all. Docs are never
// moved silently. The plan says whether there is anything to OFFER - the old default (whoever set it: 2.0.0's
// `keep` answer is asked once more, by the data question, unless that question was answered `keep` too) or the
// stack's own root under an earlier data root; update and configure ask; `--data-move move` moves the tree,
// `--data-move keep` makes an old-default root the user's.
const LEGACY_DOCS_ROOT = '.claude/docs';
const DOCS_PATH_KEYS = ['ALFRED_CODE_DOCS_PATH', 'CLAUDE_STACK_DOCS_PATH', 'CLAUDE_DOCS_PATH']; // legacy-name
const normRoot = (v) => String(v || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const heldIn = (env) => DOCS_PATH_KEYS.find((k) => env && typeof env[k] === 'string' && env[k] !== '') || null;

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

// 'none' (nothing to offer - `why` says which rule), 'repoint' (the stack's own seed names the old root
// but nothing lives there, so the new default is simply taken) or 'offer', with what a move would carry.
// `env` is the settings file this install scope writes; `personal` the settings.local.json env Claude Code
// lays over it at project and user scope (null at local scope, where it IS `env`); `ledger` the last run's
// managed env keys (null: a stamp from before the ledger, so the old seed value itself is the evidence).
// The launch environment is never read: a settings value applies over a shell export
// (code.claude.com/docs/en/llm-gateway-connect), and the absent-only seed writes one on every run anyway.
// `to` is the docs root the data root names; `kept` the stamp's `data-move: kept` - an old default the user
// kept on the data question is never offered again.
function docsMovePlan({ projectRoot, env = {}, personal = null, ledger = null, stamped = false, to = require('./copy.js').DOCS_ROOT_DEFAULT, kept = false })
{
    const base = { from: LEGACY_DOCS_ROOT, to: normRoot(to), tracked: [], untracked: [], conflicts: [], ignored: false };
    const none = (why) => ({ ...base, state: 'none', why });
    if (!stamped) return none('no install record - a fresh install takes the new default');
    // A settings file that does not parse reads as empty - an absent key, which would look like the old
    // default applying. Whose root it names cannot be told, and the settings write would be refused anyway.
    const broken = ['settings.json', 'settings.local.json'].find((name) =>
    {
        const file = path.join(projectRoot, '.claude', name);
        if (!fs.existsSync(file)) return false;
        try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return !v || typeof v !== 'object' || Array.isArray(v); }
        catch { return true; }
    });
    if (broken) return none(`${broken} cannot be read`);
    // A root in the personal file is this machine's own choice, and the stamped rule is settings.json's
    // (R98) - a move written there alone would leave the rule and the team on the old root.
    if (heldIn(personal)) return none('settings.local.json holds your own docs root');
    const key = heldIn(env);
    let root = LEGACY_DOCS_ROOT;
    if (key)
    {
        root = normRoot(env[key]);
        if (root === base.to) return none(`the docs root is already ${root}`);
        // A root moves only when it is the stack's own: the ledger recorded it, or with no ledger (a stamp from
        // before it) it is a default the stack seeded - the old one, or the catalog's. The old default the ledger
        // does NOT record is the user's: 2.0.0's keep answer took it out of the ledger and promised no update
        // would offer the move again (M1) - an unattended update takes the recommended move, so asking again moved it.
        const hash = require('./stamp.js').valueHash(env[key]);
        const legacy = root === LEGACY_DOCS_ROOT;
        const stacks = ledger ? ledger[key] === hash || ledger.ALFRED_CODE_DOCS_PATH === hash : legacy || root === require('./copy.js').DOCS_ROOT_DEFAULT;
        if (!stacks) return none(legacy ? `kept at ${root} - the docs root is yours (a 2.0.0 keep, or set by hand)` : `the docs root is ${root}, set by hand`);
    }
    if (root === LEGACY_DOCS_ROOT && kept) return none('kept at the old default - the data move was answered keep');
    const plan = { ...base, from: root };
    const from = path.join(projectRoot, ...root.split('/'));
    const files = filesUnder(from);
    if (!files.length) return { ...plan, state: 'repoint', why: 'nothing is under the old root' };
    let tracked = [];
    try
    {
        const listed = rt.execCommand('git', ['ls-files', '-z', '--', root], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const prefix = `${root}/`;
        tracked = String(listed).split('\0').filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
    }
    catch { tracked = []; }   // no repository: every file is a plain move
    const onDisk = new Set(files);
    tracked = tracked.filter((f) => onDisk.has(f)).sort();
    const isTracked = new Set(tracked);
    const dest = path.join(projectRoot, ...normRoot(to).split('/'));
    // What git saw of the old root: nothing, when it ignored the root and tracks none of it - which a move
    // must keep, or every plan and task card there shows up untracked under the new root.
    let ignored = false;
    if (!tracked.length)
        try { rt.execCommand('git', ['check-ignore', '-q', '--', `${root}/`], { cwd: projectRoot, stdio: 'ignore' }); ignored = true; }
        catch { ignored = false; }
    return {
        ...plan, state: 'offer', why: root === LEGACY_DOCS_ROOT ? 'docs at the old default' : 'the stack\'s own docs under an earlier data root', ignored,
        tracked, untracked: files.filter((f) => !isTracked.has(f)),
        conflicts: files.filter((f) => fs.existsSync(path.join(dest, ...f.split('/')))),
    };
}

// The settings views a plan reads, one home for the installer and the preflight: at local scope the file
// the scope writes is settings.local.json laid over settings.json (the N6 merge) and there is no personal
// file beside it; at project and user scope settings.json alone, with settings.local.json as `personal`.
function docsMoveViews({ claudeDir, scope })
{
    const { readBackSettings } = require('./settings.js');
    const envOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    if (scope === 'local') return { env: envOf(readBackSettings(claudeDir, 'local').env), personal: null };
    let personal = {};
    try { personal = envOf((JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.local.json'), 'utf8')) || {}).env); }
    catch { personal = {}; }
    return { env: envOf(readBackSettings(claudeDir, 'project', { sharedOnly: true }).env), personal };
}

// The docs plan alone as one line: `docs-move: offer <from> -> <to>\ttracked=<n> untracked=<n>[\tignored=yes][\tconflicts=<n>]`,
// `docs-move: repoint <from> -> <to> (nothing to move)`, or `docs-move: none (<why>)`. The preflight prints the
// whole data move instead (dataOfferLine, below), the docs part folded in.
function docsMoveLine(plan)
{
    if (plan.state === 'offer')
        return `docs-move: offer ${plan.from} -> ${plan.to}\ttracked=${plan.tracked.length} untracked=${plan.untracked.length}`
            + (plan.ignored ? '\tignored=yes' : '') + (plan.conflicts.length ? `\tconflicts=${plan.conflicts.length}` : '');
    if (plan.state === 'repoint') return `docs-move: repoint ${plan.from} -> ${plan.to} (nothing to move)`;
    return `docs-move: none (${plan.why})`;
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

// THE DATA ROOT'S OWN .gitignore - its text and why live in stack/mcp/data-root.js (dataIgnoreText), the one
// home the launchers read too. The installer keeps it CURRENT: absent or the stack's own older text is
// written, any other text is the project's own and is left alone.
const { DATA_IGNORE_HEAD, dataIgnoreText } = require('../../stack/mcp/data-root.js');

// 'written' | 'replaced' | 'current' | 'kept' (the project's own file).
function ensureDataIgnore({ projectRoot, root, docsPath, log = () => {} })
{
    const base = path.join(projectRoot, ...normRoot(root).split('/'));
    const file = path.join(base, '.gitignore');
    const want = dataIgnoreText({ root, docsPath });
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

// THE WHOLE DATA MOVE AN UPDATE OFFERS - the docs plan and every server class whose data sits somewhere
// other than its place under the root (the 2.0.0 place, or an earlier root the stamp names), minus the moves
// already recorded as pending. { state: 'offer' | 'none', why, docs, rows, root }.
function dataOffer({ projectRoot, claudeDir, scope, ledger, stamped, stampText = '', root, engines = [], memoryProject = false })
{
    const dr = require('../../stack/mcp/data-root.js');
    const kept = /^data-move: *kept *$/m.test(stampText);
    const none = (why) => ({ state: 'none', why, docs: null, rows: [], root });
    if (!stamped) return none('no install record - a fresh install lays the data under the root');
    if (kept) return none('the data move was answered keep');
    const docsPlan = docsMovePlan({ projectRoot, ...docsMoveViews({ claudeDir, scope }), ledger, stamped, to: `${root}/docs`, kept });
    const priorLine = (/^data-root: *(\S+) *$/m.exec(stampText) || [])[1];
    const prior = priorLine && dr.checkDataPath(priorLine).ok && priorLine !== root ? priorLine : null;
    const pending = dr.readPending(stampText);
    const rows = dr.dataMovePlan({ projectRoot, root, prior, engines, memory: memoryProject })
        .filter((r) => !pending.some((p) => p.cls === r.cls && p.from === r.from && p.to === r.to));
    if (docsPlan.state !== 'offer' && !rows.length) return { ...none(docsPlan.state === 'repoint' ? 'nothing to move - the docs root is re-pointed' : 'nothing to move'), docs: docsPlan };
    return { state: 'offer', why: 'data outside the root', docs: docsPlan, rows, root };
}

// The preflight's line: `data-move: offer <root>\tfrom=<places>\tdocs=<n> serena=yes|no browser=<engines|none>
// memory=yes|no[\tignored=yes][\tconflicts=<n>]`, or `data-move: none (<why>)`.
function dataOfferLine(offer)
{
    if (offer.state !== 'offer') return `data-move: none (${offer.why})`;
    const docs = offer.docs && offer.docs.state === 'offer' ? offer.docs : null;
    const from = [...(docs ? [docs.from] : []), ...offer.rows.map((r) => r.from)];
    const has = (cls) => (offer.rows.some((r) => r.cls === cls) ? 'yes' : 'no');
    const engines = offer.rows.filter((r) => r.cls.startsWith('browser-')).map((r) => r.cls.slice('browser-'.length));
    const conflicts = (docs ? docs.conflicts.length : 0) + offer.rows.filter((r) => r.conflict).length;
    return `data-move: offer ${offer.root}\tfrom=${from.join(',')}\tdocs=${docs ? docs.tracked.length + docs.untracked.length : 0} serena=${has('serena')} browser=${engines.join(',') || 'none'} memory=${has('memory')}`
        + (docs && docs.ignored ? '\tignored=yes' : '') + (conflicts ? `\tconflicts=${conflicts}` : '');
}

module.exports = {
    domains, docsVersioningSeed, migrateDocsFile, switchOnDomain, migrateDocsDomains, ensureDocsIgnore, docsMovePlan, docsMoveViews, docsMoveLine, moveDocsRoot,
    ensureDataIgnore, dataIgnoreText, pruneDataRoot, dataOffer, dataOfferLine,
    DOCS_IGNORE, DOCS_MIGRATIONS, DOCS_SWITCH_ON, RESERVED, LEGACY_DOCS_ROOT, DATA_IGNORE_HEAD,
};
