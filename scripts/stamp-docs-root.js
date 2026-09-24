#!/usr/bin/env node
'use strict';
// Stamp the deployed baseline-docs-root.md rule with the CURRENT docs root: the ALFRED_CODE_DOCS_PATH
// env value in <root>/.claude/settings.json, else the default. Handles both the fresh copy (the
// __DOCS_ROOT__ placeholder) and a previously stamped value - so the guided commands can re-stamp
// after an env change without re-running the installer (the installers stamp fresh copies with
// their own embedded logic; this script is the between-runs re-stamp).
//
// Usage: node stamp-docs-root.js [project-root]        (default: cwd - rules/ + settings.json under <root>/.claude)
//        node stamp-docs-root.js --claude-dir <dir>    (a global install: the account dir itself, e.g. ~/.claude-work)
//        node stamp-docs-root.js [project-root] --reprobe-versioning <value-this-run-seeded>
//                                                   (re-probe the docs-versioning mode at the path the file now
//                                                    holds; refused unless the file still holds that value)
//        node stamp-docs-root.js [project-root] --seed-versioning
//                                                   (ALFRED_CODE_DOCS_VERSIONING absent -> write probeVersioning's
//                                                    answer for the docs root the file holds; present -> untouched.
//                                                    Project root only - a global install is skipped with a message.)
// Exit 0 always - a missing rule file or unreadable settings is a fail-soft no-op with a message.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_ROOT = '.claude/docs';
const STAMP_RE = /(This install's root: `)[^`]*(`)/;

function resolveDocsRoot(settingsFile)
{
    try
    {
        const env = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).env || {};
        // CLAUDE_DOCS_PATH is the pre-0.2.43 spelling - still read, so an install whose settings
        // the rename has not reached yet stamps its own root rather than the default.
        return env.ALFRED_CODE_DOCS_PATH || env.CLAUDE_DOCS_PATH || DEFAULT_ROOT;
    }
    catch
    {
        return DEFAULT_ROOT;
    }
}

// claudeDir holds rules/ + settings.json: <project>/.claude for a project install, the account dir
// (~/.claude, ~/.claude-<space>) for a global one.
function stampDir(claudeDir)
{
    const ruleFile = path.join(claudeDir, 'rules', 'baseline-docs-root.md');
    if (!fs.existsSync(ruleFile))
    {
        console.log(`stamp-docs-root: no ${ruleFile} - nothing to stamp`);
        return;
    }
    const val = resolveDocsRoot(path.join(claudeDir, 'settings.json'));
    const text = fs.readFileSync(ruleFile, 'utf8');
    if (!STAMP_RE.test(text))
    {
        console.log(`stamp-docs-root: no stamp line in ${ruleFile} - left unchanged (env value still wins at session start)`);
        return;
    }
    fs.writeFileSync(ruleFile, text.replace(STAMP_RE, `$1${val}$2`));
    console.log(`stamp-docs-root: stamped '${val}' into ${ruleFile}`);
}

function stamp(root)
{
    stampDir(path.join(root, '.claude'));
}

// The rule an ABSENT ALFRED_CODE_DOCS_VERSIONING is seeded by - the same rule as both installer seeds and docs.js
// keptOutOfGit(), and a table-driven test runs all four over the same repos: 'local' only when the docs are kept OUT
// of git - no domain is tracked AND either (a) a domain exists or (b) git ignores the docs root - and 'git' otherwise,
// a fresh project whose docs root is not ignored included. A tracked domain wins over an ignored root. `docs` is the
// docs path relative to `root`, forward slashes; the ignore probe asks `<docs>/` so a directory-only pattern matches a
// root that does not exist yet. Every DOMAIN is probed, never architecture/ alone: a watch.json is what makes a folder
// a domain (architecture/ is grandfathered in without one), so a project documented only in code-style/, decisions/ or
// related-projects/ is an ordinary shape. Same rule as docs.js domains(), reserved names and all; a watch-less folder
// like quality/ is no domain and no vote.
function probeVersioning(root, docs)
{
    const base = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${docs}`;
    let domainDirs = [];
    try
    {
        domainDirs = fs.readdirSync(base, { withFileTypes: true })
            .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['references', 'history'].includes(e.name))
            .map(e => e.name)
            .filter(n => n === 'architecture' || fs.existsSync(path.join(base, n, 'watch.json')))
            .sort();
    }
    catch { domainDirs = []; }
    const quiet = { cwd: root, stdio: 'ignore' };
    if (domainDirs.some(n => spawnSync('git', ['ls-files', '--error-unmatch', '--', `${base}/${n}`], quiet).status === 0)) return 'git';
    if (domainDirs.length) return 'local';
    return docs && spawnSync('git', ['check-ignore', '-q', '--', `${docs}/`], quiet).status === 0 ? 'local' : 'git';
}

// ALFRED_CODE_DOCS_VERSIONING is seeded by that rule, probed at the docs path the settings file
// held when the INSTALL ran. On the setup route the user's chosen docs root is applied AFTER that, so a key seeded
// against the old path can describe the wrong folder. The walk that MOVES the path re-probes here, in the same
// step that re-stamps the rule, and only when its own run seeded the key: a value an earlier install wrote is a
// decision, and re-probing it would silently switch an existing install. That condition is CHECKED, not trusted:
// the caller passes the value its own install seeded and the re-probe refuses when the file holds anything else -
// a user's answer on the environment screen, or an older install's value, reads as a mismatch and is left alone.
// Forward slashes on every OS, like the installers' own probe - a mixed-separator pathspec can fail to match under
// Git for Windows.
function reprobeVersioning(root, seeded)
{
    if (seeded !== 'git' && seeded !== 'local')
    {
        console.log("stamp-docs-root: --reprobe-versioning needs the value the install seeded ('git' or 'local') - nothing re-probed");
        return;
    }
    const settingsFile = path.join(root, '.claude', 'settings.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { console.log(`stamp-docs-root: cannot read ${settingsFile} - docs versioning left as it is`); return; }
    if (!data || typeof data !== 'object' || !data.env || !data.env.ALFRED_CODE_DOCS_VERSIONING)
    {
        console.log('stamp-docs-root: no ALFRED_CODE_DOCS_VERSIONING in the env block - nothing to re-probe');
        return;
    }
    if (data.env.ALFRED_CODE_DOCS_VERSIONING !== seeded)
    {
        console.log(`stamp-docs-root: the env block holds '${data.env.ALFRED_CODE_DOCS_VERSIONING}', not the '${seeded}' this run seeded - that is a decision, so docs versioning is left as it is`);
        return;
    }
    const docs = String(resolveDocsRoot(settingsFile)).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }).status !== 0)
    {
        console.log('stamp-docs-root: not a git repository - docs versioning left as it is');
        return;
    }
    const value = probeVersioning(root, docs);
    if (data.env.ALFRED_CODE_DOCS_VERSIONING === value)
    {
        console.log(`stamp-docs-root: docs versioning already '${value}' at ${docs}/ - unchanged`);
        return;
    }
    data.env.ALFRED_CODE_DOCS_VERSIONING = value;
    fs.writeFileSync(settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`stamp-docs-root: docs versioning re-probed at ${docs}/: '${value}'`);
}

// The MISSING-row case `validate.md` (and any other reader) uses instead of the environment.json catalog default:
// that default is a CONSTANT ('git'), but this one key is DETECTED - writing the constant over a project whose docs
// are kept out of git is the exact silent switch the rule exists to prevent. Present already: left byte-for-byte,
// same guard as reprobeVersioning's 'a decision is never touched'. Merges only this one key.
function seedVersioning(root)
{
    const settingsFile = path.join(root, '.claude', 'settings.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { console.log(`stamp-docs-root: cannot read ${settingsFile} - nothing seeded`); return; }
    // An array is typeof 'object' too, and a property set on one is dropped by JSON.stringify - so without
    // the isArray checks a top-level [] or an `env: []` printed 'seeded' while writing nothing, and a string
    // `env` threw under strict mode, breaking the exit-0 promise. Each shape refuses before any write.
    const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!isObject(data))
    {
        console.log(`stamp-docs-root: ${settingsFile} is not a JSON object - nothing seeded`);
        return;
    }
    if (data.env !== undefined && !isObject(data.env))
    {
        console.log(`stamp-docs-root: ${settingsFile} has an env that is not a JSON object - nothing seeded`);
        return;
    }
    if (data.env && data.env.ALFRED_CODE_DOCS_VERSIONING)
    {
        console.log(`stamp-docs-root: ALFRED_CODE_DOCS_VERSIONING already '${data.env.ALFRED_CODE_DOCS_VERSIONING}' - nothing seeded`);
        return;
    }
    const docs = String(resolveDocsRoot(settingsFile)).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const value = probeVersioning(root, docs);
    const why = value === 'local' ? 'the docs are kept out of git' : 'the docs are not kept out of git';
    data.env = data.env || {};
    data.env.ALFRED_CODE_DOCS_VERSIONING = value;
    fs.writeFileSync(settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`stamp-docs-root: settings.json env: ALFRED_CODE_DOCS_VERSIONING seeded '${value}' at ${docs}/ - ${why}`);
}

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const i = argv.indexOf('--claude-dir');
    const reprobeAt = argv.indexOf('--reprobe-versioning');
    const seedAt = argv.indexOf('--seed-versioning');
    // The word after a flag is that flag's VALUE, never the positional project root - both value-taking flags do this;
    // --seed-versioning takes none, so it never claims the next word.
    const values = new Set([i + 1, reprobeAt + 1].filter(k => k > 0));
    const root = path.resolve(argv.find((a, k) => !a.startsWith('--') && !values.has(k)) || '.');
    if (i >= 0 && argv[i + 1]) stampDir(path.resolve(argv[i + 1]));
    else stamp(root);
    if (reprobeAt >= 0)
    {
        // A global install has no project repo to probe, and its docs root is not a path in one.
        if (i >= 0 && argv[i + 1]) console.log('stamp-docs-root: --reprobe-versioning needs a project root - skipped for a global install');
        else reprobeVersioning(root, argv[reprobeAt + 1]);
    }
    if (seedAt >= 0)
    {
        if (i >= 0 && argv[i + 1]) console.log('stamp-docs-root: --seed-versioning needs a project root - skipped for a global install');
        else seedVersioning(root);
    }
}

module.exports = { stamp, stampDir, resolveDocsRoot, reprobeVersioning, probeVersioning, seedVersioning };
